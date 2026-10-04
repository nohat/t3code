import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_BLEND, type CatalogRateCard } from "@t3tools/contracts";

import { computeBlendedPrice } from "./blendedPrice.ts";

const card = (rates: Partial<CatalogRateCard>): CatalogRateCard => ({
  currency: "USD",
  unit: "1M tokens",
  ...rates,
});

describe("computeBlendedPrice", () => {
  it("applies 70/20/10 to source rates", () => {
    const value = computeBlendedPrice(
      card({ cacheRead: 0.2, input: 2, output: 10 }),
      DEFAULT_BLEND,
    );
    expect(value).toBe(1.54);
  });

  it("returns null when any of the three dimensions is missing", () => {
    expect(computeBlendedPrice(card({ input: 2, output: 10 }), DEFAULT_BLEND)).toBeNull();
    expect(computeBlendedPrice(card({ cacheRead: 0.2, output: 10 }), DEFAULT_BLEND)).toBeNull();
    expect(computeBlendedPrice(card({ cacheRead: 0.2, input: 2 }), DEFAULT_BLEND)).toBeNull();
  });

  it("does not treat zero as missing", () => {
    expect(computeBlendedPrice(card({ cacheRead: 0, input: 1, output: 2 }), DEFAULT_BLEND)).toBe(
      0.4,
    );
  });
});
