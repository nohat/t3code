/**
 * Display formatting for the model catalog.
 *
 * Values shown here are stored, derived metrics; these helpers only format
 * them. They never substitute a placeholder for a missing value — callers
 * decide how to render `undefined`.
 *
 * @module modelCatalog/format
 */
import type { Modality, SpecializationLabel } from "@t3tools/contracts";

const USD_PER_MILLION = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_SMALL = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

/** `$2.80/M`, or `undefined` when the blended price is unavailable. */
export function formatBlendedPrice(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const formatted = value < 1 ? USD_SMALL.format(value) : USD_PER_MILLION.format(value);
  return `${formatted}/M`;
}

/** A raw provider rate (`$3.00/M`). */
export function formatRate(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const formatted = value < 1 ? USD_SMALL.format(value) : USD_PER_MILLION.format(value);
  return `${formatted}/M`;
}

/** Compact context window: `200K`, `1M`, `1.05M`. */
export function formatContextWindow(tokens: number | undefined): string | undefined {
  if (tokens === undefined) return undefined;
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${trim(tokens / 1_000)}K`;
  return String(tokens);
}

function trim(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, "");
}

/** A capability or dimension score: integers stay integers, fractions keep one digit. */
export function formatScore(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Clock speed for TTFT: `0.72s` or `1.4s`. */
export function formatTtft(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  return `${seconds.toFixed(seconds >= 1 ? 1 : 2)}s`;
}

/** Throughput: `118 t/s`. */
export function formatThroughput(tokensPerSecond: number | undefined): string | undefined {
  if (tokensPerSecond === undefined) return undefined;
  return `${Math.round(tokensPerSecond)} t/s`;
}

/** Adoption momentum from a fraction: `+31%`, `-8%`. */
export function formatMomentum(fraction: number | undefined): string | undefined {
  if (fraction === undefined) return undefined;
  const percent = fraction * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${Math.round(percent)}%`;
}

export function formatModalities(modalities: readonly Modality[]): string {
  if (modalities.length === 0) return "—";
  const labels: Record<Modality, string> = {
    text: "Text",
    image: "Image",
    audio: "Audio",
    video: "Video",
  };
  return modalities.map((modality) => labels[modality]).join(", ");
}

export const SPECIALIZATION_SYMBOL: Record<SpecializationLabel, string> = {
  exceptionalStrength: "↑↑",
  relativeStrength: "↑",
  typical: "—",
  relativeWeakness: "↓",
  significantWeakness: "↓↓",
};

export const SPECIALIZATION_LABELS: Record<SpecializationLabel, string> = {
  exceptionalStrength: "Exceptional strength",
  relativeStrength: "Relative strength",
  typical: "Typical",
  relativeWeakness: "Relative weakness",
  significantWeakness: "Significant weakness",
};

export function formatSpecialization(label: SpecializationLabel): string {
  return `${SPECIALIZATION_SYMBOL[label]} ${SPECIALIZATION_LABELS[label]}`;
}

/** A usage rank: `#4`. */
export function formatRank(rank: number | undefined): string | undefined {
  if (rank === undefined) return undefined;
  return `#${Math.round(rank)}`;
}
