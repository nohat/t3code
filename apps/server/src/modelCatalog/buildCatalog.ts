/**
 * Catalog builder.
 *
 * Assembles a validated `ModelCatalog` from retained observations. Pure: given
 * the same seed it produces byte-identical output, so a methodology change is
 * distinguishable from a model change. Derived metrics are computed here, never
 * seeded by hand.
 *
 * @module modelCatalog/buildCatalog
 */
import {
  BLEND_METHODOLOGY_VERSION,
  CAPABILITY_METHODOLOGY_VERSION,
  DEFAULT_BLEND,
  MODEL_CATALOG_METHODOLOGY,
  MODEL_CATALOG_VERSION,
  PUBLICATION_RULES,
  decodeModelCatalogSync,
  type CatalogAdoption,
  type CatalogCapability,
  type CatalogModel,
  type CatalogObservation,
  type CatalogOffer,
  type CatalogRateCard,
  type ModelCatalog,
} from "@t3tools/contracts";

import { computeBlendedPrice } from "./blendedPrice.ts";
import { computeCapabilities } from "./capability.ts";
import type { CatalogSeed, SeedModel } from "./seedTypes.ts";

type RateField =
  | "input"
  | "output"
  | "cacheRead"
  | "cacheWrite"
  | "reasoning"
  | "request"
  | "longContextInput"
  | "longContextOutput";

const PRICE_METRIC_FIELD: Readonly<Record<string, RateField>> = {
  "price.input": "input",
  "price.output": "output",
  "price.cacheRead": "cacheRead",
  "price.cacheWrite": "cacheWrite",
  "price.reasoning": "reasoning",
  "price.request": "request",
  "price.longContextInput": "longContextInput",
  "price.longContextOutput": "longContextOutput",
};

const EMPTY_CAPABILITY: CatalogCapability = {
  dimensions: [],
  specializations: [],
  published: false,
  withheldReason: "Not measured",
};

export function buildCatalog(seed: CatalogSeed): ModelCatalog {
  const observations = seed.observations;
  const capabilities = computeCapabilities({
    modelIds: seed.models.map((model) => model.id),
    observations,
    rules: PUBLICATION_RULES,
    methodologyVersion: CAPABILITY_METHODOLOGY_VERSION,
  });

  const models = seed.models.map((model) => buildModel(model, seed, capabilities));
  const catalog: ModelCatalog = {
    version: MODEL_CATALOG_VERSION,
    catalogVersion: seed.catalogVersion ?? seed.generatedAt,
    generatedAt: seed.generatedAt,
    methodology: MODEL_CATALOG_METHODOLOGY,
    sources: [...seed.sources],
    sourceSnapshots: [...seed.sourceSnapshots],
    makers: [...seed.makers],
    servingProviders: [...seed.servingProviders],
    models,
    observations: [...observations],
    generatedText: [...seed.generatedText],
  };
  // Fail loudly on an inconsistent seed rather than shipping a bad artifact.
  return decodeModelCatalogSync(catalog);
}

function buildModel(
  model: SeedModel,
  seed: CatalogSeed,
  capabilities: ReadonlyMap<string, CatalogCapability>,
): CatalogModel {
  const modelObservations = seed.observations.filter(
    (observation) => observation.modelId === model.id,
  );
  const offers = model.offers.map((offer) =>
    buildOffer(
      offer.id,
      offer.servingProviderId,
      offer.label,
      offer.isCanonical,
      offer.performance,
      seed.observations,
    ),
  );
  const capability = capabilities.get(model.id) ?? EMPTY_CAPABILITY;

  const adoption: CatalogAdoption | undefined =
    model.adoptionSignals.length > 0 ? { signals: [...model.adoptionSignals] } : undefined;

  const providerIntent = seed.generatedText.find(
    (entry) =>
      entry.modelId === model.id &&
      entry.kind === "providerIntent" &&
      entry.reviewStatus !== "rejected",
  );
  const observedProfile = seed.generatedText.find(
    (entry) =>
      entry.modelId === model.id &&
      entry.kind === "observedProfile" &&
      entry.reviewStatus !== "rejected",
  );

  return {
    id: model.id,
    canonicalName: model.canonicalName,
    familyId: model.familyId,
    makerId: model.makerId,
    ...(model.version !== undefined ? { version: model.version } : {}),
    aliases: [...model.aliases],
    ...(model.releasedAt !== undefined ? { releasedAt: model.releasedAt } : {}),
    ...(model.knowledgeCutoff !== undefined ? { knowledgeCutoff: model.knowledgeCutoff } : {}),
    technical: model.technical,
    offers,
    ...(model.primaryOfferId !== undefined ? { primaryOfferId: model.primaryOfferId } : {}),
    capability,
    ...(adoption !== undefined ? { adoption } : {}),
    ...(providerIntent !== undefined || observedProfile !== undefined
      ? {
          description: {
            ...(providerIntent !== undefined ? { providerIntentId: providerIntent.id } : {}),
            ...(observedProfile !== undefined ? { observedProfileId: observedProfile.id } : {}),
          },
        }
      : {}),
    evidence: modelObservations.map((observation) => observation.id),
  };
}

function buildOffer(
  id: string,
  servingProviderId: string,
  label: string,
  isCanonical: boolean,
  performance: CatalogOffer["performance"] | undefined,
  observations: readonly CatalogObservation[],
): CatalogOffer {
  const priceObservations = observations.filter(
    (observation) => observation.offerId === id && observation.metricClass === "pricing",
  );
  const rateCard = buildRateCard(priceObservations);
  const blendedValue = rateCard === null ? null : computeBlendedPrice(rateCard, DEFAULT_BLEND);
  const blendInputs = priceObservations.filter((observation) => {
    const field = PRICE_METRIC_FIELD[observation.metric];
    return field === "cacheRead" || field === "input" || field === "output";
  });
  return {
    id,
    servingProviderId,
    label,
    isCanonical,
    ...(rateCard !== null ? { rateCard } : {}),
    ...(blendedValue !== null
      ? {
          blendedPrice: {
            value: blendedValue,
            methodologyVersion: BLEND_METHODOLOGY_VERSION,
            inputObservationIds: blendInputs.map((observation) => observation.id),
          },
        }
      : {}),
    priceSourceIds: [...new Set(priceObservations.map((observation) => observation.sourceId))],
    ...(performance !== undefined ? { performance } : {}),
  };
}

/** Build a rate card from pricing observations. Returns `null` when none apply. */
function buildRateCard(observations: readonly CatalogObservation[]): CatalogRateCard | null {
  const rates: Partial<Record<RateField, number>> = {};
  for (const observation of observations) {
    const field = PRICE_METRIC_FIELD[observation.metric];
    if (field === undefined) continue;
    if (typeof observation.value !== "number" || !Number.isFinite(observation.value)) continue;
    rates[field] = observation.value;
  }
  if (Object.keys(rates).length === 0) return null;
  return { currency: "USD", unit: "1M tokens", ...rates };
}
