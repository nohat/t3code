// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { classify, parseAllowList, parseNameStatusZ, parseNumstatZ } from "./delta-check.ts";

const SCRIPT = join(import.meta.dirname, "delta-check.ts");

function inputs(
  overrides: Partial<Parameters<typeof classify>[0]>,
): Parameters<typeof classify>[0] {
  return {
    before: new Map(),
    after: new Map(),
    upstreamRenames: new Map(),
    mergeRenames: new Map(),
    upstreamDeleted: new Set(),
    identicalToUpstream: () => false,
    ...overrides,
  };
}

describe("parsers", () => {
  it("reads plain and renamed numstat rows", () => {
    const output = "3\t1\ta.ts\0" + "5\t0\t\0old/b.ts\0new/b.ts\0" + "-\t-\timg.png\0";
    expect(parseNumstatZ(output)).toEqual([
      { path: "a.ts", added: 3 },
      { path: "new/b.ts", added: 5 },
      { path: "img.png", added: 0 },
    ]);
  });

  it("reads renames and deletions from name-status", () => {
    const parsed = parseNameStatusZ("R095\0a.ts\0b.ts\0D\0gone.ts\0M\0kept.ts\0");
    expect([...parsed.renames]).toEqual([["a.ts", "b.ts"]]);
    expect([...parsed.deleted]).toEqual(["gone.ts"]);
  });

  it("ignores comments and blanks in the allow list", () => {
    expect([...parseAllowList("# dropped\na.ts # reason\n\n b.ts\n")]).toEqual(["a.ts", "b.ts"]);
  });
});

describe("classify", () => {
  it("keeps a file whose added lines survived", () => {
    const verdicts = classify(
      inputs({ before: new Map([["a.ts", 4]]), after: new Map([["a.ts", 6]]) }),
    );
    expect(verdicts).toEqual([{ kind: "kept", path: "a.ts", at: "a.ts" }]);
  });

  it("flags a file whose added lines dropped", () => {
    const verdicts = classify(
      inputs({ before: new Map([["a.ts", 10]]), after: new Map([["a.ts", 2]]) }),
    );
    expect(verdicts[0]?.kind).toBe("lines-dropped");
  });

  it("follows an upstream rename and a merge rename", () => {
    const verdicts = classify(
      inputs({
        before: new Map([
          ["old/a.ts", 3],
          ["fork/b.ts", 7],
        ]),
        after: new Map([
          ["new/a.ts", 3],
          ["moved/b.ts", 7],
        ]),
        upstreamRenames: new Map([["old/a.ts", "new/a.ts"]]),
        mergeRenames: new Map([["fork/b.ts", "moved/b.ts"]]),
      }),
    );
    expect(verdicts.map((verdict) => verdict.kind)).toEqual(["kept", "kept"]);
  });

  it("separates an upstream deletion from a vanished fork file", () => {
    const verdicts = classify(
      inputs({
        before: new Map([
          ["legacy.ts", 3],
          ["fork-only.ts", 9],
        ]),
        upstreamDeleted: new Set(["legacy.ts"]),
      }),
    );
    expect(verdicts.map((verdict) => verdict.kind)).toEqual(["deleted-upstream", "vanished"]);
  });

  it("treats a change upstream already made as absorbed", () => {
    const verdicts = classify(
      inputs({ before: new Map([["a.ts", 2]]), identicalToUpstream: (path) => path === "a.ts" }),
    );
    expect(verdicts[0]?.kind).toBe("absorbed");
  });
});

describe("delta-check on a synthetic repository", () => {
  function repo(): { dir: string; run: (...args: string[]) => string } {
    const dir = mkdtempSync(join(tmpdir(), "delta-check-"));
    const run = (...args: string[]): string =>
      execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
      }).trim();
    run("init", "-q", "-b", "main");
    return { dir, run };
  }

  function write(dir: string, path: string, text: string): void {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }

  function check(dir: string, refs: string[], allow?: string) {
    const args = [SCRIPT, "--old-main", refs[0]!, "--old-fork", refs[1]!];
    args.push("--new-main", refs[2]!, "--merged", refs[3]!);
    if (allow) args.push("--allow", allow);
    return spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
  }

  it("passes a merge that kept the fork delta and fails one that lost a fork file", () => {
    const { dir, run } = repo();
    try {
      write(dir, "shared.ts", "a\nb\nc\n");
      write(dir, "legacy.ts", "x\n");
      run("add", ".");
      run("commit", "-qm", "base");
      const oldMain = run("rev-parse", "HEAD");

      run("checkout", "-qb", "fork");
      write(dir, "shared.ts", "a\nb\nc\nfork1\nfork2\n");
      write(dir, "fork-only.ts", "mine\n");
      write(dir, "legacy.ts", "x\nfork\n");
      run("add", ".");
      run("commit", "-qm", "fork");
      const oldFork = run("rev-parse", "HEAD");

      run("checkout", "-q", "main");
      run("rm", "-q", "legacy.ts");
      write(dir, "upstream.ts", "new\n");
      run("add", ".");
      run("commit", "-qm", "upstream");
      const newMain = run("rev-parse", "HEAD");

      run("checkout", "-qb", "good", oldFork);
      spawnSync("git", ["merge", "-q", "--no-edit", newMain], { cwd: dir });
      run("rm", "-q", "--ignore-unmatch", "legacy.ts");
      run("commit", "-qm", "merge", "--allow-empty");
      const good = run("rev-parse", "HEAD");

      const kept = check(dir, [oldMain, oldFork, newMain, good]);
      expect(kept.status).toBe(0);
      expect(kept.stdout).toContain("deleted-upstream legacy.ts");

      run("rm", "-q", "fork-only.ts");
      run("commit", "-qm", "lose it");
      const bad = run("rev-parse", "HEAD");
      const lost = check(dir, [oldMain, oldFork, newMain, bad]);
      expect(lost.status).toBe(1);
      expect(lost.stdout).toContain("LOSS vanished fork-only.ts");

      write(dir, "allow.txt", "fork-only.ts # dropped on purpose\n");
      const allowed = check(dir, [oldMain, oldFork, newMain, bad], join(dir, "allow.txt"));
      expect(allowed.status).toBe(0);
      expect(allowed.stdout).toContain("allowed vanished fork-only.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
