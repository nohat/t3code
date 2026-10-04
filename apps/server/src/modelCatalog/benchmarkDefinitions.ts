/**
 * Benchmark normalization definitions.
 *
 * Only externally published results enter the catalog. Each published benchmark
 * is described here once, with the family it belongs to and the scale its
 * publisher reports on. Normalization is deterministic and benchmark-specific;
 * a language model is never used to score, rank, or interpret results.
 *
 * @module modelCatalog/benchmarkDefinitions
 */
import type { BenchmarkFamily } from "@t3tools/contracts";

/**
 * How a publisher reports a result:
 * - `accuracy`: a 0–1 proportion (or an already-percent 0–100 number);
 * - `index`: a published index already on an approximate 0–100 scale;
 * - `elo`: an Elo rating, mapped to an expected score against a fixed reference.
 */
export type BenchmarkScale = "accuracy" | "index" | "elo";

export interface BenchmarkDefinition {
  readonly key: string;
  readonly label: string;
  readonly family: BenchmarkFamily;
  readonly scale: BenchmarkScale;
}

/**
 * Fixed rating the Elo transform scores against. Fixed (not derived from the
 * current cohort) so a model's normalized value does not move when unrelated
 * models are added or retired.
 */
export const ELO_REFERENCE_RATING = 1200;

export const BENCHMARK_DEFINITIONS: Readonly<Record<string, BenchmarkDefinition>> = {
  sweBenchVerified: {
    key: "sweBenchVerified",
    label: "SWE-bench Verified",
    family: "coding",
    scale: "accuracy",
  },
  gpqaDiamond: {
    key: "gpqaDiamond",
    label: "GPQA Diamond",
    family: "generalReasoning",
    scale: "accuracy",
  },
  aime: { key: "aime", label: "AIME", family: "mathScience", scale: "accuracy" },
  tauBenchAgentic: {
    key: "tauBenchAgentic",
    label: "tau-bench (agentic)",
    family: "agenticCoding",
    scale: "accuracy",
  },
  ifBench: { key: "ifBench", label: "IFBench", family: "instructionFollowing", scale: "accuracy" },
  rulerLongContext: {
    key: "rulerLongContext",
    label: "RULER (long context)",
    family: "longContext",
    scale: "accuracy",
  },
  artificialAnalysisIntelligence: {
    key: "artificialAnalysisIntelligence",
    label: "Artificial Analysis Intelligence Index",
    family: "generalReasoning",
    scale: "index",
  },
  artificialAnalysisCoding: {
    key: "artificialAnalysisCoding",
    label: "Artificial Analysis Coding Index",
    family: "coding",
    scale: "index",
  },
  artificialAnalysisAgentic: {
    key: "artificialAnalysisAgentic",
    label: "Artificial Analysis Agentic Index",
    family: "agenticCoding",
    scale: "index",
  },
  tauBenchVerifiedAirline: {
    key: "tauBenchVerifiedAirline",
    label: "tau-bench Verified (airline)",
    family: "agenticCoding",
    scale: "accuracy",
  },
  searchBrowseComp: {
    key: "searchBrowseComp",
    label: "BrowseComp",
    family: "agenticCoding",
    scale: "accuracy",
  },
  searchDsqa: { key: "searchDsqa", label: "DSQA", family: "agenticCoding", scale: "accuracy" },
  searchWidesearch: {
    key: "searchWidesearch",
    label: "WideSearch",
    family: "agenticCoding",
    scale: "accuracy",
  },
  searchHle: {
    key: "searchHle",
    label: "Humanity's Last Exam",
    family: "generalReasoning",
    scale: "accuracy",
  },
  designArena: { key: "designArena", label: "Design Arena", family: "visualDesign", scale: "elo" },
  designArenaThreeD: {
    key: "designArenaThreeD",
    label: "Design Arena 3D",
    family: "threeD",
    scale: "elo",
  },
};

/**
 * Design Arena categories mapped to catalog families. Categories without a
 * family (audio, TTS) are intentionally omitted rather than forced into a
 * capability dimension they do not measure.
 */
export const DESIGN_ARENA_FAMILIES: Readonly<Record<string, BenchmarkFamily>> = {
  website: "frontend",
  uicomponent: "frontend",
  codecategories: "coding",
  dataviz: "visualDesign",
  graphicdesign: "visualDesign",
  image: "visualDesign",
  imageediting: "visualDesign",
  logo: "visualDesign",
  svg: "visualDesign",
  asciiart: "visualDesign",
  "3d": "threeD",
  gamedev: "threeD",
};

/** Resolve a benchmark key, including synthesized Design Arena categories. */
export function benchmarkDefinition(key: string): BenchmarkDefinition | undefined {
  const direct = BENCHMARK_DEFINITIONS[key];
  if (direct !== undefined) return direct;
  const prefix = "designArena.";
  if (key.startsWith(prefix)) {
    const category = key.slice(prefix.length);
    const family = DESIGN_ARENA_FAMILIES[category];
    if (family !== undefined) {
      return { key, label: `Design Arena ${category}`, family, scale: "elo" };
    }
  }
  return undefined;
}

/** Parse a `benchmark.<key>` observation metric into its key, if it is one. */
export function benchmarkKeyFromMetric(metric: string): string | undefined {
  const prefix = "benchmark.";
  return metric.startsWith(prefix) ? metric.slice(prefix.length) : undefined;
}

/** Map a reported value onto the catalog's common 0–100 latent scale. */
export function normalizeBenchmarkValue(scale: BenchmarkScale, value: number): number {
  switch (scale) {
    case "accuracy": {
      const percent = value <= 1 ? value * 100 : value;
      return clamp(percent, 0, 100);
    }
    case "index":
      return clamp(value, 0, 100);
    case "elo":
      // Elo expected score against the fixed reference, as a percentage.
      return clamp(100 / (1 + 10 ** ((ELO_REFERENCE_RATING - value) / 400)), 0, 100);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
