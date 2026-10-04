/**
 * Blended price derivation.
 *
 * The canonical blend is a synthetic comparison rate, not an estimate of a
 * user's task cost. It requires explicit, source-backed rates for cached input,
 * new input, and output on the same serving offer; when any is missing the
 * blend stays unavailable rather than imputing a rate.
 *
 * @module modelCatalog/blendedPrice
 */
import type { CatalogBlend, CatalogRateCard } from "@t3tools/contracts";

export function computeBlendedPrice(rateCard: CatalogRateCard, blend: CatalogBlend): number | null {
  const { cacheRead, input, output } = rateCard;
  if (cacheRead === undefined || input === undefined || output === undefined) return null;
  return roundRate(blend.cachedInput * cacheRead + blend.input * input + blend.output * output);
}

/** Round to a millionth of a dollar to keep the committed artifact stable. */
export function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
