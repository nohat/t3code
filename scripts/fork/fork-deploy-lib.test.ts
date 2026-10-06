// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";

import {
  atomicSwap,
  classifyV2Copy,
  deployFailureMessage,
  PINNED_RELEASES_FILE,
  COMPLETE_MARKER,
  countRunningSessions,
  countV2OnlyRows,
  isQuiet,
  movedAsideName,
  moveStateV2Aside,
  parseDrainStatus,
  parseSeconds,
  pruneReleases,
  readCurrent,
  readPrevious,
  releaseDir,
  releaseUsesV2State,
  renderLaunchAgent,
  resolveStateDb,
  serverCliCommand,
} from "./fork-deploy-lib.ts";

function makeRoot(shas: readonly string[]): string {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-deploy-"));
  shas.forEach((sha, index) => {
    NodeFS.mkdirSync(releaseDir(root, sha), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(releaseDir(root, sha), COMPLETE_MARKER), sha);
    const time = new Date(Date.UTC(2026, 0, 1 + index));
    NodeFS.utimesSync(releaseDir(root, sha), time, time);
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
    expect(NodeFS.readlinkSync(NodePath.join(root, "current"))).toBe(
      NodePath.join("releases", "bbb"),
    );
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
    NodeFS.mkdirSync(releaseDir(root, "partial"), { recursive: true });
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
    expect(NodeFS.existsSync(releaseDir(root, "old1"))).toBe(true);
    expect(NodeFS.existsSync(releaseDir(root, "old2"))).toBe(true);
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
    expect(plist).toContain("<key>T3CODE_TELEMETRY_ENABLED</key><string>false</string>");
    // Room for a V2 server's graceful shutdown before launchd sends SIGKILL.
    expect(plist).toContain("<key>ExitTimeOut</key><integer>60</integer>");
  });
});

describe("drain helpers", () => {
  it("reads the status line a drain command prints", () => {
    expect(
      parseDrainStatus('{"draining":true,"expiresAt":"2026-10-02T17:00:00Z","runningTurns":2}\n'),
    ).toEqual({ draining: true, runningTurns: 2 });
    expect(
      parseDrainStatus('warning\n{"draining":false,"expiresAt":null,"runningTurns":0}'),
    ).toEqual({
      draining: false,
      runningTurns: 0,
    });
  });

  it("rejects output that is not a drain status, such as an old server's unknown-command error", () => {
    expect(parseDrainStatus("Unknown subcommand drain")).toBeNull();
    expect(parseDrainStatus('{"draining":"yes"}')).toBeNull();
    expect(parseDrainStatus("")).toBeNull();
  });

  it("calls the server quiet only after consecutive zero counts", () => {
    expect(isQuiet([0], 3)).toBe(false);
    expect(isQuiet([2, 0, 0], 3)).toBe(false);
    expect(isQuiet([2, 0, 0, 0], 3)).toBe(true);
    expect(isQuiet([0, 0, 0, 1], 3)).toBe(false);
  });

  it("finds the server CLI inside a release, and null when the release is missing", () => {
    const root = makeRoot([]);
    expect(serverCliCommand(root, "abc")).toBeNull();
    const macOs = NodePath.join(
      releaseDir(root, "abc"),
      "T3 Code (Alpha).app",
      "Contents",
      "MacOS",
    );
    NodeFS.mkdirSync(macOs, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(macOs, "T3 Code (Alpha)"), "");
    const command = serverCliCommand(root, "abc");
    expect(command?.[0]).toBe(NodePath.join(macOs, "T3 Code (Alpha)"));
    expect(command?.[1]).toMatch(/app\.asar\/apps\/server\/dist\/bin\.mjs$/);
  });
});

describe("V2 cutover helpers", () => {
  const makeUserdata = (files: readonly string[]) => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-deploy-home-"));
    NodeFS.mkdirSync(NodePath.join(home, "userdata"));
    for (const file of files) NodeFS.writeFileSync(NodePath.join(home, "userdata", file), "");
    return home;
  };

  it("counts the serving V1 database even when a prepared or retained V2 copy exists", () => {
    const both = makeUserdata(["state.sqlite", "statev2.sqlite"]);
    expect(resolveStateDb(both, false)).toBe(NodePath.join(both, "userdata", "state.sqlite"));
    expect(resolveStateDb(both, true)).toBe(NodePath.join(both, "userdata", "statev2.sqlite"));
  });

  it("refuses database fallback when the serving release generation is unknown", () => {
    const both = makeUserdata(["state.sqlite", "statev2.sqlite"]);
    expect(() => resolveStateDb(both, null)).toThrow(/serving release/);
  });

  it("counts V2 runs the way the server does: held queued and waiting runs do not block", () => {
    const home = makeUserdata([]);
    const path = NodePath.join(home, "userdata", "statev2.sqlite");
    const db = new NodeSqlite.DatabaseSync(path);
    db.exec("create table orchestration_v2_projection_runs (status text, payload_json text)");
    const insert = db.prepare("insert into orchestration_v2_projection_runs values (?, ?)");
    for (const status of ["preparing", "starting", "running", "queued"]) insert.run(status, "{}");
    insert.run("queued", '{"queueHeld":true}');
    insert.run("waiting", "{}");
    insert.run("completed", "{}");
    db.close();
    expect(countRunningSessions(path)).toBe(4);
  });

  it("parses whole positive seconds and names the flag otherwise", () => {
    expect(parseSeconds("240", "--first-boot-budget-seconds")).toBe(240);
    expect(() => parseSeconds("0", "--first-boot-budget-seconds")).toThrow(
      /--first-boot-budget-seconds/,
    );
    expect(() => parseSeconds("1.5", "--x")).toThrow(/whole number/);
    expect(() => parseSeconds(undefined, "--x")).toThrow(/whole number/);
  });

  it("names a moved-aside copy so its WAL and SHM still pair with it", () => {
    const now = new Date("2026-10-05T13:45:07.123Z");
    expect(movedAsideName("/u/statev2.sqlite", now)).toBe(
      "/u/statev2.failed-20261005T134507Z.sqlite",
    );
    expect(movedAsideName("/u/statev2.sqlite-wal", now)).toBe(
      "/u/statev2.failed-20261005T134507Z.sqlite-wal",
    );
  });

  it("moves a failed V2 copy aside without touching state.sqlite or overwriting", () => {
    const home = makeUserdata(["state.sqlite", "statev2.sqlite", "statev2.sqlite-wal"]);
    const userdata = NodePath.join(home, "userdata");
    const now = new Date("2026-10-05T13:45:07Z");
    expect(moveStateV2Aside(userdata, now)).toEqual([
      NodePath.join(userdata, "statev2.failed-20261005T134507Z.sqlite"),
      NodePath.join(userdata, "statev2.failed-20261005T134507Z.sqlite-wal"),
    ]);
    expect(NodeFS.readdirSync(userdata).sort()).toEqual([
      "state.sqlite",
      "statev2.failed-20261005T134507Z.sqlite",
      "statev2.failed-20261005T134507Z.sqlite-wal",
    ]);
    NodeFS.writeFileSync(NodePath.join(userdata, "statev2.sqlite"), "");
    expect(() => moveStateV2Aside(userdata, now)).toThrow(/refusing to overwrite/);
    expect(NodeFS.existsSync(NodePath.join(userdata, "statev2.sqlite"))).toBe(true);
  });

  it("tells a V2 release from a v1 one by the database its bundle names", () => {
    const root = makeRoot([]);
    const release = (sha: string, bundle: string) => {
      const app = NodePath.join(releaseDir(root, sha), "T3 Code.app", "Contents");
      NodeFS.mkdirSync(NodePath.join(app, "MacOS"), { recursive: true });
      NodeFS.mkdirSync(NodePath.join(app, "Resources"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(app, "MacOS", "T3 Code"), "");
      NodeFS.writeFileSync(NodePath.join(app, "Resources", "app.asar"), bundle);
    };
    release("v1", 'const dbPath = NodePath.join(stateDir, "state.sqlite");');
    release("v2", 'const dbPath = NodePath.join(stateDir, "statev2.sqlite");');
    expect(releaseUsesV2State(root, "v1")).toBe(false);
    expect(releaseUsesV2State(root, "v2")).toBe(true);
    expect(releaseUsesV2State(root, "missing")).toBeNull();
  });

  it("counts the threads and messages only V2 has, reading both files read-only", () => {
    const home = makeUserdata([]);
    const userdata = NodePath.join(home, "userdata");
    const v1 = new NodeSqlite.DatabaseSync(NodePath.join(userdata, "state.sqlite"));
    v1.exec(`
      create table projection_threads (thread_id text primary key);
      create table projection_thread_messages (message_id text primary key);
      insert into projection_threads values ('t-old');
      insert into projection_thread_messages values ('m-old');
    `);
    v1.close();
    const v2 = new NodeSqlite.DatabaseSync(NodePath.join(userdata, "statev2.sqlite"));
    v2.exec(`
      create table orchestration_v2_projection_threads (thread_id text primary key);
      create table orchestration_v2_projection_messages (message_id text primary key);
      insert into orchestration_v2_projection_threads values ('t-old'), ('t-new');
      insert into orchestration_v2_projection_messages values ('m-old'), ('m-new1'), ('m-new2');
    `);
    v2.close();
    expect(countV2OnlyRows(userdata)).toEqual({ threads: 1, messages: 2 });
    expect(countV2OnlyRows(NodePath.join(makeUserdata(["state.sqlite"]), "userdata"))).toBeNull();
  });
});

describe("cutover ownership and durable pins", () => {
  it("keeps an explicitly pinned V1 after multiple V2 swaps", () => {
    const root = makeRoot(["v1", "v2a", "v2b", "v2c"]);
    NodeFS.writeFileSync(NodePath.join(root, PINNED_RELEASES_FILE), "v1\n");
    atomicSwap(root, "v1");
    atomicSwap(root, "v2a");
    atomicSwap(root, "v2b");
    atomicSwap(root, "v2c");
    expect(pruneReleases(root, 1)).toEqual(["v2a"]);
    expect(NodeFS.existsSync(releaseDir(root, "v1"))).toBe(true);
  });

  it("owns absent and pre-prepared V1 copies, but retains migrated V2 on re-entry", () => {
    const userdata = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "copy-classification-"));
    expect(classifyV2Copy(userdata)).toBe("fresh");
    const db = new NodeSqlite.DatabaseSync(NodePath.join(userdata, "statev2.sqlite"));
    db.exec(
      "create table projection_threads(thread_id text); create table effect_sql_migrations(migration_id integer, name text); insert into effect_sql_migrations values (54, 'Old');",
    );
    db.close();
    expect(classifyV2Copy(userdata)).toBe("fresh");
    const migrated = new NodeSqlite.DatabaseSync(NodePath.join(userdata, "statev2.sqlite"));
    migrated.exec("create table orchestration_v2_projection_threads(thread_id text);");
    migrated.close();
    expect(classifyV2Copy(userdata)).toBe("retained");
  });

  it("retains unreadable or unrecognized copies rather than claiming them", () => {
    const userdata = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "copy-unknown-"));
    NodeFS.writeFileSync(NodePath.join(userdata, "statev2.sqlite"), "not sqlite");
    expect(classifyV2Copy(userdata)).toBe("retained");
  });
});

describe("deployment failure reporting", () => {
  it("reports a post-swap restart failure with the actual current release", () => {
    expect(deployFailureMessage("candidate", true, "previous")).toBe(
      "MANUAL ACTION: deploy of candidate failed after the swap; current=previous",
    );
    expect(deployFailureMessage("candidate", false, "previous")).toBe(
      "deploy of candidate stopped before the swap",
    );
  });
});
