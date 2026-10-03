import { describe, expect, it } from "vite-plus/test";
import * as ThreadTurnActivity from "./ThreadTurnActivity.ts";

describe("ThreadTurnActivity", () => {
  it("keeps the latest event time per thread", () => {
    const activity = ThreadTurnActivity.make();
    activity.recordEvent("a", 10);
    activity.recordEvent("a", 25);
    activity.recordEvent("b", 5);

    expect(activity.listEntries()).toEqual([
      { threadId: "a", lastEventAtMs: 25, stalledSince: null },
      { threadId: "b", lastEventAtMs: 5, stalledSince: null },
    ]);
  });

  it("flags a stalled thread and clears the flag when an event arrives", () => {
    const activity = ThreadTurnActivity.make();
    activity.recordEvent("a", 10);

    expect(activity.markStalled("a", "2026-01-01T00:10:00.000Z", 10)).toBe(true);
    expect(activity.getStalledSince("a")).toBe("2026-01-01T00:10:00.000Z");

    // The first event after a flag reports the resume exactly once.
    expect(activity.recordEvent("a", 700_000)).toBe(true);
    expect(activity.getStalledSince("a")).toBeNull();
    expect(activity.recordEvent("a", 700_001)).toBe(false);
  });

  it("refuses to flag a thread whose last event moved after the sweep read it", () => {
    const activity = ThreadTurnActivity.make();
    activity.recordEvent("a", 10);
    activity.recordEvent("a", 20);

    expect(activity.markStalled("a", "2026-01-01T00:10:00.000Z", 10)).toBe(false);
    expect(activity.getStalledSince("a")).toBeNull();
    expect(activity.markStalled("unknown", "2026-01-01T00:10:00.000Z", 10)).toBe(false);
  });

  it("forgets a thread on clear, including its flag", () => {
    const activity = ThreadTurnActivity.make();
    activity.recordEvent("a", 10);
    activity.markStalled("a", "2026-01-01T00:10:00.000Z", 10);

    activity.clearThread("a");

    expect(activity.listEntries()).toEqual([]);
    expect(activity.getStalledSince("a")).toBeNull();
  });

  it("keeps the event time when a failed append unflags a thread", () => {
    const activity = ThreadTurnActivity.make();
    activity.recordEvent("a", 10);
    activity.markStalled("a", "2026-01-01T00:10:00.000Z", 10);

    activity.clearStalled("a");

    expect(activity.listEntries()).toEqual([
      { threadId: "a", lastEventAtMs: 10, stalledSince: null },
    ]);
  });
});
