// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import {
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  utimesSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  atomicSwap,
  COMPLETE_MARKER,
  pruneReleases,
  readCurrent,
  readPrevious,
  releaseDir,
  renderLaunchAgent,
} from "./fork-deploy-lib.ts";

function makeRoot(shas: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "fork-deploy-"));
  shas.forEach((sha, index) => {
    mkdirSync(releaseDir(root, sha), { recursive: true });
    writeFileSync(join(releaseDir(root, sha), COMPLETE_MARKER), sha);
    const time = new Date(Date.UTC(2026, 0, 1 + index));
    utimesSync(releaseDir(root, sha), time, time);
  });
  return root;
}

describe("atomicSwap", () => {
  it("repoints current and remembers the release it replaced", () => {
    const root = makeRoot(["aaa", "bbb"]);
    atomicSwap(root, "aaa");
    expect(readPrevious(root)).toBeNull();
    atomicSwap(root, "bbb");
    expect(readCurrent(root)).toBe("bbb");
    expect(readPrevious(root)).toBe("aaa");
    expect(readlinkSync(join(root, "current"))).toBe(join("releases", "bbb"));
  });

  it("keeps the last good release as the rollback target when rolling back", () => {
    const root = makeRoot(["aaa", "bbb"]);
    atomicSwap(root, "aaa");
    atomicSwap(root, "bbb");
    atomicSwap(root, "aaa", { rollback: true });
    expect(readCurrent(root)).toBe("aaa");
    expect(readPrevious(root)).toBe("aaa");
  });

  it("refuses a release that was never marked complete and leaves current alone", () => {
    const root = makeRoot(["aaa"]);
    atomicSwap(root, "aaa");
    mkdirSync(releaseDir(root, "partial"), { recursive: true });
    expect(() => atomicSwap(root, "partial")).toThrow(/incomplete/);
    expect(readCurrent(root)).toBe("aaa");
  });
});

describe("pruneReleases", () => {
  it("never deletes current or the rollback target, even outside the newest N", () => {
    const root = makeRoot(["old1", "old2", "mid", "new1", "new2"]);
    atomicSwap(root, "old1");
    atomicSwap(root, "old2");
    const removed = pruneReleases(root, 2);
    expect(removed.sort()).toEqual(["mid"]);
    expect(existsSync(releaseDir(root, "old1"))).toBe(true);
    expect(existsSync(releaseDir(root, "old2"))).toBe(true);
  });
});

describe("renderLaunchAgent", () => {
  it("runs from the given executable, restarts only after a crash, and escapes XML", () => {
    const plist = renderLaunchAgent({
      label: "example.prod",
      executable: "/deploy/current/App & Co.app/Contents/MacOS/App",
      userDataDir: "/data/user",
      home: "/home/t3",
      port: 13774,
      logDir: "/deploy/logs",
    });
    expect(plist).toContain("App &amp; Co.app");
    expect(plist).toContain("<key>SuccessfulExit</key><false/>");
    expect(plist).toContain("<key>T3CODE_PORT</key><string>13774</string>");
  });
});
