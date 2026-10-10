/**
 * Bounded retry around one local `opencode serve` start (fork issues #18, #20).
 *
 * OpenCode 1.x opens its SQLite database at startup. Several T3 threads
 * starting their per-thread chat servers at once can collide on that lock and
 * the loser exits with "database is locked". A short retry clears the race;
 * any other startup failure is reported immediately. The final error carries
 * the attempt count, a hint, and how many local servers this T3 server has
 * recorded, so a user can tell contention from a broken install.
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

export const OPENCODE_SERVER_START_MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [Duration.millis(250), Duration.millis(750)] as const;
const DATABASE_LOCKED = /database is locked|SQLITE_BUSY/;

/** The parts of an `OpenCodeRuntimeError` the retry reads; a type, so this module has no import cycle. */
interface StartError {
  readonly detail: string;
  readonly cause?: unknown;
}

/** True when `opencode serve` exited during startup because its database was locked. */
export function isOpenCodeDatabaseLockedStartError(error: StartError): boolean {
  const cause: unknown = error.cause;
  if (typeof cause !== "object" || cause === null || !("stderr" in cause)) return false;
  return typeof cause.stderr === "string" && DATABASE_LOCKED.test(cause.stderr);
}

/** The start failure's detail with the attempt count, the tracked server count, and a one-line hint. */
export function openCodeServerStartFailureDetail(
  error: StartError,
  input: { readonly attempts: number; readonly trackedServers: number },
): string {
  const hint = isOpenCodeDatabaseLockedStartError(error)
    ? "Hint: other OpenCode processes kept its database locked; close some or retry shortly."
    : "Hint: run `opencode serve` in a terminal to see why it does not start.";
  return [
    error.detail,
    `Attempts: ${input.attempts}. Local OpenCode servers running for T3 Code: ${input.trackedServers}.`,
    hint,
  ].join("\n\n");
}

/**
 * Runs `start` up to {@link OPENCODE_SERVER_START_MAX_ATTEMPTS} times while it
 * fails on a locked database. Each attempt gets its own child scope, closed on
 * failure, so a failed spawn's finalizers run before the next attempt instead
 * of waiting for the caller's scope.
 */
export const retryOpenCodeServerStart = <A, E extends StartError, R>(
  start: Effect.Effect<A, E, R | Scope.Scope>,
  options: {
    /** How many local servers are recorded right now, read once on final failure. */
    readonly trackedServers: Effect.Effect<number>;
    /** Rebuilds the final error with the extended detail. */
    readonly withDetail: (error: E, detail: string) => E;
  },
): Effect.Effect<A, E, R | Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const attemptOnce = Effect.gen(function* () {
      const attemptScope = yield* Scope.fork(scope);
      return yield* start.pipe(
        Scope.provide(attemptScope),
        Effect.onError((cause) => Scope.close(attemptScope, Exit.failCause(cause))),
      );
    });
    const attempt = (attemptNumber: number): Effect.Effect<A, E, R> =>
      attemptOnce.pipe(
        Effect.catch((error) => {
          if (
            attemptNumber < OPENCODE_SERVER_START_MAX_ATTEMPTS &&
            isOpenCodeDatabaseLockedStartError(error)
          ) {
            return Effect.logWarning("OpenCode server start hit a locked database; retrying", {
              attempt: attemptNumber,
            }).pipe(
              Effect.andThen(Effect.sleep(RETRY_DELAYS[attemptNumber - 1] ?? Duration.seconds(1))),
              Effect.andThen(attempt(attemptNumber + 1)),
            );
          }
          return options.trackedServers.pipe(
            Effect.flatMap((trackedServers) =>
              Effect.fail(
                options.withDetail(
                  error,
                  openCodeServerStartFailureDetail(error, {
                    attempts: attemptNumber,
                    trackedServers,
                  }),
                ),
              ),
            ),
          );
        }),
      );
    return yield* attempt(1);
  });
