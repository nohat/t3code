/**
 * Provider-inventory to catalog-seed builder.
 *
 * The running server persists a snapshot per provider instance under
 * `<stateDir>/caches/<instanceId>.json`. This module turns those snapshots into
 * canonical catalog records: it derives a maker-qualified id, merges the same
 * underlying model offered by multiple instances into one record with several
 * offers, and keeps every source-qualified alias for crosswalking.
 *
 * It is pure: the caller reads files. Custom (private) models are excluded, and
 * every model keeps explicit aliases rather than joining on display names.
 *
 * @module modelCatalog/inventory
 */
import type { CatalogAlias, CatalogMaker, CatalogServingProvider } from "@t3tools/contracts";

import type { SeedModel, SeedOffer } from "./seedTypes.ts";

export interface InventoryModel {
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly isCustom: boolean;
  readonly isDefault: boolean;
  readonly isLegacy: boolean;
}

export interface ProviderInventory {
  readonly instanceId: string;
  readonly driver: string;
  readonly displayName: string;
  readonly models: readonly InventoryModel[];
}

/** Parse one persisted provider snapshot, defensively. */
export function parseProviderInventory(raw: unknown): ProviderInventory | undefined {
  if (!isRecord(raw)) return undefined;
  const instanceId = raw.instanceId;
  const driver = raw.driver;
  if (typeof instanceId !== "string" || typeof driver !== "string") return undefined;
  if (!Array.isArray(raw.models)) return undefined;
  const models: InventoryModel[] = [];
  for (const entry of raw.models) {
    const model = parseInventoryModel(entry);
    if (model !== undefined) models.push(model);
  }
  const displayName = typeof raw.displayName === "string" ? raw.displayName : driver;
  return { instanceId, driver, displayName, models };
}

function parseInventoryModel(raw: unknown): InventoryModel | undefined {
  if (!isRecord(raw)) return undefined;
  const slug = raw.slug;
  if (typeof slug !== "string" || slug.length === 0) return undefined;
  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : slug;
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter((value): value is string => typeof value === "string")
    : [];
  return {
    slug,
    name,
    aliases,
    isCustom: raw.isCustom === true,
    isDefault: raw.isDefault === true,
    isLegacy: raw.isLegacy === true,
  };
}

const ROUTING_PREFIXES = new Set(["openrouter", "opencode", "t3", "chat"]);

const DRIVER_MAKERS: Readonly<Record<string, string>> = {
  codex: "openai",
  claudeAgent: "anthropic",
  grok: "xai",
  antigravity: "google",
  cursor: "cursor",
};

const MAKER_ALIASES: Readonly<Record<string, string>> = {
  mistralai: "mistral",
  "x-ai": "xai",
  "meta-llama": "meta",
  qwen: "alibaba",
  moonshotai: "moonshot",
  "z-ai": "zhipu",
  "01-ai": "01ai",
  "amazon-bedrock": "amazon",
};

const MAKER_NAMES: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  xai: "xAI",
  alibaba: "Alibaba",
  cohere: "Cohere",
  microsoft: "Microsoft",
  amazon: "Amazon",
  nvidia: "NVIDIA",
  moonshot: "Moonshot",
  zhipu: "Zhipu",
  minimax: "MiniMax",
  baidu: "Baidu",
  bytedance: "ByteDance",
  perplexity: "Perplexity",
  cursor: "Cursor",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  unknown: "Unknown",
};

const NAME_PREFIX_MAKERS: readonly (readonly [string, string])[] = [
  ["claude", "anthropic"],
  ["gpt", "openai"],
  ["o1", "openai"],
  ["o3", "openai"],
  ["o4", "openai"],
  ["gemini", "google"],
  ["gemma", "google"],
  ["palm", "google"],
  ["grok", "xai"],
  ["llama", "meta"],
  ["mixtral", "mistral"],
  ["mistral", "mistral"],
  ["magistral", "mistral"],
  ["codestral", "mistral"],
  ["devstral", "mistral"],
  ["deepseek", "deepseek"],
  ["qwen", "alibaba"],
  ["phi", "microsoft"],
  ["command", "cohere"],
  ["nova", "amazon"],
  ["kimi", "moonshot"],
  ["glm", "zhipu"],
  ["minimax", "minimax"],
  ["ernie", "baidu"],
  ["doubao", "bytedance"],
  ["seed", "bytedance"],
  ["solar", "upstage"],
  ["sonar", "perplexity"],
  ["composer", "cursor"],
];

const FIRST_PARTY_DRIVERS = new Set(["codex", "claudeAgent", "grok", "antigravity"]);

export interface InventorySeedParts {
  readonly makers: readonly CatalogMaker[];
  readonly servingProviders: readonly CatalogServingProvider[];
  readonly models: readonly SeedModel[];
  /** Candidate source keys per canonical model id, for crosswalk matching. */
  readonly candidates: ReadonlyMap<string, readonly string[]>;
}

export function buildInventorySeed(inventories: readonly ProviderInventory[]): InventorySeedParts {
  interface Accumulator {
    readonly model: {
      readonly id: string;
      canonicalName: string;
      readonly modelName: string;
      readonly makerId: string;
      readonly aliases: CatalogAlias[];
      readonly offers: SeedOffer[];
      primaryOfferId?: string;
    };
    readonly candidates: Set<string>;
    preferred: boolean;
  }

  const accumulators = new Map<string, Accumulator>();
  const makersUsed = new Set<string>();
  const providersById = new Map<string, CatalogServingProvider>();

  for (const inventory of inventories) {
    const kind: CatalogServingProvider["kind"] =
      inventory.driver === "opencode" || inventory.driver === "cursor"
        ? "aggregator"
        : "makerDirect";
    providersById.set(inventory.instanceId, {
      id: inventory.instanceId,
      name: inventory.displayName,
      kind,
    });

    for (const item of inventory.models) {
      if (item.isCustom) continue;
      const { makerId, modelName } = resolveIdentity(inventory.driver, item.slug);
      const id = `${makerId}/${modelName}`;
      makersUsed.add(makerId);

      let accumulator = accumulators.get(id);
      if (accumulator === undefined) {
        accumulator = {
          model: {
            id,
            canonicalName: item.name,
            modelName,
            makerId,
            aliases: [],
            offers: [],
          },
          candidates: new Set(),
          preferred: false,
        };
        accumulators.set(id, accumulator);
      } else if (FIRST_PARTY_DRIVERS.has(inventory.driver)) {
        accumulator.model.canonicalName = item.name;
      }

      addAlias(accumulator.model.aliases, inventory.driver, item.slug);
      for (const alias of item.aliases)
        addAlias(accumulator.model.aliases, inventory.driver, alias);
      for (const candidate of [item.slug, modelName, ...item.aliases]) {
        accumulator.candidates.add(candidate);
      }

      const offerId = `${inventory.instanceId}:${slugFragment(item.slug)}`;
      accumulator.model.offers.push({
        id: offerId,
        servingProviderId: inventory.instanceId,
        label: inventory.displayName,
        isCanonical: false,
      });
      const preferredHere =
        FIRST_PARTY_DRIVERS.has(inventory.driver) && DRIVER_MAKERS[inventory.driver] === makerId;
      if (accumulator.model.primaryOfferId === undefined) {
        accumulator.model.primaryOfferId = offerId;
        accumulator.preferred = preferredHere;
      } else if (preferredHere && !accumulator.preferred) {
        accumulator.model.primaryOfferId = offerId;
        accumulator.preferred = true;
      }
    }
  }

  const makers: CatalogMaker[] = [...makersUsed].sort().map((id) => ({
    id,
    name: MAKER_NAMES[id] ?? titleCase(id),
  }));

  const models: SeedModel[] = [];
  const candidates = new Map<string, readonly string[]>();
  for (const accumulator of accumulators.values()) {
    const primary = accumulator.model.primaryOfferId;
    const offers = accumulator.model.offers.map((offer) => ({
      ...offer,
      isCanonical: offer.id === primary,
    }));
    models.push({
      id: accumulator.model.id,
      canonicalName: accumulator.model.canonicalName,
      familyId: accumulator.model.modelName,
      makerId: accumulator.model.makerId,
      aliases: accumulator.model.aliases,
      technical: { modalities: ["text"] },
      offers,
      ...(primary !== undefined ? { primaryOfferId: primary } : {}),
      adoptionSignals: [],
    });
    candidates.set(accumulator.model.id, [...accumulator.candidates]);
  }

  return {
    makers,
    servingProviders: [...providersById.values()],
    models,
    candidates,
  };
}

/** Derive a maker-qualified identity from a driver and a raw model slug. */
export function resolveIdentity(
  driver: string,
  slug: string,
): { readonly makerId: string; readonly modelName: string } {
  const segments = stripRouting(segmentsOf(slug));
  const joined = canonicalizeModelName(segments.join("-"));
  const inferred = inferMakerFromName(joined);
  if (segments.length > 1 && inferred === undefined && DRIVER_MAKERS[driver] === undefined) {
    return {
      makerId: normalizeMaker(segments[0] ?? "unknown"),
      modelName: canonicalizeModelName(segments.slice(1).join("-")),
    };
  }
  const makerId =
    inferred ??
    DRIVER_MAKERS[driver] ??
    (segments.length > 1 ? normalizeMaker(segments[0] ?? "unknown") : "unknown");
  return { makerId, modelName: joined };
}

/** Canonical id segment: lowercase, separators collapsed to hyphens. */
function canonicalizeModelName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferMakerFromName(name: string): string | undefined {
  const lower = name.toLowerCase();
  const match = NAME_PREFIX_MAKERS.find(([prefix]) => lower.startsWith(prefix));
  return match?.[1];
}

function segmentsOf(slug: string): string[] {
  return slug.split("/").filter((segment) => segment.length > 0);
}

function stripRouting(segments: readonly string[]): string[] {
  const result = [...segments];
  while (result.length > 1 && ROUTING_PREFIXES.has((result[0] ?? "").toLowerCase())) {
    result.shift();
  }
  return result;
}

function normalizeMaker(value: string): string {
  const lower = value.toLowerCase();
  return MAKER_ALIASES[lower] ?? lower;
}

function addAlias(aliases: CatalogAlias[], source: string, sourceId: string): void {
  if (sourceId.length === 0) return;
  if (aliases.some((alias) => alias.source === source && alias.sourceId === sourceId)) return;
  aliases.push({ source, sourceId });
}

function slugFragment(value: string): string {
  return value.replace(/[^A-Za-z0-9._/-]+/g, "-");
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
