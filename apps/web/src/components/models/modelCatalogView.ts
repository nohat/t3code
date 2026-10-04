/**
 * Pure view model for the models dashboard.
 *
 * Builds table rows from the bundled catalog and applies search, filters, and
 * sorting without calculating any derived metric. Missing values stay missing
 * and always sort last, so an absent score never outranks a measured one.
 *
 * @module models/modelCatalogView
 */
import type {
  BenchmarkFamily,
  CatalogCapability,
  CatalogModel,
  CatalogSpecialization,
  ModelCatalog,
} from "@t3tools/contracts";
import {
  getBlendedPrice,
  getMaker,
  getMomentum,
  getPrimaryOffer,
  getServingProvider,
  getUsageRank,
  isNew,
  modelSearchText,
  recencyBucket,
  type RecencyBucket,
} from "@t3tools/shared/modelCatalog";

export interface ModelRow {
  readonly model: CatalogModel;
  readonly makerName: string;
  readonly providerNames: readonly string[];
  readonly blendedPrice: number | undefined;
  readonly capability: number | undefined;
  readonly capabilityPublished: boolean;
  readonly withheldReason: string | undefined;
  readonly specializations: readonly CatalogSpecialization[];
  readonly ttftSeconds: number | undefined;
  readonly throughput: number | undefined;
  readonly usageRank: number | undefined;
  readonly momentum7d: number | undefined;
  readonly contextWindow: number | undefined;
  readonly releasedAt: string | undefined;
  readonly isNew: boolean;
  readonly searchText: string;
}

export function buildModelRow(catalog: ModelCatalog, model: CatalogModel, nowMs: number): ModelRow {
  const primary = getPrimaryOffer(model);
  const ttftMs = primary?.performance?.ttftMs?.median;
  const throughput = primary?.performance?.outputTokensPerSecond?.median;
  return {
    model,
    makerName: getMaker(catalog, model.makerId)?.name ?? model.makerId,
    providerNames: model.offers.map(
      (offer) =>
        getServingProvider(catalog, offer.servingProviderId)?.name ?? offer.servingProviderId,
    ),
    blendedPrice: getBlendedPrice(model),
    capability: model.capability.overall?.score,
    capabilityPublished: model.capability.published,
    withheldReason: model.capability.withheldReason,
    specializations: notableSpecializations(model.capability),
    ttftSeconds: ttftMs === undefined ? undefined : ttftMs / 1000,
    throughput,
    usageRank: getUsageRank(model, "7d"),
    momentum7d: getMomentum(model, "7d"),
    contextWindow: model.technical.contextWindow,
    releasedAt: model.releasedAt,
    isNew: isNew(model.releasedAt, nowMs),
    searchText: modelSearchText(model, catalog),
  };
}

export function buildModelRows(catalog: ModelCatalog, nowMs: number): readonly ModelRow[] {
  return catalog.models.map((model) => buildModelRow(catalog, model, nowMs));
}

/** Non-typical specializations, strongest deviations first. */
export function notableSpecializations(
  capability: CatalogCapability,
): readonly CatalogSpecialization[] {
  return [...capability.specializations]
    .filter((entry) => entry.label !== "typical")
    .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))
    .slice(0, 2);
}

export type CapabilityBand = "ge90" | "80to89" | "70to79" | "lt70" | "unpublished";
export type FeatureFilter =
  | "images"
  | "tools"
  | "structuredOutput"
  | "reasoningControl"
  | "openWeights";

export interface ModelFilters {
  readonly query: string;
  readonly makerIds: readonly string[];
  readonly servingProviderIds: readonly string[];
  readonly capabilityBands: readonly CapabilityBand[];
  readonly priceMin: number | undefined;
  readonly priceMax: number | undefined;
  readonly priceAvailableOnly: boolean;
  readonly contextMin: number | undefined;
  readonly features: readonly FeatureFilter[];
  readonly specializationFamilies: readonly BenchmarkFamily[];
  readonly recency: readonly RecencyBucket[];
}

export const EMPTY_FILTERS: ModelFilters = {
  query: "",
  makerIds: [],
  servingProviderIds: [],
  capabilityBands: [],
  priceMin: undefined,
  priceMax: undefined,
  priceAvailableOnly: false,
  contextMin: undefined,
  features: [],
  specializationFamilies: [],
  recency: [],
};

export function filterModelRows(
  rows: readonly ModelRow[],
  filters: ModelFilters,
  nowMs: number,
): readonly ModelRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => matchesQuery(row, query) && matchesFilters(row, filters, nowMs));
}

function matchesQuery(row: ModelRow, query: string): boolean {
  return query.length === 0 || row.searchText.includes(query);
}

function matchesFilters(row: ModelRow, filters: ModelFilters, nowMs: number): boolean {
  if (filters.makerIds.length > 0 && !filters.makerIds.includes(row.model.makerId)) return false;
  if (
    filters.servingProviderIds.length > 0 &&
    !row.model.offers.some((offer) => filters.servingProviderIds.includes(offer.servingProviderId))
  ) {
    return false;
  }
  if (filters.capabilityBands.length > 0 && !matchesCapabilityBand(row, filters.capabilityBands)) {
    return false;
  }
  if (filters.priceAvailableOnly && row.blendedPrice === undefined) return false;
  if (filters.priceMin !== undefined) {
    if (row.blendedPrice === undefined || row.blendedPrice < filters.priceMin) return false;
  }
  if (filters.priceMax !== undefined) {
    if (row.blendedPrice === undefined || row.blendedPrice > filters.priceMax) return false;
  }
  if (filters.contextMin !== undefined) {
    if (row.contextWindow === undefined || row.contextWindow < filters.contextMin) return false;
  }
  if (
    filters.features.length > 0 &&
    !filters.features.every((feature) => hasFeature(row, feature))
  ) {
    return false;
  }
  if (filters.specializationFamilies.length > 0) {
    const families = new Set(row.model.capability.dimensions.map((dimension) => dimension.family));
    if (!filters.specializationFamilies.some((family) => families.has(family))) return false;
  }
  if (filters.recency.length > 0) {
    const bucket = recencyBucket(row.releasedAt, nowMs);
    if (!filters.recency.includes(bucket)) return false;
  }
  return true;
}

function matchesCapabilityBand(row: ModelRow, bands: readonly CapabilityBand[]): boolean {
  return bands.some((band) => {
    if (band === "unpublished") return !row.capabilityPublished;
    if (row.capability === undefined) return false;
    if (band === "ge90") return row.capability >= 90;
    if (band === "80to89") return row.capability >= 80 && row.capability < 90;
    if (band === "70to79") return row.capability >= 70 && row.capability < 80;
    return row.capability < 70;
  });
}

function hasFeature(row: ModelRow, feature: FeatureFilter): boolean {
  const technical = row.model.technical;
  switch (feature) {
    case "images":
      return technical.modalities.includes("image");
    case "tools":
      return technical.supportsTools === true;
    case "structuredOutput":
      return technical.supportsStructuredOutput === true;
    case "reasoningControl":
      return technical.supportsReasoningControl === true;
    case "openWeights":
      return technical.openWeights === true;
  }
}

export type SortKey =
  | "name"
  | "maker"
  | "capability"
  | "price"
  | "context"
  | "released"
  | "ttft"
  | "throughput"
  | "usage"
  | "momentum";

export interface SortSpec {
  readonly key: SortKey;
  readonly direction: "asc" | "desc";
}

export const DEFAULT_SORT: SortSpec = { key: "capability", direction: "desc" };

export function sortModelRows(rows: readonly ModelRow[], spec: SortSpec): readonly ModelRow[] {
  const factor = spec.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA = sortValue(a, spec.key);
    const valueB = sortValue(b, spec.key);
    if (valueA === undefined && valueB === undefined) return a.model.id.localeCompare(b.model.id);
    if (valueA === undefined) return 1;
    if (valueB === undefined) return -1;
    if (typeof valueA === "string" || typeof valueB === "string") {
      return factor * String(valueA).localeCompare(String(valueB));
    }
    if (valueA === valueB) return a.model.id.localeCompare(b.model.id);
    return factor * (valueA < valueB ? -1 : 1);
  });
}

function sortValue(row: ModelRow, key: SortKey): string | number | undefined {
  switch (key) {
    case "name":
      return row.model.canonicalName;
    case "maker":
      return row.makerName;
    case "capability":
      return row.capability;
    case "price":
      return row.blendedPrice;
    case "context":
      return row.contextWindow;
    case "released":
      return row.releasedAt === undefined ? undefined : Date.parse(row.releasedAt);
    case "ttft":
      return row.ttftSeconds;
    case "throughput":
      return row.throughput;
    case "usage":
      return row.usageRank;
    case "momentum":
      return row.momentum7d;
  }
}
