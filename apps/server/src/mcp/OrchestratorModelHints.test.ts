import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import type { ProviderAdapterV2Shape } from "../orchestration-v2/ProviderAdapter.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import type { ModelRate } from "../usage/usagePricing.ts";
import * as UsageService from "../usage/UsageService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import * as OrchestratorModelHints from "./OrchestratorModelHints.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const encodePayloadJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const rate = (input: number, output: number): ModelRate => ({
  inputCostPerToken: input / 1_000_000,
  outputCostPerToken: output / 1_000_000,
  cacheReadCostPerToken: 0,
  cacheCreationCostPerToken: 0,
  fast: null,
  ultrafast: null,
});

const usageLayer = Layer.mock(UsageService.UsageService)({
  readModelRates: Effect.succeed({
    rates: new Map([["gpt-5.5", rate(2, 8)]]),
    overrides: new Map(),
    fetchedAt: "2026-10-05T00:00:00.000Z",
  }),
});

const insertRun = (input: {
  readonly runId: string;
  readonly ordinal?: number;
  readonly threadId: string;
  readonly instanceId: string;
  readonly model: string;
  readonly requestedAt: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const payloadJson = yield* encodePayloadJson({
      modelSelection: { instanceId: input.instanceId, model: input.model },
    });
    yield* sql`
      INSERT INTO orchestration_v2_projection_runs (
        run_id, thread_id, ordinal, provider, provider_instance_id, provider_thread_id,
        status, requested_at, completed_at, payload_json
      )
      VALUES (
        ${input.runId}, ${input.threadId}, ${input.ordinal ?? 1}, ${input.instanceId}, ${input.instanceId}, NULL,
        'completed', ${input.requestedAt}, NULL,
        ${payloadJson}
      )
    `;
  });

it.effect("counts distinct recent threads per model in one grouped read", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(NOW)));
    yield* insertRun({
      runId: "run-1",
      threadId: "thread-a",
      instanceId: "codex",
      model: "gpt-5.5",
      requestedAt: "2026-10-04T10:00:00.000Z",
    });
    // A second run on the same thread counts the thread once.
    yield* insertRun({
      runId: "run-2",
      ordinal: 2,
      threadId: "thread-a",
      instanceId: "codex",
      model: "gpt-5.5",
      requestedAt: "2026-10-04T11:00:00.000Z",
    });
    yield* insertRun({
      runId: "run-3",
      threadId: "thread-b",
      instanceId: "codex",
      model: "gpt-5.5",
      requestedAt: "2026-09-25T10:00:00.000Z",
    });
    // Outside the 14-day window.
    yield* insertRun({
      runId: "run-4",
      threadId: "thread-c",
      instanceId: "codex",
      model: "gpt-5.5",
      requestedAt: "2026-09-01T10:00:00.000Z",
    });
    yield* insertRun({
      runId: "run-5",
      threadId: "thread-d",
      instanceId: "claudeAgent",
      model: "claude-opus-4-7",
      requestedAt: "2026-10-05T09:00:00.000Z",
    });

    const hints = yield* (yield* OrchestratorModelHints.OrchestratorModelHints).read;
    const model = (slug: string) => ({ slug, name: slug, isCustom: false, capabilities: null });

    const codex = OrchestratorModelHints.modelHintFields(hints, "codex", model("gpt-5.5"));
    assert.equal(codex.recentThreadCount, 2);
    assert.equal(codex.pricing?.inputCostPerMillionTokens, 2);
    assert.equal(codex.pricing?.outputCostPerMillionTokens, 8);

    // Same model under another instance is a separate count; no rate, no pricing.
    assert.deepEqual(
      OrchestratorModelHints.modelHintFields(hints, "claudeAgent", model("claude-opus-4-7")),
      { recentThreadCount: 1 },
    );
    assert.deepEqual(OrchestratorModelHints.modelHintFields(hints, "codex", model("unused")), {
      recentThreadCount: 0,
    });
    assert.deepEqual(OrchestratorModelHints.modelHintFields(null, "codex", model("gpt-5.5")), {});
  }).pipe(
    Effect.provide(
      OrchestratorModelHints.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(SqlitePersistenceMemory, usageLayer)),
      ),
    ),
  ),
);

it.effect("adds pricing and recent use to orchestrator_capabilities models", () =>
  Effect.gen(function* () {
    const codexInstanceId = ProviderInstanceId.make("codex");
    const provider: ServerProvider = {
      instanceId: codexInstanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: "test",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: NOW,
      models: [
        { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
        { slug: "unpriced", name: "Unpriced", isCustom: false, capabilities: null },
      ],
      slashCommands: [],
      skills: [],
    };
    const hints: OrchestratorModelHints.ModelHints = {
      rates: { rates: new Map([["gpt-5.5", rate(2, 8)]]), overrides: new Map(), fetchedAt: null },
      recentThreadCounts: new Map([["codex\u0000gpt-5.5", 3]]),
    };
    const scope: McpInvocationScope = {
      environmentId: EnvironmentId.make("environment:model-hints"),
      requestNamespace: "client:model-hints",
      thread: undefined,
      client: undefined,
      capabilities: new Set(["orchestration"]),
      issuedAt: 1,
    };
    const dependencies = Layer.mergeAll(
      NodeServices.layer,
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
      Layer.succeed(
        ProviderAdapterRegistry.ProviderAdapterRegistryV2,
        ProviderAdapterRegistry.ProviderAdapterRegistryV2.of({
          list: () => Effect.succeed([codexInstanceId]),
          get: (instanceId: ProviderInstanceId) =>
            Effect.succeed({ instanceId } as unknown as ProviderAdapterV2Shape),
        } as unknown as ProviderAdapterRegistry.ProviderAdapterRegistryV2["Service"]),
      ),
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
      Layer.succeed(
        OrchestratorModelHints.OrchestratorModelHints,
        OrchestratorModelHints.OrchestratorModelHints.of({ read: Effect.succeed(hints) }),
      ),
    );

    const capabilities = yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.capabilities(scope);
    }).pipe(Effect.provide(OrchestratorMcpService.layer.pipe(Layer.provide(dependencies))));

    const [priced, unpriced] = capabilities.providers[0]!.models;
    assert.equal(priced?.recentThreadCount, 3);
    assert.equal(priced?.pricing?.inputCostPerMillionTokens, 2);
    assert.equal(priced?.pricing?.costSource, "modelPriced");
    assert.isUndefined(unpriced?.pricing);
    assert.equal(unpriced?.recentThreadCount, 0);
  }),
);
