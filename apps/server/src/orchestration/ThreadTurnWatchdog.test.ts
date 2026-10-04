import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";

import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import * as ThreadTurnActivity from "./ThreadTurnActivity.ts";
import {
  STALLED_TURN_SWEEP_INTERVAL_MS,
  STALLED_TURN_THRESHOLD_MS,
  startStalledTurnWatchdog,
  sweepStalledTurns,
} from "./ThreadTurnWatchdog.ts";

const options = { thresholdMs: STALLED_TURN_THRESHOLD_MS };
const threadId = ThreadId.make("thread-1");

type ShellOverrides = {
  readonly status?: "running" | "ready";
  readonly providerName?: string;
  readonly activeTurnId?: TurnId | null;
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly backgroundLiveness?: "working" | "monitoring" | null;
};

// Only the fields the watchdog reads; the rest of the shell is irrelevant.
const makeShell = (overrides: ShellOverrides): OrchestrationThreadShell =>
  ({
    id: threadId,
    projectId: ProjectId.make("project-1"),
    session: {
      threadId,
      status: overrides.status ?? "running",
      providerName: overrides.providerName ?? "claudeAgent",
      runtimeMode: "full-access",
      activeTurnId:
        overrides.activeTurnId === undefined ? TurnId.make("turn-1") : overrides.activeTurnId,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    hasPendingApprovals: overrides.hasPendingApprovals ?? false,
    hasPendingUserInput: overrides.hasPendingUserInput ?? false,
    backgroundLiveness: overrides.backgroundLiveness ?? null,
  }) as unknown as OrchestrationThreadShell;

function makeHarness(shell: Option.Option<OrchestrationThreadShell>) {
  const activity = ThreadTurnActivity.make();
  const dispatched: OrchestrationCommand[] = [];
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(ThreadTurnActivity.ThreadTurnActivityService, activity),
      Effect.provideService(ProjectionSnapshotQuery, {
        getThreadShellById: () => Effect.succeed(shell),
      } as unknown as ProjectionSnapshotQuery["Service"]),
      Effect.provideService(OrchestrationEngineService, {
        dispatch: (command: OrchestrationCommand) =>
          Effect.sync(() => {
            dispatched.push(command);
            return { sequence: dispatched.length };
          }),
      } as unknown as OrchestrationEngineService["Service"]),
    );
  return { activity, dispatched, provide };
}

const activityKinds = (dispatched: ReadonlyArray<OrchestrationCommand>) =>
  dispatched.flatMap((command) =>
    command.type === "thread.activity.append" ? [command.activity.kind] : [],
  );

describe("ThreadTurnWatchdog", () => {
  it.effect("flags a silent Claude turn once and records stalledSince", () =>
    Effect.gen(function* () {
      const { activity, dispatched, provide } = makeHarness(Option.some(makeShell({})));
      activity.recordEvent(threadId, 0);

      yield* provide(sweepStalledTurns(options));
      expect(activity.getStalledSince(threadId)).toBeNull();

      yield* TestClock.adjust(Duration.millis(STALLED_TURN_THRESHOLD_MS));
      yield* provide(sweepStalledTurns(options));
      yield* provide(sweepStalledTurns(options));

      expect(activityKinds(dispatched)).toEqual(["provider.turn.stalled"]);
      expect(activity.getStalledSince(threadId)).toBe("1970-01-01T00:10:00.000Z");
    }),
  );

  it.effect("sweeps on its schedule and never interrupts the turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { activity, dispatched, provide } = makeHarness(Option.some(makeShell({})));
        activity.recordEvent(threadId, 0);
        yield* provide(startStalledTurnWatchdog(options));

        yield* Effect.yieldNow;
        yield* TestClock.adjust(Duration.millis(STALLED_TURN_THRESHOLD_MS - 1));
        expect(dispatched).toEqual([]);

        yield* TestClock.adjust(Duration.millis(STALLED_TURN_SWEEP_INTERVAL_MS));
        expect(dispatched.map((command) => command.type)).toEqual(["thread.activity.append"]);
        expect(activityKinds(dispatched)).toEqual(["provider.turn.stalled"]);
      }),
    ),
  );

  it.effect("keeps a turn unflagged while heartbeats keep arriving", () =>
    Effect.gen(function* () {
      const { activity, dispatched, provide } = makeHarness(Option.some(makeShell({})));
      activity.recordEvent(threadId, 0);

      // A tool.progress heartbeat every 5 minutes, for an hour.
      for (let beat = 0; beat < 12; beat += 1) {
        yield* TestClock.adjust(Duration.minutes(5));
        activity.recordEvent(threadId, yield* Clock.currentTimeMillis);
        yield* provide(sweepStalledTurns(options));
      }

      expect(dispatched).toEqual([]);
      expect(activity.getStalledSince(threadId)).toBeNull();
    }),
  );

  const exclusions: ReadonlyArray<readonly [string, ShellOverrides]> = [
    ["a pending approval", { hasPendingApprovals: true }],
    ["pending user input", { hasPendingUserInput: true }],
    ["live background work", { backgroundLiveness: "working" }],
    ["monitoring background work", { backgroundLiveness: "monitoring" }],
    ["a non-Claude provider", { providerName: "codex" }],
    ["a session that is not running", { status: "ready" }],
    ["a running session without an active turn", { activeTurnId: null }],
  ];
  for (const [label, overrides] of exclusions) {
    it.effect(`does not flag a silent turn with ${label}`, () =>
      Effect.gen(function* () {
        const { activity, dispatched, provide } = makeHarness(Option.some(makeShell(overrides)));
        activity.recordEvent(threadId, 0);

        yield* TestClock.adjust(Duration.millis(STALLED_TURN_THRESHOLD_MS * 2));
        yield* provide(sweepStalledTurns(options));

        expect(dispatched).toEqual([]);
        expect(activity.getStalledSince(threadId)).toBeNull();
      }),
    );
  }

  it.effect("drops a flag once the turn is no longer running", () =>
    Effect.gen(function* () {
      const { activity, provide } = makeHarness(Option.some(makeShell({ status: "ready" })));
      activity.recordEvent(threadId, 0);
      activity.markStalled(threadId, "1970-01-01T00:10:00.000Z", 0);

      yield* TestClock.adjust(Duration.millis(STALLED_TURN_THRESHOLD_MS));
      yield* provide(sweepStalledTurns(options));

      expect(activity.listEntries()).toEqual([]);
    }),
  );

  it.effect("stops watching a thread that no longer exists", () =>
    Effect.gen(function* () {
      const { activity, dispatched, provide } = makeHarness(Option.none());
      activity.recordEvent(threadId, 0);

      yield* TestClock.adjust(Duration.millis(STALLED_TURN_THRESHOLD_MS));
      yield* provide(sweepStalledTurns(options));

      expect(dispatched).toEqual([]);
      expect(activity.listEntries()).toEqual([]);
    }),
  );
});
