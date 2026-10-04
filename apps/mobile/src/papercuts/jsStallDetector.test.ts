import { describe, expect, it } from "vite-plus/test";

import { createStallDetector } from "./jsStallDetector";

describe("createStallDetector", () => {
  it("reports how late a tick was once it crosses the threshold", () => {
    let clock = 0;
    const detector = createStallDetector({ intervalMs: 1000, thresholdMs: 1500, now: () => clock });

    clock = 1010;
    expect(detector.tick()).toBeNull();
    clock += 1000 + 1499;
    expect(detector.tick()).toBeNull();
    clock += 1000 + 6300;
    expect(detector.tick()).toBe(6300);
    clock += 1000;
    expect(detector.tick()).toBeNull();
  });

  it("ignores a gap that was reset, such as time in the background", () => {
    let clock = 0;
    const detector = createStallDetector({ intervalMs: 1000, thresholdMs: 1500, now: () => clock });

    clock = 60_000;
    detector.reset();
    clock += 1000;
    expect(detector.tick()).toBeNull();
  });
});
