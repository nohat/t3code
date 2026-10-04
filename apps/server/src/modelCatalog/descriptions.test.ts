import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ProviderInstanceId, type CatalogCapability } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  generateModelSummaryEntry,
  observedProfileEvidence,
  validateModelSummary,
} from "./descriptions.ts";

const stubTextGeneration = (
  summary: TextGeneration.ModelSummaryGenerationResult,
): TextGeneration.TextGeneration["Service"] =>
  TextGeneration.TextGeneration.of({
    generateCommitMessage: () => Effect.die("unused"),
    generatePrContent: () => Effect.die("unused"),
    generateBranchName: () => Effect.die("unused"),
    generateThreadTitle: () => Effect.die("unused"),
    generateModelSummary: () => Effect.succeed(summary),
  });

const summaryInput = {
  cwd: "/tmp",
  modelId: "anthropic/claude-sonnet-5.5",
  modelName: "Claude Sonnet 5.5",
  kind: "providerIntent" as const,
  sourceText: "The best combination of speed and intelligence.",
  sourceUrls: ["https://example.test/source"],
  sourceObservationIds: [],
  modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-6-luna"),
  generatedAt: "2026-10-01T00:00:00.000Z",
};

describe("generateModelSummaryEntry", () => {
  it.effect("records provenance and validation for a passing summary", () =>
    Effect.gen(function* () {
      const entry = yield* generateModelSummaryEntry({
        ...summaryInput,
        textGeneration: stubTextGeneration({
          text: "The provider presents the model as balancing speed and intelligence.",
          evidenceQuote: "combination of speed and intelligence",
        }),
      });
      expect(entry.reviewStatus).toBe("pending");
      expect(entry.promptVersion).toBe("provider-intent-summary-v1");
      expect(entry.providerModelSelection.model).toBe("gpt-6-luna");
      expect(entry.validation.sourceQuoteCheck).toBe("passed");
      expect(entry.sourceUrls).toEqual(["https://example.test/source"]);
    }),
  );

  it.effect("retains a rejected entry with its reason instead of replacing it", () =>
    Effect.gen(function* () {
      const entry = yield* generateModelSummaryEntry({
        ...summaryInput,
        textGeneration: stubTextGeneration({
          text: "The provider presents the model as balancing speed and intelligence.",
          evidenceQuote: "absent from the source",
        }),
      });
      expect(entry.reviewStatus).toBe("rejected");
      expect(entry.rejectedReason).toContain("verbatim");
    }),
  );
});

describe("validateModelSummary", () => {
  const sourceText = "The best combination of speed and intelligence.";

  it("passes a provider-intent summary whose quote appears verbatim", () => {
    const result = validateModelSummary({
      kind: "providerIntent",
      text: "The provider presents the model as balancing speed and intelligence.",
      evidenceQuote: "combination of speed and intelligence",
      sourceText,
    });
    expect(result.sourceQuoteCheck).toBe("passed");
    expect(result.schemaValid).toBe(true);
    expect(result.unsupportedClaims).toBe(false);
  });

  it("fails a provider-intent summary without a matching quote", () => {
    const result = validateModelSummary({
      kind: "providerIntent",
      text: "The provider presents the model as balancing speed and intelligence.",
      evidenceQuote: "a phrase that is not in the source",
      sourceText,
    });
    expect(result.sourceQuoteCheck).toBe("failed");
    expect(result.reason).toContain("verbatim");
  });

  it("rejects an observed profile that introduces a number absent from the evidence", () => {
    const result = validateModelSummary({
      kind: "observedProfile",
      text: "It scores 95 on coding tasks.",
      evidenceQuote: undefined,
      sourceText: "Overall capability: 90.0",
    });
    expect(result.unsupportedClaims).toBe(true);
    expect(result.reason).toContain("95");
  });

  it("accepts an observed profile that only reuses evidence values", () => {
    const result = validateModelSummary({
      kind: "observedProfile",
      text: "Coding is the strongest dimension with an overall capability of 90.0.",
      evidenceQuote: undefined,
      sourceText: "Overall capability: 90.0",
    });
    expect(result.unsupportedClaims).toBe(false);
    expect(result.sourceQuoteCheck).toBe("notApplicable");
  });

  it("rejects a summary over the word limit", () => {
    const result = validateModelSummary({
      kind: "providerIntent",
      text: Array.from({ length: 41 }, () => "word").join(" "),
      evidenceQuote: "word",
      sourceText: "word",
    });
    expect(result.schemaValid).toBe(false);
  });
});

describe("observedProfileEvidence", () => {
  it("states the withheld reason when no score is published", () => {
    const capability: CatalogCapability = {
      dimensions: [],
      specializations: [],
      published: false,
      withheldReason: "Not measured",
    };
    expect(observedProfileEvidence(capability)).toBe("Not measured");
  });

  it("lists only stored dimension values", () => {
    const capability: CatalogCapability = {
      overall: {
        score: 103.5,
        frontierReference: 100.5,
        coverage: {
          familiesCovered: ["coding", "generalReasoning"],
          familiesRequired: ["generalReasoning", "coding"],
          observationCount: 2,
        },
        methodologyVersion: "v1",
        inputObservationIds: ["o1", "o2"],
      },
      dimensions: [
        { family: "coding", score: 97.2, observationCount: 1, inputObservationIds: ["o1"] },
      ],
      specializations: [],
      published: true,
    };
    const evidence = observedProfileEvidence(capability);
    expect(evidence).toContain("Overall capability: 103.5");
    expect(evidence).toContain("coding: 97.2");
  });
});
