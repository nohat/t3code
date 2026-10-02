import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ReactNode } from "react";

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { PricingBadge } from "./PricingBadge";
import type { ModelPricing } from "./providerIconUtils";

function pricing(overrides: Partial<ModelPricing> = {}): ModelPricing {
  return {
    inputCostPerMillionTokens: 3,
    outputCostPerMillionTokens: 15,
    cacheReadCostPerMillionTokens: 0.3,
    cacheWriteCostPerMillionTokens: 3.75,
    costSource: "modelPriced",
    fetchedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PricingBadge", () => {
  it("renders nothing when unpriced", () => {
    expect(renderToStaticMarkup(<PricingBadge />)).toBe("");
    expect(renderToStaticMarkup(<PricingBadge pricing={null} />)).toBe("");
  });

  it("renders paired $in/$out per 1M", () => {
    const markup = renderToStaticMarkup(<PricingBadge pricing={pricing()} />);
    expect(markup).toContain("$3/$15");
  });

  it("renders Free when both rates are zero", () => {
    const markup = renderToStaticMarkup(
      <PricingBadge
        pricing={pricing({
          inputCostPerMillionTokens: 0,
          outputCostPerMillionTokens: 0,
          cacheReadCostPerMillionTokens: 0,
          cacheWriteCostPerMillionTokens: 0,
        })}
      />,
    );
    expect(markup).toContain("Free");
    expect(markup).not.toContain("$0.00/$0.00");
  });

  it("shows LiteLLM footer with updated date", () => {
    const markup = renderToStaticMarkup(<PricingBadge pricing={pricing()} />);
    expect(markup).toContain("LiteLLM");
    expect(markup).toContain("Updated");
  });

  it("shows Custom rate footer when isCustomRate is true", () => {
    const markup = renderToStaticMarkup(<PricingBadge pricing={pricing({ isCustomRate: true })} />);
    expect(markup).toContain("Custom rate");
  });

  it("shows cache read discounts and cache write premiums relative to input", () => {
    const markup = renderToStaticMarkup(<PricingBadge pricing={pricing()} />);
    expect(markup).toContain("Input:");
    expect(markup).toContain("Output:");
    expect(markup).toContain("Cache read:");
    expect(markup).toContain("90% discount vs input");
    expect(markup).toContain("cache -90%");
    expect(markup).toContain("Cache write:");
    expect(markup).toContain("25% premium vs input");
    expect(markup).toContain("Blended input (90% cached):");
    expect(markup).toContain("$0.57 / 1M");
    expect(markup).not.toContain("$0.30");
    expect(markup).not.toContain("$3.75");
  });

  it("renders blended rates or both rate styles in the picker list", () => {
    const blendedMarkup = renderToStaticMarkup(
      <PricingBadge pricing={pricing()} display="blended" />,
    );
    expect(blendedMarkup).toContain("Blend");
    expect(blendedMarkup).toContain("$0.57");
    expect(blendedMarkup).toContain("/$15");
    expect(blendedMarkup).not.toContain("~");
    expect(blendedMarkup).not.toContain("$3/$15</span>");

    const bothMarkup = renderToStaticMarkup(<PricingBadge pricing={pricing()} display="both" />);
    expect(bothMarkup).toContain("$3/$15");
    const bothListMarkup = bothMarkup.split('<div class="space-y-1">')[0] ?? bothMarkup;
    expect(bothListMarkup).toContain("-90%");
    expect(bothListMarkup).toContain("Blend");
    expect(bothListMarkup).toContain("$0.57");
    expect(bothListMarkup).not.toContain("~");
    expect(bothListMarkup).not.toContain(" in</span>");
  });

  it("renders the base and blended parts independently for compact picker rows", () => {
    const baseMarkup = renderToStaticMarkup(
      <PricingBadge pricing={pricing()} display="both" part="base" />,
    ).split('<div class="space-y-1">')[0];
    expect(baseMarkup).toContain("$3/$15");
    expect(baseMarkup).toContain("cache -90%");
    expect(baseMarkup).not.toContain("Blend");

    const blendedMarkup = renderToStaticMarkup(
      <PricingBadge pricing={pricing()} display="both" part="blended" />,
    ).split('<div class="space-y-1">')[0];
    expect(blendedMarkup).toContain("Blend");
    expect(blendedMarkup).toContain("$0.57");
    expect(blendedMarkup).not.toContain("$3/$15");
  });

  it("handles equal and free input rates", () => {
    const sameRateMarkup = renderToStaticMarkup(
      <PricingBadge
        pricing={pricing({
          cacheReadCostPerMillionTokens: 3,
          cacheWriteCostPerMillionTokens: 3,
        })}
      />,
    );
    expect(sameRateMarkup.match(/Same as input/g)).toHaveLength(3);

    const freeMarkup = renderToStaticMarkup(
      <PricingBadge
        pricing={pricing({
          inputCostPerMillionTokens: 0,
          outputCostPerMillionTokens: 1,
          cacheReadCostPerMillionTokens: 0,
          cacheWriteCostPerMillionTokens: 0,
        })}
      />,
    );
    expect(freeMarkup).toContain("Same as free input");
    expect(freeMarkup).not.toContain("NaN");
  });
});
