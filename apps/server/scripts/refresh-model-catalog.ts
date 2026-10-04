#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalFetch:off
// @effect-diagnostics globalTimers:off
// @effect-diagnostics globalDate:off -- Maintainer-run CLI; plain Node keeps it runnable from any T3-spawned shell.
/**
 * Model catalog refresh job.
 *
 * Fetches the configured published sources, retains raw responses with
 * provenance, normalizes them with deterministic adapters, recomputes derived
 * metrics, and writes the versioned artifact consumed by every client. API
 * credentials are read from the refresh environment only and are never written
 * into the artifact.
 *
 * Usage:
 *   node apps/server/scripts/refresh-model-catalog.ts [--offline] [--out <path>]
 *     [--retain-raw <dir>] [--now <iso>]
 *
 * Without `--offline`, sources lacking credentials or failing to fetch are
 * skipped; their prior observations are retained from the seed, so a partial
 * refresh never drops data.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  encodeModelCatalogSync,
  type CatalogAdoptionSignal,
  type CatalogObservation,
  type CatalogSourceSnapshot,
} from "@t3tools/contracts";

import { buildCatalog } from "../src/modelCatalog/buildCatalog.ts";
import { sourceMatches } from "../src/modelCatalog/crosswalk.ts";
import { CATALOG_SEED } from "../src/modelCatalog/seed.ts";
import type { CatalogSeed, SeedModel } from "../src/modelCatalog/seedTypes.ts";
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
  OPENROUTER_RANKINGS_URL,
  parseOpenRouterRankings,
} from "../src/modelCatalog/sources/openRouterRankings.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    offline: { type: "boolean", default: false },
    out: { type: "string" },
    "retain-raw": { type: "string" },
    now: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  process.stdout.write(
    "Usage: refresh-model-catalog.ts [--offline] [--out <path>] [--retain-raw <dir>] [--now <iso>]\n",
  );
  process.exit(0);
}

const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..", "..");
const outPath =
  values.out ??
  NodePath.join(repoRoot, "packages", "shared", "src", "modelCatalog", "catalog.json");
const now = values.now ?? new Date().toISOString();
const openRouterApiKey = process.env.OPENROUTER_API_KEY;

const snapshots: CatalogSourceSnapshot[] = [];
const fetchedObservations: CatalogObservation[] = [];
const fetchedSignals: { modelId: string; signal: CatalogAdoptionSignal }[] = [];

async function fetchJson(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown | undefined> {
  try {
    const response = await fetch(url, {
      ...(headers !== undefined ? { headers } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function sourceIdToKind(sourceId: string): CatalogSourceSnapshot["sourceKind"] {
  if (sourceId.startsWith("openrouter")) {
    if (sourceId.includes("benchmark")) return "openrouterBenchmarks";
    if (sourceId.includes("ranking")) return "openrouterRankings";
    if (sourceId.includes("task")) return "openrouterTasks";
    return "openrouterModels";
  }
  return "litellmPrices";
}

function retainRaw(sourceId: string, payload: unknown, url: string): void {
  const serialized = JSON.stringify(payload);
  if (values["retain-raw"]) {
    const directory = NodePath.resolve(values["retain-raw"]);
    NodeFS.mkdirSync(directory, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(directory, `${sourceId}.json`), serialized);
  }
  const isOpenRouter = sourceId.startsWith("openrouter");
  snapshots.push({
    sourceId,
    sourceKind: sourceIdToKind(sourceId),
    url,
    retrievedAt: now,
    contentHash: NodeCrypto.createHash("sha256").update(serialized).digest("hex"),
    recordCount: Array.isArray(payload) ? payload.length : 0,
    ...(isOpenRouter ? { license: "CC BY 4.0", citation: "OpenRouter Data API" } : {}),
  });
}

const matches = (source: string) => sourceMatches(CATALOG_SEED.models, source);
const meta = (sourceId: string, url: string): AdapterMeta => ({
  sourceId,
  sourceUrl: url,
  retrievedAt: now,
});

if (!values.offline) {
  const litellm = await fetchJson(LITELLM_PRICES_URL);
  if (litellm !== undefined) {
    retainRaw("litellm.model_prices", litellm, LITELLM_PRICES_URL);
    fetchedObservations.push(
      ...parseLiteLlmPrices(
        litellm,
        matches("litellm"),
        meta("litellm.model_prices", LITELLM_PRICES_URL),
      ),
    );
  } else {
    process.stderr.write("litellm: fetch failed, retaining seed observations\n");
  }

  if (openRouterApiKey !== undefined) {
    const headers = { Authorization: `Bearer ${openRouterApiKey}` };
    const benchmarks = await fetchJson(OPENROUTER_BENCHMARKS_URL, headers);
    if (benchmarks !== undefined) {
      retainRaw("openrouter.benchmarks", benchmarks, OPENROUTER_BENCHMARKS_URL);
      fetchedObservations.push(
        ...parseOpenRouterBenchmarks(
          benchmarks,
          matches("openrouter"),
          meta("openrouter.benchmarks", OPENROUTER_BENCHMARKS_URL),
        ),
      );
    } else {
      process.stderr.write("openrouter benchmarks: fetch failed, retaining seed observations\n");
    }
    const rankings = await fetchJson(OPENROUTER_RANKINGS_URL, headers);
    if (rankings !== undefined) {
      retainRaw("openrouter.rankings", rankings, OPENROUTER_RANKINGS_URL);
      fetchedSignals.push(
        ...parseOpenRouterRankings(
          rankings,
          matches("openrouter"),
          meta("openrouter.rankings", OPENROUTER_RANKINGS_URL),
        ).signals,
      );
    } else {
      process.stderr.write("openrouter rankings: fetch failed, retaining seed observations\n");
    }
  } else {
    process.stderr.write("openrouter: OPENROUTER_API_KEY not set, retaining seed observations\n");
  }
}

const seed = mergeResults(CATALOG_SEED, fetchedObservations, fetchedSignals, snapshots, now);
const catalog = buildCatalog(seed);
NodeFS.mkdirSync(NodePath.dirname(outPath), { recursive: true });
NodeFS.writeFileSync(
  outPath,
  `${JSON.stringify(JSON.parse(encodeModelCatalogSync(catalog)), null, 2)}\n`,
);
process.stdout.write(
  `Wrote ${outPath} (${catalog.models.length} models, ${catalog.observations.length} observations, ${catalog.sourceSnapshots.length} snapshots)\n`,
);

/**
 * Fetched observations replace seed observations for the same metric identity.
 * Fetched adoption signals replace seed signals of the same (metric, window,
 * task); seed observations and signals the refresh did not cover remain.
 */
function mergeResults(
  base: CatalogSeed,
  observations: readonly CatalogObservation[],
  signals: readonly { modelId: string; signal: CatalogAdoptionSignal }[],
  sourceSnapshots: readonly CatalogSourceSnapshot[],
  generatedAt: string,
): CatalogSeed {
  const fetchedIds = new Set(observations.map((observation) => observation.id));
  const retainedObservations = base.observations.filter(
    (observation) => !fetchedIds.has(observation.id),
  );
  const signalsByModel = new Map<string, CatalogAdoptionSignal[]>();
  for (const entry of signals) {
    const list = signalsByModel.get(entry.modelId) ?? [];
    list.push(entry.signal);
    signalsByModel.set(entry.modelId, list);
  }
  const models: SeedModel[] = base.models.map((model) => {
    const fetched = signalsByModel.get(model.id);
    if (fetched === undefined) return model;
    const keys = new Set(fetched.map(signalKey));
    const retained = model.adoptionSignals.filter((signal) => !keys.has(signalKey(signal)));
    return { ...model, adoptionSignals: [...retained, ...fetched] };
  });
  return {
    ...base,
    generatedAt,
    catalogVersion: generatedAt,
    sourceSnapshots: [...sourceSnapshots],
    models,
    observations: [...retainedObservations, ...observations],
  };
}

function signalKey(signal: CatalogAdoptionSignal): string {
  return `${signal.metric}:${signal.window}:${signal.task ?? ""}`;
}
