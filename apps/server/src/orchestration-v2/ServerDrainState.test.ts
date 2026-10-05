import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";

import * as ServerDrainState from "./ServerDrainState.ts";

const expiresAtMillis = (status: ServerDrainState.ServerDrainStatus) =>
  status.expiresAt === null ? null : DateTime.toEpochMillis(status.expiresAt);

const idleThread = ThreadId.make("thread-idle");
const runningThread = ThreadId.make("thread-running");
const isThreadRunning = (threadId: ThreadId) => Effect.succeed(threadId === runningThread);

const turnStart = (threadId: ThreadId, extra?: { readonly bootstrap?: unknown }) => ({
  type: "thread.turn.start",
  threadId,
  ...extra,
});

const withDrain = <A, E>(
  run: (drain: ServerDrainState.ServerDrainState["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const drain = yield* ServerDrainState.ServerDrainState;
    return yield* run(drain);
  }).pipe(Effect.provide(ServerDrainState.layer));

it.effect("accepts new turns until drain mode is turned on", () =>
  withDrain((drain) =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* drain.status, { draining: false, expiresAt: null });
      yield* ServerDrainState.rejectTurnStartsWhileDraining(
        drain,
        isThreadRunning,
        turnStart(idleThread),
      );
    }),
  ),
);

it.effect("refuses a new turn with a message the client can show and a reason it can act on", () =>
  withDrain((drain) =>
    Effect.gen(function* () {
      yield* drain.enable();
      const error = yield* ServerDrainState.rejectTurnStartsWhileDraining(
        drain,
        isThreadRunning,
        turnStart(idleThread),
      ).pipe(Effect.flip);
      assert.strictEqual(error.reason, "server-draining");
      assert.strictEqual(error.message, ServerDrainState.DRAIN_REFUSAL_MESSAGE);
      assert.isUndefined(error.bootstrapThreadDisposition);
    }),
  ),
);

it.effect("tells the client a refused bootstrap send created no thread", () =>
  withDrain((drain) =>
    Effect.gen(function* () {
      yield* drain.enable();
      const error = yield* ServerDrainState.rejectTurnStartsWhileDraining(
        drain,
        isThreadRunning,
        turnStart(idleThread, { bootstrap: { createThread: { projectId: "project-1" } } }),
      ).pipe(Effect.flip);
      assert.strictEqual(error.bootstrapThreadDisposition, "not-created");
    }),
  ),
);

it.effect("lets a message steer a turn that is already running", () =>
  withDrain((drain) =>
    Effect.gen(function* () {
      yield* drain.enable();
      yield* ServerDrainState.rejectTurnStartsWhileDraining(
        drain,
        isThreadRunning,
        turnStart(runningThread),
      );
    }),
  ),
);

it.effect("lets running turns finish: interrupts, approvals, and answers still run", () =>
  withDrain((drain) =>
    Effect.gen(function* () {
      yield* drain.enable();
      for (const type of [
        "thread.turn.interrupt",
        "thread.approval.respond",
        "thread.user-input.respond",
        "thread.session.stop",
        "thread.meta.update",
      ]) {
        yield* ServerDrainState.rejectTurnStartsWhileDraining(drain, isThreadRunning, {
          type,
          threadId: idleThread,
        });
      }
    }),
  ),
);

it.effect("expires on its own so a dead deploy cannot leave the server refusing", () =>
  withDrain((drain) =>
    Effect.gen(function* () {
      const enabled = yield* drain.enable(Duration.minutes(5));
      assert.isTrue(enabled.draining);
      assert.strictEqual(
        expiresAtMillis(enabled),
        DateTime.toEpochMillis(yield* DateTime.now) + Duration.toMillis(Duration.minutes(5)),
      );

      yield* TestClock.adjust(Duration.minutes(4));
      assert.isTrue((yield* drain.status).draining);

      yield* TestClock.adjust(Duration.minutes(1));
      assert.deepStrictEqual(yield* drain.status, { draining: false, expiresAt: null });
      yield* ServerDrainState.rejectTurnStartsWhileDraining(
        drain,
        isThreadRunning,
        turnStart(idleThread),
      );
    }),
  ),
);

it.effect("defaults to a 30 minute drain and can be turned off early", () =>
  withDrain((drain) =>
    Effect.gen(function* () {
      const enabled = yield* drain.enable();
      assert.strictEqual(
        expiresAtMillis(enabled),
        DateTime.toEpochMillis(yield* DateTime.now) + Duration.toMillis(Duration.minutes(30)),
      );
      assert.deepStrictEqual(yield* drain.disable, { draining: false, expiresAt: null });
      yield* ServerDrainState.rejectTurnStartsWhileDraining(
        drain,
        isThreadRunning,
        turnStart(idleThread),
      );
    }),
  ),
);
