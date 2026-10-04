/**
 * Seed catalog.
 *
 * Hand-curated identity, technical metadata, serving offers, and retained source
 * observations. Every value here is attributed to a source; derived metrics
 * (blended price, capability, specialization) are computed by `buildCatalog`
 * and must not be added here. Observations that were not published are left
 * out, so the dashboard can show them as not measured.
 *
 * The refresh job replaces this with freshly fetched observations on its own
 * cadence; this seed keeps the dashboard useful and reviewable before then.
 *
 * @module modelCatalog/seed
 */
import type {
  CatalogAdoptionSignal,
  CatalogObservation,
  CatalogSourceRef,
} from "@t3tools/contracts";

import type { CatalogSeed, SeedModel } from "./seedTypes.ts";

const RETRIEVED_AT = "2026-10-01T21:10:06.637Z";
const GENERATED_AT = "2026-10-01T21:10:06.637Z";
const OPENROUTER_OBSERVED_AT = "2026-10-01";
const OFFICIAL_OBSERVED_AT = "2026-09-28";

const sources: CatalogSourceRef[] = [
  {
    sourceId: "anthropic.sonnet-5-5",
    sourceKind: "officialModelPage",
    label: "Anthropic — Claude Sonnet 5.5 overview",
    url: "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
  },
  {
    sourceId: "openai.gpt-6.1-sol",
    sourceKind: "officialModelPage",
    label: "OpenAI — GPT-6.1 Sol",
    url: "https://platform.openai.com/docs/models/gpt-6.1-sol",
  },
  {
    sourceId: "openrouter.models",
    sourceKind: "openrouterModels",
    label: "OpenRouter — model catalog API",
    url: "https://openrouter.ai/api/v1/models",
  },
  {
    sourceId: "openrouter.benchmarks",
    sourceKind: "openrouterBenchmarks",
    label: "OpenRouter Data API — benchmarks",
    url: "https://openrouter.ai/docs/cookbook/administration/data-api",
    license: "CC BY 4.0",
    citation: "OpenRouter Data API, benchmarks endpoint",
  },
  {
    sourceId: "openrouter.rankings",
    sourceKind: "openrouterRankings",
    label: "OpenRouter Data API — daily rankings",
    url: "https://openrouter.ai/api/v1/datasets/rankings-daily",
    license: "CC BY 4.0",
    citation: "OpenRouter Data API, rankings-daily dataset",
  },
  {
    sourceId: "openrouter.tasks",
    sourceKind: "openrouterTasks",
    label: "OpenRouter Data API — task classifications",
    url: "https://openrouter.ai/api/v1/classifications/task",
    license: "CC BY 4.0",
    citation: "OpenRouter Data API, task classifications endpoint",
  },
  {
    sourceId: "artificialanalysis.intelligence",
    sourceKind: "artificialAnalysis",
    label: "Artificial Analysis — Intelligence Index",
    url: "https://artificialanalysis.ai/",
  },
  {
    sourceId: "designarena.elo",
    sourceKind: "designArena",
    label: "Design Arena — category Elo",
    url: "https://www.designarena.ai/",
  },
  {
    sourceId: "litellm.model_prices",
    sourceKind: "litellmPrices",
    label: "LiteLLM model price table",
    url: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  },
];

function priceObservation(
  modelId: string,
  offerId: string,
  sourceId: string,
  sourceUrl: string,
  metric: "price.input" | "price.output" | "price.cacheRead" | "price.cacheWrite",
  value: number,
): CatalogObservation {
  return {
    id: `${modelId}:${offerId}:${metric}`,
    modelId,
    offerId,
    metric,
    value,
    unit: "USD per 1M tokens",
    metricClass: "pricing",
    sourceId,
    sourceUrl,
    observedAt: OFFICIAL_OBSERVED_AT,
    retrievedAt: RETRIEVED_AT,
  };
}

function benchmarkObservation(
  modelId: string,
  family: CatalogObservation["benchmarkFamily"],
  key: string,
  value: number,
  sourceId: string,
  sourceUrl: string,
): CatalogObservation {
  return {
    id: `${modelId}:benchmark:${key}`,
    modelId,
    metric: `benchmark.${key}`,
    value,
    metricClass: "benchmark",
    ...(family !== undefined ? { benchmarkFamily: family } : {}),
    sourceId,
    sourceUrl,
    observedAt: OPENROUTER_OBSERVED_AT,
    retrievedAt: RETRIEVED_AT,
  };
}

function usageSignal(
  metric: CatalogAdoptionSignal["metric"],
  value: number,
  window: string,
  sourceId: "openrouter.rankings" | "openrouter.tasks",
  task?: string,
): CatalogAdoptionSignal {
  return {
    platform: "OpenRouter",
    universe: "Public OpenRouter model variants (top 50 plus an aggregate 'other')",
    window,
    metric,
    ...(task !== undefined ? { task } : {}),
    value,
    ...(metric === "momentum" ? { unit: "fraction" } : {}),
    sourceId,
    asOf: OPENROUTER_OBSERVED_AT,
    license: "CC BY 4.0",
    citation: "OpenRouter Data API",
  };
}

const ANTHROPIC = "anthropic";
const OPENAI = "openai";
const GOOGLE = "google";
const DEEPSEEK = "deepseek";
const META = "meta";

const makers = [
  { id: ANTHROPIC, name: "Anthropic", homepage: "https://www.anthropic.com" },
  { id: OPENAI, name: "OpenAI", homepage: "https://openai.com" },
  { id: GOOGLE, name: "Google", homepage: "https://deepmind.google" },
  { id: DEEPSEEK, name: "DeepSeek", homepage: "https://www.deepseek.com" },
  { id: META, name: "Meta", homepage: "https://ai.meta.com" },
];

const servingProviders = [
  { id: "anthropic-api", name: "Anthropic API", kind: "makerDirect" as const },
  { id: "openai-api", name: "OpenAI API", kind: "makerDirect" as const },
  { id: "google-api", name: "Google AI API", kind: "makerDirect" as const },
  { id: "deepseek-api", name: "DeepSeek API", kind: "makerDirect" as const },
  {
    id: "openrouter-anthropic",
    name: "OpenRouter → Anthropic",
    kind: "aggregator" as const,
    note: "Routed serving offer; rates are OpenRouter's, not Anthropic's direct rate card.",
  },
  {
    id: "openrouter-openai",
    name: "OpenRouter → OpenAI",
    kind: "aggregator" as const,
    note: "Routed serving offer; rates are OpenRouter's, not OpenAI's direct rate card.",
  },
];

const observations: CatalogObservation[] = [
  // Anthropic Claude Sonnet 5.5 — direct offer.
  priceObservation(
    "anthropic/claude-sonnet-5.5",
    "anthropic-direct",
    "anthropic.sonnet-5-5",
    "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
    "price.input",
    2,
  ),
  priceObservation(
    "anthropic/claude-sonnet-5.5",
    "anthropic-direct",
    "anthropic.sonnet-5-5",
    "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
    "price.output",
    10,
  ),
  priceObservation(
    "anthropic/claude-sonnet-5.5",
    "anthropic-direct",
    "anthropic.sonnet-5-5",
    "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
    "price.cacheRead",
    0.2,
  ),
  // Routed OpenRouter offer, distinct from the maker's direct rate card.
  priceObservation(
    "anthropic/claude-sonnet-5.5",
    "openrouter-anthropic",
    "openrouter.models",
    "https://openrouter.ai/api/v1/models",
    "price.input",
    2.2,
  ),
  priceObservation(
    "anthropic/claude-sonnet-5.5",
    "openrouter-anthropic",
    "openrouter.models",
    "https://openrouter.ai/api/v1/models",
    "price.output",
    11,
  ),
  priceObservation(
    "anthropic/claude-sonnet-5.5",
    "openrouter-anthropic",
    "openrouter.models",
    "https://openrouter.ai/api/v1/models",
    "price.cacheRead",
    0.22,
  ),
  benchmarkObservation(
    "anthropic/claude-sonnet-5.5",
    "generalReasoning",
    "gpqaDiamond",
    0.929293,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "anthropic/claude-sonnet-5.5",
    "coding",
    "sweBenchVerified",
    0.82,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "anthropic/claude-sonnet-5.5",
    "agenticCoding",
    "tauBenchAgentic",
    0.75,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "anthropic/claude-sonnet-5.5",
    "instructionFollowing",
    "ifBench",
    0.8,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "anthropic/claude-sonnet-5.5",
    "mathScience",
    "aime",
    0.9,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),

  // OpenAI GPT-6.1 Sol.
  priceObservation(
    "openai/gpt-6.1-sol",
    "openai-direct",
    "openai.gpt-6.1-sol",
    "https://platform.openai.com/docs/models/gpt-6.1-sol",
    "price.input",
    2,
  ),
  priceObservation(
    "openai/gpt-6.1-sol",
    "openai-direct",
    "openai.gpt-6.1-sol",
    "https://platform.openai.com/docs/models/gpt-6.1-sol",
    "price.output",
    10,
  ),
  priceObservation(
    "openai/gpt-6.1-sol",
    "openai-direct",
    "openai.gpt-6.1-sol",
    "https://platform.openai.com/docs/models/gpt-6.1-sol",
    "price.cacheRead",
    0.1,
  ),
  benchmarkObservation(
    "openai/gpt-6.1-sol",
    "generalReasoning",
    "gpqaDiamond",
    0.944444,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "openai/gpt-6.1-sol",
    "coding",
    "sweBenchVerified",
    0.78,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "openai/gpt-6.1-sol",
    "agenticCoding",
    "tauBenchAgentic",
    0.71,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "openai/gpt-6.1-sol",
    "instructionFollowing",
    "ifBench",
    0.83,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "openai/gpt-6.1-sol",
    "mathScience",
    "aime",
    0.93,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),

  // Anthropic Claude Opus 5.5 — includes a Design Arena 3D Elo result.
  priceObservation(
    "anthropic/claude-opus-5.5",
    "anthropic-opus-direct",
    "anthropic.sonnet-5-5",
    "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
    "price.input",
    5,
  ),
  priceObservation(
    "anthropic/claude-opus-5.5",
    "anthropic-opus-direct",
    "anthropic.sonnet-5-5",
    "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
    "price.output",
    25,
  ),
  priceObservation(
    "anthropic/claude-opus-5.5",
    "anthropic-opus-direct",
    "anthropic.sonnet-5-5",
    "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
    "price.cacheRead",
    0.5,
  ),
  benchmarkObservation(
    "anthropic/claude-opus-5.5",
    "generalReasoning",
    "artificialAnalysisIntelligence",
    42,
    "artificialanalysis.intelligence",
    "https://artificialanalysis.ai/",
  ),
  benchmarkObservation(
    "anthropic/claude-opus-5.5",
    "coding",
    "sweBenchVerified",
    0.85,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "anthropic/claude-opus-5.5",
    "agenticCoding",
    "tauBenchAgentic",
    0.8,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "anthropic/claude-opus-5.5",
    "instructionFollowing",
    "ifBench",
    0.84,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "anthropic/claude-opus-5.5",
    "threeD",
    "designArenaThreeD",
    1300,
    "designarena.elo",
    "https://www.designarena.ai/",
  ),

  // Google Gemini 3.5 Pro.
  priceObservation(
    "google/gemini-3.5-pro",
    "google-direct",
    "litellm.model_prices",
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    "price.input",
    1.25,
  ),
  priceObservation(
    "google/gemini-3.5-pro",
    "google-direct",
    "litellm.model_prices",
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    "price.output",
    10,
  ),
  priceObservation(
    "google/gemini-3.5-pro",
    "google-direct",
    "litellm.model_prices",
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    "price.cacheRead",
    0.31,
  ),
  benchmarkObservation(
    "google/gemini-3.5-pro",
    "generalReasoning",
    "gpqaDiamond",
    0.88,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "google/gemini-3.5-pro",
    "coding",
    "sweBenchVerified",
    0.74,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "google/gemini-3.5-pro",
    "agenticCoding",
    "tauBenchAgentic",
    0.7,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "google/gemini-3.5-pro",
    "instructionFollowing",
    "ifBench",
    0.79,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "google/gemini-3.5-pro",
    "longContext",
    "rulerLongContext",
    0.85,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),

  // OpenAI GPT-6 Luna — price only; no published benchmark observations yet.
  priceObservation(
    "openai/gpt-6-luna",
    "openai-luna-direct",
    "litellm.model_prices",
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    "price.input",
    0.15,
  ),
  priceObservation(
    "openai/gpt-6-luna",
    "openai-luna-direct",
    "litellm.model_prices",
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    "price.output",
    0.6,
  ),
  priceObservation(
    "openai/gpt-6-luna",
    "openai-luna-direct",
    "litellm.model_prices",
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    "price.cacheRead",
    0.015,
  ),

  // DeepSeek V4 — two families, so coverage is insufficient to publish.
  benchmarkObservation(
    "deepseek/deepseek-v4",
    "generalReasoning",
    "gpqaDiamond",
    0.8,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
  benchmarkObservation(
    "deepseek/deepseek-v4",
    "coding",
    "sweBenchVerified",
    0.7,
    "openrouter.benchmarks",
    "https://openrouter.ai/docs/cookbook/administration/data-api",
  ),
];

function model(seed: SeedModel): SeedModel {
  return seed;
}

const models: SeedModel[] = [
  model({
    id: "anthropic/claude-sonnet-5.5",
    canonicalName: "Claude Sonnet 5.5",
    familyId: "claude-sonnet",
    makerId: ANTHROPIC,
    version: "5.5",
    aliases: [
      { source: "openrouter", sourceId: "anthropic/claude-sonnet-5.5" },
      { source: "anthropic", sourceId: "claude-sonnet-5-5" },
      { source: "litellm", sourceId: "claude-sonnet-5-5" },
    ],
    releasedAt: "2026-09-18",
    knowledgeCutoff: "2026-04-01",
    technical: {
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
      modalities: ["text", "image"],
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsReasoningControl: true,
    },
    offers: [
      {
        id: "anthropic-direct",
        servingProviderId: "anthropic-api",
        label: "Anthropic API",
        isCanonical: true,
        performance: {
          ttftMs: {
            metric: "ttftMs",
            median: 720,
            p25: 640,
            p75: 820,
            sampleCount: 120,
            sourceId: "artificialanalysis.intelligence",
            sourceUrl: "https://artificialanalysis.ai/",
            measuredAt: "2026-09-30T00:00:00.000Z",
            observedAt: "2026-09-30",
          },
          outputTokensPerSecond: {
            metric: "outputTokensPerSecond",
            median: 118,
            p25: 105,
            p75: 132,
            sampleCount: 120,
            sourceId: "artificialanalysis.intelligence",
            sourceUrl: "https://artificialanalysis.ai/",
            measuredAt: "2026-09-30T00:00:00.000Z",
            observedAt: "2026-09-30",
          },
        },
      },
      {
        id: "openrouter-anthropic",
        servingProviderId: "openrouter-anthropic",
        label: "OpenRouter → Anthropic",
        isCanonical: false,
      },
    ],
    primaryOfferId: "anthropic-direct",
    adoptionSignals: [
      usageSignal("usageRank", 1, "7d", "openrouter.rankings"),
      usageSignal("taskRank", 1, "7d", "openrouter.tasks", "coding"),
      usageSignal("momentum", 0.31, "7d", "openrouter.rankings"),
      usageSignal("momentum", 0.74, "30d", "openrouter.rankings"),
    ],
  }),
  model({
    id: "openai/gpt-6.1-sol",
    canonicalName: "GPT-6.1 Sol",
    familyId: "gpt-6.1-sol",
    makerId: OPENAI,
    version: "6.1",
    aliases: [
      { source: "openai", sourceId: "gpt-6.1-sol" },
      { source: "openrouter", sourceId: "openai/gpt-6.1-sol" },
      { source: "litellm", sourceId: "gpt-6.1-sol" },
    ],
    releasedAt: "2026-08-20",
    technical: {
      contextWindow: 1_050_000,
      maxOutputTokens: 100_000,
      modalities: ["text", "image"],
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsReasoningControl: true,
    },
    offers: [
      {
        id: "openai-direct",
        servingProviderId: "openai-api",
        label: "OpenAI API",
        isCanonical: true,
        performance: {
          ttftMs: {
            metric: "ttftMs",
            median: 880,
            sampleCount: 96,
            sourceId: "artificialanalysis.intelligence",
            sourceUrl: "https://artificialanalysis.ai/",
            measuredAt: "2026-09-30T00:00:00.000Z",
            observedAt: "2026-09-30",
          },
          outputTokensPerSecond: {
            metric: "outputTokensPerSecond",
            median: 96,
            sampleCount: 96,
            sourceId: "artificialanalysis.intelligence",
            sourceUrl: "https://artificialanalysis.ai/",
            measuredAt: "2026-09-30T00:00:00.000Z",
            observedAt: "2026-09-30",
          },
        },
      },
    ],
    primaryOfferId: "openai-direct",
    adoptionSignals: [
      usageSignal("usageRank", 2, "7d", "openrouter.rankings"),
      usageSignal("taskRank", 2, "7d", "openrouter.tasks", "coding"),
      usageSignal("momentum", 0.15, "7d", "openrouter.rankings"),
    ],
  }),
  model({
    id: "anthropic/claude-opus-5.5",
    canonicalName: "Claude Opus 5.5",
    familyId: "claude-opus",
    makerId: ANTHROPIC,
    version: "5.5",
    aliases: [
      { source: "anthropic", sourceId: "claude-opus-5-5" },
      { source: "openrouter", sourceId: "anthropic/claude-opus-5.5" },
      { source: "litellm", sourceId: "claude-opus-5-5" },
    ],
    releasedAt: "2026-06-10",
    technical: {
      contextWindow: 500_000,
      maxOutputTokens: 64_000,
      modalities: ["text", "image"],
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsReasoningControl: true,
    },
    offers: [
      {
        id: "anthropic-opus-direct",
        servingProviderId: "anthropic-api",
        label: "Anthropic API",
        isCanonical: true,
      },
    ],
    primaryOfferId: "anthropic-opus-direct",
    adoptionSignals: [usageSignal("usageRank", 3, "7d", "openrouter.rankings")],
  }),
  model({
    id: "google/gemini-3.5-pro",
    canonicalName: "Gemini 3.5 Pro",
    familyId: "gemini-3.5",
    makerId: GOOGLE,
    version: "3.5",
    aliases: [
      { source: "google", sourceId: "gemini-3.5-pro" },
      { source: "openrouter", sourceId: "google/gemini-3.5-pro" },
      { source: "litellm", sourceId: "gemini-3.5-pro" },
    ],
    releasedAt: "2026-07-15",
    technical: {
      contextWindow: 2_000_000,
      maxOutputTokens: 65_536,
      modalities: ["text", "image", "audio", "video"],
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsReasoningControl: true,
    },
    offers: [
      {
        id: "google-direct",
        servingProviderId: "google-api",
        label: "Google AI API",
        isCanonical: true,
        performance: {
          ttftMs: {
            metric: "ttftMs",
            median: 610,
            sampleCount: 88,
            sourceId: "artificialanalysis.intelligence",
            sourceUrl: "https://artificialanalysis.ai/",
            measuredAt: "2026-09-30T00:00:00.000Z",
            observedAt: "2026-09-30",
          },
          outputTokensPerSecond: {
            metric: "outputTokensPerSecond",
            median: 212,
            sampleCount: 88,
            sourceId: "artificialanalysis.intelligence",
            sourceUrl: "https://artificialanalysis.ai/",
            measuredAt: "2026-09-30T00:00:00.000Z",
            observedAt: "2026-09-30",
          },
        },
      },
    ],
    primaryOfferId: "google-direct",
    adoptionSignals: [usageSignal("usageRank", 4, "7d", "openrouter.rankings")],
  }),
  model({
    id: "openai/gpt-6-luna",
    canonicalName: "GPT-6 Luna",
    familyId: "gpt-6-luna",
    makerId: OPENAI,
    version: "6",
    aliases: [
      { source: "openai", sourceId: "gpt-6-luna" },
      { source: "openrouter", sourceId: "openai/gpt-6-luna" },
      { source: "litellm", sourceId: "gpt-6-luna" },
    ],
    releasedAt: "2026-09-25",
    technical: {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      modalities: ["text", "image"],
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsReasoningControl: true,
    },
    offers: [
      {
        id: "openai-luna-direct",
        servingProviderId: "openai-api",
        label: "OpenAI API",
        isCanonical: true,
      },
    ],
    primaryOfferId: "openai-luna-direct",
    adoptionSignals: [
      usageSignal("usageRank", 5, "7d", "openrouter.rankings"),
      usageSignal("momentum", 0.5, "7d", "openrouter.rankings"),
    ],
  }),
  model({
    id: "deepseek/deepseek-v4",
    canonicalName: "DeepSeek V4",
    familyId: "deepseek-v4",
    makerId: DEEPSEEK,
    version: "4",
    aliases: [
      { source: "deepseek", sourceId: "deepseek-v4" },
      { source: "openrouter", sourceId: "deepseek/deepseek-v4" },
    ],
    releasedAt: "2026-05-01",
    technical: {
      contextWindow: 128_000,
      maxOutputTokens: 32_768,
      modalities: ["text"],
      supportsTools: true,
      openWeights: true,
    },
    offers: [
      {
        id: "deepseek-direct",
        servingProviderId: "deepseek-api",
        label: "DeepSeek API",
        isCanonical: true,
      },
    ],
    primaryOfferId: "deepseek-direct",
    adoptionSignals: [usageSignal("usageRank", 8, "7d", "openrouter.rankings")],
  }),
  model({
    id: "meta/llama-5-70b",
    canonicalName: "Llama 5 70B",
    familyId: "llama-5",
    makerId: META,
    version: "5",
    aliases: [
      { source: "meta", sourceId: "llama-5-70b" },
      { source: "openrouter", sourceId: "meta/llama-5-70b" },
    ],
    releasedAt: "2026-03-01",
    technical: {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      modalities: ["text"],
      supportsTools: false,
      openWeights: true,
    },
    offers: [
      {
        id: "meta-open-weights",
        servingProviderId: "deepseek-api",
        label: "Open weights",
        isCanonical: true,
      },
    ],
    primaryOfferId: "meta-open-weights",
    adoptionSignals: [],
  }),
];

export const CATALOG_SEED: CatalogSeed = {
  generatedAt: GENERATED_AT,
  catalogVersion: GENERATED_AT,
  sources,
  sourceSnapshots: [],
  makers,
  servingProviders,
  models,
  observations,
  generatedText: [
    {
      id: "anthropic/claude-sonnet-5.5:providerIntent",
      modelId: "anthropic/claude-sonnet-5.5",
      kind: "providerIntent",
      text: "The provider presents Claude Sonnet 5.5 as offering a combination of speed and intelligence.",
      promptVersion: "provider-intent-summary-v1",
      providerModelSelection: { instanceId: "codex", model: "gpt-6-luna" },
      providerDriver: "codex",
      sourceObservationIds: [],
      sourceUrls: ["https://platform.claude.com/docs/en/models/sonnet-5-5/overview"],
      generatedAt: GENERATED_AT,
      validation: { schemaValid: true, sourceQuoteCheck: "passed", unsupportedClaims: false },
      reviewStatus: "approved",
    },
    {
      id: "anthropic/claude-sonnet-5.5:observedProfile",
      modelId: "anthropic/claude-sonnet-5.5",
      kind: "observedProfile",
      text: "Strong agentic-coding and coding results relative to models of comparable overall capability; instruction-following sits near the peer average.",
      promptVersion: "observed-profile-summary-v1",
      providerModelSelection: { instanceId: "codex", model: "gpt-6-luna" },
      providerDriver: "codex",
      sourceObservationIds: [
        "anthropic/claude-sonnet-5.5:benchmark:sweBenchVerified",
        "anthropic/claude-sonnet-5.5:benchmark:tauBenchAgentic",
        "anthropic/claude-sonnet-5.5:benchmark:ifBench",
      ],
      sourceUrls: ["https://openrouter.ai/docs/cookbook/administration/data-api"],
      generatedAt: GENERATED_AT,
      validation: {
        schemaValid: true,
        sourceQuoteCheck: "notApplicable",
        unsupportedClaims: false,
      },
      reviewStatus: "approved",
    },
    {
      id: "openai/gpt-6.1-sol:providerIntent",
      modelId: "openai/gpt-6.1-sol",
      kind: "providerIntent",
      text: "OpenAI positions GPT-6.1 Sol as a high-throughput model for reasoning-heavy work.",
      promptVersion: "provider-intent-summary-v1",
      providerModelSelection: { instanceId: "codex", model: "gpt-6-luna" },
      providerDriver: "codex",
      sourceObservationIds: [],
      sourceUrls: ["https://platform.openai.com/docs/models/gpt-6.1-sol"],
      generatedAt: GENERATED_AT,
      validation: { schemaValid: true, sourceQuoteCheck: "passed", unsupportedClaims: false },
      reviewStatus: "pending",
    },
  ],
};
