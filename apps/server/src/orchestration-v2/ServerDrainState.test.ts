import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ServerDrainState from "./ServerDrainState.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ThreadMessageIntake from "./ThreadMessageIntake.ts";
import { userFacingDispatchErrorMessage } from "./UserFacingErrors.ts";

const idleThread = ThreadId.make("thread-idle");
const runningThread = ThreadId.make("thread-running");
const projectId = ProjectId.make("project-drain");

// The gate reads only `activityRunStatus`; the rest of the shell is irrelevant here.
const shellWith = (activityRunStatus: OrchestrationV2ThreadShell["activityRunStatus"]) =>
  ({ activityRunStatus }) as unknown as OrchestrationV2ThreadShell;

/**
 * Intake over mocked thread services: `dispatched` and `launched` record what
 * got past the gate. The drain layer is the real one.
 */
const makeHarness = () => {
  const dispatched: Array<string> = [];
  const launched: Array<CommandId> = [];
  const layer = Layer.mergeAll(
    ServerDrainState.layer.pipe(
      Layer.provide(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadShell: (threadId) =>
            Effect.succeed(
              threadId === runningThread
                ? shellWith("running")
                : threadId === idleThread
                  ? shellWith(null)
                  : null,
            ),
        }),
      ),
      Layer.provide(SqlitePersistenceMemory),
    ),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      dispatch: (command) => {
        dispatched.push(command.commandId);
        return Effect.succeed({ sequence: dispatched.length, storedEvents: [] });
      },
    }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) => {
        launched.push(input.commandId);
        return Effect.die("launch result is not inspected");
      },
    }),
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-drain-intake-" }),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return { dispatched, launched, layer };
};

const userMessage = (
  threadId: ThreadId,
  label: string,
  extra?: Partial<Extract<OrchestrationV2Command, { type: "message.dispatch" }>>,
): OrchestrationV2Command => ({
  type: "message.dispatch",
  createdBy: "user",
  creationSource: "web",
  commandId: CommandId.make(`cmd-${label}`),
  threadId,
  messageId: MessageId.make(`message-${label}`),
  text: "hello",
  attachments: [],
  dispatchMode: { type: "start_immediately" },
  ...extra,
});

const userLaunch = (label: string, withMessage = true): ThreadLaunch.ThreadLaunchInput => ({
  commandId: CommandId.make(`cmd-launch-${label}`),
  projectId,
  title: "Drain",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
  runtimeMode: "full-access",
  interactionMode: "default",
  workspaceStrategy: { type: "root" },
  ...(withMessage ? { initialMessage: { text: "hello", attachments: [] } } : {}),
  createdBy: "user",
  creationSource: "web",
});

const withDrain = <A, E, R>(
  run: (
    drain: ServerDrainState.ServerDrainState["Service"],
    harness: ReturnType<typeof makeHarness>,
  ) => Effect.Effect<A, E, R>,
) => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const drain = yield* ServerDrainState.ServerDrainState;
    return yield* run(drain, harness);
  }).pipe(Effect.provide(harness.layer));
};

const expiresAtMillis = (status: ServerDrainState.ServerDrainStatus) =>
  status.expiresAt === null ? null : DateTime.toEpochMillis(status.expiresAt);

it.effect("accepts user sends and launches until drain mode is turned on", () =>
  withDrain((drain, { dispatched, launched }) =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* drain.status, { draining: false, expiresAt: null });
      yield* ThreadMessageIntake.dispatchCommand(userMessage(idleThread, "open"));
      yield* ThreadMessageIntake.launchThread(userLaunch("open")).pipe(Effect.exit);
      assert.deepStrictEqual(dispatched, ["cmd-open"]);
      assert.deepStrictEqual(launched, ["cmd-launch-open"]);
    }),
  ),
);

it.effect("refuses a user send that would start a turn, with a message the client shows", () =>
  withDrain((drain, { dispatched }) =>
    Effect.gen(function* () {
      yield* drain.enable();
      const error = yield* ThreadMessageIntake.dispatchCommand(
        userMessage(idleThread, "refused"),
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ServerDrainingError");
      assert.strictEqual(error.message, ServerDrainState.DRAIN_REFUSAL_MESSAGE);
      // The WebSocket handler builds the client error from this.
      assert.strictEqual(
        userFacingDispatchErrorMessage(error),
        ServerDrainState.DRAIN_REFUSAL_MESSAGE,
      );
      assert.deepStrictEqual(dispatched, []);
    }),
  ),
);

it.effect("refuses a user launch before it creates a thread", () =>
  withDrain((drain, { launched }) =>
    Effect.gen(function* () {
      yield* drain.enable();
      const error = yield* ThreadMessageIntake.launchThread(userLaunch("refused")).pipe(
        Effect.flip,
      );
      assert.strictEqual(error._tag, "ServerDrainingError");
      assert.deepStrictEqual(launched, []);
    }),
  ),
);

it.effect("lets a launch without a message through, since it starts no turn", () =>
  withDrain((drain, { launched }) =>
    Effect.gen(function* () {
      yield* drain.enable();
      yield* ThreadMessageIntake.launchThread(userLaunch("empty", false)).pipe(Effect.exit);
      assert.deepStrictEqual(launched, ["cmd-launch-empty"]);
    }),
  ),
);

it.effect("lets steers and sends to a running thread join the turn in flight", () =>
  withDrain((drain, { dispatched }) =>
    Effect.gen(function* () {
      yield* drain.enable();
      yield* ThreadMessageIntake.dispatchCommand(
        userMessage(idleThread, "steer-active", {
          dispatchMode: { type: "steer_active", targetRunId: RunId.make("run-1") },
        }),
      );
      yield* ThreadMessageIntake.dispatchCommand(
        userMessage(idleThread, "steer-intent", { deliveryIntent: "steer" }),
      );
      yield* ThreadMessageIntake.dispatchCommand(userMessage(runningThread, "running"));
      assert.deepStrictEqual(dispatched, ["cmd-steer-active", "cmd-steer-intent", "cmd-running"]);
    }),
  ),
);

it.effect("lets running turns finish: interrupts and agent sends still run", () =>
  withDrain((drain, { dispatched }) =>
    Effect.gen(function* () {
      yield* drain.enable();
      yield* ThreadMessageIntake.dispatchCommand({
        type: "run.interrupt",
        commandId: CommandId.make("cmd-interrupt"),
        threadId: runningThread,
        runId: RunId.make("run-1"),
      });
      yield* ThreadMessageIntake.dispatchCommand(
        userMessage(idleThread, "agent", { createdBy: "agent", creationSource: "mcp" }),
      );
      assert.deepStrictEqual(dispatched, ["cmd-interrupt", "cmd-agent"]);
    }),
  ),
);

it.effect("refuses a send to a thread it cannot read", () =>
  withDrain((drain, { dispatched }) =>
    Effect.gen(function* () {
      yield* drain.enable();
      const error = yield* ThreadMessageIntake.dispatchCommand(
        userMessage(ThreadId.make("thread-missing"), "missing"),
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ServerDrainingError");
      assert.deepStrictEqual(dispatched, []);
    }),
  ),
);

it.effect("expires on its own so a dead deploy cannot leave the server refusing", () =>
  withDrain((drain, { dispatched }) =>
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
      yield* ThreadMessageIntake.dispatchCommand(userMessage(idleThread, "expired"));
      assert.deepStrictEqual(dispatched, ["cmd-expired"]);
    }),
  ),
);

it.effect("defaults to a 30 minute drain and can be turned off early", () =>
  withDrain((drain, { dispatched }) =>
    Effect.gen(function* () {
      const enabled = yield* drain.enable();
      assert.strictEqual(
        expiresAtMillis(enabled),
        DateTime.toEpochMillis(yield* DateTime.now) + Duration.toMillis(Duration.minutes(30)),
      );
      assert.deepStrictEqual(yield* drain.disable, { draining: false, expiresAt: null });
      yield* ThreadMessageIntake.dispatchCommand(userMessage(idleThread, "after"));
      assert.deepStrictEqual(dispatched, ["cmd-after"]);
    }),
  ),
);
