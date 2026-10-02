/**
 * Per-model pricing estimates for provider snapshots.
 *
 * Projects the usage rate tables onto `ServerProviderModel` rows so the
 * composer model picker can render cost badges. Everything here is pure:
 * callers supply already-loaded tables (see `UsageService.readModelRates`)
 * and this module never touches the network or the clock.
 *
 * Rate semantics mirror `priceUsage` in `usagePricing.ts`:
 * - Custom overrides win over the LiteLLM table, matched by trimmed slug
 *   exactly as transcript pricing matches them.
 * - LiteLLM rates resolve through `lookupRate`, so slug normalization,
 *   variant-suffix stripping, and bare-name aliasing behave the same as
 *   the usage page. Bare family names ("sonnet") stay unpriced.
 * - Picker estimates use base-tier rates. The `fast` multiplier is a
 *   per-request property of a transcript record, not of the model, so it
 *   is deliberately not applied here.
 *
 * @module modelPricing
 */
import type { ServerProviderModel } from "@t3tools/contracts";

import { lookupRate, type RateTable } from "../usage/usagePricing.ts";

const TOKENS_PER_MILLION = 1_000_000;

export interface ModelPricingInput {
  /** Parsed LiteLLM table (per-token rates). */
  readonly rates: RateTable;
  /** Custom override table from server settings (per-token rates). */
  readonly overrides: RateTable;
  /** ISO instant the backing table was fetched, or null when unknown. */
  readonly fetchedAt: string | null;
}

/**
 * Attach `pricing` to every model with a known rate. Models without a rate
 * keep their shape untouched, and when no model prices the input array is
 * returned by reference so downstream equality checks stay cheap.
 */
export function attachModelPricing(
  models: ReadonlyArray<ServerProviderModel>,
  input: ModelPricingInput,
): ReadonlyArray<ServerProviderModel> {
  let changed = false;
  const priced = models.map((model) => {
    // Same lookup order as `priceUsage`: trimmed-slug override first,
    // normalized LiteLLM rate second.
    const overrideRate = input.overrides.get(model.slug.trim());
    const rate = overrideRate ?? lookupRate(input.rates, model.slug);
    if (rate === null) {
      return model;
    }
    changed = true;
    return {
      ...model,
      pricing: {
        inputCostPerMillionTokens: rate.inputCostPerToken * TOKENS_PER_MILLION,
        outputCostPerMillionTokens: rate.outputCostPerToken * TOKENS_PER_MILLION,
        cacheReadCostPerMillionTokens: rate.cacheReadCostPerToken * TOKENS_PER_MILLION,
        cacheWriteCostPerMillionTokens: rate.cacheCreationCostPerToken * TOKENS_PER_MILLION,
        costSource: "modelPriced" as const,
        // The picker footer distinguishes admin-set rates from LiteLLM's.
        ...(overrideRate === undefined ? {} : { isCustomRate: true as const }),
        ...(input.fetchedAt === null ? {} : { fetchedAt: input.fetchedAt }),
      },
    };
  });
  return changed ? priced : models;
}
