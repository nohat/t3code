import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import { OpenCodeRuntimeError } from "./opencodeRuntime.ts";
import {
  isOpenCodeDatabaseLockedStartError,
  openCodeServerStartFailureDetail,
  retryOpenCodeServerStart,
} from "./opencodeServerStartRetry.ts";

const exitedWith = (stderr: string) =>
  new OpenCodeRuntimeError({
    operation: "startOpenCodeServerProcess",
    detail: `OpenCode server exited before startup completed (code: 1).\n\nstderr:\n${stderr}`,
    cause: { exitCode: 1, stdout: "", stderr },
  });

const lockedError = exitedWith("Error: database is locked");

const withDetail = (error: OpenCodeRuntimeError, detail: string) =>
  new OpenCodeRuntimeError({ operation: error.operation, detail, cause: error.cause });

/** A start that fails with `failures` in order, then succeeds; counts attempts and open scopes. */
const makeStart = (failures: ReadonlyArray<OpenCodeRuntimeError>) =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const openScopes = yield* Ref.make(0);
    const start = Effect.gen(function* () {
      const attempt = yield* Ref.updateAndGet(attempts, (count) => count + 1);
      yield* Ref.update(openScopes, (count) => count + 1);
      yield* Effect.addFinalizer(() => Ref.update(openScopes, (count) => count - 1));
      const failure = failures[attempt - 1];
      if (failure) return yield* failure;
      return "http://127.0.0.1:4096";
    });
    return { start, attempts, openScopes };
  });

it("retries only a startup exit whose stderr reports a locked database", () => {
  NodeAssert.equal(isOpenCodeDatabaseLockedStartError(lockedError), true);
  NodeAssert.equal(isOpenCodeDatabaseLockedStartError(exitedWith("SQLITE_BUSY: busy")), true);
  NodeAssert.equal(isOpenCodeDatabaseLockedStartError(exitedWith("Error: port in use")), false);
  NodeAssert.equal(
    isOpenCodeDatabaseLockedStartError(
      new OpenCodeRuntimeError({
        operation: "startOpenCodeServerProcess",
        detail: "Timed out waiting for OpenCode server start after 5000ms.",
      }),
    ),
    false,
  );
});

it("adds the attempt count, the tracked server count, and a hint to the detail", () => {
  const detail = openCodeServerStartFailureDetail(lockedError, { attempts: 3, trackedServers: 4 });
  NodeAssert.ok(detail.startsWith(lockedError.detail));
  NodeAssert.match(detail, /Attempts: 3\. Local OpenCode servers running for T3 Code: 4\./);
  NodeAssert.match(detail, /Hint: other OpenCode processes kept its database locked/);
  NodeAssert.match(
    openCodeServerStartFailureDetail(exitedWith("boom"), { attempts: 1, trackedServers: 0 }),
    /Hint: run `opencode serve` in a terminal/,
  );
});

it.effect("recovers from a locked database on a later attempt", () =>
  Effect.gen(function* () {
    const { start, attempts, openScopes } = yield* makeStart([lockedError, lockedError]);
    const fiber = yield* retryOpenCodeServerStart(start, {
      trackedServers: Effect.succeed(0),
      withDetail,
    }).pipe(Effect.scoped, Effect.forkChild);
    yield* TestClock.adjust(Duration.seconds(2));
    NodeAssert.equal(yield* Fiber.join(fiber), "http://127.0.0.1:4096");
    NodeAssert.equal(yield* Ref.get(attempts), 3);
    NodeAssert.equal(yield* Ref.get(openScopes), 0);
  }),
);

it.effect("closes each failed attempt's scope before the next attempt", () =>
  Effect.gen(function* () {
    const { start, openScopes } = yield* makeStart([lockedError]);
    const scope = yield* Scope.make();
    const fiber = yield* retryOpenCodeServerStart(start, {
      trackedServers: Effect.succeed(0),
      withDetail,
    }).pipe(Scope.provide(scope), Effect.forkChild);
    yield* TestClock.adjust(Duration.seconds(1));
    yield* Fiber.join(fiber);
    // Only the successful attempt's scope is still open, owned by the caller.
    NodeAssert.equal(yield* Ref.get(openScopes), 1);
    yield* Scope.close(scope, Exit.void);
    NodeAssert.equal(yield* Ref.get(openScopes), 0);
  }),
);

it.effect("gives up after three locked attempts with the detail attached", () =>
  Effect.gen(function* () {
    const { start, attempts } = yield* makeStart([lockedError, lockedError, lockedError]);
    const fiber = yield* retryOpenCodeServerStart(start, {
      trackedServers: Effect.succeed(5),
      withDetail,
    }).pipe(Effect.scoped, Effect.flip, Effect.forkChild);
    yield* TestClock.adjust(Duration.seconds(2));
    const error = yield* Fiber.join(fiber);
    NodeAssert.equal(yield* Ref.get(attempts), 3);
    NodeAssert.match(error.detail, /Attempts: 3\. Local OpenCode servers running for T3 Code: 5\./);
    NodeAssert.deepEqual(error.cause, lockedError.cause);
  }),
);

it.effect("does not retry other startup failures", () =>
  Effect.gen(function* () {
    const { start, attempts } = yield* makeStart([exitedWith("Error: invalid config")]);
    const error = yield* retryOpenCodeServerStart(start, {
      trackedServers: Effect.succeed(1),
      withDetail,
    }).pipe(Effect.scoped, Effect.flip);
    NodeAssert.equal(yield* Ref.get(attempts), 1);
    NodeAssert.match(error.detail, /Attempts: 1\./);
  }),
);
