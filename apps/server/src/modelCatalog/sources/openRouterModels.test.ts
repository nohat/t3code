import { describe, expect, it } from "@effect/vitest";

import type { AdapterMeta } from "./liteLlmPricing.ts";
import { openRouterModelObservations, parseOpenRouterModels } from "./openRouterModels.ts";

const meta: AdapterMeta = {
  sourceId: "openrouter.models",
  sourceUrl: "https://openrouter.ai/api/v1/models",
  retrievedAt: "2026-10-01T00:00:00.000Z",
  observedAt: "2026-10-01",
};

describe("parseOpenRouterModels", () => {
  const payload = {
    data: [
      {
        id: "anthropic/claude-opus-5.5",
        name: "Claude Opus 5.5",
        context_length: 200_000,
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
          modality: "text+image->text",
        },
        pricing: {
          prompt: "0.000003",
          completion: "0.000015",
          input_cache_read: "0.0000003",
          input_cache_write: "0.00000375",
          request: "0",
        },
      },
    ],
  };

  it("converts per-token prices to per-million and reads modalities", () => {
    const models = parseOpenRouterModels(payload);
    expect(models).toHaveLength(1);
    const model = models[0];
    expect(model?.contextLength).toBe(200_000);
    expect(model?.inputModalities).toEqual(["text", "image"]);
    expect(model?.pricing).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
  });

  it("emits one observation per present price dimension", () => {
    const model = parseOpenRouterModels(payload)[0];
    if (model === undefined) throw new Error("expected a model");
    const observations = openRouterModelObservations(
      model,
      "anthropic/claude-opus-5.5",
      "openrouter:x",
      meta,
    );
    const byMetric = new Map(
      observations.map((observation) => [observation.metric, observation.value]),
    );
    expect(byMetric.get("price.input")).toBe(3);
    expect(byMetric.get("price.cacheRead")).toBe(0.3);
    expect(observations.every((observation) => observation.offerId === "openrouter:x")).toBe(true);
  });
});
