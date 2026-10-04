/**
 * Capability and specialization derivation.
 *
 * Pure and deterministic. Inputs are retained benchmark observations; outputs
 * are frontier-relative scores with the observation ids that produced them. No
 * model is hand-scored and no benchmark is run here.
 *
 * Pipeline: normalize each published result onto a 0–100 scale, average per
 * family, express each family relative to its frontier reference, average the
 * dimensions into a composite, then map the composite against the frontier
 * cluster. Publication is gated by the catalog's coverage rules. Specialization
 * is the residual of a family's dimension score against the regression of that
 * family on overall capability.
 *
 * @module modelCatalog/capability
 */
import type {
  BenchmarkFamily,
  CatalogCapability,
  CatalogCapabilityCoverage,
  CatalogCapabilityIndex,
  CatalogObservation,
  CatalogPublicationRules,
  CatalogSpecialization,
  CapabilityFamilyScore,
  SpecializationLabel,
} from "@t3tools/contracts";

import {
  benchmarkDefinition,
  benchmarkKeyFromMetric,
  normalizeBenchmarkValue,
} from "./benchmarkDefinitions.ts";

export interface ComputeCapabilitiesInput {
  readonly modelIds: readonly string[];
  readonly observations: readonly CatalogObservation[];
  readonly rules: CatalogPublicationRules;
  readonly methodologyVersion: string;
}

interface BenchmarkDatum {
  readonly modelId: string;
  readonly family: BenchmarkFamily;
  readonly score: number;
  readonly observationId: string;
}

export function computeCapabilities(
  input: ComputeCapabilitiesInput,
): ReadonlyMap<string, CatalogCapability> {
  const data = collectBenchmarkData(input.observations);

  const byModel = new Map<string, Map<BenchmarkFamily, BenchmarkDatum[]>>();
  for (const modelId of input.modelIds) byModel.set(modelId, new Map());
  for (const datum of data) {
    const families = byModel.get(datum.modelId);
    if (families === undefined) continue;
    const list = families.get(datum.family);
    if (list === undefined) families.set(datum.family, [datum]);
    else list.push(datum);
  }

  // Raw family means per model, then each family's frontier reference.
  const rawFamily = new Map<
    string,
    Map<BenchmarkFamily, { mean: number; data: BenchmarkDatum[] }>
  >();
  const familyFrontier = new Map<BenchmarkFamily, number>();
  const familyValues = new Map<BenchmarkFamily, number[]>();
  for (const [modelId, families] of byModel) {
    const perModel = new Map<BenchmarkFamily, { mean: number; data: BenchmarkDatum[] }>();
    for (const [family, data_] of families) {
      const mean = average(data_.map((datum) => datum.score));
      perModel.set(family, { mean, data: data_ });
      const values = familyValues.get(family);
      if (values === undefined) familyValues.set(family, [mean]);
      else values.push(mean);
    }
    rawFamily.set(modelId, perModel);
  }
  for (const [family, values] of familyValues) {
    familyFrontier.set(family, meanOfTop(values, input.rules.frontierClusterSize));
  }

  // Frontier-relative dimension scores and composites.
  const dimensions = new Map<string, CapabilityFamilyScore[]>();
  const composites = new Map<string, number>();
  for (const modelId of input.modelIds) {
    const perModel = rawFamily.get(modelId);
    if (perModel === undefined || perModel.size === 0) {
      dimensions.set(modelId, []);
      continue;
    }
    const scores: CapabilityFamilyScore[] = [];
    for (const [family, entry] of perModel) {
      const reference = familyFrontier.get(family) ?? 0;
      const score = reference > 0 ? (100 * entry.mean) / reference : 0;
      scores.push({
        family,
        score,
        observationCount: entry.data.length,
        inputObservationIds: entry.data.map((datum) => datum.observationId),
      });
    }
    scores.sort((a, b) => a.family.localeCompare(b.family));
    dimensions.set(modelId, scores);
    composites.set(modelId, average(scores.map((score) => score.score)));
  }

  const qualifying = input.modelIds.filter((modelId) => {
    const scores = dimensions.get(modelId) ?? [];
    const families = new Set(scores.map((score) => score.family));
    const requiredCovered = input.rules.requiredFamilies.every((family) => families.has(family));
    return requiredCovered && families.size >= input.rules.minimumFamilies;
  });
  const frontierComposite =
    qualifying.length > 0
      ? meanOfTop(
          qualifying.map((modelId) => composites.get(modelId) ?? 0),
          input.rules.frontierClusterSize,
        )
      : undefined;

  const overall = new Map<string, CatalogCapabilityIndex>();
  for (const modelId of input.modelIds) {
    const composite = composites.get(modelId);
    const scores = dimensions.get(modelId) ?? [];
    if (
      composite === undefined ||
      frontierComposite === undefined ||
      !qualifying.includes(modelId)
    ) {
      continue;
    }
    const coverage: CatalogCapabilityCoverage = {
      familiesCovered: scores.map((score) => score.family),
      familiesRequired: input.rules.requiredFamilies,
      observationCount: scores.reduce((sum, score) => sum + score.observationCount, 0),
    };
    overall.set(modelId, {
      score: (100 * composite) / frontierComposite,
      frontierReference: frontierComposite,
      coverage,
      methodologyVersion: input.methodologyVersion,
      inputObservationIds: scores.flatMap((score) => score.inputObservationIds),
    });
  }

  const specializations = computeSpecializations({
    modelIds: input.modelIds,
    dimensions,
    overall,
  });

  const result = new Map<string, CatalogCapability>();
  for (const modelId of input.modelIds) {
    const scores = dimensions.get(modelId) ?? [];
    const index = overall.get(modelId);
    const published = index !== undefined;
    const withheld = published ? undefined : withholdReason(scores, input.rules);
    result.set(modelId, {
      ...(index !== undefined ? { overall: index } : {}),
      dimensions: scores,
      specializations: specializations.get(modelId) ?? [],
      published,
      ...(withheld !== undefined ? { withheldReason: withheld } : {}),
    });
  }
  return result;
}

function collectBenchmarkData(observations: readonly CatalogObservation[]): BenchmarkDatum[] {
  const data: BenchmarkDatum[] = [];
  for (const observation of observations) {
    if (observation.metricClass !== "benchmark") continue;
    if (observation.benchmarkFamily === undefined) continue;
    if (typeof observation.value !== "number" || !Number.isFinite(observation.value)) continue;
    const key = benchmarkKeyFromMetric(observation.metric);
    const definition = key === undefined ? undefined : benchmarkDefinition(key);
    if (definition === undefined) continue;
    data.push({
      modelId: observation.modelId,
      family: definition.family,
      score: normalizeBenchmarkValue(definition.scale, observation.value),
      observationId: observation.id,
    });
  }
  return data;
}

interface SpecializationInput {
  readonly modelIds: readonly string[];
  readonly dimensions: ReadonlyMap<string, CapabilityFamilyScore[]>;
  readonly overall: ReadonlyMap<string, CatalogCapabilityIndex>;
}

function computeSpecializations(
  input: SpecializationInput,
): ReadonlyMap<string, CatalogSpecialization[]> {
  // Group dimension scores by family, keeping only published-overall models.
  const perFamily = new Map<
    BenchmarkFamily,
    { overall: number; observed: number; observationIds: readonly string[]; modelId: string }[]
  >();
  for (const modelId of input.modelIds) {
    const index = input.overall.get(modelId);
    if (index === undefined) continue;
    for (const dimension of input.dimensions.get(modelId) ?? []) {
      const entry = {
        modelId,
        overall: index.score,
        observed: dimension.score,
        observationIds: dimension.inputObservationIds,
      };
      const list = perFamily.get(dimension.family);
      if (list === undefined) perFamily.set(dimension.family, [entry]);
      else list.push(entry);
    }
  }

  const result = new Map<string, CatalogSpecialization[]>();
  for (const [family, points] of perFamily) {
    // A regression needs at least three models and some spread in overall.
    if (points.length < 3) continue;
    const regression = fitLinear(
      points.map((point) => point.overall),
      points.map((point) => point.observed),
    );
    if (regression === undefined) continue;
    const residuals = points.map(
      (point) => point.observed - (regression.intercept + regression.slope * point.overall),
    );
    const std = populationStd(residuals);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const residual = residuals[index];
      if (point === undefined || residual === undefined) continue;
      const expected = regression.intercept + regression.slope * point.overall;
      const z = std > 0 ? residual / std : 0;
      const specialization: CatalogSpecialization = {
        family,
        observed: point.observed,
        expected,
        residual,
        label: specializationLabel(z),
        inputObservationIds: point.observationIds,
      };
      const list = result.get(point.modelId);
      if (list === undefined) result.set(point.modelId, [specialization]);
      else list.push(specialization);
    }
  }
  return result;
}

function specializationLabel(z: number): SpecializationLabel {
  if (z >= 2) return "exceptionalStrength";
  if (z >= 1) return "relativeStrength";
  if (z <= -2) return "significantWeakness";
  if (z <= -1) return "relativeWeakness";
  return "typical";
}

function withholdReason(
  scores: readonly CapabilityFamilyScore[],
  rules: CatalogPublicationRules,
): string {
  if (scores.length === 0) return "Not measured";
  const families = new Set(scores.map((score) => score.family));
  const missing = rules.requiredFamilies.filter((family) => !families.has(family));
  if (missing.length > 0) return `Insufficient coverage: missing ${missing.join(", ")}`;
  if (families.size < rules.minimumFamilies) {
    return `Insufficient coverage: ${families.size} of ${rules.minimumFamilies} families`;
  }
  return "Frontier reference unavailable";
}

/** Ordinary least squares. Returns `undefined` when there is no spread in x. */
function fitLinear(
  xs: readonly number[],
  ys: readonly number[],
): { intercept: number; slope: number } | undefined {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return undefined;
  const meanX = average(xs);
  const meanY = average(ys);
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = (xs[index] ?? 0) - meanX;
    covariance += dx * ((ys[index] ?? 0) - meanY);
    variance += dx * dx;
  }
  if (Math.abs(variance) < Number.EPSILON) return undefined;
  const slope = covariance / variance;
  return { intercept: meanY - slope * meanX, slope };
}

function populationStd(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function meanOfTop(values: readonly number[], count: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  return average(sorted.slice(0, Math.max(1, count)));
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
