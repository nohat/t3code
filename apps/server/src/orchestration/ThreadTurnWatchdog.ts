/**
 * Stalled-turn watchdog: flags a running turn whose provider has gone silent.
 *
 * A provider can hang mid-turn (a wedged subprocess, a dropped stream) while
 * the session still reads "running", and nothing else notices. Ingestion
 * stamps the last provider event per thread in ThreadTurnActivityService;
 * this sweep flags threads that have been silent past the threshold and
 * appends a `provider.turn.stalled` activity so clients refetch the shell and
 * see `stalledSince`. It never interrupts the turn: stop and resend stay
 * manual. Ingestion appends `provider.turn.resumed` if the provider speaks
 * again.
 *
 * A turn legitimately waiting on someone else is not stalled: a pending
 * approval or user question, or live background work (subagents, monitors),
 * all produce long silences by design.
 *
 * @module ThreadTurnWatchdog
 */
import { CommandId, EventId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import { forkParked } from "../serverActivation.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { ThreadTurnActivityService } from "./ThreadTurnActivity.ts";

export const STALLED_TURN_THRESHOLD_MS = 10 * 60 * 1000;
export const STALLED_TURN_SWEEP_INTERVAL_MS = 30 * 1000;

/**
 * Drivers the watchdog covers. Claude only for now: other adapters have not
 * been audited for how quiet a healthy turn can be. Widen deliberately.
 */
const WATCHED_PROVIDERS: ReadonlySet<string> = new Set(["claudeAgent"]);

export interface StalledTurnWatchdogOptions {
  readonly thresholdMs: number;
  readonly sweepIntervalMs?: number;
}

/** Threshold from `T3CODE_STALLED_TURN_THRESHOLD_MS`, else the default. */
export const resolveStalledTurnWatchdogOptions: Effect.Effect<StalledTurnWatchdogOptions> =
  Config.Int("T3CODE_STALLED_TURN_THRESHOLD_MS").pipe(
    Config.withDefault(STALLED_TURN_THRESHOLD_MS),
    Effect.map((thresholdMs) => ({ thresholdMs: Math.max(1, thresholdMs) })),
    Effect.orElseSucceed(() => ({ thresholdMs: STALLED_TURN_THRESHOLD_MS })),
  );

const isoFromMillis = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

/** One pass over the watched threads. Exported for tests. */
export const sweepStalledTurns = (options: StalledTurnWatchdogOptions) =>
  Effect.gen(function* () {
    const turnActivity = yield* ThreadTurnActivityService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const now = yield* Clock.currentTimeMillis;
    const nowIso = isoFromMillis(now);

    for (const entry of turnActivity.listEntries()) {
      const idleMs = now - entry.lastEventAtMs;
      if (idleMs < options.thresholdMs) {
        continue;
      }

      const threadId = ThreadId.make(entry.threadId);
      const thread = yield* projectionSnapshotQuery
        .getThreadShellById(threadId)
        .pipe(Effect.map(Option.getOrUndefined));
      if (thread === undefined) {
        // Deleted or archived: nothing left to watch.
        turnActivity.clearThread(entry.threadId);
        continue;
      }

      const session = thread.session;
      const turnId = session?.activeTurnId ?? null;
      const turnRunning = session !== null && session.status === "running" && turnId !== null;
      if (entry.stalledSince !== null) {
        // The turn can end without a terminal provider event reaching
        // ingestion; a flag must not outlive it.
        if (!turnRunning) {
          turnActivity.clearThread(entry.threadId);
        }
        continue;
      }
      if (
        !turnRunning ||
        session.providerName === null ||
        !WATCHED_PROVIDERS.has(session.providerName) ||
        thread.hasPendingApprovals ||
        thread.hasPendingUserInput ||
        (thread.backgroundLiveness ?? null) !== null
      ) {
        continue;
      }

      // Flag before appending so the shell refetch the append triggers sees
      // stalledSince. Refuses if an event landed since the idle check above.
      if (!turnActivity.markStalled(entry.threadId, nowIso, entry.lastEventAtMs)) {
        continue;
      }
      yield* orchestrationEngine
        .dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make(`stalled-turn:${entry.threadId}:${now}`),
          threadId,
          activity: {
            id: EventId.make(`stalled-turn:${entry.threadId}:${now}`),
            tone: "info",
            kind: "provider.turn.stalled",
            summary: "Provider stopped responding",
            payload: {
              stalledSince: nowIso,
              lastEventAt: isoFromMillis(entry.lastEventAtMs),
              idleMs,
              thresholdMs: options.thresholdMs,
            },
            turnId,
            createdAt: nowIso,
          },
          createdAt: nowIso,
        })
        .pipe(
          Effect.tap(() =>
            Effect.logWarning("orchestration.turn.stalled", {
              threadId: entry.threadId,
              turnId,
              idleMs,
            }),
          ),
          Effect.catchCause((cause) => {
            // Retry on the next sweep rather than leave an unannounced flag.
            turnActivity.clearStalled(entry.threadId);
            return Effect.logWarning("orchestration.turn.stalled.append-failed", {
              threadId: entry.threadId,
              cause,
            });
          }),
        );
    }
  });

/** Fork the periodic sweep in the caller's scope, parked until activation. */
export const startStalledTurnWatchdog = (options: StalledTurnWatchdogOptions) =>
  forkParked(
    sweepStalledTurns(options).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("orchestration.turn.stalled.sweep-failed", { cause }),
      ),
      Effect.repeat(
        Schedule.spaced(Duration.millis(options.sweepIntervalMs ?? STALLED_TURN_SWEEP_INTERVAL_MS)),
      ),
    ),
  );
