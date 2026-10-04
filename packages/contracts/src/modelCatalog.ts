/**
 * Model catalog contract.
 *
 * The catalog is a versioned, source-traceable artifact built offline by the
 * refresh job and bundled into clients. It deliberately keeps four kinds of
 * information separate:
 *
 * 1. provider facts and raw source observations (identity, provenance);
 * 2. derived quantitative metrics (blended price, capability, specialization);
 * 3. observed ecosystem signals (adoption, usage rank, momentum);
 * 4. qualitative description (generated text with review status).
 *
 * Missing data stays missing. A withheld capability score is represented by
 * `capability.published === false` and an absent `overall`, never by zero.
 * Clients must not fetch third-party sources while rendering; they read this
 * artifact and its recorded methodology version.
 *
 * @module modelCatalog
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Bumped on incompatible changes to the artifact shape. */
export const MODEL_CATALOG_VERSION = 1 as const;

/** A finite, non-negative number (rates, scores, counts with fractional parts). */
export const NonNegativeNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);

/**
 * Benchmark families the catalog can hold evidence for. The first six are the
 * initial families; the software-specific families are future dimensions and
 * must never be inferred from general coding results.
 */
export const BenchmarkFamily = Schema.Literals([
  "generalReasoning",
  "coding",
  "agenticCoding",
  "instructionFollowing",
  "mathScience",
  "longContext",
  "frontend",
  "visualDesign",
  "threeD",
  "spatialReasoning",
]);
export type BenchmarkFamily = typeof BenchmarkFamily.Type;

export const Modality = Schema.Literals(["text", "image", "audio", "video"]);
export type Modality = typeof Modality.Type;

/**
 * Identifies where an observation came from. `sourceId` is a stable key so the
 * refresh job can de-duplicate and re-attribute observations across runs.
 */
export const SourceKind = Schema.Literals([
  "officialModelPage",
  "openrouterModels",
  "openrouterBenchmarks",
  "openrouterRankings",
  "openrouterTasks",
  "litellmPrices",
  "designArena",
  "artificialAnalysis",
]);
export type SourceKind = typeof SourceKind.Type;

export const CatalogSourceRef = Schema.Struct({
  sourceId: TrimmedNonEmptyString,
  sourceKind: SourceKind,
  label: TrimmedNonEmptyString,
  url: Schema.optional(TrimmedNonEmptyString),
  license: Schema.optional(TrimmedNonEmptyString),
  citation: Schema.optional(TrimmedNonEmptyString),
});
export type CatalogSourceRef = typeof CatalogSourceRef.Type;

/** Provenance for one raw source response retained by the refresh job. */
export const CatalogSourceSnapshot = Schema.Struct({
  sourceId: TrimmedNonEmptyString,
  sourceKind: SourceKind,
  url: Schema.optional(TrimmedNonEmptyString),
  /** When the refresh job retrieved the response. */
  retrievedAt: Schema.String,
  /** The publisher's own as-of/version marker, when it provides one. */
  asOf: Schema.optional(TrimmedNonEmptyString),
  version: Schema.optional(TrimmedNonEmptyString),
  /** Hash of the retained raw response, so a rebuild can prove its inputs. */
  contentHash: TrimmedNonEmptyString,
  license: Schema.optional(TrimmedNonEmptyString),
  citation: Schema.optional(TrimmedNonEmptyString),
  recordCount: NonNegativeInt,
});
export type CatalogSourceSnapshot = typeof CatalogSourceSnapshot.Type;

/**
 * A single retained source observation. This is the leaf record every derived
 * metric points at, so any displayed number can be traced and regenerated.
 */
export const ObservationMetricClass = Schema.Literals([
  "pricing",
  "benchmark",
  "speed",
  "adoption",
  "metadata",
]);
export type ObservationMetricClass = typeof ObservationMetricClass.Type;

export const CatalogObservation = Schema.Struct({
  id: TrimmedNonEmptyString,
  modelId: TrimmedNonEmptyString,
  /** Present for offer-scoped metrics (pricing, speed). */
  offerId: Schema.optional(TrimmedNonEmptyString),
  /** Dot-namespaced metric key, e.g. `price.input` or `benchmark.gpqaDiamond.accuracy`. */
  metric: TrimmedNonEmptyString,
  value: Schema.Union([Schema.Number, Schema.String, Schema.Boolean]),
  unit: Schema.optional(TrimmedNonEmptyString),
  metricClass: ObservationMetricClass,
  benchmarkFamily: Schema.optional(BenchmarkFamily),
  /** Published evaluation conditions that qualify how the value may be read. */
  conditions: Schema.optional(TrimmedNonEmptyString),
  sourceId: TrimmedNonEmptyString,
  sourceUrl: Schema.optional(TrimmedNonEmptyString),
  /** Publisher's observation/evaluation date, when stated. */
  observedAt: Schema.optional(Schema.String),
  retrievedAt: Schema.String,
  contentHash: Schema.optional(TrimmedNonEmptyString),
  license: Schema.optional(TrimmedNonEmptyString),
  citation: Schema.optional(TrimmedNonEmptyString),
});
export type CatalogObservation = typeof CatalogObservation.Type;

export const CatalogMaker = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  homepage: Schema.optional(TrimmedNonEmptyString),
});
export type CatalogMaker = typeof CatalogMaker.Type;

export const ServingProviderKind = Schema.Literals(["makerDirect", "aggregator", "cloud"]);
export type ServingProviderKind = typeof ServingProviderKind.Type;

export const CatalogServingProvider = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  kind: ServingProviderKind,
  homepage: Schema.optional(TrimmedNonEmptyString),
  note: Schema.optional(TrimmedNonEmptyString),
});
export type CatalogServingProvider = typeof CatalogServingProvider.Type;

/**
 * A complete-or-partial provider rate card. Every dimension is optional: an
 * absent rate is unknown, never zero.
 */
export const CatalogRateCard = Schema.Struct({
  currency: Schema.Literal("USD"),
  unit: Schema.Literal("1M tokens"),
  input: Schema.optional(NonNegativeNumber),
  output: Schema.optional(NonNegativeNumber),
  cacheRead: Schema.optional(NonNegativeNumber),
  cacheWrite: Schema.optional(NonNegativeNumber),
  reasoning: Schema.optional(NonNegativeNumber),
  request: Schema.optional(NonNegativeNumber),
  longContextInput: Schema.optional(NonNegativeNumber),
  longContextOutput: Schema.optional(NonNegativeNumber),
});
export type CatalogRateCard = typeof CatalogRateCard.Type;

/** A blended rate plus the exact observations and methodology that produced it. */
export const CatalogBlendedPrice = Schema.Struct({
  value: NonNegativeNumber,
  methodologyVersion: TrimmedNonEmptyString,
  inputObservationIds: Schema.Array(TrimmedNonEmptyString),
});
export type CatalogBlendedPrice = typeof CatalogBlendedPrice.Type;

export const PerformanceMetric = Schema.Literals(["ttftMs", "outputTokensPerSecond"]);
export type PerformanceMetric = typeof PerformanceMetric.Type;

export const CatalogPerformanceMeasurement = Schema.Struct({
  metric: PerformanceMetric,
  median: NonNegativeNumber,
  p25: Schema.optional(NonNegativeNumber),
  p75: Schema.optional(NonNegativeNumber),
  sampleCount: Schema.optional(NonNegativeInt),
  sourceId: TrimmedNonEmptyString,
  sourceUrl: Schema.optional(TrimmedNonEmptyString),
  measuredAt: Schema.String,
  observedAt: Schema.optional(Schema.String),
  conditions: Schema.optional(TrimmedNonEmptyString),
});
export type CatalogPerformanceMeasurement = typeof CatalogPerformanceMeasurement.Type;

export const CatalogPerformance = Schema.Struct({
  ttftMs: Schema.optional(CatalogPerformanceMeasurement),
  outputTokensPerSecond: Schema.optional(CatalogPerformanceMeasurement),
});
export type CatalogPerformance = typeof CatalogPerformance.Type;

/**
 * One offer of a model from a serving provider. Price and speed belong here,
 * not to the underlying model: the same model can be served at different rates
 * and speeds by different providers.
 */
export const CatalogOffer = Schema.Struct({
  id: TrimmedNonEmptyString,
  servingProviderId: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isCanonical: Schema.Boolean,
  rateCard: Schema.optional(CatalogRateCard),
  blendedPrice: Schema.optional(CatalogBlendedPrice),
  priceSourceIds: Schema.Array(TrimmedNonEmptyString),
  performance: Schema.optional(CatalogPerformance),
});
export type CatalogOffer = typeof CatalogOffer.Type;

export const CapabilityFamilyScore = Schema.Struct({
  family: BenchmarkFamily,
  /** Normalized score on the catalog's common latent scale. */
  score: NonNegativeNumber,
  observationCount: NonNegativeInt,
  inputObservationIds: Schema.Array(TrimmedNonEmptyString),
});
export type CapabilityFamilyScore = typeof CapabilityFamilyScore.Type;

export const CatalogCapabilityCoverage = Schema.Struct({
  familiesCovered: Schema.Array(BenchmarkFamily),
  familiesRequired: Schema.Array(BenchmarkFamily),
  observationCount: NonNegativeInt,
});
export type CatalogCapabilityCoverage = typeof CatalogCapabilityCoverage.Type;

/** Frontier-relative capability index. Only present when publication rules pass. */
export const CatalogCapabilityIndex = Schema.Struct({
  score: NonNegativeNumber,
  frontierReference: NonNegativeNumber,
  coverage: CatalogCapabilityCoverage,
  methodologyVersion: TrimmedNonEmptyString,
  inputObservationIds: Schema.Array(TrimmedNonEmptyString),
});
export type CatalogCapabilityIndex = typeof CatalogCapabilityIndex.Type;

export const SpecializationLabel = Schema.Literals([
  "exceptionalStrength",
  "relativeStrength",
  "typical",
  "relativeWeakness",
  "significantWeakness",
]);
export type SpecializationLabel = typeof SpecializationLabel.Type;

/** Observed category performance relative to expected at comparable overall capability. */
export const CatalogSpecialization = Schema.Struct({
  family: BenchmarkFamily,
  observed: NonNegativeNumber,
  expected: NonNegativeNumber,
  residual: Schema.Number,
  label: SpecializationLabel,
  inputObservationIds: Schema.Array(TrimmedNonEmptyString),
});
export type CatalogSpecialization = typeof CatalogSpecialization.Type;

export const CatalogCapability = Schema.Struct({
  /** Absent when coverage is insufficient to publish. */
  overall: Schema.optional(CatalogCapabilityIndex),
  dimensions: Schema.Array(CapabilityFamilyScore),
  specializations: Schema.Array(CatalogSpecialization),
  published: Schema.Boolean,
  /** Human-readable explanation when `published` is false. */
  withheldReason: Schema.optional(TrimmedNonEmptyString),
});
export type CatalogCapability = typeof CatalogCapability.Type;

export const AdoptionMetric = Schema.Literals([
  "usageRank",
  "taskRank",
  "tokenShare",
  "requestShare",
  "momentum",
]);
export type AdoptionMetric = typeof AdoptionMetric.Type;

/**
 * An observed ecosystem signal. Always names the platform, universe, and time
 * window it was measured over; never presented as global adoption.
 */
export const CatalogAdoptionSignal = Schema.Struct({
  platform: TrimmedNonEmptyString,
  universe: TrimmedNonEmptyString,
  window: TrimmedNonEmptyString,
  metric: AdoptionMetric,
  task: Schema.optional(TrimmedNonEmptyString),
  value: Schema.Number,
  unit: Schema.optional(TrimmedNonEmptyString),
  sourceId: TrimmedNonEmptyString,
  sourceUrl: Schema.optional(TrimmedNonEmptyString),
  asOf: Schema.String,
  license: Schema.optional(TrimmedNonEmptyString),
  citation: Schema.optional(TrimmedNonEmptyString),
});
export type CatalogAdoptionSignal = typeof CatalogAdoptionSignal.Type;

export const CatalogAdoption = Schema.Struct({
  signals: Schema.Array(CatalogAdoptionSignal),
});
export type CatalogAdoption = typeof CatalogAdoption.Type;

export const GeneratedTextKind = Schema.Literals([
  "providerIntent",
  "observedProfile",
  "communityResponse",
]);
export type GeneratedTextKind = typeof GeneratedTextKind.Type;

export const GeneratedTextReviewStatus = Schema.Literals(["pending", "approved", "rejected"]);
export type GeneratedTextReviewStatus = typeof GeneratedTextReviewStatus.Type;

export const CatalogGeneratedTextProviderSelection = Schema.Struct({
  instanceId: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  options: Schema.optional(Schema.Unknown),
});
export type CatalogGeneratedTextProviderSelection =
  typeof CatalogGeneratedTextProviderSelection.Type;

/**
 * A stored, source-grounded summary. Generation happens during ingestion or an
 * explicit refresh, never during rendering. A rejected or invalid result is
 * retained with its failure, not silently replaced.
 */
export const CatalogGeneratedText = Schema.Struct({
  id: TrimmedNonEmptyString,
  modelId: TrimmedNonEmptyString,
  kind: GeneratedTextKind,
  text: TrimmedNonEmptyString,
  promptVersion: TrimmedNonEmptyString,
  providerModelSelection: CatalogGeneratedTextProviderSelection,
  providerDriver: Schema.optional(TrimmedNonEmptyString),
  sourceObservationIds: Schema.Array(TrimmedNonEmptyString),
  sourceUrls: Schema.Array(TrimmedNonEmptyString),
  generatedAt: Schema.String,
  validation: Schema.Struct({
    schemaValid: Schema.Boolean,
    sourceQuoteCheck: Schema.Literals(["passed", "failed", "notApplicable"]),
    unsupportedClaims: Schema.Boolean,
  }),
  reviewStatus: GeneratedTextReviewStatus,
  rejectedReason: Schema.optional(TrimmedNonEmptyString),
});
export type CatalogGeneratedText = typeof CatalogGeneratedText.Type;

export const CatalogAlias = Schema.Struct({
  source: TrimmedNonEmptyString,
  sourceId: TrimmedNonEmptyString,
});
export type CatalogAlias = typeof CatalogAlias.Type;

/** Factual technical capabilities useful during selection. All optional. */
export const CatalogTechnical = Schema.Struct({
  contextWindow: Schema.optional(NonNegativeInt),
  maxOutputTokens: Schema.optional(NonNegativeInt),
  modalities: Schema.Array(Modality),
  supportsTools: Schema.optional(Schema.Boolean),
  supportsStructuredOutput: Schema.optional(Schema.Boolean),
  supportsReasoningControl: Schema.optional(Schema.Boolean),
  openWeights: Schema.optional(Schema.Boolean),
});
export type CatalogTechnical = typeof CatalogTechnical.Type;

export const CatalogModel = Schema.Struct({
  /** Maker-qualified canonical id, e.g. `anthropic/claude-sonnet-5.5`. */
  id: TrimmedNonEmptyString,
  canonicalName: TrimmedNonEmptyString,
  familyId: TrimmedNonEmptyString,
  makerId: TrimmedNonEmptyString,
  version: Schema.optional(TrimmedNonEmptyString),
  aliases: Schema.Array(CatalogAlias),
  releasedAt: Schema.optional(Schema.String),
  knowledgeCutoff: Schema.optional(Schema.String),
  technical: CatalogTechnical,
  offers: Schema.Array(CatalogOffer),
  /** The offer used for headline price/speed when a single value is shown. */
  primaryOfferId: Schema.optional(TrimmedNonEmptyString),
  capability: CatalogCapability,
  adoption: Schema.optional(CatalogAdoption),
  description: Schema.optional(
    Schema.Struct({
      providerIntentId: Schema.optional(TrimmedNonEmptyString),
      observedProfileId: Schema.optional(TrimmedNonEmptyString),
    }),
  ),
  /** Ids of every observation that informed this record. */
  evidence: Schema.Array(TrimmedNonEmptyString),
});
export type CatalogModel = typeof CatalogModel.Type;

export const CatalogBlend = Schema.Struct({
  cachedInput: NonNegativeNumber,
  input: NonNegativeNumber,
  output: NonNegativeNumber,
});
export type CatalogBlend = typeof CatalogBlend.Type;

export const CatalogPublicationRules = Schema.Struct({
  /** Families that must both be covered before an overall score is published. */
  requiredFamilies: Schema.Array(BenchmarkFamily),
  /** Minimum number of distinct families required to publish an overall score. */
  minimumFamilies: NonNegativeInt,
  /** Number of top models averaged into the frontier reference cluster. */
  frontierClusterSize: NonNegativeInt,
});
export type CatalogPublicationRules = typeof CatalogPublicationRules.Type;

/**
 * Centrally configured methodology versions and weights. Every derived metric
 * carries the version that produced it so a methodology change is
 * distinguishable from a model change.
 */
export const CatalogMethodology = Schema.Struct({
  blendMethodologyVersion: TrimmedNonEmptyString,
  blend: CatalogBlend,
  capabilityMethodologyVersion: TrimmedNonEmptyString,
  specializationMethodologyVersion: TrimmedNonEmptyString,
  adoptionMethodologyVersion: TrimmedNonEmptyString,
  publication: CatalogPublicationRules,
});
export type CatalogMethodology = typeof CatalogMethodology.Type;

/** 70% cached input + 20% new input + 10% output. */
export const BLEND_METHODOLOGY_VERSION = "blend-70-20-10-v1";
export const CAPABILITY_METHODOLOGY_VERSION = "capability-frontier-mean-v1";
export const SPECIALIZATION_METHODOLOGY_VERSION = "specialization-ols-residual-v1";
export const ADOPTION_METHODOLOGY_VERSION = "openrouter-adoption-ccby-v1";

export const DEFAULT_BLEND: CatalogBlend = { cachedInput: 0.7, input: 0.2, output: 0.1 };

/**
 * Overall capability is published only with general-reasoning and coding
 * evidence plus coverage in at least four families. Software-specific families
 * never substitute for these.
 */
export const PUBLICATION_RULES: CatalogPublicationRules = {
  requiredFamilies: ["generalReasoning", "coding"],
  minimumFamilies: 4,
  frontierClusterSize: 5,
};

export const MODEL_CATALOG_METHODOLOGY: CatalogMethodology = {
  blendMethodologyVersion: BLEND_METHODOLOGY_VERSION,
  blend: DEFAULT_BLEND,
  capabilityMethodologyVersion: CAPABILITY_METHODOLOGY_VERSION,
  specializationMethodologyVersion: SPECIALIZATION_METHODOLOGY_VERSION,
  adoptionMethodologyVersion: ADOPTION_METHODOLOGY_VERSION,
  publication: PUBLICATION_RULES,
};

export const ModelCatalog = Schema.Struct({
  version: Schema.Literal(MODEL_CATALOG_VERSION),
  /** Monotonic artifact version (ISO timestamp of generation). */
  catalogVersion: TrimmedNonEmptyString,
  generatedAt: Schema.String,
  methodology: CatalogMethodology,
  sources: Schema.Array(CatalogSourceRef),
  sourceSnapshots: Schema.Array(CatalogSourceSnapshot),
  makers: Schema.Array(CatalogMaker),
  servingProviders: Schema.Array(CatalogServingProvider),
  models: Schema.Array(CatalogModel),
  observations: Schema.Array(CatalogObservation),
  generatedText: Schema.Array(CatalogGeneratedText),
});
export type ModelCatalog = typeof ModelCatalog.Type;

export const decodeModelCatalog = Schema.decodeUnknownEffect(ModelCatalog);
export const decodeModelCatalogSync = Schema.decodeUnknownSync(ModelCatalog);
export const encodeModelCatalog = Schema.encodeEffect(Schema.fromJsonString(ModelCatalog));
export const encodeModelCatalogSync = Schema.encodeSync(Schema.fromJsonString(ModelCatalog));
