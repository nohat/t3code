#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalFetch:off
// @effect-diagnostics globalTimers:off
// @effect-diagnostics globalDate:off -- Maintainer-run audit CLI; reads the persisted provider inventory and joins public sources.
/**
 * Model catalog audit.
 *
 * Enumerates every selectable model in the local T3 instance from the persisted
 * provider snapshots (`<stateDir>/caches/<instanceId>.json`), then joins public
 * and authenticated published sources to build a versioned catalog for a local
 * audit. It does not modify the committed shared artifact.
 *
 * Usage:
 *   node apps/server/scripts/model-catalog-audit.ts [--caches <dir>] [--out <path>]
 *     [--offline] [--openrouter-key-file <path>] [--retain-raw <dir>] [--now <iso>]
 *
 * The OpenRouter data API key is read from `OPENROUTER_API_KEY` or the key file
 * (default `~/code/scaffold/.env`). It is never written to the artifact.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  encodeModelCatalogSync,
  type CatalogAdoptionSignal,
  type CatalogAlias,
  type CatalogObservation,
  type CatalogServingProvider,
  type CatalogSourceSnapshot,
  type Modality,
} from "@t3tools/contracts";

import { buildCatalog } from "../src/modelCatalog/buildCatalog.ts";
import {
  buildInventorySeed,
  parseProviderInventory,
  type ProviderInventory,
} from "../src/modelCatalog/inventory.ts";
import { buildSourceIndex, matchSource } from "../src/modelCatalog/matching.ts";
import type { CatalogSeed, SeedModel, SeedOffer } from "../src/modelCatalog/seedTypes.ts";
import {
  LITELLM_PRICES_URL,
  parseLiteLlmPrices,
  type AdapterMeta,
} from "../src/modelCatalog/sources/liteLlmPricing.ts";
import {
  OPENROUTER_BENCHMARKS_URL,
  parseOpenRouterBenchmarks,
} from "../src/modelCatalog/sources/openRouterBenchmarks.ts";
import {
  OPENROUTER_MODELS_URL,
  openRouterModelObservations,
  parseOpenRouterModels,
} from "../src/modelCatalog/sources/openRouterModels.ts";
import {
  OPENROUTER_RANKINGS_URL,
  parseOpenRouterRankings,
} from "../src/modelCatalog/sources/openRouterRankings.ts";
import {
  OPENROUTER_TASKS_URL,
  parseOpenRouterTasks,
} from "../src/modelCatalog/sources/openRouterTasks.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    caches: { type: "string" },
    out: { type: "string" },
    offline: { type: "boolean", default: false },
    "openrouter-key-file": { type: "string" },
    "retain-raw": { type: "string" },
    now: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  process.stdout.write(
    "Usage: model-catalog-audit.ts [--caches <dir>] [--out <path>] [--offline] [--openrouter-key-file <path>] [--retain-raw <dir>] [--now <iso>]\n",
  );
  process.exit(0);
}

const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..", "..");
const cachesDir = values.caches ?? NodePath.join(process.env.HOME ?? "", ".t3", "caches");
const outPath = values.out ?? NodePath.join(repoRoot, ".t3", "model-catalog-audit.json");
const now = values.now ?? new Date().toISOString();

const openRouterApiKey = readOpenRouterKey();

function readOpenRouterKey(): string | undefined {
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const file =
    values["openrouter-key-file"] ??
    NodePath.join(process.env.HOME ?? "", "code", "scaffold", ".env");
  if (!NodeFS.existsSync(file)) return undefined;
  for (const line of NodeFS.readFileSync(file, "utf8").split(/\r?\n/g)) {
    const match = /^\s*OPENROUTER_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1].replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

async function fetchJson(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown | undefined> {
  try {
    const response = await fetch(url, {
      ...(headers !== undefined ? { headers } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

const snapshots: CatalogSourceSnapshot[] = [];
function retainRaw(
  sourceId: string,
  payload: unknown,
  url: string,
  license?: string,
  citation?: string,
): void {
  const serialized = JSON.stringify(payload);
  if (values["retain-raw"]) {
    NodeFS.mkdirSync(values["retain-raw"], { recursive: true });
    NodeFS.writeFileSync(NodePath.join(values["retain-raw"], `${sourceId}.json`), serialized);
  }
  snapshots.push({
    sourceId,
    sourceKind: sourceKindFor(sourceId),
    url,
    retrievedAt: now,
    contentHash: hash(serialized),
    recordCount: Array.isArray(payload) ? payload.length : 0,
    ...(license !== undefined ? { license } : {}),
    ...(citation !== undefined ? { citation } : {}),
  });
}

function sourceKindFor(sourceId: string): CatalogSourceSnapshot["sourceKind"] {
  if (sourceId.startsWith("openrouter")) {
    if (sourceId.includes("benchmark")) return "openrouterBenchmarks";
    if (sourceId.includes("models")) return "openrouterModels";
    if (sourceId.includes("ranking")) return "openrouterRankings";
    if (sourceId.includes("task")) return "openrouterTasks";
  }
  return "litellmPrices";
}

function hash(value: string): string {
  // Content hash over retained data; provenance only, not a security boundary.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 + code, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function meta(sourceId: string, url: string): AdapterMeta {
  return { sourceId, sourceUrl: url, retrievedAt: now };
}

// --- inventory -------------------------------------------------------------

const inventories: ProviderInventory[] = [];
for (const file of NodeFS.readdirSync(cachesDir).filter((name) => name.endsWith(".json"))) {
  try {
    const parsed = parseProviderInventory(
      JSON.parse(NodeFS.readFileSync(NodePath.join(cachesDir, file), "utf8")),
    );
    if (parsed !== undefined) inventories.push(parsed);
  } catch {
    // A malformed snapshot is skipped; other providers still contribute.
  }
}
inventories.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
const inventoryModelCount = inventories.reduce((sum, provider) => sum + provider.models.length, 0);

const seedParts = buildInventorySeed(inventories);
const servingProviders: CatalogServingProvider[] = [...seedParts.servingProviders];

interface MutableModel {
  model: SeedModel;
  technical: SeedModel["technical"];
  offers: SeedOffer[];
  aliases: CatalogAlias[];
  adoptionSignals: CatalogAdoptionSignal[];
}

const modelsById = new Map<string, MutableModel>();
for (const model of seedParts.models) {
  modelsById.set(model.id, {
    model,
    technical: model.technical,
    offers: [...model.offers],
    aliases: [...model.aliases],
    adoptionSignals: [],
  });
}

const observations: CatalogObservation[] = [];
let litellmMatched = 0;
let openRouterMatched = 0;

// --- LiteLLM pricing + context --------------------------------------------

if (!values.offline) {
  const litellm = await fetchJson(LITELLM_PRICES_URL);
  if (litellm !== undefined) {
    retainRaw("litellm.model_prices", litellm, LITELLM_PRICES_URL);
    const index = buildSourceIndex(Object.entries(litellm as Record<string, unknown>));
    const matches: { sourceModelId: string; modelId: string; offerId: string }[] = [];
    for (const entry of modelsById.values()) {
      const primary = entry.offers.find((offer) => offer.isCanonical) ?? entry.offers[0];
      if (primary === undefined) continue;
      const candidates = candidatesFor(entry, seedParts.candidates.get(entry.model.id));
      const match = matchSource(candidates, index);
      if (match === undefined) continue;
      litellmMatched += 1;
      matches.push({ sourceModelId: match.key, modelId: entry.model.id, offerId: primary.id });
      const context = contextFromLiteLlm(match.value);
      if (context.contextWindow !== undefined) {
        entry.technical = { ...entry.technical, contextWindow: context.contextWindow };
        observations.push(
          contextObservation(
            entry.model.id,
            "contextWindow",
            context.contextWindow,
            "litellm.model_prices",
            LITELLM_PRICES_URL,
          ),
        );
      }
      if (context.maxOutputTokens !== undefined) {
        entry.technical = { ...entry.technical, maxOutputTokens: context.maxOutputTokens };
        observations.push(
          contextObservation(
            entry.model.id,
            "maxOutputTokens",
            context.maxOutputTokens,
            "litellm.model_prices",
            LITELLM_PRICES_URL,
          ),
        );
      }
    }
    if (matches.length > 0) {
      // Reuse the adapter's exact conversion by re-keying to the matched keys.
      const payload = litellm as Record<string, unknown>;
      observations.push(
        ...parseLiteLlmPrices(payload, matches, meta("litellm.model_prices", LITELLM_PRICES_URL)),
      );
    }
  } else {
    process.stderr.write("litellm: fetch failed, skipping pricing\n");
  }
}

// --- OpenRouter routed offer + context/modalities ---------------------------

if (!values.offline) {
  const orPayload = await fetchJson(OPENROUTER_MODELS_URL);
  if (orPayload !== undefined) {
    retainRaw(
      "openrouter.models",
      orPayload,
      OPENROUTER_MODELS_URL,
      "CC BY 4.0",
      "OpenRouter Data API",
    );
    const orModels = parseOpenRouterModels(orPayload);
    const index = buildSourceIndex(orModels.map((model) => [model.id, model] as const));
    const openRouterProvider: CatalogServingProvider = {
      id: "openrouter",
      name: "OpenRouter",
      kind: "aggregator",
      note: "Routed serving offer; rates are OpenRouter's, not the maker's direct rate card.",
    };
    let addedProvider = false;
    for (const entry of modelsById.values()) {
      const candidates = candidatesFor(entry, seedParts.candidates.get(entry.model.id));
      const match = matchSource(candidates, index);
      if (match === undefined) continue;
      openRouterMatched += 1;
      const orModel = match.value;
      const offerId = `openrouter:${orModel.id}`;
      entry.offers.push({
        id: offerId,
        servingProviderId: "openrouter",
        label: "OpenRouter",
        isCanonical: false,
      });
      addedProvider = true;
      if (
        !entry.aliases.some(
          (alias) => alias.source === "openrouter" && alias.sourceId === orModel.id,
        )
      ) {
        entry.aliases.push({ source: "openrouter.models", sourceId: orModel.id });
      }
      observations.push(
        ...openRouterModelObservations(
          orModel,
          entry.model.id,
          offerId,
          meta("openrouter.models", OPENROUTER_MODELS_URL),
        ),
      );
      const modalities = unionModalities(orModel.inputModalities, orModel.outputModalities);
      if (modalities.length > 0) entry.technical = { ...entry.technical, modalities };
      if (orModel.contextLength !== undefined) {
        entry.technical = { ...entry.technical, contextWindow: orModel.contextLength };
        observations.push(
          contextObservation(
            entry.model.id,
            "contextWindow",
            orModel.contextLength,
            "openrouter.models",
            OPENROUTER_MODELS_URL,
          ),
        );
      }
    }
    if (addedProvider) servingProviders.push(openRouterProvider);
  } else {
    process.stderr.write("openrouter models: fetch failed, skipping routed offers\n");
  }
}

// --- OpenRouter data API: benchmarks + adoption -----------------------------

// Every candidate alias, so benchmark/ranking permaslugs can match even when
// they carry a release-date suffix the inventory slug lacked.
const allCandidates: { sourceModelId: string; modelId: string; offerId: string }[] = [];
for (const entry of modelsById.values()) {
  const primary = entry.offers.find((offer) => offer.isCanonical) ?? entry.offers[0];
  if (primary === undefined) continue;
  const seen = new Set<string>();
  for (const candidate of candidatesFor(entry, seedParts.candidates.get(entry.model.id))) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    allCandidates.push({ sourceModelId: candidate, modelId: entry.model.id, offerId: primary.id });
  }
}

let benchmarkCount = 0;
let adoptionCount = 0;
if (!values.offline && openRouterApiKey !== undefined && allCandidates.length > 0) {
  const headers = { Authorization: `Bearer ${openRouterApiKey}` };
  const benchmarks = await fetchJson(OPENROUTER_BENCHMARKS_URL, headers);
  if (benchmarks !== undefined) {
    retainRaw(
      "openrouter.benchmarks",
      benchmarks,
      OPENROUTER_BENCHMARKS_URL,
      "CC BY 4.0",
      "OpenRouter Data API",
    );
    const parsed = parseOpenRouterBenchmarks(
      benchmarks,
      allCandidates,
      meta("openrouter.benchmarks", OPENROUTER_BENCHMARKS_URL),
    );
    benchmarkCount = parsed.length;
    observations.push(...parsed);
  } else {
    process.stderr.write("openrouter benchmarks: fetch failed\n");
  }

  const rankings = await fetchJson(OPENROUTER_RANKINGS_URL, headers);
  if (rankings !== undefined) {
    retainRaw(
      "openrouter.rankings",
      rankings,
      OPENROUTER_RANKINGS_URL,
      "CC BY 4.0",
      "OpenRouter Data API",
    );
    const signals = parseOpenRouterRankings(
      rankings,
      allCandidates,
      meta("openrouter.rankings", OPENROUTER_RANKINGS_URL),
    ).signals;
    adoptionCount += mergeSignals(signals);
  } else {
    process.stderr.write("openrouter rankings: fetch failed\n");
  }

  const tasks = await fetchJson(`${OPENROUTER_TASKS_URL}?window=7d`, headers);
  if (tasks !== undefined) {
    retainRaw("openrouter.tasks", tasks, OPENROUTER_TASKS_URL, "CC BY 4.0", "OpenRouter Data API");
    const signals = parseOpenRouterTasks(
      tasks,
      allCandidates,
      meta("openrouter.tasks", OPENROUTER_TASKS_URL),
      "7d",
    ).signals;
    adoptionCount += mergeSignals(signals);
  } else {
    process.stderr.write("openrouter tasks: fetch failed\n");
  }
} else if (openRouterApiKey === undefined) {
  process.stderr.write("openrouter data api: no key, skipping benchmarks and adoption\n");
}

function mergeSignals(
  signals: readonly { modelId: string; signal: CatalogAdoptionSignal }[],
): number {
  let merged = 0;
  for (const { modelId, signal } of signals) {
    const entry = modelsById.get(modelId);
    if (entry === undefined) continue;
    const key = signalKey(signal);
    const retained = entry.adoptionSignals.filter((existing) => signalKey(existing) !== key);
    entry.adoptionSignals = [...retained, signal];
    merged += 1;
  }
  return merged;
}

// --- build ------------------------------------------------------------------

const models: SeedModel[] = [...modelsById.values()].map((entry) => ({
  ...entry.model,
  technical: entry.technical,
  offers: entry.offers,
  aliases: entry.aliases,
  adoptionSignals: entry.adoptionSignals,
}));

const seed: CatalogSeed = {
  generatedAt: now,
  catalogVersion: now,
  sources: [
    {
      sourceId: "litellm.model_prices",
      sourceKind: "litellmPrices",
      label: "LiteLLM model price table",
      url: LITELLM_PRICES_URL,
    },
    {
      sourceId: "openrouter.models",
      sourceKind: "openrouterModels",
      label: "OpenRouter model catalog API",
      url: OPENROUTER_MODELS_URL,
      license: "CC BY 4.0",
      citation: "OpenRouter Data API",
    },
    {
      sourceId: "openrouter.benchmarks",
      sourceKind: "openrouterBenchmarks",
      label: "OpenRouter Data API — benchmarks",
      url: OPENROUTER_BENCHMARKS_URL,
      license: "CC BY 4.0",
    },
    {
      sourceId: "openrouter.rankings",
      sourceKind: "openrouterRankings",
      label: "OpenRouter Data API — daily rankings",
      url: OPENROUTER_RANKINGS_URL,
      license: "CC BY 4.0",
    },
  ],
  sourceSnapshots: snapshots,
  makers: [...seedParts.makers],
  servingProviders,
  models,
  observations,
  generatedText: [],
};

const catalog = buildCatalog(seed);
NodeFS.mkdirSync(NodePath.dirname(outPath), { recursive: true });
NodeFS.writeFileSync(
  outPath,
  `${JSON.stringify(JSON.parse(encodeModelCatalogSync(catalog)), null, 2)}\n`,
);

const priced = catalog.models.filter((model) =>
  model.offers.some((offer) => offer.blendedPrice !== undefined),
).length;
const published = catalog.models.filter((model) => model.capability.published).length;
process.stdout.write(
  [
    `Wrote ${outPath}`,
    `inventory: ${inventories.length} providers, ${inventoryModelCount} raw models`,
    `catalog: ${catalog.models.length} canonical models, ${catalog.servingProviders.length} serving providers`,
    `pricing: litellm ${litellmMatched}, openrouter ${openRouterMatched}, blended available ${priced}`,
    `capability: ${published} published, ${benchmarkCount} benchmark observations`,
    `adoption: ${adoptionCount} signals`,
    `snapshots: ${catalog.sourceSnapshots.length}`,
  ].join("\n") + "\n",
);

function candidatesFor(entry: MutableModel, extra: readonly string[] | undefined): string[] {
  const candidates = new Set<string>([entry.model.familyId, entry.model.id]);
  for (const alias of entry.aliases) candidates.add(alias.sourceId);
  for (const value of extra ?? []) candidates.add(value);
  return [...candidates];
}

function contextFromLiteLlm(entry: unknown): { contextWindow?: number; maxOutputTokens?: number } {
  if (typeof entry !== "object" || entry === null) return {};
  const record = entry as Record<string, unknown>;
  const context = firstNumber(record, ["max_input_tokens", "max_tokens", "context_window"]);
  const output = firstNumber(record, ["max_output_tokens", "max_tokens"]);
  return {
    ...(context !== undefined ? { contextWindow: context } : {}),
    ...(output !== undefined ? { maxOutputTokens: output } : {}),
  };
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function contextObservation(
  modelId: string,
  metric: string,
  value: number,
  sourceId: string,
  sourceUrl: string,
): CatalogObservation {
  return {
    id: `${modelId}:${metric}:${sourceId}`,
    modelId,
    metric,
    value,
    metricClass: "metadata",
    sourceId,
    sourceUrl,
    retrievedAt: now,
  };
}

function unionModalities(
  input: readonly Modality[] | undefined,
  output: readonly Modality[] | undefined,
): Modality[] {
  const result = new Set<Modality>();
  for (const modality of input ?? []) result.add(modality);
  for (const modality of output ?? []) result.add(modality);
  return [...result];
}

function signalKey(signal: CatalogAdoptionSignal): string {
  return `${signal.metric}:${signal.window}:${signal.task ?? ""}`;
}
