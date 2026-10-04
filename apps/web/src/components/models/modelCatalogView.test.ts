import { describe, expect, it } from "vite-plus/test";
import { MODEL_CATALOG } from "@t3tools/shared/modelCatalog";

import {
  buildModelRows,
  EMPTY_FILTERS,
  filterModelRows,
  sortModelRows,
  type ModelFilters,
} from "./modelCatalogView";

const NOW = Date.parse("2026-10-01T00:00:00.000Z");
const rows = buildModelRows(MODEL_CATALOG, NOW);
const withFilters = (patch: Partial<ModelFilters>): ModelFilters => ({
  ...EMPTY_FILTERS,
  ...patch,
});

describe("model catalog view", () => {
  it("builds a row for every catalog model", () => {
    expect(rows).toHaveLength(MODEL_CATALOG.models.length);
  });

  it("matches the canonical name and source-qualified aliases in search", () => {
    expect(filterModelRows(rows, withFilters({ query: "sonnet" }), NOW).length).toBeGreaterThan(0);
    const aliased = filterModelRows(rows, withFilters({ query: "google/gemini-3.5-pro" }), NOW);
    expect(aliased.map((row) => row.model.id)).toContain("google/gemini-3.5-pro");
  });

  it("excludes models without a blended price when price-availability is required", () => {
    const filtered = filterModelRows(rows, withFilters({ priceAvailableOnly: true }), NOW);
    expect(filtered.every((row) => row.blendedPrice !== undefined)).toBe(true);
    expect(filtered.some((row) => row.model.id === "deepseek/deepseek-v4")).toBe(false);
  });

  it("filters by capability band, treating unpublished as its own band", () => {
    const unpublished = filterModelRows(
      rows,
      withFilters({ capabilityBands: ["unpublished"] }),
      NOW,
    );
    expect(unpublished.some((row) => row.model.id === "openai/gpt-6-luna")).toBe(true);
    const ge90 = filterModelRows(rows, withFilters({ capabilityBands: ["ge90"] }), NOW);
    expect(ge90.every((row) => (row.capability ?? 0) >= 90)).toBe(true);
  });

  it("filters by feature support", () => {
    const withImages = filterModelRows(rows, withFilters({ features: ["images"] }), NOW);
    expect(withImages.every((row) => row.model.technical.modalities.includes("image"))).toBe(true);
  });

  it("always sorts missing values last regardless of direction", () => {
    const desc = sortModelRows(rows, { key: "capability", direction: "desc" });
    const asc = sortModelRows(rows, { key: "capability", direction: "asc" });
    expect(desc[desc.length - 1]?.capability).toBeUndefined();
    expect(asc[asc.length - 1]?.capability).toBeUndefined();
    expect(asc[0]?.capability).toBeLessThanOrEqual(asc[1]?.capability ?? Number.POSITIVE_INFINITY);
  });

  it("sorts by blended price without inventing values for unpriced models", () => {
    const sorted = sortModelRows(rows, { key: "price", direction: "asc" });
    const priced = sorted.filter((row) => row.blendedPrice !== undefined);
    for (let index = 1; index < priced.length; index += 1) {
      expect(priced[index]?.blendedPrice ?? 0).toBeGreaterThanOrEqual(
        priced[index - 1]?.blendedPrice ?? 0,
      );
    }
    expect(sorted[sorted.length - 1]?.blendedPrice).toBeUndefined();
  });
});
