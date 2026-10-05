import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderModelPricing } from "@t3tools/contracts";
import { modelPricingLines } from "./modelPricing";

const pricing: ServerProviderModelPricing = {
  inputCostPerMillionTokens: 10,
  outputCostPerMillionTokens: 50,
  cacheReadCostPerMillionTokens: 1,
  cacheWriteCostPerMillionTokens: 12.5,
  costSource: "modelPriced",
};

describe("mobile model rates", () => {
  it("labels base and cache rates with units", () => {
    expect(modelPricingLines(pricing, "input-output")).toEqual([
      "Input $10.00 · Output $50.00 / 1M tokens",
      "Cache read $1.00 / 1M tokens",
    ]);
  });
  it("blends 90% cache reads, keeps output separate, and excludes cache writes", () => {
    expect(modelPricingLines(pricing, "blended")).toEqual([
      "Blended input $1.90 · Output $50.00 / 1M tokens",
    ]);
    expect(modelPricingLines(pricing, "both")).toEqual([
      "Input $10.00 · Output $50.00 / 1M tokens",
      "Cache read $1.00 / 1M tokens",
      "Blended input $1.90 / 1M tokens",
    ]);
  });
  it("distinguishes unknown, zero, and sub-cent rates", () => {
    expect(modelPricingLines(undefined)).toEqual(["Price unavailable"]);
    expect(
      modelPricingLines(
        { ...pricing, inputCostPerMillionTokens: 0, outputCostPerMillionTokens: 0.001 },
        "input-output",
      )[0],
    ).toBe("Input $0.00 · Output <$0.01 / 1M tokens");
  });
  it("identifies custom overrides in every mode", () => {
    for (const display of ["input-output", "blended", "both"] as const) {
      expect(modelPricingLines({ ...pricing, isCustomRate: true }, display)).toContain(
        "Custom rate",
      );
    }
  });
});
