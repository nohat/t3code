import { describe, expect, it } from "@effect/vitest";

import type { SourceModelMatch } from "../crosswalk.ts";
import { parseLiteLlmPrices, type AdapterMeta } from "./liteLlmPricing.ts";
import { parseOpenRouterBenchmarks } from "./openRouterBenchmarks.ts";
import { parseOpenRouterRankings } from "./openRouterRankings.ts";
import { parseOpenRouterTasks } from "./openRouterTasks.ts";

const meta: AdapterMeta = {
  sourceId: "test.source",
  sourceUrl: "https://example.test/source",
  retrievedAt: "2026-10-01T00:00:00.000Z",
  observedAt: "2026-10-01",
};

const match = (sourceModelId: string, modelId: string): SourceModelMatch => ({
  sourceModelId,
  modelId,
  offerId: "direct",
});

describe("parseLiteLlmPrices", () => {
  it("converts per-token rates to per-million and skips absent rates", () => {
    const observations = parseLiteLlmPrices(
      {
        "claude-sonnet-5-5": {
          input_cost_per_token: 2e-6,
          output_cost_per_token: 1e-5,
          cache_read_input_token_cost: 2e-7,
        },
      },
      [match("claude-sonnet-5-5", "anthropic/claude-sonnet-5.5")],
      meta,
    );
    const byMetric = new Map(observations.map((observation) => [observation.metric, observation]));
    expect(byMetric.get("price.input")?.value).toBe(2);
    expect(byMetric.get("price.output")?.value).toBe(10);
    expect(byMetric.get("price.cacheRead")?.value).toBe(0.2);
    expect(byMetric.has("price.cacheWrite")).toBe(false);
    expect(byMetric.get("price.input")?.offerId).toBe("direct");
  });

  it("emits nothing for unmatched or malformed entries", () => {
    expect(parseLiteLlmPrices({}, [match("missing", "m")], meta)).toEqual([]);
  });
});

describe("parseOpenRouterBenchmarks", () => {
  it("maps benchmark slugs to catalog keys and families", () => {
    const observations = parseOpenRouterBenchmarks(
      {
        data: [
          {
            model_permaslug: "anthropic/claude-sonnet-5.5",
            benchmark: "gpqa_diamond",
            score: 0.92,
          },
          {
            source: "design-arena",
            model_permaslug: "anthropic/claude-sonnet-5.5-20260918",
            category: "3d",
            elo: 1300,
          },
          {
            source: "artificial-analysis",
            model_permaslug: "anthropic/claude-sonnet-5.5-20260918",
            intelligence_index: 56,
            coding_index: null,
          },
        ],
      },
      [match("anthropic/claude-sonnet-5.5", "anthropic/claude-sonnet-5.5")],
      meta,
    );
    const gpqa = observations.find((observation) => observation.metric === "benchmark.gpqaDiamond");
    expect(gpqa?.value).toBe(0.92);
    expect(gpqa?.benchmarkFamily).toBe("generalReasoning");
    const threeD = observations.find(
      (observation) => observation.metric === "benchmark.designArena.3d",
    );
    expect(threeD?.value).toBe(1300);
    expect(threeD?.benchmarkFamily).toBe("threeD");
    const intelligence = observations.find(
      (observation) => observation.metric === "benchmark.artificialAnalysisIntelligence",
    );
    expect(intelligence?.value).toBe(56);
    // The null coding index is skipped, not treated as zero.
    expect(
      observations.some(
        (observation) => observation.metric === "benchmark.artificialAnalysisCoding",
      ),
    ).toBe(false);
  });

  it("ignores rows for unknown benchmarks or models", () => {
    const observations = parseOpenRouterBenchmarks(
      { data: [{ model_permaslug: "x", benchmark: "mystery", score: 1 }] },
      [match("x", "x")],
      meta,
    );
    expect(observations).toEqual([]);
  });
});

describe("parseOpenRouterRankings", () => {
  const dates = Array.from(
    { length: 14 },
    (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`,
  );
  const rows = dates.flatMap((date, index) => [
    { date, model_permaslug: "a/x", total_tokens: index < 7 ? 10 : 20 },
    { date, model_permaslug: "b/y", total_tokens: 5 },
  ]);

  it("derives a rank and 7-day momentum from the daily rows", () => {
    const result = parseOpenRouterRankings(
      { data: rows },
      [match("a/x", "a/x"), match("b/y", "b/y")],
      meta,
    );
    const rank = (modelId: string) =>
      result.signals.find(
        (entry) => entry.modelId === modelId && entry.signal.metric === "usageRank",
      )?.signal.value;
    expect(rank("a/x")).toBe(1);
    expect(rank("b/y")).toBe(2);

    const momentum = (modelId: string, window: string) =>
      result.signals.find(
        (entry) =>
          entry.modelId === modelId &&
          entry.signal.metric === "momentum" &&
          entry.signal.window === window,
      )?.signal.value;
    expect(momentum("a/x", "7d")).toBeCloseTo(1, 5);
    expect(momentum("b/y", "7d")).toBe(0);
  });
});

describe("parseOpenRouterTasks", () => {
  it("ranks matched models per task over the stated window", () => {
    const result = parseOpenRouterTasks(
      {
        data: [
          {
            tag: "classification",
            display_name: "Classification",
            models: [
              { id: "anthropic/claude-opus-5.5-20260918", tag_usage_share: 0.3 },
              { id: "openai/gpt-6.1-sol", tag_usage_share: 0.1 },
            ],
          },
        ],
      },
      [
        match("anthropic/claude-opus-5.5-20260918", "anthropic/claude-opus-5-5"),
        match("openai/gpt-6.1-sol", "openai/gpt-6.1-sol"),
      ],
      meta,
      "7d",
    );
    const ranks = new Map(result.signals.map((entry) => [entry.modelId, entry.signal]));
    expect(ranks.get("anthropic/claude-opus-5-5")?.value).toBe(1);
    expect(ranks.get("anthropic/claude-opus-5-5")?.task).toBe("Classification");
    expect(ranks.get("openai/gpt-6.1-sol")?.value).toBe(2);
    expect(ranks.get("anthropic/claude-opus-5-5")?.window).toBe("7d");
  });
});
