/**
 * Source-grounded catalog descriptions.
 *
 * Summaries are generated during ingestion or an explicit refresh through T3's
 * configured text-generation service, never during rendering. This module owns
 * prompt versioning, deterministic evidence formatting, schema/quote/number
 * validation, and the provenance record stored with every result. A result that
 * fails validation is retained as rejected, not silently replaced.
 *
 * @module modelCatalog/descriptions
 */
import {
  TextGenerationError,
  type CatalogCapability,
  type CatalogGeneratedText,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  MODEL_SUMMARY_EVIDENCE_MAX_WORDS,
  MODEL_SUMMARY_MAX_WORDS,
} from "../textGeneration/TextGenerationPrompts.ts";

export const PROVIDER_INTENT_PROMPT_VERSION = "provider-intent-summary-v1";
export const OBSERVED_PROFILE_PROMPT_VERSION = "observed-profile-summary-v1";

export interface SummaryValidation {
  readonly schemaValid: boolean;
  readonly sourceQuoteCheck: "passed" | "failed" | "notApplicable";
  readonly unsupportedClaims: boolean;
  readonly reason?: string;
}

export function validateModelSummary(input: {
  kind: TextGeneration.ModelSummaryKind;
  text: string;
  evidenceQuote: string | undefined;
  sourceText: string;
}): SummaryValidation {
  const text = input.text.trim();
  if (text.length === 0) {
    return fail("generated summary was empty");
  }
  const limit =
    input.kind === "providerIntent" ? MODEL_SUMMARY_MAX_WORDS : MODEL_SUMMARY_EVIDENCE_MAX_WORDS;
  if (countWords(text) > limit) {
    return fail(`generated summary exceeded ${limit} words`);
  }

  if (input.kind === "providerIntent") {
    const quote = input.evidenceQuote?.trim() ?? "";
    if (quote.length === 0 || !normalize(input.sourceText).includes(normalize(quote))) {
      return {
        schemaValid: true,
        sourceQuoteCheck: "failed",
        unsupportedClaims: false,
        reason: "evidence quote was not found verbatim in the source material",
      };
    }
    return { schemaValid: true, sourceQuoteCheck: "passed", unsupportedClaims: false };
  }

  // Observed profiles may not introduce a number absent from the evidence.
  const numbers = text.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
  const source = normalize(input.sourceText);
  const missing = numbers.filter((token) => !source.includes(token.replace(",", "")));
  if (missing.length > 0) {
    return {
      schemaValid: true,
      sourceQuoteCheck: "notApplicable",
      unsupportedClaims: true,
      reason: `summary introduced values not present in the evidence: ${missing.join(", ")}`,
    };
  }
  return { schemaValid: true, sourceQuoteCheck: "notApplicable", unsupportedClaims: false };
}

const fail = (reason: string): SummaryValidation => ({
  schemaValid: false,
  sourceQuoteCheck: "notApplicable",
  unsupportedClaims: false,
  reason,
});

function countWords(text: string): number {
  return text.split(/\s+/g).filter((word) => word.length > 0).length;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Deterministic evidence text for an observed-profile prompt. Only computed,
 * stored values are emitted, so the model cannot invent a metric.
 */
export function observedProfileEvidence(capability: CatalogCapability): string {
  if (!capability.published || capability.overall === undefined) {
    return capability.withheldReason ?? "No published benchmark evidence.";
  }
  const labels = new Map(capability.specializations.map((entry) => [entry.family, entry.label]));
  const lines = [
    `Overall capability: ${capability.overall.score.toFixed(1)} (frontier reference ${capability.overall.frontierReference.toFixed(1)})`,
    "",
    "Dimension scores relative to the frontier, with specialization:",
  ];
  for (const dimension of capability.dimensions) {
    const label = labels.get(dimension.family) ?? "insufficient evidence";
    lines.push(`- ${dimension.family}: ${dimension.score.toFixed(1)} (${label})`);
  }
  return lines.join("\n");
}

export interface GenerateModelSummaryEntryInput {
  readonly textGeneration: TextGeneration.TextGeneration["Service"];
  readonly cwd: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly kind: TextGeneration.ModelSummaryKind;
  readonly sourceText: string;
  readonly sourceUrls: readonly string[];
  readonly sourceObservationIds: readonly string[];
  readonly modelSelection: ModelSelection;
  readonly providerDriver?: string;
  readonly generatedAt: string;
}

export const generateModelSummaryEntry = Effect.fn("generateModelSummaryEntry")(function* (
  input: GenerateModelSummaryEntryInput,
): Effect.fn.Return<CatalogGeneratedText, TextGenerationError> {
  const result = yield* input.textGeneration.generateModelSummary({
    cwd: input.cwd,
    kind: input.kind,
    modelName: input.modelName,
    sourceText: input.sourceText,
    modelSelection: input.modelSelection,
  });
  const validation = validateModelSummary({
    kind: input.kind,
    text: result.text,
    evidenceQuote: result.evidenceQuote,
    sourceText: input.sourceText,
  });
  const rejected =
    !validation.schemaValid ||
    validation.sourceQuoteCheck === "failed" ||
    validation.unsupportedClaims;
  return {
    id: `${input.modelId}:${input.kind === "providerIntent" ? "providerIntent" : "observedProfile"}`,
    modelId: input.modelId,
    kind: input.kind,
    text: result.text.trim(),
    promptVersion:
      input.kind === "providerIntent"
        ? PROVIDER_INTENT_PROMPT_VERSION
        : OBSERVED_PROFILE_PROMPT_VERSION,
    providerModelSelection: {
      instanceId: input.modelSelection.instanceId,
      model: input.modelSelection.model,
      ...(input.modelSelection.options !== undefined
        ? { options: input.modelSelection.options }
        : {}),
    },
    ...(input.providerDriver !== undefined ? { providerDriver: input.providerDriver } : {}),
    sourceObservationIds: [...input.sourceObservationIds],
    sourceUrls: [...input.sourceUrls],
    generatedAt: input.generatedAt,
    validation: {
      schemaValid: validation.schemaValid,
      sourceQuoteCheck: validation.sourceQuoteCheck,
      unsupportedClaims: validation.unsupportedClaims,
    },
    reviewStatus: rejected ? "rejected" : "pending",
    ...(validation.reason !== undefined ? { rejectedReason: validation.reason } : {}),
  };
});
