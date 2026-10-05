/**
 * Fork: per-model pricing and recent use for `orchestrator_capabilities`, so
 * an agent choosing a delegate can weigh cost and what this environment
 * actually runs. Read-only: one cached rate-table read and one grouped query
 * over the V2 run projection per capabilities call.
 */
import type { ServerProviderModel, ServerProviderModelPricing } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { attachModelPricing } from "../provider/modelPricing.ts";
import * as UsageService from "../usage/UsageService.ts";

export const RECENT_USE_WINDOW_DAYS = 14;

export interface ModelHints {
  readonly rates: UsageService.ModelRatesSnapshot;
  /** Distinct threads per `recentUseKey(instanceId, model)` inside the window; null when unreadable. */
  readonly recentThreadCounts: ReadonlyMap<string, number> | null;
}

const recentUseKey = (instanceId: string, model: string) => `${instanceId}\u0000${model}`;

export class OrchestratorModelHints extends Context.Service<
  OrchestratorModelHints,
  { readonly read: Effect.Effect<ModelHints> }
>()("t3/mcp/OrchestratorModelHints") {}

/** The optional capability fields for one model; empty when hints are unavailable. */
export function modelHintFields(
  hints: ModelHints | null,
  instanceId: string,
  model: ServerProviderModel,
): { readonly pricing?: ServerProviderModelPricing; readonly recentThreadCount?: number } {
  if (hints === null) return {};
  const pricing = attachModelPricing([model], hints.rates)[0]?.pricing;
  return {
    ...(pricing === undefined ? {} : { pricing }),
    ...(hints.recentThreadCounts === null
      ? {}
      : {
          recentThreadCount:
            hints.recentThreadCounts.get(recentUseKey(instanceId, model.slug)) ?? 0,
        }),
  };
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const usage = yield* UsageService.UsageService;

  const readRecentThreadCounts = Effect.gen(function* () {
    const since = DateTime.formatIso(
      DateTime.subtract(yield* DateTime.now, { days: RECENT_USE_WINDOW_DAYS }),
    );
    const rows = yield* sql<{
      readonly instance_id: string | null;
      readonly model: string | null;
      readonly thread_count: number;
    }>`
      SELECT
        json_extract(payload_json, '$.modelSelection.instanceId') AS instance_id,
        json_extract(payload_json, '$.modelSelection.model') AS model,
        COUNT(DISTINCT thread_id) AS thread_count
      FROM orchestration_v2_projection_runs
      WHERE requested_at >= ${since}
      GROUP BY instance_id, model
    `;
    return new Map<string, number>(
      rows.flatMap((row) =>
        row.instance_id === null || row.model === null
          ? []
          : [[recentUseKey(row.instance_id, row.model), Number(row.thread_count)] as const],
      ),
    );
  }).pipe(
    // Hints are advisory: a failed read leaves the counts out, never the call.
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not count recent model use", { cause }).pipe(Effect.as(null)),
    ),
  );

  const read = Effect.all({
    rates: usage.readModelRates,
    recentThreadCounts: readRecentThreadCounts,
  });

  return OrchestratorModelHints.of({ read });
});

export const layer = Layer.effect(OrchestratorModelHints, make);
