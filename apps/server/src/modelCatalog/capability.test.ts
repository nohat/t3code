import { describe, expect, it } from "@effect/vitest";
import {
  CAPABILITY_METHODOLOGY_VERSION,
  PUBLICATION_RULES,
  type BenchmarkFamily,
  type CatalogObservation,
} from "@t3tools/contracts";

import { normalizeBenchmarkValue } from "./benchmarkDefinitions.ts";
import { computeCapabilities } from "./capability.ts";

const benchmark = (
  modelId: string,
  key: "gpqaDiamond" | "sweBenchVerified" | "tauBenchAgentic" | "ifBench",
  family: BenchmarkFamily,
  value: number,
): CatalogObservation => ({
  id: `${modelId}:${key}`,
  modelId,
  metric: `benchmark.${key}`,
  value,
  metricClass: "benchmark",
  benchmarkFamily: family,
  sourceId: "test",
  retrievedAt: "2026-10-01T00:00:00.000Z",
});

const fourFamilies = (
  modelId: string,
  general: number,
  coding: number,
  agentic: number,
  instruction: number,
): CatalogObservation[] => [
  benchmark(modelId, "gpqaDiamond", "generalReasoning", general),
  benchmark(modelId, "sweBenchVerified", "coding", coding),
  benchmark(modelId, "tauBenchAgentic", "agenticCoding", agentic),
  benchmark(modelId, "ifBench", "instructionFollowing", instruction),
];

describe("normalizeBenchmarkValue", () => {
  it("maps a 0–1 accuracy to a percentage and leaves percent values", () => {
    expect(normalizeBenchmarkValue("accuracy", 0.5)).toBe(50);
    expect(normalizeBenchmarkValue("accuracy", 92)).toBe(92);
  });

  it("clamps an index into 0–100", () => {
    expect(normalizeBenchmarkValue("index", 120)).toBe(100);
  });

  it("maps an Elo rating to an expected score against the fixed reference", () => {
    expect(normalizeBenchmarkValue("elo", 1200)).toBe(50);
    expect(normalizeBenchmarkValue("elo", 1400)).toBeCloseTo(76.0, 1);
  });
});

describe("computeCapabilities", () => {
  const observations = [
    ...fourFamilies("a", 0.9, 0.8, 0.7, 0.6),
    ...fourFamilies("b", 0.8, 0.7, 0.6, 0.5),
    benchmark("c", "gpqaDiamond", "generalReasoning", 0.7),
    benchmark("c", "sweBenchVerified", "coding", 0.6),
  ];

  const result = computeCapabilities({
    modelIds: ["a", "b", "c", "d"],
    observations,
    rules: PUBLICATION_RULES,
    methodologyVersion: CAPABILITY_METHODOLOGY_VERSION,
  });

  it("publishes an overall score only when coverage meets the rules", () => {
    expect(result.get("a")?.published).toBe(true);
    expect(result.get("b")?.published).toBe(true);
    expect(result.get("c")?.published).toBe(false);
    expect(result.get("c")?.withheldReason).toBe("Insufficient coverage: 2 of 4 families");
    expect(result.get("d")?.published).toBe(false);
    expect(result.get("d")?.withheldReason).toBe("Not measured");
  });

  it("keeps the frontier reference near 100 and orders models by composite", () => {
    const a = result.get("a")?.overall;
    const b = result.get("b")?.overall;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.score).toBeGreaterThan(b?.score ?? 0);
    expect(a?.coverage.familiesCovered).toHaveLength(4);
    expect(a?.inputObservationIds).toHaveLength(4);
  });

  it("computes specializations only with enough comparable models", () => {
    // Only two models publish an overall score here, so regression is skipped.
    expect(result.get("a")?.specializations).toEqual([]);
  });

  it("computes residual specializations once three or more models publish", () => {
    const withThird = computeCapabilities({
      modelIds: ["a", "b", "e"],
      observations: [...observations, ...fourFamilies("e", 0.85, 0.5, 0.95, 0.55)],
      rules: PUBLICATION_RULES,
      methodologyVersion: CAPABILITY_METHODOLOGY_VERSION,
    });
    const a = withThird.get("a");
    expect(a?.published).toBe(true);
    expect(a?.specializations).toHaveLength(4);
    for (const family of ["generalReasoning", "coding", "agenticCoding", "instructionFollowing"]) {
      expect(a?.specializations.some((entry) => entry.family === family)).toBe(true);
    }
  });
});
