import { describe, expect, it } from "@effect/vitest";
import type { ServerProviderModel } from "@t3tools/contracts";

import { createOverrideRateTable, parseRateTable } from "../usage/usagePricing.ts";
import { attachModelPricing } from "./modelPricing.ts";

const model = (slug: string): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: null,
});

const FETCHED_AT = "2026-10-01T00:00:00.000Z";

const rates = parseRateTable({
  // Synthetic names only: adding a model must never require touching these tests.
  "test/acme-fable-5": {
    input_cost_per_token: 1e-5,
    output_cost_per_token: 5e-5,
    cache_read_input_token_cost: 1e-6,
    cache_creation_input_token_cost: 2e-5,
  },
});

const empty = {
  rates: parseRateTable({}),
  overrides: createOverrideRateTable({}),
  fetchedAt: null,
};

describe("attachModelPricing", () => {
  it("prices a model from the LiteLLM table in USD per million tokens", () => {
    const priced = attachModelPricing([model("acme-fable-5")], {
      rates,
      overrides: createOverrideRateTable({}),
      fetchedAt: FETCHED_AT,
    });

    expect(priced[0]?.pricing).toEqual({
      inputCostPerMillionTokens: 10,
      outputCostPerMillionTokens: 50,
      cacheReadCostPerMillionTokens: 1,
      cacheWriteCostPerMillionTokens: 20,
      costSource: "modelPriced",
      fetchedAt: FETCHED_AT,
    });
  });

  it("prioritizes custom overrides over LiteLLM rates", () => {
    const priced = attachModelPricing([model("acme-fable-5")], {
      rates,
      overrides: createOverrideRateTable({
        "acme-fable-5": { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 },
      }),
      fetchedAt: FETCHED_AT,
    });

    expect(priced[0]?.pricing).toMatchObject({
      inputCostPerMillionTokens: 1,
      outputCostPerMillionTokens: 2,
      // Omitted cache rates fall back to the input rate, per the override schema.
      cacheReadCostPerMillionTokens: 1,
      cacheWriteCostPerMillionTokens: 1,
    });
  });

  it("matches override keys by trimmed slug", () => {
    const priced = attachModelPricing([model("acme-fable-5")], {
      rates: parseRateTable({}),
      overrides: createOverrideRateTable({
        "  acme-fable-5  ": { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 },
      }),
      fetchedAt: null,
    });

    expect(priced[0]?.pricing).toMatchObject({
      inputCostPerMillionTokens: 1,
      costSource: "modelPriced",
    });
    // Unknown table fetch time stays absent rather than degrading to null.
    expect(priced[0]?.pricing).not.toHaveProperty("fetchedAt");
  });

  it("leaves unpriced models untouched and returns the input when nothing prices", () => {
    const models = [model("acme-unknown-9"), model("sonnet")];
    const priced = attachModelPricing(models, {
      rates,
      overrides: createOverrideRateTable({}),
      fetchedAt: FETCHED_AT,
    });

    expect(priced).toBe(models);
    expect(priced[0]?.pricing).toBeUndefined();
  });

  it("returns the input array by reference when both tables are empty", () => {
    const models = [model("acme-fable-5")];

    expect(attachModelPricing(models, empty)).toBe(models);
  });

  it("prices priced models without touching their unpriced siblings", () => {
    const pricedModel = model("acme-fable-5");
    const unpricedModel = model("acme-unknown-9");
    const priced = attachModelPricing([pricedModel, unpricedModel], {
      rates,
      overrides: createOverrideRateTable({}),
      fetchedAt: null,
    });

    expect(priced).toHaveLength(2);
    expect(priced[0]?.pricing?.inputCostPerMillionTokens).toBe(10);
    expect(priced[1]).toBe(unpricedModel);
  });
});
