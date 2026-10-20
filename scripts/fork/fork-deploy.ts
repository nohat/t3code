#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
/**
 * Builds the fork's packaged macOS app and installs it into /Applications, to be launched and
 * quit like any other app. Nothing keeps it running: no launchd job, no supervisor.
 *
 *   node scripts/fork/fork-deploy.ts build <ref> [--bump <major|minor|patch>] [--version <x.y.z>] [--summary <t>] [--why <t>]
 *   node scripts/fork/fork-deploy.ts install <ref> [same version flags]
 *   node scripts/fork/fork-deploy.ts status
 *   node scripts/fork/fork-deploy.ts version <ref> [--bump ...] [--version ...]
 *
 * `install` builds the ref if it has no release yet, quits the running app (it refuses to go on
 * while the app or the server port is still up, so one writer holds the database), copies the app
 * in, writes the port, data home, and telemetry setting into its Info.plist as LSEnvironment
 * (Finder launches carry no shell environment), and re-signs the bundle ad hoc. `deploy`,
 * `rollback`, and `plist` are gone with the launch agent.
 *
 * Versions: the fork ships its own semver line from 1.0.0. A fresh sha mints
 * the next version (bump level, default patch); a rebuild reuses the recorded
 * one. Minting requires --summary (what ships) and --why (why this level), so
 * the decision ledger in the deploy root records the reasoning. See
 * docs/fork/versioning.md for the bump rules.
 *
 * Machine-specific settings (paths, port, notifier) live in a JSON file outside git, named by
 * --config or FORK_DEPLOY_CONFIG. Only failures, holds, and rollbacks are reported; silence
 * means the deploy succeeded.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  COMPLETE_MARKER,
  countRunningSessions,
  ensureDir,
  isComplete,
  probeHealth,
  pruneReleases,
  readCurrent,
  releaseDir,
  resolveStateDb,
  serverCliCommand,
} from "./fork-deploy-lib.ts";
import {
  appendBumpDecision,
  FORK_INITIAL_VERSION,
  type ForkBumpLevel,
  isForkVersion,
  latestRegistryVersion,
  listVersionedReleases,
  readReleaseVersion,
  readVersionRegistry,
  recordForkVersion,
  resolveForkVersion,
  versionForSha,
  writeReleaseVersion,
} from "./fork-versions.ts";

interface Config {
  /** Deploy root holding releases/, current, and the lock. */
  readonly root: string;
  /** Dedicated git worktree used only for building; it is checked out detached. */
  readonly buildTree: string;
  /** T3CODE_HOME of the production instance. */
  readonly home: string;
  readonly port: number;
  /** Where the app is installed; defaults to /Applications. */
  readonly appsDir?: string;
  /** Command prefix that delivers a message; `--summary <text> --message <body>` is appended. */
  readonly notify?: readonly string[];
  /** PATH for the scrubbed build environment (toolchains the build needs). */
  readonly buildPath: string;
  /** Commands run in the build tree before building; each must exit 0. */
  readonly gate: readonly (readonly string[])[];
  readonly keepReleases?: number;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    // Which segment to bump when a build mints a fresh version. Rebuilds of an
    // already-released sha reuse its version and ignore this.
    bump: { type: "string", default: "patch" },
    // Explicit version for this build, bypassing the bump. Must be unused.
    version: { type: "string" },
    // One line: what ships. Recorded in the decision ledger with --why.
    summary: { type: "string" },
    // Why this level and not the neighbors. Required when minting a version.
    why: { type: "string" },
  },
});

const configPath = values.config ?? process.env.FORK_DEPLOY_CONFIG ?? ".t3/fork-deploy.json";
const config: Config = JSON.parse(readFileSync(configPath, "utf8"));
const appsDir = config.appsDir ?? "/Applications";
const BUNDLE_ID = "com.t3tools.t3code";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message: string) => console.log(`fork-deploy: ${message}`);

function report(summary: string, body: string): void {
  console.error(`fork-deploy: ${summary}\n${body}`);
  if (!config.notify?.length) return;
  const [command, ...args] = config.notify;
  // A hung notifier (it once sat on a network call for hours) must not hold up the deploy.
  spawnSync(command!, [...args, "--summary", summary.slice(0, 200), "--message", body], {
    stdio: "ignore",
    timeout: 30_000,
  });
}

/** Runs a command with extra env vars, still scrubbed of the dev shell. */
function runWithEnv(
  command: readonly string[],
  cwd: string,
  extraEnv: Readonly<Record<string, string>>,
): void {
  const [file, ...args] = command;
  const result = spawnSync(file!, args, {
    cwd,
    stdio: "inherit",
    env: {
      HOME: homedir(),
      PATH: config.buildPath,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: "en_US.UTF-8",
      ...extraEnv,
    },
  });
  if (result.status !== 0) throw new Error(`${command.join(" ")} exited ${result.status}`);
}

/** Runs a command with only PATH and HOME, so nothing from an agent or dev shell leaks in. */
function run(command: readonly string[], cwd: string): void {
  runWithEnv(command, cwd, {});
}

function git(...args: string[]): string {
  const result = spawnSync("git", ["-C", config.buildTree, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

const BUMP_LEVELS = ["major", "minor", "patch"] as const;

function parseBumpLevel(raw: string | undefined): ForkBumpLevel {
  const level = (raw ?? "patch").trim().toLowerCase();
  if (level === "major" || level === "minor" || level === "patch") return level;
  throw new Error(`--bump must be one of ${BUMP_LEVELS.join(", ")}, got "${raw}"`);
}

/**
 * Resolves the version a build of this sha ships as. A rebuild reuses the
 * recorded version; a fresh sha mints one from the bump level (or an explicit
 * --version) and records it, plus the decision rationale, before building.
 */
function resolveBuildVersion(fullSha: string): {
  readonly version: string;
  readonly fresh: boolean;
} {
  const registry = readVersionRegistry(config.root);
  const existing = versionForSha(registry, fullSha);
  if (existing) {
    log(`${existing.sha.slice(0, 10)} already shipped as ${existing.version}; reusing it`);
    return { version: existing.version, fresh: false };
  }
  const explicit = values.version?.trim();
  if (explicit) {
    if (!isForkVersion(explicit)) throw new Error(`--version "${explicit}" is not semver`);
    if (versionForSha(registry, fullSha)) {
      throw new Error(`sha ${fullSha} already has a version`);
    }
    for (const entry of Object.values(registry)) {
      if (entry.version === explicit) {
        throw new Error(`version ${explicit} already maps to ${entry.sha}; pick another`);
      }
    }
    const summary = values.summary?.trim();
    const why = values.why?.trim();
    if (!summary || !why) {
      throw new Error("--summary and --why are required when minting a version with --version");
    }
    recordForkVersion(config.root, fullSha, explicit);
    appendBumpDecision(config.root, {
      version: explicit,
      level: latestRegistryVersion(registry) ? parseBumpLevel(values.bump) : "patch",
      sha: fullSha,
      summary,
      rationale: `explicit --version: ${why}`,
    });
    return { version: explicit, fresh: true };
  }
  const level = parseBumpLevel(values.bump);
  const { version } = resolveForkVersion(registry, fullSha, level);
  const summary = values.summary?.trim();
  const why = values.why?.trim();
  if (!summary || !why) {
    throw new Error(
      `minting ${version} (${level} from ${latestRegistryVersion(registry) ?? "nothing"}): ` +
        "--summary and --why are required so the ledger records the bump decision",
    );
  }
  recordForkVersion(config.root, fullSha, version);
  appendBumpDecision(config.root, { version, level, sha: fullSha, summary, rationale: why });
  log(`minted fork version ${version} (${level}) for ${fullSha.slice(0, 10)}`);
  return { version, fresh: true };
}

function buildRelease(sha: string, version: string): void {
  if (git("status", "--porcelain"))
    throw new Error("build tree has local changes; refusing to build");
  git("checkout", "--detach", sha);
  for (const command of config.gate) run(command, config.buildTree);
  run(["vp", "i"], config.buildTree);

  const out = join(config.root, `.build-${sha}`);
  const partial = `${releaseDir(config.root, sha)}.partial`;
  rmSync(out, { recursive: true, force: true });
  rmSync(partial, { recursive: true, force: true });
  // One version for every surface: the artifact, the bundled server, the web
  // client, and the mobile build when it runs through this path all read
  // T3CODE_FORK_VERSION.
  const versionEnv = { T3CODE_FORK_VERSION: version };
  runWithEnv(
    [
      "node",
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      "--arch",
      "arm64",
      "--build-version",
      version,
      "--output-dir",
      out,
    ],
    config.buildTree,
    versionEnv,
  );
  const zip = spawnSync("sh", ["-c", `ls "${out}"/*.zip`], { encoding: "utf8" }).stdout.trim();
  if (!zip) throw new Error("build produced no zip");
  mkdirSync(partial, { recursive: true });
  run(["ditto", "-x", "-k", zip, partial], config.buildTree);
  writeFileSync(join(partial, COMPLETE_MARKER), `${sha}\n`);
  writeReleaseVersion(config.root, `${sha}.partial`, version);
  // The release dir name is the destination: rename moves the version marker
  // with it, so the marker must be written to the partial path first.
  renameSync(partial, releaseDir(config.root, sha));
  rmSync(out, { recursive: true, force: true });
}

/** Builds a release without touching production, so the later deploy is only a swap. */
async function build(ref: string): Promise<number> {
  const sha = git("rev-parse", "--short=10", `${ref}^{commit}`);
  const fullSha = git("rev-parse", `${ref}^{commit}`);
  if (isComplete(config.root, sha)) {
    const existing = readReleaseVersion(config.root, sha);
    if (!existing) throw new Error("cached artifact is unversioned; build a new revision instead");
    return (log(`${sha} is already built${existing ? ` as fork ${existing}` : ""}`), 0);
  }
  ensureDir(join(config.root, "releases"));
  const lock = join(config.root, ".deploy.lock");
  try {
    mkdirSync(lock);
  } catch {
    report("build refused: another deploy holds the lock", `lock: ${lock}`);
    return 1;
  }
  try {
    const { version } = resolveBuildVersion(fullSha);
    log(`building ${sha} as fork ${version}`);
    buildRelease(sha, version);
    return 0;
  } catch (error) {
    report(`build of ${sha} failed`, String(error instanceof Error ? error.message : error));
    return 1;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const installedMarker = () => join(config.root, ".installed");

function readInstalled(): string | null {
  try {
    return readFileSync(installedMarker(), "utf8").trim() || null;
  } catch {
    return null;
  }
}

async function status(): Promise<number> {
  const installed = readInstalled();
  const versionOf = (sha: string | null) =>
    sha ? (readReleaseVersion(config.root, sha) ?? "(unversioned)") : "(none)";
  log(`installed=${installed ?? "(none)"} fork=${versionOf(installed)} in ${appsDir}`);
  const releases = listVersionedReleases(config.root);
  log(
    `releases: ${
      releases.map((sha) => `${sha}@${readReleaseVersion(config.root, sha) ?? "?"}`).join(", ") ||
      "(none)"
    }`,
  );
  const registry = readVersionRegistry(config.root);
  const latest = latestRegistryVersion(registry);
  log(
    `fork line: latest=${latest ?? `(none; next build mints ${FORK_INITIAL_VERSION})`} ` +
      `registry=${Object.keys(registry).length} release(s)`,
  );
  log(`app running=${appRunning()} server healthy=${await probeHealth(config.port)}`);
  const stateDb = resolveStateDb(config.home);
  log(
    `running turns: ${existsSync(stateDb) ? (countRunningSessions(stateDb) ?? "(unreadable)") : "(no database)"} (${stateDb})`,
  );
  return 0;
}

/** True while any process runs from an app bundle that carries this fork's bundle id. */
function appRunning(): boolean {
  const script = `tell application "System Events" to count (every process whose bundle identifier is "${BUNDLE_ID}")`;
  const result = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  return Number(result.stdout.trim()) > 0;
}

/** The `.app` inside a release; its name follows upstream's product name (Alpha, Beta, ...). */
function releaseApp(sha: string): string {
  const name = readdirSync(releaseDir(config.root, sha)).find((entry) => entry.endsWith(".app"));
  if (!name) throw new Error(`release ${sha} contains no .app`);
  return name;
}

/**
 * Installs a release into the apps directory so it launches and quits like any macOS app. The
 * environment a LaunchAgent used to supply goes into the bundle's Info.plist as LSEnvironment,
 * which Launch Services applies to Finder, Dock, and `open` launches; editing the plist breaks
 * the signature, so the bundle is re-signed ad hoc.
 */
async function install(ref: string): Promise<number> {
  const sha = git("rev-parse", "--short=10", `${ref}^{commit}`);
  const fullSha = git("rev-parse", `${ref}^{commit}`);
  ensureDir(join(config.root, "releases"));
  const lock = join(config.root, ".deploy.lock");
  try {
    mkdirSync(lock);
  } catch {
    report("install refused: another build or install holds the lock", `lock: ${lock}`);
    return 1;
  }
  try {
    const { version } = resolveBuildVersion(fullSha);
    if (!isComplete(config.root, sha)) {
      log(`building ${sha} as fork ${version}`);
      buildRelease(sha, version);
    } else if (readReleaseVersion(config.root, sha) !== version) {
      throw new Error(
        "cached artifact does not carry this fork version; build a new revision instead",
      );
    }

    if (appRunning()) {
      log("quitting the running app");
      spawnSync("osascript", ["-e", `tell application id "${BUNDLE_ID}" to quit`], {
        stdio: "inherit",
        timeout: 30_000,
      });
      // A quit that waits on a running turn or a shutdown flush gets minutes, not a kill.
      for (let waited = 0; waited < 180 && appRunning(); waited += 2) await sleep(2000);
    }
    if (appRunning() || (await probeHealth(config.port))) {
      throw new Error(
        `the app or its server on port ${config.port} is still running; quit it and retry`,
      );
    }

    const name = releaseApp(sha);
    const destination = join(appsDir, name);
    const staged = join(appsDir, `.${name}.installing`);
    rmSync(staged, { recursive: true, force: true });
    run(["ditto", join(releaseDir(config.root, sha), name), staged], config.buildTree);
    const plistPath = join(staged, "Contents", "Info.plist");
    for (const [key, value] of [
      ["T3CODE_PORT", String(config.port)],
      ["T3CODE_HOME", config.home],
      ["T3CODE_TELEMETRY_ENABLED", "false"],
    ] as const) {
      run(["plutil", "-replace", `LSEnvironment.${key}`, "-string", value, plistPath], appsDir);
    }
    run(["xattr", "-cr", staged], appsDir);
    run(["codesign", "--force", "--deep", "--sign", "-", staged], appsDir);
    rmSync(destination, { recursive: true, force: true });
    renameSync(staged, destination);
    writeFileSync(installedMarker(), `${sha}\n`);
    pruneReleases(config.root, config.keepReleases ?? 3);
    log(`installed ${sha} (fork ${version}) as ${destination}; launch it from Finder`);
    return 0;
  } catch (error) {
    report(`install of ${sha} failed`, String(error instanceof Error ? error.message : error));
    return 1;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Prints the version a ref would ship as, without building. */
function version(ref: string): number {
  const fullSha = git("rev-parse", `${ref}^{commit}`);
  const registry = readVersionRegistry(config.root);
  const existing = versionForSha(registry, fullSha);
  if (existing) {
    log(`${fullSha.slice(0, 10)} already shipped as fork ${existing.version}`);
    return 0;
  }
  const explicit = values.version?.trim();
  if (explicit) {
    if (!isForkVersion(explicit)) throw new Error(`--version "${explicit}" is not semver`);
    log(`${fullSha.slice(0, 10)} would ship as fork ${explicit} (explicit)`);
    return 0;
  }
  const level = parseBumpLevel(values.bump);
  const { version: next } = resolveForkVersion(registry, fullSha, level);
  log(
    `${fullSha.slice(0, 10)} would ship as fork ${next} ` +
      `(${level} from ${latestRegistryVersion(registry) ?? "nothing"})`,
  );
  return 0;
}

const [command, ref] = positionals;
const exitCode = await (async () => {
  switch (command) {
    case "build":
      if (ref) return build(ref);
      break;
    case "install":
      if (ref) return install(ref);
      break;
    case "deploy":
    case "rollback":
    case "plist":
      console.error(
        `fork-deploy: "${command}" is disabled: the fork no longer runs under launchd. Use "install <ref>".`,
      );
      return 64;
    case "status":
      return status();
    case "version":
      if (ref) return version(ref);
      break;
  }
  console.error(
    "usage: fork-deploy <build <ref> [--bump <major|minor|patch>] [--version <x.y.z>] [--summary <text>] [--why <text>] | install <ref> [same version flags] | status | version <ref>>",
  );
  return 64;
})();
process.exit(exitCode);
