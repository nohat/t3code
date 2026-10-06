// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/**
 * Fork release versions. The fork ships its own short semver line starting at
 * 1.0.0: the first packaged fork build is 1.0.0, and every deploy after that
 * bumps what the change warrants. One version covers macOS, server, and iOS
 * together, so any surface reports the same number for a given release.
 *
 * The registry maps deploy-root release shas to the version they shipped, so a
 * rebuild of an already-released sha reuses its version instead of minting a
 * new one. The decision ledger records why each bump picked its level, so
 * later agents stay consistent and the reasoning compounds.
 */

export const FORK_INITIAL_VERSION = "1.0.0";

/** File inside the deploy root holding the sha -> entry registry. */
export const VERSION_REGISTRY_FILE = "fork-versions.json";
/** File inside the deploy root holding the bump decision ledger. */
export const VERSION_LEDGER_FILE = "fork-version-decisions.md";
/** Marker file written into each complete release dir. */
export const RELEASE_VERSION_FILE = ".fork-version";

export type ForkBumpLevel = "major" | "minor" | "patch";

export interface ForkVersionEntry {
  readonly version: string;
  /** Full 40-hex commit sha the version was built from. */
  readonly sha: string;
}

export type ForkVersionRegistry = Record<string, ForkVersionEntry>;

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const HEX_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export const isForkVersion = (value: string): boolean => SEMVER_PATTERN.test(value.trim());

export const isCommitSha = (value: string): boolean => HEX_SHA_PATTERN.test(value.trim());

export const normalizeSha = (value: string): string => value.trim().toLowerCase();

export function parseForkVersion(value: string): {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
} | null {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function bumpForkVersion(version: string, level: ForkBumpLevel): string {
  const parsed = parseForkVersion(version);
  if (!parsed) throw new Error(`cannot bump non-semver fork version "${version}"`);
  switch (level) {
    case "major":
      return `${parsed.major + 1}.0.0`;
    case "minor":
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case "patch":
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
}

export function compareForkVersions(left: string, right: string): number {
  const parsedLeft = parseForkVersion(left);
  const parsedRight = parseForkVersion(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error(`cannot compare non-semver fork versions "${left}" and "${right}"`);
  }
  return (
    parsedLeft.major - parsedRight.major ||
    parsedLeft.minor - parsedRight.minor ||
    parsedLeft.patch - parsedRight.patch
  );
}

const registryPath = (root: string) => NodePath.join(root, VERSION_REGISTRY_FILE);
const ledgerPath = (root: string) => NodePath.join(root, VERSION_LEDGER_FILE);

/** Reads the registry, returning {} when no release has shipped yet. */
export function readVersionRegistry(root: string): ForkVersionRegistry {
  let raw: string;
  try {
    raw = NodeFS.readFileSync(registryPath(root), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`fork version registry is not valid JSON: ${registryPath(root)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`fork version registry is not an object: ${registryPath(root)}`);
  }
  const registry: ForkVersionRegistry = {};
  for (const [sha, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`fork version registry entry for ${sha} is not an object`);
    }
    const { version, sha: entrySha } = entry as Record<string, unknown>;
    if (typeof version !== "string" || !isForkVersion(version)) {
      throw new Error(`fork version registry entry for ${sha} has no semver version`);
    }
    if (typeof entrySha !== "string" || !isCommitSha(entrySha)) {
      throw new Error(`fork version registry entry for ${sha} has no commit sha`);
    }
    const normalized = normalizeSha(sha);
    if (normalizeSha(entrySha) !== normalized) {
      throw new Error(`fork version registry key ${sha} does not match its entry sha`);
    }
    if (registry[normalized]) {
      throw new Error(`fork version registry has a duplicate entry for ${sha}`);
    }
    registry[normalized] = { version: version.trim(), sha: normalizeSha(entrySha) };
  }
  return registry;
}

/** Newest registry version, or null before the first release. */
export function latestRegistryVersion(registry: ForkVersionRegistry): string | null {
  let latest: string | null = null;
  for (const entry of Object.values(registry)) {
    if (latest === null || compareForkVersions(entry.version, latest) > 0) latest = entry.version;
  }
  return latest;
}

/** The version already assigned to this sha, matching by prefix or full sha. */
export function versionForSha(registry: ForkVersionRegistry, sha: string): ForkVersionEntry | null {
  const normalized = normalizeSha(sha);
  for (const entry of Object.values(registry)) {
    if (entry.sha === normalized || entry.sha.startsWith(normalized)) return entry;
  }
  return null;
}

/**
 * Next version for a new sha: reuse the recorded one on rebuild, else bump the
 * newest shipped version (or start the line at 1.0.0 for the first release).
 */
export function resolveForkVersion(
  registry: ForkVersionRegistry,
  sha: string,
  level: ForkBumpLevel,
): { readonly version: string; readonly reused: boolean } {
  const existing = versionForSha(registry, sha);
  if (existing) return { version: existing.version, reused: true };
  const latest = latestRegistryVersion(registry);
  if (latest === null) return { version: FORK_INITIAL_VERSION, reused: false };
  return { version: bumpForkVersion(latest, level), reused: false };
}

/** Atomically records sha -> version; throws when the sha already maps elsewhere. */
export function recordForkVersion(root: string, sha: string, version: string): ForkVersionEntry {
  const normalized = normalizeSha(sha);
  if (!isCommitSha(normalized)) throw new Error(`refusing to record non-sha "${sha}"`);
  if (!isForkVersion(version)) throw new Error(`refusing to record non-semver "${version}"`);
  const registry = readVersionRegistry(root);
  const existing = versionForSha(registry, normalized);
  if (existing) {
    if (existing.version !== version.trim()) {
      throw new Error(
        `sha ${normalized} already shipped as ${existing.version}; refusing to reassign ${version}`,
      );
    }
    return existing;
  }
  for (const entry of Object.values(registry)) {
    if (entry.version === version.trim() && entry.sha !== normalized) {
      throw new Error(`version ${version} already maps to ${entry.sha}; refusing to reuse it`);
    }
  }
  const entry: ForkVersionEntry = { version: version.trim(), sha: normalized };
  const next: ForkVersionRegistry = { ...registry, [normalized]: entry };
  NodeFS.mkdirSync(root, { recursive: true });
  const tmp = NodePath.join(root, `.${VERSION_REGISTRY_FILE}.${process.pid}`);
  NodeFS.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  NodeFS.renameSync(tmp, registryPath(root));
  return entry;
}

/** Reads the .fork-version marker a completed release carries. */
export function readReleaseVersion(root: string, sha: string): string | null {
  try {
    const value = NodeFS.readFileSync(
      NodePath.join(root, "releases", sha, RELEASE_VERSION_FILE),
      "utf8",
    ).trim();
    return isForkVersion(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeReleaseVersion(root: string, sha: string, version: string): void {
  NodeFS.writeFileSync(
    NodePath.join(root, "releases", sha, RELEASE_VERSION_FILE),
    `${version.trim()}\n`,
  );
}

export interface ForkBumpDecision {
  readonly version: string;
  readonly level: ForkBumpLevel;
  readonly sha: string;
  /** One line: what shipped. */
  readonly summary: string;
  /** Why this level and not the neighbors. Required so the ledger compounds. */
  readonly rationale: string;
}

/**
 * Appends a bump decision to the ledger. The rationale is required: a version
 * without a recorded reason teaches the next agent nothing.
 */
export function appendBumpDecision(root: string, decision: ForkBumpDecision): void {
  if (!isForkVersion(decision.version)) {
    throw new Error(`refusing to ledger non-semver "${decision.version}"`);
  }
  if (!isCommitSha(decision.sha)) {
    throw new Error(`refusing to ledger non-sha "${decision.sha}"`);
  }
  if (!decision.summary.trim()) throw new Error("refusing to ledger a decision without a summary");
  if (!decision.rationale.trim()) {
    throw new Error("refusing to ledger a decision without a rationale");
  }
  NodeFS.mkdirSync(root, { recursive: true });
  const path = ledgerPath(root);
  if (!NodeFS.existsSync(path)) {
    NodeFS.writeFileSync(
      path,
      `# Fork version decisions\n\nEach shipped version records why its bump level was picked, so later agents stay consistent.\n\n`,
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  NodeFS.writeFileSync(
    path,
    `## ${decision.version} (${decision.level}, ${date})\n\n- sha: \`${normalizeSha(decision.sha)}\`\n- shipped: ${decision.summary.trim()}\n- why ${decision.level}: ${decision.rationale.trim()}\n\n`,
    { flag: "a" },
  );
}

/** Versioned releases, newest version first. Unversioned legacy releases sort last by mtime. */
export function listVersionedReleases(root: string): readonly string[] {
  const dir = NodePath.join(root, "releases");
  if (!NodeFS.existsSync(dir)) return [];
  const names = NodeFS.readdirSync(dir).filter((name) => {
    try {
      return NodeFS.statSync(NodePath.join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
  const withVersion: { readonly sha: string; readonly version: string | null }[] = names.map(
    (sha) => ({ sha, version: readReleaseVersion(root, sha) }),
  );
  withVersion.sort((a, b) => {
    if (a.version && b.version) return compareForkVersions(b.version, a.version);
    if (a.version) return -1;
    if (b.version) return 1;
    return (
      NodeFS.statSync(NodePath.join(dir, b.sha)).mtimeMs -
      NodeFS.statSync(NodePath.join(dir, a.sha)).mtimeMs
    );
  });
  return withVersion.map((entry) => entry.sha);
}
