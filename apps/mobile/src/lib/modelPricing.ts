import type { ServerProviderModelPricing } from "@t3tools/contracts";
import { DEFAULT_MODEL_COST_DISPLAY, type ModelCostDisplay } from "@t3tools/contracts/settings";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function rate(value: number) {
  return value > 0 && value < 0.01 ? "<$0.01" : currency.format(value);
}

/** API-equivalent rates, never subscription spend; the blend matches the web picker. */
export function modelPricingLines(
  pricing: ServerProviderModelPricing | undefined,
  display: ModelCostDisplay = DEFAULT_MODEL_COST_DISPLAY,
): readonly string[] {
  if (!pricing) return ["Price unavailable"];
  const input = pricing.inputCostPerMillionTokens;
  const output = pricing.outputCostPerMillionTokens;
  const cached = pricing.cacheReadCostPerMillionTokens;
  const lines = [];
  if (display !== "blended") {
    lines.push(`Input ${rate(input)} · Output ${rate(output)} / 1M tokens`);
    lines.push(`Cache read ${rate(cached)} / 1M tokens`);
  }
  if (display !== "input-output") {
    const blended = input * 0.1 + cached * 0.9;
    lines.push(
      `Blended input ${rate(blended)}${display === "blended" ? ` · Output ${rate(output)}` : ""} / 1M tokens`,
    );
  }
  if (pricing.isCustomRate) lines.push("Custom rate");
  return lines;
}
