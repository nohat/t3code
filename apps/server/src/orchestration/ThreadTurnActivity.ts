/**
 * ThreadTurnActivityService - in-memory per-thread record of the last
 * provider event, plus the stalled-turn watchdog's flag.
 *
 * Ingestion stamps every provider event here before queueing it (including
 * the high-frequency deltas the lifecycle worker drops), so one Map.set is
 * the whole per-event cost: no DB write, no websocket traffic. The watchdog
 * reads it on a slow sweep and the shell query reads `stalledSince` at
 * mapping time. No persistence, no migration: after a server restart the
 * registry is empty, which matches reality because the provider sessions it
 * described are gone too.
 *
 * @module ThreadTurnActivityService
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface ThreadTurnActivityEntry {
  readonly threadId: string;
  readonly lastEventAtMs: number;
  /** ISO timestamp the watchdog flagged the turn, or null while healthy. */
  readonly stalledSince: string | null;
}

export class ThreadTurnActivityService extends Context.Service<
  ThreadTurnActivityService,
  {
    /**
     * Stamp one provider event. Returns true when the thread was flagged as
     * stalled, in which case the flag is cleared and the caller owes a
     * resumed activity.
     */
    readonly recordEvent: (threadId: string, atMs: number) => boolean;

    /**
     * Flag a thread, but only if no event has landed since the sweep read
     * `observedLastEventAtMs`. Returns whether the flag was set.
     */
    readonly markStalled: (
      threadId: string,
      stalledSince: string,
      observedLastEventAtMs: number,
    ) => boolean;

    /** Drop the flag without touching the last-event time (a failed append). */
    readonly clearStalled: (threadId: string) => void;

    /** Turn settled or session died: nothing to watch until the next event. */
    readonly clearThread: (threadId: string) => void;

    readonly getStalledSince: (threadId: string) => string | null;

    /** Threads currently being watched, for the watchdog sweep. */
    readonly listEntries: () => ReadonlyArray<ThreadTurnActivityEntry>;
  }
>()("t3/orchestration/ThreadTurnActivity/ThreadTurnActivityService") {}

export function make(): ThreadTurnActivityService["Service"] {
  const entryByThreadId = new Map<string, ThreadTurnActivityEntry>();

  return {
    recordEvent: (threadId, atMs) => {
      const wasStalled = entryByThreadId.get(threadId)?.stalledSince != null;
      entryByThreadId.set(threadId, { threadId, lastEventAtMs: atMs, stalledSince: null });
      return wasStalled;
    },

    markStalled: (threadId, stalledSince, observedLastEventAtMs) => {
      const entry = entryByThreadId.get(threadId);
      if (entry === undefined || entry.lastEventAtMs !== observedLastEventAtMs) {
        return false;
      }
      entryByThreadId.set(threadId, { ...entry, stalledSince });
      return true;
    },

    clearStalled: (threadId) => {
      const entry = entryByThreadId.get(threadId);
      if (entry !== undefined && entry.stalledSince !== null) {
        entryByThreadId.set(threadId, { ...entry, stalledSince: null });
      }
    },

    clearThread: (threadId) => {
      entryByThreadId.delete(threadId);
    },

    getStalledSince: (threadId) => entryByThreadId.get(threadId)?.stalledSince ?? null,

    listEntries: () => Array.from(entryByThreadId.values()),
  };
}

export const layer = Layer.effect(ThreadTurnActivityService, Effect.sync(make));
