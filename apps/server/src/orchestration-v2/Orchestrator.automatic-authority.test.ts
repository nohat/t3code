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
const testLayer = Layer.merge(
  database,
  makeOrchestratorV2ReplayLayerWithRegistry(
    { name: "automatic-authority" },
    ProviderAdapterRegistry.makeLayer([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);
const threadId = ThreadId.make("thread:automatic-authority");
const message = (key: string, sequence?: number) => ({
  type: "message.dispatch",
  commandId: CommandId.make(key),
  threadId,
  messageId: MessageId.make(key),
  text: "synthetic automatic observation",
  attachments: [],
  dispatchMode: { type: "start_immediately" },
  deliveryIntent: "auto",
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
    messages: number;
  }>`SELECT (SELECT count(*) FROM orchestration_v2_projection_runs WHERE thread_id=${threadId}) AS runs, (SELECT count(*) FROM orchestration_v2_effect_outbox WHERE thread_id=${threadId} AND effect_type='provider-turn.start') AS starts, (SELECT count(*) FROM orchestration_v2_projection_messages WHERE thread_id=${threadId}) AS messages`;
  const row = rows[0];
  assert.isDefined(row, "the SQL aggregate must return exactly one row");
  return row;
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
          if (mutation !== "archive-unarchive") {
            const current = yield* service.getThreadSnapshot(threadId);
            const fresh = message("fresh-inactive", current.snapshotSequence);
            assert.equal((yield* Effect.exit(rawDispatch(fresh)))._tag, "Failure");
            assert.deepEqual(yield* counts, before);
            assert.equal((yield* Effect.exit(rawDispatch(fresh)))._tag, "Failure");
            assert.deepEqual(yield* counts, before);
          }
        }).pipe(Effect.provide(testLayer)),
    );
  for (const choice of [
    "stale",
    "fresh",
    "manual",
    "pending-interrupt",
    "held-queue",
    "older-pending-interrupt",
  ] as const)
    it.effect(`interrupt authority ${choice} is exercised independently`, () =>
      Effect.gen(function* () {
        const service = yield* setup;
        yield* rawDispatch(message("initial-user"));
        const observed = yield* service.getThreadSnapshot(threadId);
        if (choice === "held-queue")
          yield* rawDispatch({
            ...message("queued-before-stop"),
            dispatchMode: { type: "defer_start" },
          });
        const run = observed.projection.runs[0];
        assert.ok(run);
        yield* service.dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("stop"),
          threadId,
          runId: run.id,
          holdQueue: true,
        });
        if (choice === "pending-interrupt" || choice === "older-pending-interrupt") {
          // Replay the projection boundary while a provider interrupt is pending:
          // request exists, result absent, executing state not yet settled.
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM orchestration_v2_projection_turn_items WHERE thread_id=${threadId} AND type='run_interrupt_result'`;
          yield* sql`UPDATE orchestration_v2_projection_runs SET status='running', payload_json=json_set(payload_json, '$.status', 'running') WHERE thread_id=${threadId} AND run_id=${run.id}`;
          if (choice === "older-pending-interrupt") {
            yield* sql`UPDATE orchestration_v2_projection_runs SET status='completed', payload_json=json_set(payload_json, '$.status', 'completed') WHERE thread_id=${threadId} AND run_id=${run.id}`;
            yield* rawDispatch({
              ...message("explicit-later-queue"),
              dispatchMode: { type: "defer_start" },
            });
          }
        }
        const current = yield* service.getThreadSnapshot(threadId);
        const before = yield* counts;
        if (choice === "manual") {
          yield* rawDispatch(message("explicit-user-recovery"));
          assert.equal((yield* counts).runs, before.runs + 1);
        } else {
          const sequence =
            choice === "stale" ? observed.snapshotSequence : current.snapshotSequence;
          assert.equal(
            (yield* Effect.exit(rawDispatch(message("automatic-after-stop", sequence))))._tag,
            "Failure",
          );
          assert.deepEqual(yield* counts, before);
        }
      }).pipe(Effect.provide(testLayer)),
    );
  for (const initialMode of ["defer_start", "start_immediately"] as const)
    it.effect(`accepts unchanged authority with ${initialMode} work`, () =>
      Effect.gen(function* () {
        const service = yield* setup;
        yield* rawDispatch({ ...message("existing"), dispatchMode: { type: initialMode } });
        const observed = yield* service.getThreadSnapshot(threadId);
        const before = yield* counts;
        yield* rawDispatch({
          ...message("protected-followup", observed.snapshotSequence),
          dispatchMode: { type: "defer_start" },
        });
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
  for (const scenario of [
    "selected",
    "replay-after-stop",
    "newer-stop",
    "archive",
    "pending-interrupt",
    "wrong-purpose",
    "wrong-run",
  ] as const)
    it.effect(`explicit continuation Resume ${scenario}`, () =>
      Effect.gen(function* () {
        const service = yield* setup;
        yield* rawDispatch(message("resume-initial"));
        const initial = yield* service.getThreadSnapshot(threadId);
        const stopped = initial.projection.runs[0];
        assert.ok(stopped);
        yield* rawDispatch({ ...message("other-held"), dispatchMode: { type: "defer_start" } });
        yield* service.dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("resume-stop"),
          threadId,
          runId: stopped.id,
          holdQueue: true,
        });
        const action = yield* service.getThreadSnapshot(threadId);
        const command = {
          ...message("selected-resume"),
          automaticAuthority: {
            purpose: scenario === "wrong-purpose" ? "checklist" : "continuation",
            expectedThreadSequence: action.snapshotSequence,
            resumeAfterRunId: scenario === "wrong-run" ? "not-the-stopped-run" : stopped.id,
          },
        };
        if (scenario === "newer-stop") {
          // A provider can still report this SAME run executing while Stop settles.
          // Commit the second Stop through the ordinary mutation service.
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE orchestration_v2_projection_runs SET status='running', payload_json=json_set(payload_json, '$.status', 'running') WHERE thread_id=${threadId} AND run_id=${stopped.id}`;
          yield* service.dispatch({
            type: "run.interrupt",
            commandId: CommandId.make("newer-same-run-stop"),
            threadId,
            runId: stopped.id,
            holdQueue: true,
          });
        }
        if (scenario === "archive")
          yield* service.dispatch({
            type: "thread.archive",
            commandId: CommandId.make("resume-archive"),
            threadId,
          });
        if (scenario === "pending-interrupt") {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM orchestration_v2_projection_turn_items WHERE thread_id=${threadId} AND type='run_interrupt_result'`;
        }
        const before = yield* counts;
        const result = yield* Effect.exit(rawDispatch(command));
        if (scenario !== "selected" && scenario !== "replay-after-stop") {
          assert.equal(result._tag, "Failure");
          assert.deepEqual(yield* counts, before);
          assert.equal((yield* Effect.exit(rawDispatch(command)))._tag, "Failure");
          assert.deepEqual(yield* counts, before);
          return;
        }
        assert.equal(result._tag, "Success");
        const after = yield* service.getThreadSnapshot(threadId);
        const other = after.projection.runs.find(
          (run) => run.userMessageId === MessageId.make("other-held"),
        );
        assert.ok(other);
        assert.equal(other.status, "queued");
        assert.equal(other.queueHeld, true);
        assert.equal((yield* counts).runs, before.runs + 1);
        if (scenario === "replay-after-stop") {
          const resumed = after.projection.runs.find(
            (run) => run.userMessageId === MessageId.make("selected-resume"),
          );
          assert.ok(resumed);
          yield* service.dispatch({
            type: "run.interrupt",
            commandId: CommandId.make("stop-resumed"),
            threadId,
            runId: resumed.id,
            holdQueue: true,
          });
          const revokedCounts = yield* counts;
          const replay = yield* rawDispatch(command);
          if (result._tag === "Success") assert.equal(replay.sequence, result.value.sequence);
          assert.deepEqual(yield* counts, revokedCounts);
          const final = yield* service.getThreadSnapshot(threadId);
          assert.equal(final.projection.runs.find((run) => run.id === other.id)?.queueHeld, true);
        }
      }).pipe(Effect.provide(testLayer)),
    );
});
