import { describe, expect, it } from "vite-plus/test";
import { restartStoppedJob } from "./fork-deploy-restart.ts";

function fixture(overrides = {}) {
  const calls: string[] = [];
  let time = 0;
  const operations = {
    plistExists: () => true,
    bootout: () => (calls.push("bootout"), 0),
    pid: (): number | null => null,
    bootstrap: () => (calls.push("bootstrap"), 0),
    now: () => time,
    wait: () => {
      time += 2000;
    },
    ...overrides,
  };
  return {
    calls,
    operations,
    cleanup: () => {
      calls.push("cleanup");
    },
  };
}

describe("restartStoppedJob", () => {
  it("refuses a missing plist without stopping or falling back to kickstart", () => {
    const f = fixture({ plistExists: () => false });
    expect(() => restartStoppedJob(f.operations, f.cleanup)).toThrow(/plist/);
    expect(f.calls).toEqual([]);
  });
  it("refuses cleanup and bootstrap when bootout fails", () => {
    const f = fixture({ bootout: () => 5 });
    expect(() => restartStoppedJob(f.operations, f.cleanup)).toThrow(/bootout/);
    expect(f.calls).toEqual([]);
  });
  it("never mutates or bootstraps while a PID persists", () => {
    const f = fixture({ pid: () => 123 });
    expect(() => restartStoppedJob(f.operations, f.cleanup)).toThrow(/PID/);
    expect(f.calls).toEqual(["bootout"]);
  });
  it("waits for confirmed absence before cleanup and bootstrap", () => {
    let polls = 0;
    const f = fixture({ pid: () => (++polls < 3 ? 123 : null) });
    restartStoppedJob(f.operations, f.cleanup);
    expect(f.calls).toEqual(["bootout", "cleanup", "bootstrap"]);
  });
  it("propagates cleanup failure after attempting recovery", () => {
    const f = fixture();
    const failure = new Error("cleanup failed");
    expect(() =>
      restartStoppedJob(f.operations, () => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(f.calls).toEqual(["bootout", "bootstrap"]);
  });
  it("reports bootstrap exhaustion explicitly", () => {
    let attempts = 0;
    const f = fixture({ bootstrap: () => (++attempts, 5) });
    expect(() => restartStoppedJob(f.operations, f.cleanup)).toThrow(/bootstrap.*8/);
    expect(attempts).toBe(8);
  });
  it("reports both cleanup and recovery failures", () => {
    const f = fixture({ bootstrap: () => 5 });
    expect(() =>
      restartStoppedJob(f.operations, () => {
        throw new Error("cleanup failed");
      }),
    ).toThrow(/cleanup failed.*bootstrap/);
  });
});
