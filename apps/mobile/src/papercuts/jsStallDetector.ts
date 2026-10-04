/**
 * Notices that the JavaScript thread was blocked by watching a repeating timer
 * fire late. It can only report a stall after the thread recovers, which is
 * what a papercut event buffer needs: the next report then shows that it
 * happened. A thread that never recovers is the native heartbeat's job.
 */
export function createStallDetector(options: {
  readonly intervalMs: number;
  /** How much later than `intervalMs` a tick must arrive to count as a stall. */
  readonly thresholdMs: number;
  readonly now: () => number;
}) {
  let lastTickAt = options.now();
  return {
    /** Returns how late this tick was when it crossed the threshold, otherwise null. */
    tick(): number | null {
      const at = options.now();
      const lateBy = at - lastTickAt - options.intervalMs;
      lastTickAt = at;
      return lateBy >= options.thresholdMs ? Math.round(lateBy) : null;
    },
    /** Forget the gap, for example after the app was in the background and no timers ran. */
    reset() {
      lastTickAt = options.now();
    },
  };
}
