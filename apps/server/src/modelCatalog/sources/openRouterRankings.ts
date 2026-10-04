// @effect-diagnostics globalDate:off -- Date-only window arithmetic over publisher day strings.
/**
 * OpenRouter usage adapter.
 *
 * `rankings-daily` reports token volume for the top public OpenRouter variants
 * plus an `other` aggregate. This adapter derives ranks, token share, and 7-/30-
 * day momentum. These describe OpenRouter traffic only, over a bounded window,
 * and are never presented as global adoption or as benchmark capability.
 *
 * @module modelCatalog/sources/openRouterRankings
 */
import type { CatalogAdoptionSignal } from "@t3tools/contracts";

import type { SourceModelMatch } from "../crosswalk.ts";
import { buildSourceIndex, matchSource } from "../matching.ts";
import { extractRows } from "./openRouterBenchmarks.ts";
import type { AdapterMeta } from "./liteLlmPricing.ts";

export const OPENROUTER_RANKINGS_URL = "https://openrouter.ai/api/v1/datasets/rankings-daily";

export interface RankingParseResult {
  readonly signals: { readonly modelId: string; readonly signal: CatalogAdoptionSignal }[];
}

const UNIVERSE = "Public OpenRouter model variants (top 50 plus an aggregate 'other')";

export function parseOpenRouterRankings(
  payload: unknown,
  matches: readonly SourceModelMatch[],
  meta: AdapterMeta,
): RankingParseResult {
  const rows = extractRows(payload);
  const index = buildSourceIndex(
    matches.map((match) => [match.sourceModelId, match.modelId] as const),
  );

  // modelId -> date -> tokens
  const perModel = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const sourceModelId = firstString(row, ["model_permaslug", "model", "model_id", "slug"]);
    const modelId =
      sourceModelId === undefined ? undefined : matchSource([sourceModelId], index)?.value;
    if (modelId === undefined) continue;
    const date = firstString(row, ["date", "day", "as_of"]);
    const tokens = firstNumber(row, ["total_tokens", "tokens", "token_count", "total_token_count"]);
    if (date === undefined || tokens === undefined) continue;
    const days = perModel.get(modelId) ?? new Map<string, number>();
    days.set(date, (days.get(date) ?? 0) + tokens);
    perModel.set(modelId, days);
  }

  const dates = [...new Set([...perModel.values()].flatMap((days) => [...days.keys()]))].sort();
  const latest = dates[dates.length - 1];
  if (latest === undefined) return { signals: [] };
  const asOf = latest;

  const latestTotals = [...perModel.entries()].map(([modelId, days]) => ({
    modelId,
    tokens: days.get(latest) ?? 0,
  }));
  const ranked = [...latestTotals].sort((a, b) => b.tokens - a.tokens);
  const total7 = latestTotals.reduce(
    (sum, entry) => sum + sumWindow(perModel.get(entry.modelId) ?? new Map(), latest, 7),
    0,
  );

  const signals: { modelId: string; signal: CatalogAdoptionSignal }[] = [];
  for (const entry of ranked) {
    const days = perModel.get(entry.modelId) ?? new Map();
    const rank = ranked.findIndex((candidate) => candidate.modelId === entry.modelId) + 1;
    signals.push({
      modelId: entry.modelId,
      signal: signal("usageRank", rank, "7d", asOf, meta),
    });
    const last7 = sumWindow(days, latest, 7);
    const prev7 = sumWindowBefore(days, latest, 7, 7);
    const momentum7 = ratioChange(last7, prev7);
    if (momentum7 !== undefined) {
      signals.push({
        modelId: entry.modelId,
        signal: signal("momentum", momentum7, "7d", asOf, meta),
      });
    }
    const last30 = sumWindow(days, latest, 30);
    const prev30 = sumWindowBefore(days, latest, 30, 30);
    const momentum30 = ratioChange(last30, prev30);
    if (momentum30 !== undefined) {
      signals.push({
        modelId: entry.modelId,
        signal: signal("momentum", momentum30, "30d", asOf, meta),
      });
    }
    if (total7 > 0) {
      signals.push({
        modelId: entry.modelId,
        signal: signal("tokenShare", last7 / total7, "7d", asOf, meta),
      });
    }
  }
  return { signals };
}

function signal(
  metric: CatalogAdoptionSignal["metric"],
  value: number,
  window: string,
  asOf: string,
  meta: AdapterMeta,
): CatalogAdoptionSignal {
  return {
    platform: "OpenRouter",
    universe: UNIVERSE,
    window,
    metric,
    value,
    ...(metric === "momentum" || metric === "tokenShare" ? { unit: "fraction" } : {}),
    sourceId: meta.sourceId,
    sourceUrl: meta.sourceUrl,
    asOf,
    license: "CC BY 4.0",
    citation: "OpenRouter Data API",
  };
}

function sumWindow(days: Map<string, number>, latest: string, windowDays: number): number {
  const threshold = latestDateMinus(latest, windowDays - 1);
  let sum = 0;
  for (const [date, tokens] of days) if (date >= threshold && date <= latest) sum += tokens;
  return sum;
}

function sumWindowBefore(
  days: Map<string, number>,
  latest: string,
  windowDays: number,
  offsetDays: number,
): number {
  const end = latestDateMinus(latest, offsetDays);
  const start = latestDateMinus(latest, offsetDays + windowDays - 1);
  let sum = 0;
  for (const [date, tokens] of days) if (date >= start && date <= end) sum += tokens;
  return sum;
}

function ratioChange(current: number, previous: number): number | undefined {
  if (previous <= 0) return undefined;
  return (current - previous) / previous;
}

/** Date-string arithmetic on `YYYY-MM-DD`, avoiding timezone drift. */
function latestDateMinus(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) return date;
  return new Date(parsed - days * 86_400_000).toISOString().slice(0, 10);
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
    if (typeof value === "string" && value.length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
