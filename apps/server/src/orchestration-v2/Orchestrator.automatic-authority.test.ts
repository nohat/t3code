import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  OrchestrationV2Command,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-6.1-sol" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Provider execution is forbidden in authority tests"),
} as ProviderAdapterV2Shape;
const database = SqlitePersistenceMemory;
const testLayer = makeOrchestratorV2ReplayLayerWithRegistry(
  { name: "automatic-authority" },
  ProviderAdapterRegistry.makeLayer([adapter]),
  { databaseLayer: database, runEffectWorker: false },
);
const threadId = ThreadId.make("thread:automatic-authority");
const message = (key: string, sequence?: number) => ({
  type: "message.dispatch",
  commandId: CommandId.make(key),
  threadId,
  messageId: MessageId.make(key),
  text: "synthetic automatic observation",
  attachments: [],
  dispatchMode: { type: "defer_start" },
  createdBy: "user",
  creationSource: "server",
  ...(sequence === undefined
    ? {}
    : { automaticAuthority: { purpose: "checklist", expectedThreadSequence: sequence } }),
});
// The ordinary raw RPC's command decoder and SAME locked mutation service.
// No sendToThread helper, HTTP server, provider worker or production DB.
const rawDispatch = (input: unknown) =>
  Schema.decodeUnknownEffect(OrchestrationV2Command)(input).pipe(
    Effect.flatMap((command) =>
      Effect.flatMap(Orchestrator.OrchestratorV2, (service) => service.dispatch(command)),
    ),
  );
const setup = Effect.gen(function* () {
  const service = yield* Orchestrator.OrchestratorV2;
  yield* service.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create"),
    threadId,
    projectId: ProjectId.make("project:synthetic"),
    title: "Synthetic",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  return service;
});
const counts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    runs: number;
    starts: number;
  }>`SELECT (SELECT count(*) FROM orchestration_v2_projection_runs WHERE thread_id=${threadId}) AS runs, (SELECT count(*) FROM orchestration_v2_effect_outbox WHERE thread_id=${threadId} AND effect_type='provider-turn.start') AS starts`;
  return rows[0];
});
describe("atomic automatic authority at ordinary RPC mutation", () => {
  for (const mutation of ["thread.archive", "thread.delete", "archive-unarchive"] as const)
    it.effect(
      `refuses stale automatic authority after ${mutation} without run/effect creation`,
      () =>
        Effect.gen(function* () {
          const service = yield* setup;
          const observed = yield* service.getThreadSnapshot(threadId);
          yield* service.dispatch({
            type: mutation === "archive-unarchive" ? "thread.archive" : mutation,
            commandId: CommandId.make("revoke"),
            threadId,
          });
          if (mutation === "archive-unarchive")
            yield* service.dispatch({
              type: "thread.unarchive",
              commandId: CommandId.make("unarchive"),
              threadId,
            });
          const before = yield* counts;
          const outcome = yield* Effect.exit(
            rawDispatch(message("stale", observed.snapshotSequence)),
          );
          assert.equal(outcome._tag, "Failure");
          assert.deepEqual(yield* counts, before);
        }).pipe(Effect.provide(testLayer)),
    );
  it.effect(
    "refuses automatic dispatch after interrupt commits; manual user recovery remains allowed",
    () =>
      Effect.gen(function* () {
        const service = yield* setup;
        yield* rawDispatch({
          ...message("initial-user"),
          dispatchMode: { type: "start_immediately" },
        });
        const observed = yield* service.getThreadSnapshot(threadId);
        const run = observed.projection.runs[0];
        assert.ok(run);
        yield* service.dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("stop"),
          threadId,
          runId: run.id,
          holdQueue: true,
        });
        const before = yield* counts;
        assert.equal(
          (yield* Effect.exit(rawDispatch(message("stale-after-stop", observed.snapshotSequence))))
            ._tag,
          "Failure",
        );
        assert.deepEqual(yield* counts, before);
        const stopped = yield* service.getThreadSnapshot(threadId);
        assert.equal(
          (yield* Effect.exit(rawDispatch(message("fresh-after-stop", stopped.snapshotSequence))))
            ._tag,
          "Failure",
        );
        yield* rawDispatch(message("explicit-user-recovery"));
        assert.equal((yield* counts).runs, before.runs + 1);
      }).pipe(Effect.provide(testLayer)),
  );
  it.effect(
    "accepts unchanged authority and replay preserves its original receipt after revocation",
    () =>
      Effect.gen(function* () {
        const service = yield* setup;
        const observed = yield* service.getThreadSnapshot(threadId);
        const command = message("accepted", observed.snapshotSequence);
        const accepted = yield* rawDispatch(command);
        const before = yield* counts;
        yield* service.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("archive-after-accept"),
          threadId,
        });
        const replay = yield* rawDispatch(command);
        assert.equal(replay.sequence, accepted.sequence);
        assert.deepEqual(yield* counts, before);
      }).pipe(Effect.provide(testLayer)),
  );
});
