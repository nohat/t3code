/**
 * OpenRouter benchmark adapter.
 *
 * The authenticated OpenRouter Data API republishes source-attributed results
 * from Artificial Analysis, Design Arena, and OpenRouter's own evaluations.
 * Arena Elo, published indexes, and benchmark accuracy stay distinct because
 * each maps to its own benchmark definition with its own scale.
 *
 * @module modelCatalog/sources/openRouterBenchmarks
 */
import type { CatalogObservation } from "@t3tools/contracts";

import { benchmarkDefinition } from "../benchmarkDefinitions.ts";
import type { SourceModelMatch } from "../crosswalk.ts";
import { buildSourceIndex, matchSource } from "../matching.ts";
import type { AdapterMeta } from "./liteLlmPricing.ts";

export const OPENROUTER_BENCHMARKS_URL = "https://openrouter.ai/api/v1/benchmarks";

/** OpenRouter benchmark slugs mapped to catalog benchmark keys. */
const OR_BENCHMARK_KEYS: Readonly<Record<string, string>> = {
  gpqa_diamond: "gpqaDiamond",
  gpqa: "gpqaDiamond",
  swe_bench_verified: "sweBenchVerified",
  tau_bench_verified_airline: "tauBenchVerifiedAirline",
  search_browsecomp: "searchBrowseComp",
  search_dsqa: "searchDsqa",
  search_hle: "searchHle",
  search_widesearch: "searchWidesearch",
  aime: "aime",
  ifbench: "ifBench",
  ruler: "rulerLongContext",
};

const AA_INDEX_FIELDS: readonly (readonly [string, string])[] = [
  ["intelligence_index", "artificialAnalysisIntelligence"],
  ["coding_index", "artificialAnalysisCoding"],
  ["agentic_index", "artificialAnalysisAgentic"],
];

export function parseOpenRouterBenchmarks(
  payload: unknown,
  matches: readonly SourceModelMatch[],
  meta: AdapterMeta,
): CatalogObservation[] {
  const rows = extractRows(payload);
  const index = buildSourceIndex(
    matches.map((match) => [match.sourceModelId, match.modelId] as const),
  );
  const observations: CatalogObservation[] = [];
  const seen = new Set<string>();

  const emit = (
    modelId: string,
    key: string,
    value: number,
    conditions: string | undefined,
  ): void => {
    const definition = benchmarkDefinition(key);
    if (definition === undefined) return;
    const observationId = `${modelId}:benchmark:${key}`;
    if (seen.has(observationId)) return;
    seen.add(observationId);
    observations.push({
      id: observationId,
      modelId,
      metric: `benchmark.${key}`,
      value,
      metricClass: "benchmark",
      benchmarkFamily: definition.family,
      ...(conditions !== undefined ? { conditions } : {}),
      sourceId: meta.sourceId,
      sourceUrl: meta.sourceUrl,
      ...(meta.observedAt !== undefined ? { observedAt: meta.observedAt } : {}),
      retrievedAt: meta.retrievedAt,
    });
  };

  for (const row of rows) {
    const sourceModelId = firstString(row, ["model_permaslug", "model", "model_id", "slug"]);
    if (sourceModelId === undefined) continue;
    const match = matchSource([sourceModelId], index);
    if (match === undefined) continue;
    const modelId = match.value;
    const source = firstString(row, ["source"]) ?? "openrouter";
    const conditions = conditionsFor(row);

    if (source === "artificial-analysis") {
      for (const [field, key] of AA_INDEX_FIELDS) {
        const value = firstNumber(row, [field]);
        if (value !== undefined) emit(modelId, key, value, conditions);
      }
      continue;
    }
    if (source === "design-arena") {
      const category = firstString(row, ["category"]);
      const elo = firstNumber(row, ["elo"]);
      if (category !== undefined && elo !== undefined)
        emit(modelId, `designArena.${category}`, elo, conditions);
      continue;
    }

    const slug = firstString(row, [
      "benchmark_type",
      "benchmark",
      "category",
      "benchmark_id",
      "benchmark_name",
    ]);
    if (slug === undefined) continue;
    const key = OR_BENCHMARK_KEYS[slug.toLowerCase().replace(/[\s-]+/g, "_")];
    if (key === undefined) continue;
    const value = firstNumber(row, ["accuracy", "score", "value"]);
    if (value !== undefined) emit(modelId, key, value, conditions);
  }
  return observations;
}

export function extractRows(payload: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload)) {
    const data = payload.data ?? payload.results;
    if (Array.isArray(data)) return data.filter(isRecord);
    if (isRecord(data)) return Object.values(data).filter(isRecord);
  }
  return [];
}

function conditionsFor(row: Record<string, unknown>): string | undefined {
  const tasks = firstNumber(row, ["total_tasks"]);
  const run = firstString(row, ["last_run_timestamp"]);
  const parts: string[] = [];
  if (tasks !== undefined) parts.push(`total_tasks=${tasks}`);
  if (run !== undefined) parts.push(`run=${run}`);
  return parts.length > 0 ? parts.join(" ") : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
