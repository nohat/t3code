import { OrchestrationDispatchCommandError, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import type { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

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
  }
>()("t3/orchestration/ServerDrainState") {}

const notDraining: ServerDrainStatus = { draining: false, expiresAt: null };

export const layer = Layer.effect(
  ServerDrainState,
  Effect.gen(function* () {
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

    return ServerDrainState.of({
      status,
      enable: (ttl = DEFAULT_DRAIN_TTL) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          yield* Ref.set(expiresAtMillis, DateTime.toEpochMillis(now) + Duration.toMillis(ttl));
          return yield* status;
        }),
      disable: Ref.set(expiresAtMillis, null).pipe(Effect.as(notDraining)),
    });
  }),
);

/**
 * Whether a thread's provider session is running a turn. A failed read counts
 * as not running: during a drain the cost of a wrong answer is a refused
 * message the user can resend, which beats letting a new turn through.
 */
export const makeIsThreadRunning =
  (projectionSnapshotQuery: ProjectionSnapshotQuery["Service"]) => (threadId: ThreadId) =>
    projectionSnapshotQuery.getThreadShellById(threadId).pipe(
      Effect.map(Option.exists((thread) => thread.session?.status === "running")),
      Effect.catch(() => Effect.succeed(false)),
    );

/**
 * Refuses a command that would start a new turn while the server drains. Both
 * dispatch transports (WebSocket, HTTP) run this next to
 * `rejectCommandsDuringClone`. It is not in the engine's dispatch because the
 * server starts turns itself (compaction replay, an answered async question)
 * and those must keep working, and not in the pre-readiness command gate
 * because HTTP skips that.
 *
 * Only `thread.turn.start` is refused. Interrupts, approvals, user-input
 * responses, and everything else still run so running turns can finish.
 *
 * A `thread.turn.start` for a thread whose session is already `running` is let
 * through. The decider and ProviderCommandReactor treat every turn start the
 * same (the adapter decides whether it steers a live turn or opens a new one),
 * so the session status is the narrowest reliable signal that this message
 * joins a turn already in flight rather than begin one. It is not airtight: a
 * turn that ends between this check and the adapter receiving the message can
 * make a steer open a new turn. A drain tolerates that, since the deploy
 * re-checks the running count before restarting.
 */
export const rejectTurnStartsWhileDraining = (
  drain: ServerDrainState["Service"],
  isThreadRunning: (threadId: ThreadId) => Effect.Effect<boolean>,
  command: {
    readonly type: string;
    readonly threadId?: ThreadId;
    readonly bootstrap?: unknown;
  },
): Effect.Effect<void, OrchestrationDispatchCommandError> =>
  Effect.gen(function* () {
    if (command.type !== "thread.turn.start") return;
    const { draining } = yield* drain.status;
    if (!draining) return;
    if (command.threadId !== undefined && (yield* isThreadRunning(command.threadId))) return;
    return yield* new OrchestrationDispatchCommandError({
      message: DRAIN_REFUSAL_MESSAGE,
      reason: "server-draining",
      // Nothing has been created yet, so the client can restore its draft.
      ...(createsBootstrapThread(command.bootstrap)
        ? { bootstrapThreadDisposition: "not-created" as const }
        : {}),
    });
  });

function createsBootstrapThread(bootstrap: unknown): boolean {
  return (
    typeof bootstrap === "object" &&
    bootstrap !== null &&
    (bootstrap as { createThread?: unknown }).createThread !== undefined
  );
}
