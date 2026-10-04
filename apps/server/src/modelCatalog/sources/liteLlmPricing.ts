/**
 * LiteLLM price adapter.
 *
 * LiteLLM publishes provider rates per token. This adapter is deterministic and
 * only emits a rate when the source provides it; missing rates stay missing.
 * Matched models must be crosswalked by explicit source alias.
 *
 * @module modelCatalog/sources/liteLlmPricing
 */
import type { CatalogObservation } from "@t3tools/contracts";

import type { SourceModelMatch } from "../crosswalk.ts";

export const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export interface AdapterMeta {
  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly observedAt?: string;
}

const TOKEN_RATE_FIELDS: Readonly<
  Record<string, "price.input" | "price.output" | "price.cacheRead" | "price.cacheWrite">
> = {
  input_cost_per_token: "price.input",
  output_cost_per_token: "price.output",
  cache_read_input_token_cost: "price.cacheRead",
  cache_creation_input_token_cost: "price.cacheWrite",
};

export function parseLiteLlmPrices(
  payload: unknown,
  matches: readonly SourceModelMatch[],
  meta: AdapterMeta,
): CatalogObservation[] {
  if (!isRecord(payload)) return [];
  const observations: CatalogObservation[] = [];
  for (const match of matches) {
    const entry = payload[match.sourceModelId];
    if (!isRecord(entry)) continue;
    for (const [field, metric] of Object.entries(TOKEN_RATE_FIELDS)) {
      const perToken = entry[field];
      if (typeof perToken !== "number" || !Number.isFinite(perToken)) continue;
      observations.push({
        id: `${match.modelId}:${match.offerId}:${metric}`,
        modelId: match.modelId,
        offerId: match.offerId,
        metric,
        value: roundToMillionth(perToken * 1_000_000),
        unit: "USD per 1M tokens",
        metricClass: "pricing",
        sourceId: meta.sourceId,
        sourceUrl: meta.sourceUrl,
        ...(meta.observedAt !== undefined ? { observedAt: meta.observedAt } : {}),
        retrievedAt: meta.retrievedAt,
      });
    }
  }
  return observations;
}

function roundToMillionth(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
