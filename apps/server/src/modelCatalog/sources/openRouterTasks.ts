/**
 * OpenRouter task-classification adapter.
 *
 * `GET /api/v1/classifications/task` publishes sampled usage shares per task
 * category and the top models in each. This yields task-specific ranks over
 * OpenRouter traffic only, within a bounded window; it is not a benchmark score
 * and not global usage.
 *
 * @module modelCatalog/sources/openRouterTasks
 */
import type { CatalogAdoptionSignal } from "@t3tools/contracts";

import type { SourceModelMatch } from "../crosswalk.ts";
import { buildSourceIndex, matchSource } from "../matching.ts";
import { extractRows } from "./openRouterBenchmarks.ts";
import type { AdapterMeta } from "./liteLlmPricing.ts";

export const OPENROUTER_TASKS_URL = "https://openrouter.ai/api/v1/classifications/task";

const UNIVERSE = "OpenRouter traffic classified by task (sampled usage and token shares)";

export interface TaskParseResult {
  readonly signals: { readonly modelId: string; readonly signal: CatalogAdoptionSignal }[];
}

export function parseOpenRouterTasks(
  payload: unknown,
  matches: readonly SourceModelMatch[],
  meta: AdapterMeta,
  window: string,
): TaskParseResult {
  const rows = extractRows(payload);
  const index = buildSourceIndex(
    matches.map((match) => [match.sourceModelId, match.modelId] as const),
  );
  const signals: { modelId: string; signal: CatalogAdoptionSignal }[] = [];

  for (const row of rows) {
    const task = firstString(row, ["display_name", "tag"]);
    const models = Array.isArray(row.models) ? row.models.filter(isRecord) : [];
    if (task === undefined || models.length === 0) continue;
    const ranked = models
      .map((model) => ({
        id: typeof model.id === "string" ? model.id : undefined,
        share: firstNumber(model, ["tag_usage_share", "usage_share"]),
      }))
      .filter((entry): entry is { id: string; share: number | undefined } => entry.id !== undefined)
      .sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
    for (let indexInRank = 0; indexInRank < ranked.length; indexInRank += 1) {
      const entry = ranked[indexInRank];
      if (entry === undefined) continue;
      const modelId = matchSource([entry.id], index)?.value;
      if (modelId === undefined) continue;
      signals.push({
        modelId,
        signal: {
          platform: "OpenRouter",
          universe: UNIVERSE,
          window,
          metric: "taskRank",
          task,
          value: indexInRank + 1,
          sourceId: meta.sourceId,
          sourceUrl: meta.sourceUrl,
          asOf: meta.observedAt ?? meta.retrievedAt,
          license: "CC BY 4.0",
          citation: "OpenRouter Data API",
        },
      });
    }
  }
  return { signals };
}

function firstString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function firstNumber(row: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
