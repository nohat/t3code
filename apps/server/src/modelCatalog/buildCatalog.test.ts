import { describe, expect, it } from "@effect/vitest";

import { buildCatalog } from "./buildCatalog.ts";
import { CATALOG_SEED } from "./seed.ts";

const catalog = buildCatalog(CATALOG_SEED);
const model = (id: string) => catalog.models.find((entry) => entry.id === id);

describe("buildCatalog", () => {
  it("is deterministic for a fixed seed", () => {
    expect(JSON.stringify(buildCatalog(CATALOG_SEED))).toBe(JSON.stringify(catalog));
  });

  it("derives the documented blended prices from source rates", () => {
    expect(model("anthropic/claude-sonnet-5.5")?.offers[0]?.blendedPrice?.value).toBe(1.54);
    expect(model("openai/gpt-6.1-sol")?.offers[0]?.blendedPrice?.value).toBe(1.47);
  });

  it("points every blended price at the three source observations", () => {
    const blended = model("anthropic/claude-sonnet-5.5")?.offers[0]?.blendedPrice;
    expect(blended?.inputObservationIds).toHaveLength(3);
    expect(blended?.methodologyVersion).toBe(catalog.methodology.blendMethodologyVersion);
  });

  it("leaves price unavailable when a rate is missing rather than imputing", () => {
    const offers = model("deepseek/deepseek-v4")?.offers ?? [];
    expect(offers.every((offer) => offer.blendedPrice === undefined)).toBe(true);
  });

  it("keeps missing capability explicit instead of zero", () => {
    const luna = model("openai/gpt-6-luna");
    expect(luna?.capability.published).toBe(false);
    expect(luna?.capability.overall).toBeUndefined();
    expect(luna?.capability.withheldReason).toBe("Not measured");
  });

  it("withholds a score when benchmark coverage is insufficient", () => {
    const deepseek = model("deepseek/deepseek-v4");
    expect(deepseek?.capability.published).toBe(false);
    expect(deepseek?.capability.withheldReason).toContain("Insufficient coverage");
  });

  it("attaches generated-text references only for retained summaries", () => {
    const sonnet = model("anthropic/claude-sonnet-5.5");
    expect(sonnet?.description?.providerIntentId).toBeDefined();
    const gpt = model("openai/gpt-6.1-sol");
    const pending = catalog.generatedText.find(
      (entry) => entry.id === gpt?.description?.providerIntentId,
    );
    expect(pending?.reviewStatus).toBe("pending");
  });

  it("retains provider-specific speed measurements with their source", () => {
    const performance = model("anthropic/claude-sonnet-5.5")?.offers[0]?.performance;
    expect(performance?.ttftMs?.median).toBe(720);
    expect(performance?.outputTokensPerSecond?.median).toBe(118);
    expect(performance?.ttftMs?.sourceId).toBe("artificialanalysis.intelligence");
  });

  it("records evidence observation ids for every model that has observations", () => {
    const sonnet = model("anthropic/claude-sonnet-5.5");
    expect(sonnet?.evidence.length).toBeGreaterThan(0);
    expect(catalog.observations.some((observation) => observation.id === sonnet?.evidence[0])).toBe(
      true,
    );
  });
});
