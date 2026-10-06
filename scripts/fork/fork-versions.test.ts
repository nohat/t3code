// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  appendBumpDecision,
  bumpForkVersion,
  compareForkVersions,
  FORK_INITIAL_VERSION,
  isCommitSha,
  isForkVersion,
  latestRegistryVersion,
  listVersionedReleases,
  parseForkVersion,
  readReleaseVersion,
  readVersionRegistry,
  recordForkVersion,
  RELEASE_VERSION_FILE,
  resolveForkVersion,
  versionForSha,
  writeReleaseVersion,
} from "./fork-versions.ts";

function makeRoot(): string {
  return NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-versions-"));
}

describe("semver helpers", () => {
  it("parses strict semver and rejects the rest", () => {
    expect(parseForkVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseForkVersion(" 10.0.1 ")).toEqual({ major: 10, minor: 0, patch: 1 });
    expect(parseForkVersion("1.2")).toBeNull();
    expect(parseForkVersion("1.2.3-nightly")).toBeNull();
    expect(parseForkVersion("v1.2.3")).toBeNull();
    expect(parseForkVersion("01.2.3")).toBeNull();
    expect(isForkVersion("1.0.0")).toBe(true);
    expect(isForkVersion("0.0.44")).toBe(true);
    expect(isForkVersion("0.0.44-nohat.abc")).toBe(false);
  });

  it("bumps each level and resets the lower segments", () => {
    expect(bumpForkVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpForkVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpForkVersion("1.2.3", "major")).toBe("2.0.0");
    expect(() => bumpForkVersion("nope", "patch")).toThrow(/non-semver/);
  });

  it("orders versions numerically, not lexicographically", () => {
    expect(compareForkVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareForkVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareForkVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareForkVersions("1.0.1", "1.0.2")).toBeLessThan(0);
  });

  it("validates shas", () => {
    expect(isCommitSha("de839b392a")).toBe(true);
    expect(isCommitSha("de839b392ab661763ee00adf6d61982d369f035b")).toBe(true);
    expect(isCommitSha("fork/prod")).toBe(false);
    expect(isCommitSha("xyz")).toBe(false);
  });
});

describe("registry", () => {
  it("starts empty and the first release is the initial version", () => {
    const root = makeRoot();
    expect(readVersionRegistry(root)).toEqual({});
    expect(latestRegistryVersion({})).toBeNull();
    expect(resolveForkVersion({}, "a".repeat(40), "patch")).toEqual({
      version: FORK_INITIAL_VERSION,
      reused: false,
    });
    expect(FORK_INITIAL_VERSION).toBe("1.0.0");
  });

  it("reuses the recorded version when a sha rebuilds", () => {
    const root = makeRoot();
    const sha = "a".repeat(40);
    recordForkVersion(root, sha, "1.0.0");
    expect(resolveForkVersion(readVersionRegistry(root), sha, "minor")).toEqual({
      version: "1.0.0",
      reused: true,
    });
    expect(versionForSha(readVersionRegistry(root), sha.slice(0, 10))?.version).toBe("1.0.0");
  });

  it("bumps from the newest shipped version for a new sha", () => {
    const root = makeRoot();
    recordForkVersion(root, "a".repeat(40), "1.0.0");
    recordForkVersion(root, "b".repeat(40), "1.1.0");
    const registry = readVersionRegistry(root);
    expect(latestRegistryVersion(registry)).toBe("1.1.0");
    expect(resolveForkVersion(registry, "c".repeat(40), "patch").version).toBe("1.1.1");
    expect(resolveForkVersion(registry, "c".repeat(40), "minor").version).toBe("1.2.0");
    expect(resolveForkVersion(registry, "c".repeat(40), "major").version).toBe("2.0.0");
  });

  it("refuses to reassign a sha or reuse a version", () => {
    const root = makeRoot();
    const sha = "a".repeat(40);
    recordForkVersion(root, sha, "1.0.0");
    expect(() => recordForkVersion(root, sha, "1.0.1")).toThrow(/already shipped/);
    expect(() => recordForkVersion(root, "b".repeat(40), "1.0.0")).toThrow(/already maps/);
    expect(() => recordForkVersion(root, "not-a-sha", "1.0.1")).toThrow(/non-sha/);
    expect(() => recordForkVersion(root, "b".repeat(40), "1.0-nohat")).toThrow(/non-semver/);
    // Idempotent when the mapping already matches.
    expect(recordForkVersion(root, sha, "1.0.0").version).toBe("1.0.0");
  });

  it("rejects a corrupt registry instead of minting over it", () => {
    const root = makeRoot();
    NodeFS.writeFileSync(NodePath.join(root, "fork-versions.json"), "not json");
    expect(() => readVersionRegistry(root)).toThrow(/not valid JSON/);
    NodeFS.writeFileSync(
      NodePath.join(root, "fork-versions.json"),
      JSON.stringify({ abc: { version: "x" } }),
    );
    expect(() => readVersionRegistry(root)).toThrow(/no semver version/);
  });
});

describe("release markers and ledger", () => {
  it("keeps the stamped version when a partial release is promoted", () => {
    const root = makeRoot();
    const sha = "a".repeat(10);
    NodeFS.mkdirSync(NodePath.join(root, "releases", `${sha}.partial`), { recursive: true });
    writeReleaseVersion(root, `${sha}.partial`, "1.0.0");
    NodeFS.renameSync(
      NodePath.join(root, "releases", `${sha}.partial`),
      NodePath.join(root, "releases", sha),
    );
    expect(readReleaseVersion(root, sha)).toBe("1.0.0");
  });

  it("round-trips the per-release version marker", () => {
    const root = makeRoot();
    const releases = NodePath.join(root, "releases", "a".repeat(10));
    NodeFS.rmSync(root, { recursive: true, force: true });
    NodeFS.mkdirSync(releases, { recursive: true });
    expect(readReleaseVersion(root, "a".repeat(10))).toBeNull();
    writeReleaseVersion(root, "a".repeat(10), "1.2.0");
    expect(readReleaseVersion(root, "a".repeat(10))).toBe("1.2.0");
    expect(NodeFS.readFileSync(NodePath.join(releases, RELEASE_VERSION_FILE), "utf8")).toBe(
      "1.2.0\n",
    );
  });

  it("lists versioned releases newest-version first", () => {
    const root = makeRoot();
    for (const sha of ["a".repeat(10), "b".repeat(10), "c".repeat(10)]) {
      NodeFS.mkdirSync(NodePath.join(root, "releases", sha), { recursive: true });
    }
    writeReleaseVersion(root, "a".repeat(10), "1.0.0");
    writeReleaseVersion(root, "b".repeat(10), "1.2.0");
    expect(listVersionedReleases(root)).toEqual(["b".repeat(10), "a".repeat(10), "c".repeat(10)]);
  });

  it("requires a rationale in the decision ledger", () => {
    const root = makeRoot();
    expect(() =>
      appendBumpDecision(root, {
        version: "1.1.0",
        level: "minor",
        sha: "a".repeat(40),
        summary: "shipped resync",
        rationale: "",
      }),
    ).toThrow(/rationale/);
    appendBumpDecision(root, {
      version: "1.1.0",
      level: "minor",
      sha: "a".repeat(40),
      summary: "shipped resync",
      rationale: "new user-visible action, not a fix; patch would understate it",
    });
    const ledger = NodeFS.readFileSync(NodePath.join(root, "fork-version-decisions.md"), "utf8");
    expect(ledger).toContain("## 1.1.0 (minor,");
    expect(ledger).toContain("why minor: new user-visible action");
  });
});
