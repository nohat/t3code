import type { OrchestrationV2Command, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "./ProjectionStore.ts";

/** How long a drain lasts when its caller does not say. */
export const DEFAULT_DRAIN_TTL = Duration.minutes(30);

/**
 * Shown to the person whose message was refused. Deliberately free of the
 * transport-error wording (see `isTransportConnectionErrorMessage`) so clients
 * display it instead of hiding it as a dropped connection.
 */
export const DRAIN_REFUSAL_MESSAGE =
  "T3 Code is restarting for an update. Your message was not sent; try again in about a minute.";

export interface ServerDrainStatus {
  readonly draining: boolean;
  /** Null unless draining. */
  readonly expiresAt: DateTime.Utc | null;
}

export interface ServerDrainRunCounts {
  /**
   * Runs doing provider work or about to: preparing, starting, running, and
   * queued runs the user has not held (they start when the active run ends).
   */
  readonly runningTurns: number;
  /**
   * Runs parked on background work. Not blocking: a restart cancels that work
   * and tells the agent, but the turn itself is over.
   */
  readonly waitingRuns: number;
}

export type ServerDrainReport = ServerDrainStatus & ServerDrainRunCounts;

/** A user command that would start a new turn while the server drains. */
export class ServerDrainingError extends Schema.TaggedError<ServerDrainingError>()(
  "ServerDrainingError",
  {},
) {
  override get message(): string {
    return DRAIN_REFUSAL_MESSAGE;
  }
}

export class ServerDrainRunCountError extends Schema.TaggedError<ServerDrainRunCountError>()(
  "ServerDrainRunCountError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to count active runs.";
  }
}

/**
 * Whether the server is refusing new turns so a deploy can wait for running
 * ones to finish.
 *
 * The state is memory only on purpose: a restart is exactly what ends a drain,
 * and it expires on its own so a deploy that dies mid-drain cannot leave the
 * server refusing forever.
 */
export class ServerDrainState extends Context.Service<
  ServerDrainState,
  {
    readonly status: Effect.Effect<ServerDrainStatus>;
    readonly enable: (ttl?: Duration.Duration) => Effect.Effect<ServerDrainStatus>;
    readonly disable: Effect.Effect<ServerDrainStatus>;
    /** Drain state plus the run counts a deploy polls before it restarts. */
    readonly report: Effect.Effect<ServerDrainReport, ServerDrainRunCountError>;
    /**
     * Fails while draining unless the message steers, or joins, a run already
     * in flight on `threadId`. Null `threadId` is a launch that creates its
     * thread, which is always a new turn.
     */
    readonly admitUserTurn: (target: {
      readonly threadId: ThreadId | null;
      readonly steer: boolean;
    }) => Effect.Effect<void, ServerDrainingError>;
  }
>()("t3/orchestration-v2/ServerDrainState") {}

const notDraining: ServerDrainStatus = { draining: false, expiresAt: null };

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const sql = yield* SqlClient.SqlClient;
  // Expiry as a timestamp, not a timer: reading the state compares against
  // the clock, so there is no fiber to leak or to forget to cancel.
  const expiresAtMillis = yield* Ref.make<number | null>(null);

  const status = Effect.gen(function* () {
    const expiry = yield* Ref.get(expiresAtMillis);
    if (expiry === null) return notDraining;
    const now = yield* DateTime.now;
    return DateTime.toEpochMillis(now) < expiry
      ? { draining: true, expiresAt: DateTime.makeUnsafe(expiry) }
      : notDraining;
  });

  // The WHERE clause repeats the partial index
  // `orchestration_v2_projection_runs_recovery_idx`, so only live runs are read.
  // `queueHeld` matches the "runtime" predicate in ProjectionStore.
  const countRuns = sql<{ readonly running: number | null; readonly waiting: number | null }>`
    SELECT
      SUM(CASE
        WHEN status IN ('preparing', 'starting', 'running') THEN 1
        WHEN status = 'queued' AND json_extract(payload_json, '$.queueHeld') IS NOT 1 THEN 1
        ELSE 0
      END) AS running,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting
    FROM orchestration_v2_projection_runs
    WHERE status IN ('queued', 'preparing', 'starting', 'running', 'waiting')
  `.pipe(
    Effect.map(([row]): ServerDrainRunCounts => ({
      runningTurns: row?.running ?? 0,
      waitingRuns: row?.waiting ?? 0,
    })),
    Effect.mapError((cause) => new ServerDrainRunCountError({ cause })),
  );

  // A failed read counts as not running: during a drain the cost of a wrong
  // answer is a refused message the user can resend, which beats letting a
  // new turn through.
  const isThreadRunning = (threadId: ThreadId) =>
    projections.getThreadShell(threadId).pipe(
      Effect.map((shell) => shell?.activityRunStatus === "running"),
      Effect.orElseSucceed(() => false),
    );

  return ServerDrainState.of({
    status,
    enable: (ttl = DEFAULT_DRAIN_TTL) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* Ref.set(expiresAtMillis, DateTime.toEpochMillis(now) + Duration.toMillis(ttl));
        return yield* status;
      }),
    disable: Ref.set(expiresAtMillis, null).pipe(Effect.as(notDraining)),
    report: Effect.all([status, countRuns]).pipe(
      Effect.map(([state, counts]) => ({ ...state, ...counts })),
    ),
    admitUserTurn: Effect.fn("ServerDrainState.admitUserTurn")(function* (target) {
      // Only a drain pays for the shell read; the normal send path is one Ref read.
      if (!(yield* status).draining || target.steer) return;
      if (target.threadId !== null && (yield* isThreadRunning(target.threadId))) return;
      return yield* new ServerDrainingError();
    }),
  });
});

export const layer = Layer.effect(ServerDrainState, make);

/**
 * Intake gate for `ThreadMessageIntake`. Only user sends are refused: the
 * server starts turns itself (restart continuation, wakes, scheduled tasks,
 * delegated completions) and those must keep working, and they do not pass
 * through intake. Interrupts, approvals, answers, and every other command
 * still run so running turns can finish.
 *
 * The service is optional here so intake keeps its upstream requirements. Drain
 * can only be switched on through the HTTP routes, which require it, so a
 * context without it is never draining.
 */
export const admitUserMessage = (command: OrchestrationV2Command) =>
  command.type === "message.dispatch" && command.createdBy === "user"
    ? admit({
        threadId: command.threadId,
        steer: command.dispatchMode.type === "steer_active" || command.deliveryIntent === "steer",
      })
    : Effect.void;

/** Launch half of the intake gate. A launch with no message starts no turn. */
export const admitUserLaunch = (input: {
  readonly createdBy: string;
  readonly threadId?: ThreadId | undefined;
  readonly initialMessage?: unknown;
}) =>
  input.createdBy === "user" && input.initialMessage !== undefined
    ? admit({ threadId: input.threadId ?? null, steer: false })
    : Effect.void;

const admit = (target: { readonly threadId: ThreadId | null; readonly steer: boolean }) =>
  Effect.serviceOption(ServerDrainState).pipe(
    Effect.flatMap((drain) =>
      Option.isSome(drain) ? drain.value.admitUserTurn(target) : Effect.void,
    ),
  );
