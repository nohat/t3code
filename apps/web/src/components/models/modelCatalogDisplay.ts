/**
 * Dashboard display helpers.
 *
 * A missing value always renders as an em dash or an explicit "not measured"
 * label. This module never converts missing data into a number.
 *
 * @module models/modelCatalogDisplay
 */
import type { BenchmarkFamily, CatalogSpecialization } from "@t3tools/contracts";
import { BENCHMARK_FAMILY_LABELS, SPECIALIZATION_SYMBOL } from "@t3tools/shared/modelCatalog";

export const EM_DASH = "—";

export function displayOrDash(value: string | number | undefined): string {
  if (value === undefined) return EM_DASH;
  return String(value);
}

export function capabilityLabel(published: boolean, withheldReason: string | undefined): string {
  if (published) return EM_DASH;
  return withheldReason ?? "Not measured";
}

export function specializationText(specialization: CatalogSpecialization): string {
  return `${SPECIALIZATION_SYMBOL[specialization.label]} ${BENCHMARK_FAMILY_LABELS[specialization.family]}`;
}

export function familyLabel(family: BenchmarkFamily): string {
  return BENCHMARK_FAMILY_LABELS[family];
}

export const CAPABILITY_BAND_LABELS = {
  ge90: "90+",
  "80to89": "80–89",
  "70to79": "70–79",
  lt70: "Below 70",
  unpublished: "Not published",
} as const;

export const FEATURE_LABELS = {
  images: "Image input",
  tools: "Tool use",
  structuredOutput: "Structured output",
  reasoningControl: "Reasoning control",
  openWeights: "Open weights",
} as const;

export const RECENCY_LABELS = {
  lastMonth: "Last month",
  last3Months: "Last 3 months",
  lastYear: "Last year",
  older: "Older",
  unknown: "Unknown",
} as const;
