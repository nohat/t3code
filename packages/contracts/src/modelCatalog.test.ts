import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  BLEND_METHODOLOGY_VERSION,
  CAPABILITY_METHODOLOGY_VERSION,
  DEFAULT_BLEND,
  MODEL_CATALOG_METHODOLOGY,
  MODEL_CATALOG_VERSION,
  ModelCatalog,
  PUBLICATION_RULES,
  SPECIALIZATION_METHODOLOGY_VERSION,
  type CatalogModel,
} from "./modelCatalog.ts";

const decode = Schema.decodeUnknownSync(ModelCatalog);

function makeModel(overrides: Partial<CatalogModel>): CatalogModel {
  return {
    id: "maker/model",
    canonicalName: "Model",
    familyId: "model",
    makerId: "maker",
    aliases: [],
    technical: { modalities: ["text"] },
    offers: [],
    capability: {
      dimensions: [],
      specializations: [],
      published: false,
      withheldReason: "Not measured",
    },
    evidence: [],
    ...overrides,
  };
}

function makeCatalog(models: readonly CatalogModel[]) {
  return {
    version: MODEL_CATALOG_VERSION,
    catalogVersion: "2026-10-01T00:00:00.000Z",
    generatedAt: "2026-10-01T00:00:00.000Z",
    methodology: MODEL_CATALOG_METHODOLOGY,
    sources: [],
    sourceSnapshots: [],
    makers: [],
    servingProviders: [],
    models,
    observations: [],
    generatedText: [],
  };
}

describe("ModelCatalog contract", () => {
  it("decodes a catalog whose model has no measured capability", () => {
    const decoded = decode(makeCatalog([makeModel({})]));
    expect(decoded.models[0]?.capability.published).toBe(false);
    expect(decoded.models[0]?.capability.overall).toBeUndefined();
  });

  it("decodes an offer with a partial rate card and an available blend", () => {
    const decoded = decode(
      makeCatalog([
        makeModel({
          offers: [
            {
              id: "direct",
              servingProviderId: "maker",
              label: "Direct",
              isCanonical: true,
              rateCard: {
                currency: "USD",
                unit: "1M tokens",
                input: 3,
                output: 15,
                cacheRead: 0.75,
              },
              blendedPrice: {
                value: 2.8,
                methodologyVersion: BLEND_METHODOLOGY_VERSION,
                inputObservationIds: ["a", "b", "c"],
              },
              priceSourceIds: ["source"],
            },
          ],
          primaryOfferId: "direct",
        }),
      ]),
    );
    expect(decoded.models[0]?.offers[0]?.blendedPrice?.value).toBe(2.8);
  });

  it("exposes the agreed methodology constants", () => {
    expect(MODEL_CATALOG_METHODOLOGY.blend).toEqual(DEFAULT_BLEND);
    expect(MODEL_CATALOG_METHODOLOGY.blendMethodologyVersion).toBe(BLEND_METHODOLOGY_VERSION);
    expect(MODEL_CATALOG_METHODOLOGY.capabilityMethodologyVersion).toBe(
      CAPABILITY_METHODOLOGY_VERSION,
    );
    expect(MODEL_CATALOG_METHODOLOGY.specializationMethodologyVersion).toBe(
      SPECIALIZATION_METHODOLOGY_VERSION,
    );
    expect(PUBLICATION_RULES.requiredFamilies).toContain("generalReasoning");
    expect(PUBLICATION_RULES.requiredFamilies).toContain("coding");
  });

  it("rejects a catalog with an unknown capability family", () => {
    expect(() =>
      decode(
        makeCatalog([
          makeModel({
            capability: {
              dimensions: [
                {
                  family: "notAFamily" as never,
                  score: 1,
                  observationCount: 1,
                  inputObservationIds: [],
                },
              ],
              specializations: [],
              published: false,
            },
          }),
        ]),
      ),
    ).toThrow();
  });
});
