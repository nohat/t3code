// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  isDue,
  parsePatches,
  readState,
  renderSyncIssue,
  touchedPackages,
  validateCadence,
  writeState,
} from "./upstream-sync-lib.ts";
import { trial } from "./upstream-sync.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
function temporary() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-test-"));
  roots.push(root);
  return root;
}

describe("sync decisions", () => {
  it("runs only when due and rejects malformed persisted cadence", () => {
    expect(isDue(undefined, 24)).toBe(true);
    const now = Date.UTC(2026, 9, 6);
    expect(isDue(new Date(now - 23 * 3_600_000).toISOString(), 24, now)).toBe(false);
    expect(isDue(new Date(now - 24 * 3_600_000).toISOString(), 24, now)).toBe(true);
    const path = NodePath.join(temporary(), "state.json");
    writeState(path, { intervalHours: 12 });
    expect(readState(path).intervalHours).toBe(12);
    NodeFS.writeFileSync(path, '{"intervalHours":0}');
    expect(() => readState(path)).toThrow("invalid sync state");
  });

  it("enforces cadence bounds and a factor of two even when the agent ignores its prompt", () => {
    const decision = (intervalHours: number) => ({
      intervalHours,
      reason: "upstream volume",
      analysis: "commits increased",
    });
    expect(validateCadence(decision(12), 24).intervalHours).toBe(12);
    expect(validateCadence(decision(48), 24).intervalHours).toBe(48);
    for (const hours of [5, 169, 11, 49, Number.NaN])
      expect(() => validateCadence(decision(hours), 24)).toThrow();
    expect(() => validateCadence({ ...decision(24), reason: "" }, 24)).toThrow();
  });

  it("identifies package scopes and validates the feature registry", () => {
    expect(
      touchedPackages([
        "apps/web/src/a.ts",
        "apps/web/src/b.ts",
        "packages/contracts/src/c.ts",
        "scripts/a.ts",
        "README.md",
      ]),
    ).toEqual(["apps/web", "packages/contracts", "scripts"]);
    expect(parsePatches("name\tbranch\tguard\nfeature\tfeat/a\tnode test.js\n")[0]?.name).toBe(
      "feature",
    );
    expect(() => parsePatches("name\tbranch\tguard\na\tx\t-\na\ty\t-\n")).toThrow();
  });

  it("publishes only revision, path, status and guard evidence", () => {
    const record = {
      forkSha: "a".repeat(40),
      upstreamSha: "b".repeat(40),
      status: "guard-failed",
      conflicts: ["apps/web/src/a.ts"],
      failedGuards: ["feature"],
      losses: [],
      affectedPatches: ["feature"],
      secretLog: "private test stdout",
    };
    const issue = renderSyncIssue(record);
    expect(issue).toContain("apps/web/src/a.ts");
    expect(issue).not.toContain(record.secretLog);
  });
});

function fixture(guard = "exit 0") {
  const root = temporary();
  const repo = NodePath.join(root, "repo");
  NodeFS.mkdirSync(repo);
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.com");
  NodeFS.mkdirSync(NodePath.join(repo, "docs/fork"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(repo, "scripts/fork"), { recursive: true });
  NodeFS.copyFileSync(
    new URL("./delta-check.ts", import.meta.url),
    NodePath.join(repo, "scripts/fork/delta-check.ts"),
  );
  NodeFS.writeFileSync(NodePath.join(repo, "package.json"), '{"type":"module"}');
  NodeFS.writeFileSync(
    NodePath.join(repo, "docs/fork/patches.tsv"),
    `name\tbranch\tguard\nfeature\tfork/prod\t${guard}\n`,
  );
  NodeFS.writeFileSync(NodePath.join(repo, "shared.txt"), "base\n");
  git("add", "docs/fork/patches.tsv", "scripts/fork/delta-check.ts", "package.json", "shared.txt");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-b", "fork/prod");
  NodeFS.writeFileSync(NodePath.join(repo, "fork.txt"), "fork feature\n");
  git("add", "fork.txt");
  git("commit", "-m", "fork feature");
  const fork = git("rev-parse", "HEAD");
  git("checkout", "-b", "upstream", base);
  const bin = NodePath.join(root, "bin");
  NodeFS.mkdirSync(bin);
  NodeFS.writeFileSync(NodePath.join(bin, "vp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return {
    root,
    repo,
    git,
    base,
    fork,
    config: {
      root: NodePath.join(root, "deploy"),
      repo,
      githubRepo: "nohat/t3code",
      path: `${bin}:${process.env.PATH}`,
    },
  };
}

describe("scratch trial merges", () => {
  it("makes a clean candidate without moving fork/prod or the primary checkout", () => {
    const f = fixture();
    NodeFS.writeFileSync(NodePath.join(f.repo, "upstream.txt"), "upstream feature\n");
    f.git("add", "upstream.txt");
    f.git("commit", "-m", "upstream change");
    const head = f.git("rev-parse", "HEAD");
    const record = trial(f.config, "upstream", "fork/prod");
    expect(record.status).toBe("clean");
    expect(record.guards).toEqual([{ name: "feature", code: 0 }]);
    expect(f.git("rev-parse", "fork/prod")).toBe(f.fork);
    expect(f.git("rev-parse", "HEAD")).toBe(head);
    expect(f.git("worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
    expect(f.git("merge-base", record.candidateSha!, head)).toBe(head);
    const retry = trial(f.config, "upstream", "fork/prod");
    expect(retry.candidateBranch).toBe(record.candidateBranch);
    expect(retry.candidateSha).toBe(record.candidateSha);
  });

  it("records a conflict, maps it to a feature, and aborts only its own merge", () => {
    const f = fixture();
    NodeFS.writeFileSync(NodePath.join(f.repo, "shared.txt"), "upstream\n");
    f.git("add", "shared.txt");
    f.git("commit", "-m", "upstream change");
    f.git("checkout", "fork/prod");
    NodeFS.writeFileSync(NodePath.join(f.repo, "shared.txt"), "fork\n");
    f.git("add", "shared.txt");
    f.git("commit", "-m", "fork shared change");
    const fork = f.git("rev-parse", "HEAD");
    const record = trial(f.config, "upstream", "fork/prod");
    expect(record.status).toBe("conflict");
    expect(record.conflicts).toEqual(["shared.txt"]);
    expect(record.affectedPatches).toEqual(["feature"]);
    expect(f.git("rev-parse", "fork/prod")).toBe(fork);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  it("rejects an unincorporated accepted patch even when its guard would pass", () => {
    const f = fixture();
    NodeFS.writeFileSync(NodePath.join(f.repo, "unincorporated.txt"), "accepted patch\n");
    f.git("add", "unincorporated.txt");
    f.git("commit", "-m", "accepted patch");
    f.git("branch", "feat/unincorporated");
    f.git("checkout", "fork/prod");
    NodeFS.writeFileSync(
      NodePath.join(f.repo, "docs/fork/patches.tsv"),
      "name\tbranch\tguard\nfeature\tfeat/unincorporated\texit 0\n",
    );
    f.git("add", "docs/fork/patches.tsv");
    f.git("commit", "-m", "register accepted patch");
    f.git("checkout", "upstream");
    // Keep upstream independent of the accepted branch.
    f.git("reset", "--hard", f.base);
    NodeFS.writeFileSync(NodePath.join(f.repo, "upstream.txt"), "upstream\n");
    f.git("add", "upstream.txt");
    f.git("commit", "-m", "upstream change");
    const record = trial(f.config, "upstream", "fork/prod");
    expect(record.status).toBe("guard-failed");
    expect(record.guards).toEqual([{ name: "feature", code: 1 }]);
    expect(record.candidateSha).toBeUndefined();
  });

  it("refuses a candidate when a feature guard fails", () => {
    const f = fixture("exit 7");
    NodeFS.writeFileSync(NodePath.join(f.repo, "upstream.txt"), "upstream\n");
    f.git("add", "upstream.txt");
    f.git("commit", "-m", "upstream change");
    const record = trial(f.config, "upstream", "fork/prod");
    expect(record.status).toBe("guard-failed");
    expect(record.guards[0]?.code).toBe(7);
    expect(record.candidateSha).toBeUndefined();
    expect(f.git("rev-parse", "fork/prod")).toBe(f.fork);
  });
});
