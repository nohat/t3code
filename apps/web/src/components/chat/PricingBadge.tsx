import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ModelCostDisplay } from "@t3tools/contracts/settings";
import type { ModelPricing } from "./providerIconUtils";

const ASSUMED_CACHED_INPUT_SHARE = 0.9;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatPerMillion(value: number): string {
  return currency.format(value);
}

function formatCompactPerMillion(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return compactCurrency.format(value);
}

function formatTooltipValue(value: number): string {
  return `${formatPerMillion(value)} / 1M`;
}

function formatRelativeRate(rate: number, inputRate: number): string {
  if (inputRate === 0) {
    return rate === 0 ? "Same as free input" : "Not comparable to free input";
  }
  if (rate === inputRate) return "Same as input";

  const difference = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    (Math.abs(rate - inputRate) / inputRate) * 100,
  );
  return rate < inputRate ? `${difference}% discount vs input` : `${difference}% premium vs input`;
}

function formatCacheDifference(pricing: ModelPricing): string {
  const inputRate = pricing.inputCostPerMillionTokens;
  const cacheReadRate = pricing.cacheReadCostPerMillionTokens;
  if (inputRate === 0) return "free";
  if (cacheReadRate === inputRate) return "same";

  const difference = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    (Math.abs(cacheReadRate - inputRate) / inputRate) * 100,
  );
  return cacheReadRate < inputRate ? `-${difference}%` : `+${difference}%`;
}

function formatCacheDiscountBadge(pricing: ModelPricing): string {
  const difference = formatCacheDifference(pricing);
  if (difference === "free") return "Free cache";
  if (difference === "same") return "Cache same";
  return `cache ${difference}`;
}

function BlendedRateBadge({
  inputRate,
  outputRate,
  includeOutput,
}: {
  inputRate: number;
  outputRate: number;
  includeOutput: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded border border-primary/30 bg-primary/5 px-1 py-0.5 text-3xs font-medium leading-none">
      <span className="text-muted-foreground">Blend</span>
      <span className="rounded-sm bg-primary/10 px-1 py-0.5 font-semibold tabular-nums text-primary">
        {formatCompactPerMillion(inputRate)}
      </span>
      {includeOutput ? (
        <span className="text-muted-foreground">/{formatCompactPerMillion(outputRate)}</span>
      ) : null}
    </span>
  );
}

function CombinedCacheBlendBadge({
  pricing,
  blendedInput,
}: {
  pricing: ModelPricing;
  blendedInput: number;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1 py-0.5 text-3xs font-medium leading-none">
      <span className="text-muted-foreground">{formatCacheDifference(pricing)}</span>
      <BlendedRateBadge
        inputRate={blendedInput}
        outputRate={pricing.outputCostPerMillionTokens}
        includeOutput={false}
      />
    </span>
  );
}

function formatUpdatedDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PricingBadge({
  pricing,
  display = "input-output",
  part = "all",
}: {
  pricing?: ModelPricing | null;
  display?: ModelCostDisplay | undefined;
  part?: "all" | "base" | "blended" | undefined;
}) {
  if (!pricing) return null;

  const input = pricing.inputCostPerMillionTokens;
  const output = pricing.outputCostPerMillionTokens;
  const blendedInput =
    input * (1 - ASSUMED_CACHED_INPUT_SHARE) +
    pricing.cacheReadCostPerMillionTokens * ASSUMED_CACHED_INPUT_SHARE;

  const isFree = input === 0 && output === 0;
  const inputOutputLabel = isFree
    ? "Free"
    : `${formatCompactPerMillion(input)}/${formatCompactPerMillion(output)}`;
  const showBaseRates = part === "base" || (part === "all" && display !== "blended");
  const showBlendedRate = part === "blended" || (part === "all" && display !== "input-output");
  const badges = showBaseRates ? [inputOutputLabel, formatCacheDiscountBadge(pricing)] : [];

  const updatedLabel = pricing.fetchedAt ? formatUpdatedDate(pricing.fetchedAt) : null;
  const footer = pricing.isCustomRate
    ? "Custom rate"
    : updatedLabel
      ? `LiteLLM \u00B7 Updated ${updatedLabel}`
      : "LiteLLM";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="flex shrink-0 items-center gap-1"
            aria-label={
              display === "blended"
                ? `Blended input ${formatPerMillion(blendedInput)} per million, output ${formatPerMillion(output)} per million`
                : `Input ${formatPerMillion(input)} per million, output ${formatPerMillion(output)} per million, cache read ${formatRelativeRate(pricing.cacheReadCostPerMillionTokens, input)}${display === "both" ? `, blended input ${formatPerMillion(blendedInput)} per million` : ""}`
            }
          >
            {badges.map((badge, index) => (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-3xs font-medium leading-none text-muted-foreground"
                key={`${index}-${badge}`}
              >
                {badge}
              </span>
            ))}
            {showBlendedRate && display === "both" && part === "all" ? (
              <CombinedCacheBlendBadge pricing={pricing} blendedInput={blendedInput} />
            ) : showBlendedRate ? (
              <BlendedRateBadge
                inputRate={blendedInput}
                outputRate={output}
                includeOutput={display === "blended"}
              />
            ) : null}
          </span>
        }
      />
      <TooltipPopup side="left" align="center" className="text-xs">
        <div className="space-y-1">
          <div>
            Input: <code>{formatTooltipValue(input)}</code>
          </div>
          <div>
            Output: <code>{formatTooltipValue(output)}</code>
          </div>
          <div>
            Cache read:{" "}
            <code>{formatRelativeRate(pricing.cacheReadCostPerMillionTokens, input)}</code>
          </div>
          <div>
            Cache write:{" "}
            <code>{formatRelativeRate(pricing.cacheWriteCostPerMillionTokens, input)}</code>
          </div>
          <div>
            Blended input (90% cached): <code>{formatTooltipValue(blendedInput)}</code>
          </div>
          <div className="text-muted-foreground">
            Fixed 90% cache-read assumption; excludes cache-write premiums.
          </div>
          <div className="mt-2 border-t pt-1 text-xs text-muted-foreground">{footer}</div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
