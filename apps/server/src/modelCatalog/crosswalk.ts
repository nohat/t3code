/**
 * Source-to-canonical model crosswalk.
 *
 * Source records are matched to canonical models only through explicit,
 * source-qualified aliases. Display names are never used to join records.
 *
 * @module modelCatalog/crosswalk
 */
import type { SeedModel } from "./seedTypes.ts";

export interface SourceModelMatch {
  /** The identifier the source publishes. */
  readonly sourceModelId: string;
  readonly modelId: string;
  /** The offer the observation belongs to, when offer-scoped. */
  readonly offerId: string;
}

export function sourceMatches(
  models: readonly SeedModel[],
  source: string,
): readonly SourceModelMatch[] {
  const matches: SourceModelMatch[] = [];
  for (const model of models) {
    const offer =
      model.offers.find((entry) => entry.id === model.primaryOfferId) ??
      model.offers.find((entry) => entry.isCanonical) ??
      model.offers[0];
    if (offer === undefined) continue;
    for (const alias of model.aliases) {
      if (alias.source === source) {
        matches.push({ sourceModelId: alias.sourceId, modelId: model.id, offerId: offer.id });
      }
    }
  }
  return matches;
}
