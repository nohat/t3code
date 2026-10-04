/**
 * Input shapes for the catalog builder.
 *
 * The seed holds only source-observable facts: identity, aliases, technical
 * metadata, serving offers, retained observations, and already-generated text.
 * Derived metrics are computed by `buildCatalog` and never seeded by hand.
 *
 * @module modelCatalog/seedTypes
 */
import type {
  CatalogAdoptionSignal,
  CatalogAlias,
  CatalogGeneratedText,
  CatalogMaker,
  CatalogObservation,
  CatalogPerformance,
  CatalogServingProvider,
  CatalogSourceRef,
  CatalogSourceSnapshot,
  CatalogTechnical,
} from "@t3tools/contracts";

export interface SeedOffer {
  readonly id: string;
  readonly servingProviderId: string;
  readonly label: string;
  readonly isCanonical: boolean;
  readonly performance?: CatalogPerformance;
}

export interface SeedModel {
  readonly id: string;
  readonly canonicalName: string;
  readonly familyId: string;
  readonly makerId: string;
  readonly version?: string;
  readonly aliases: readonly CatalogAlias[];
  readonly releasedAt?: string;
  readonly knowledgeCutoff?: string;
  readonly technical: CatalogTechnical;
  readonly offers: readonly SeedOffer[];
  readonly primaryOfferId?: string;
  readonly adoptionSignals: readonly CatalogAdoptionSignal[];
}

export interface CatalogSeed {
  readonly generatedAt: string;
  readonly catalogVersion?: string;
  readonly sources: readonly CatalogSourceRef[];
  readonly sourceSnapshots: readonly CatalogSourceSnapshot[];
  readonly makers: readonly CatalogMaker[];
  readonly servingProviders: readonly CatalogServingProvider[];
  readonly models: readonly SeedModel[];
  readonly observations: readonly CatalogObservation[];
  readonly generatedText: readonly CatalogGeneratedText[];
}
