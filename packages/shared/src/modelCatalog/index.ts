/**
 * Bundled model catalog access.
 *
 * The artifact is generated offline by the refresh job
 * (`apps/server/scripts/refresh-model-catalog.ts`) and committed here so every
 * surface — web, desktop, and mobile — reads the same versioned data with no
 * runtime server dependency and no third-party fetch while rendering.
 *
 * Selectors return `undefined` for missing data. They never invent a value.
 *
 * @module modelCatalog
 */
import {
  decodeModelCatalogSync,
  type CatalogGeneratedText,
  type CatalogMaker,
  type CatalogModel,
  type CatalogObservation,
  type CatalogOffer,
  type CatalogServingProvider,
  type GeneratedTextKind,
  type ModelCatalog,
} from "@t3tools/contracts";

import rawCatalog from "./catalog.json" with { type: "json" };

export * from "./constants.ts";
export * from "./format.ts";
export * from "./freshness.ts";

export const MODEL_CATALOG: ModelCatalog = decodeModelCatalogSync(rawCatalog);

export function getModel(catalog: ModelCatalog, id: string): CatalogModel | undefined {
  return catalog.models.find((model) => model.id === id);
}

export function getMaker(catalog: ModelCatalog, id: string): CatalogMaker | undefined {
  return catalog.makers.find((maker) => maker.id === id);
}

export function getServingProvider(
  catalog: ModelCatalog,
  id: string,
): CatalogServingProvider | undefined {
  return catalog.servingProviders.find((provider) => provider.id === id);
}

export function getOffer(model: CatalogModel, offerId: string): CatalogOffer | undefined {
  return model.offers.find((offer) => offer.id === offerId);
}

/**
 * The offer whose price and speed are shown when a single value is needed.
 * Falls back to the first offer when `primaryOfferId` is absent or dangling.
 */
export function getPrimaryOffer(model: CatalogModel): CatalogOffer | undefined {
  if (model.primaryOfferId !== undefined) {
    const primary = getOffer(model, model.primaryOfferId);
    if (primary !== undefined) return primary;
  }
  return model.offers[0];
}

/**
 * A model's headline blended price. Prefers the canonical offer, then the
 * primary offer. Returns `undefined` when no offer has a complete blend.
 */
export function getBlendedPrice(model: CatalogModel): number | undefined {
  const canonical = model.offers.find((offer) => offer.isCanonical);
  return (canonical ?? getPrimaryOffer(model))?.blendedPrice?.value;
}

export function getGeneratedText(
  catalog: ModelCatalog,
  id: string | undefined,
): CatalogGeneratedText | undefined {
  if (id === undefined) return undefined;
  return catalog.generatedText.find((entry) => entry.id === id);
}

/** The stored summary of `kind` for a model, if any. */
export function getModelGeneratedText(
  catalog: ModelCatalog,
  modelId: string,
  kind: GeneratedTextKind,
): CatalogGeneratedText | undefined {
  return catalog.generatedText.find((entry) => entry.modelId === modelId && entry.kind === kind);
}

export function getObservations(
  catalog: ModelCatalog,
  observationIds: readonly string[],
): readonly CatalogObservation[] {
  const wanted = new Set(observationIds);
  return catalog.observations.filter((observation) => wanted.has(observation.id));
}

/**
 * Free-text haystack for search. Matches canonical name, canonical id, maker,
 * serving providers, and every source-qualified alias; never reorders results.
 */
export function modelSearchText(model: CatalogModel, catalog: ModelCatalog): string {
  const makerName = getMaker(catalog, model.makerId)?.name ?? "";
  const providerNames = model.offers
    .map((offer) => getServingProvider(catalog, offer.servingProviderId)?.name ?? "")
    .join(" ");
  const aliases = model.aliases.map((alias) => alias.sourceId).join(" ");
  return [model.canonicalName, model.id, model.familyId, makerName, providerNames, aliases]
    .join(" ")
    .toLowerCase();
}

/** Distinct maker ids present in the catalog, sorted by display name. */
export function listMakers(catalog: ModelCatalog): readonly CatalogMaker[] {
  const present = new Set(catalog.models.map((model) => model.makerId));
  return catalog.makers
    .filter((maker) => present.has(maker.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Distinct serving providers present in the catalog, sorted by display name. */
export function listServingProviders(catalog: ModelCatalog): readonly CatalogServingProvider[] {
  const present = new Set(
    catalog.models.flatMap((model) => model.offers.map((offer) => offer.servingProviderId)),
  );
  return catalog.servingProviders
    .filter((provider) => present.has(provider.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getUsageRank(model: CatalogModel, window?: string): number | undefined {
  const signal = model.adoption?.signals.find(
    (entry) => entry.metric === "usageRank" && (window === undefined || entry.window === window),
  );
  return signal?.value;
}

export function getMomentum(model: CatalogModel, window: string): number | undefined {
  const signal = model.adoption?.signals.find(
    (entry) => entry.metric === "momentum" && entry.window === window,
  );
  return signal?.value;
}

export function getTaskRank(
  model: CatalogModel,
  task: string,
  window?: string,
): number | undefined {
  const signal = model.adoption?.signals.find(
    (entry) =>
      entry.metric === "taskRank" &&
      entry.task === task &&
      (window === undefined || entry.window === window),
  );
  return signal?.value;
}
