/**
 * OpenRouter model-catalog adapter.
 *
 * `GET /api/v1/models` is public and returns identity, context length,
 * modality, and per-token pricing for OpenRouter's routed offering. These are a
 * distinct routed serving offer, never a substitute for a maker's direct rate
 * card.
 *
 * @module modelCatalog/sources/openRouterModels
 */
import type { CatalogObservation, Modality } from "@t3tools/contracts";

import type { AdapterMeta } from "./liteLlmPricing.ts";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export interface OpenRouterModel {
  readonly id: string;
  readonly name: string;
  readonly contextLength?: number;
  readonly inputModalities?: readonly Modality[];
  readonly outputModalities?: readonly Modality[];
  readonly pricing: Readonly<Partial<Record<OpenRouterPriceField, number>>>;
}

export type OpenRouterPriceField = "input" | "output" | "cacheRead" | "cacheWrite";

const PRICING_FIELDS: Readonly<Record<string, OpenRouterPriceField>> = {
  prompt: "input",
  completion: "output",
  input_cache_read: "cacheRead",
  input_cache_write: "cacheWrite",
};

const MODALITY_NAMES = new Set(["text", "image", "audio", "video"]);

export function parseOpenRouterModels(payload: unknown): readonly OpenRouterModel[] {
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const models: OpenRouterModel[] = [];
  for (const row of rows) {
    const model = parseOpenRouterModel(row);
    if (model !== undefined) models.push(model);
  }
  return models;
}

function parseOpenRouterModel(raw: unknown): OpenRouterModel | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string" || raw.id.length === 0) return undefined;
  const pricing: Partial<Record<OpenRouterPriceField, number>> = {};
  if (isRecord(raw.pricing)) {
    for (const [sourceField, field] of Object.entries(PRICING_FIELDS)) {
      const value = raw.pricing[sourceField];
      const perToken =
        typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
      if (Number.isFinite(perToken) && perToken >= 0) {
        pricing[field] = roundToMillionth(perToken * 1_000_000);
      }
    }
  }
  const architecture = isRecord(raw.architecture) ? raw.architecture : undefined;
  const contextLength = typeof raw.context_length === "number" ? raw.context_length : undefined;
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.id,
    ...(contextLength !== undefined ? { contextLength } : {}),
    ...modalityFields(architecture),
    pricing,
  };
}

function modalityFields(
  architecture: Record<string, unknown> | undefined,
): Pick<OpenRouterModel, "inputModalities" | "outputModalities"> {
  if (architecture === undefined) return {};
  const input = readModalities(architecture.input_modalities);
  const output = readModalities(architecture.output_modalities);
  return {
    ...(input.length > 0 ? { inputModalities: input } : {}),
    ...(output.length > 0 ? { outputModalities: output } : {}),
  };
}

function readModalities(value: unknown): Modality[] {
  if (!Array.isArray(value)) return [];
  const result: Modality[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && MODALITY_NAMES.has(entry)) {
      result.push(entry as Modality);
    }
  }
  return result;
}

export function openRouterModelObservations(
  model: OpenRouterModel,
  modelId: string,
  offerId: string,
  meta: AdapterMeta,
): CatalogObservation[] {
  const observations: CatalogObservation[] = [];
  for (const [field, value] of Object.entries(model.pricing)) {
    observations.push({
      id: `${modelId}:${offerId}:price.${field}`,
      modelId,
      offerId,
      metric: `price.${field}`,
      value,
      unit: "USD per 1M tokens",
      metricClass: "pricing",
      sourceId: meta.sourceId,
      sourceUrl: meta.sourceUrl,
      ...(meta.observedAt !== undefined ? { observedAt: meta.observedAt } : {}),
      retrievedAt: meta.retrievedAt,
    });
  }
  return observations;
}

function roundToMillionth(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
