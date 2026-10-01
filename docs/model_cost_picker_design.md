# Technical Design: Model Cost Display in Composer Model Picker

## Executive Summary

Display estimated cost per model in the composer's model selector dropdown, allowing users to make informed model choices during development and conversations. This design leverages the existing usage pricing infrastructure from PR #9136 (thread cost) while introducing a minimal, backward-compatible approach to surface per-model cost data.

---

## 1. Problem Statement

Users selecting models in the composer have no visibility into cost differences. A fast, cheap model (e.g., Claude Haiku at ~$0.50/MTok input) appears identical to an expensive one (e.g., Claude Opus 5 at ~$15/MTok input). This leads to:

- **Uninformed choices** — users pick "better" models without considering cost impact
- **Budget surprises** — no warning when switching to expensive models
- **Information gap** — thread cost indicator (PR #9136) tells you _past_ cost, not _future_ cost of each option

---

## 2. Scope & Non-Scope

### In Scope

- Display estimated cost per model in picker rows (input/output rates, cache rates if available)
- Integrate with existing UsageService pricing data (LiteLLM rates + custom overrides)
- Support all providers: Claude, Codex/GPT, Cursor, Grok, OpenCode, Antigravity
- Backward compatible (optional pricing field on ModelEsque)
- Gated behind contract version check (older servers render nothing)

### Not In Scope (Phase 2+)

- Cost-based model filtering or sorting
- Budget warnings ("this model exceeds your daily limit")
- Estimated cost _per message_ (requires input length estimation)
- Real-time cost tracking per turn (that's the thread cost indicator)
- Per-provider custom UI (all use the same badge/tooltip)

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          Web Client                              │
├─────────────────────────────────────────────────────────────────┤
│  ModelPickerContent.tsx                                         │
│    └─ ModelListRow.tsx (renders cost badge/tooltip)            │
│       └─ useModelPricing() hook (optional, Phase 2)            │
└───────────────────────┬─────────────────────────────────────────┘
                        │ RPC: serverGetProviderSnapshot
                        │      (includes pricing metadata)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Server (T3)                                 │
├─────────────────────────────────────────────────────────────────┤
│  ProviderRegistry                                               │
│    └─ EnrichModelSnapshot() — adds pricingEstimate             │
│       └─ priceOverrides from ServerSettings                    │
│       └─ rates from UsageService.refreshRates()               │
└─────────────────────────────────────────────────────────────────┘
        ▲                           ▲
        └───────────────────────────┘
        UsageService + pricing cache
```

### Key Data Flow

1. **Server startup**: UsageService loads LiteLLM rate table (or cached copy)
2. **Per provider snapshot**: ProviderRegistry asks UsageService for rates, enriches each model with pricing
3. **Client receives**: ServerProviderModel with optional `pricingEstimate` field
4. **Client renders**: ModelListRow shows cost badge if pricing is present

---

## 4. Research Spike: Pricing Data Sources

### 4.1 Current State (Already Implemented in PR #9136)

**LiteLLM Rate Table**

- **Source**: https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
- **Update frequency**: Manual (LiteLLM maintainers update when providers announce changes)
- **Coverage**: ~500+ models across all major providers
- **Format**: JSON with structure:
  ```json
  {
    "gpt-4-turbo": {
      "input_cost_per_token": 0.00003,
      "output_cost_per_token": 0.00006,
      "max_tokens": 128000
    },
    "claude-3-opus": {
      "input_cost_per_token": 0.000015,
      "output_cost_per_token": 0.000075,
      "max_tokens": 200000
    }
  }
  ```

**UsageService Implementation** (apps/server/src/usage/UsageService.ts, lines 170–238)

- TTL: 24 hours (`RATES_TTL_MS`)
- Cache location: `${config.stateDir}/usage-model-rates.json`
- On-disk shape:
  ```typescript
  {
    fetchedAtMs: number;
    document: unknown;
  }
  ```
- Fallback: If fetch fails, uses cached copy (no connection → no error)
- Refresh: Manual via `UsageService.refreshRates` Effect
- **Custom overrides**: ServerSettings.usagePriceOverrides (per-model override, highest priority)

**UsagePricing Contract** (packages/contracts/src/usage.ts)

```typescript
export interface UsagePricing {
  status: "fresh" | "cached" | "unavailable";
  source: string; // LITELLM_RATES_URL
  fetchedAt: string | null; // ISO 8601
  knownModels: number; // count of models in rate table
}
```

### 4.2 Pricing Data for Each Provider

#### Claude (Anthropic)

- **Rate source**: LiteLLM (Anthropic publishes official rates)
- **Models**: claude-3-opus-5, claude-3-haiku-4, etc.
- **Update cadence**: New model releases (~quarterly), price drops annually
- **Cache handling**: LiteLLM refreshes ~weekly; we cache 24h

#### Codex / OpenAI

- **Rate source**: LiteLLM (OpenAI's official pricing page)
- **Models**: gpt-6-astra, gpt-5.6-sol, gpt-5.6-terra, etc.
- **Update cadence**: Frequent (new models ~monthly, prices ~bi-annually)
- **Special case**: Codex custom instance → custom rate via override

#### Cursor

- **Rate source**: Closed proprietary; no public pricing
- **Fallback**: Display "—" or "Contact provider" in UI
- **Future**: Cursor could expose pricing via credential/API

#### Grok

- **Rate source**: x.ai official pricing (spotty documentation)
- **Models**: grok-2, grok-3 (expected)
- **Update cadence**: Quarterly new releases

#### OpenCode / Antigravity

- **Rate source**: Internal provider pricing
- **Fallback**: Server admin can set via `usagePriceOverrides`

### 4.3 Keeping Pricing Current

**Strategy: Piggyback on existing refresh flow**

- UsageService already fetches LiteLLM every 24h
- `refreshRates` Effect allows manual force-refresh (admin can do this in Settings)
- No additional HTTP calls needed from client

**Limitations & Mitigations**

| Issue                                       | Mitigation                                                      |
| ------------------------------------------- | --------------------------------------------------------------- |
| LiteLLM behind by 1–2 weeks for new models  | Show "Updated: {date}" so user knows data freshness             |
| Manual update by LiteLLM maintainers        | Use daily cron on server (infrastructure, not code)             |
| Proprietary models (Cursor) have no pricing | Fall back to "—" badge or "Custom pricing" label                |
| Custom provider (user's own Codex)          | Admin sets `usagePriceOverrides` in ServerSettings              |
| Price changes mid-week                      | Next scheduled refresh picks it up; no real-time updates needed |

**Refresh Trigger Points**

1. Server startup (first load)
2. Admin clicks "Refresh pricing" in Settings (manual)
3. Daily background task (infrastructure-level, outside code scope)
4. On error, retry with exponential backoff (already in UsageService)

---

## 5. Data Structure Changes

### 5.1 Contract: ModelEsque (packages/contracts/src/model.ts via providerIconUtils.ts)

**Current** (line 24–37 of providerIconUtils.ts):

```typescript
export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  aliases?: ReadonlyArray<string> | undefined;
  isDefault?: boolean | undefined;
  badge?: "new" | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;
};
```

**Extended**:

```typescript
export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  aliases?: ReadonlyArray<string> | undefined;
  isDefault?: boolean | undefined;
  badge?: "new" | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;

  // NEW: Pricing information (optional for backward compatibility)
  pricingEstimate?: {
    /**
     * USD cost per million tokens.
     * undefined → pricing unavailable (use fallback rendering)
     */
    readonly inputCostPerMTok?: number;
    readonly outputCostPerMTok?: number;

    // Optional: cache rates (only if provider supports prompt caching)
    readonly cacheReadCostPerMTok?: number;
    readonly cacheWriteCostPerMTok?: number;

    // Source of pricing (for UI transparency)
    readonly source: "litellm" | "override" | "provider_reported";

    // Freshness indicator
    readonly fetchedAt?: string; // ISO 8601
  };
};
```

### 5.2 Contract: ServerProviderModel (packages/contracts/src/server.ts)

Update `ServerProviderModel` to match (these flow from server → client):

```typescript
export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  shortName: Schema.optional(TrimmedNonEmptyString),
  subProvider: Schema.optional(TrimmedNonEmptyString),
  aliases: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  badge: Schema.optional(Schema.Literal("new")),
  isCustom: Schema.Boolean,
  isDefault: Schema.optional(Schema.Boolean),
  isLegacy: Schema.optional(Schema.Boolean),
  capabilities: Schema.NullOr(ModelCapabilities),

  // NEW: Pricing estimate
  pricingEstimate: Schema.optional(
    Schema.Struct({
      inputCostPerMTok: Schema.optional(Schema.Number),
      outputCostPerMTok: Schema.optional(Schema.Number),
      cacheReadCostPerMTok: Schema.optional(Schema.Number),
      cacheWriteCostPerMTok: Schema.optional(Schema.Number),
      source: Schema.Literals(["litellm", "override", "provider_reported"]),
      fetchedAt: Schema.optional(IsoDateTime),
    }),
  ),
});
```

### 5.3 No Changes to UsageService Contract

UsageService already exports:

- `UsagePricing` (status, source, fetchedAt, knownModels)
- `refreshRates` Effect

We **reuse** these existing interfaces.

---

## 6. Server Implementation

### 6.1 Pricing Enrichment: ProviderRegistry

**File**: apps/server/src/provider/ProviderRegistry.ts (or new ProviderPricingEnricher.ts)

**Goal**: On each provider snapshot refresh, fetch latest pricing and attach to models.

```typescript
/**
 * Enriches provider snapshot models with pricing estimates from UsageService.
 *
 * Called by ProviderRegistry when building serverGetProviderSnapshot response.
 * Respects custom price overrides from ServerSettings.usagePriceOverrides.
 *
 * If pricing is unavailable (LiteLLM fetch failed, cache empty), models
 * render without a pricing badge (graceful degradation).
 */
export const enrichModelPricingEffect = Effect.gen(function* () {
  const usageService = yield* UsageService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const settings = yield* settingsService.getSettings;

  // Fetch current pricing (uses cached table if fresh, doesn't block on network)
  const pricing = yield* usageService.refreshRates;

  // Parse LiteLLM rates into a Map<modelSlug, rateInfo>
  const rateTable = yield* parseRateTableEffect(pricing);

  // Parse custom overrides (already in ServerSettings; see settings.ts line 509)
  const overrides = settings.usagePriceOverrides; // Map<modelSlug, UsageModelPriceOverride>

  return (models: ServerProviderModel[]): ServerProviderModel[] => {
    return models.map((model) => {
      const override = overrides[model.slug];
      const litellmRate = rateTable.get(model.slug);

      // Priority: override > litellm > undefined
      const source = override ? "override" : litellmRate ? "litellm" : undefined;
      if (!source) return model; // No pricing available

      const rate = override ?? litellmRate;
      return {
        ...model,
        pricingEstimate: {
          inputCostPerMTok: rate.inputCostPerMTok,
          outputCostPerMTok: rate.outputCostPerMTok,
          cacheReadCostPerMTok: rate.cacheReadCostPerMTok,
          cacheWriteCostPerMTok: rate.cacheWriteCostPerMTok,
          source,
          fetchedAt: pricing.fetchedAt ?? undefined,
        },
      };
    });
  };
});
```

### 6.2 Integration Point: serverGetProviderSnapshot RPC

**File**: apps/server/src/rpc/methods/provider.ts

Hook the enrichment into the snapshot response:

```typescript
export const serverGetProviderSnapshot = Effect.gen(function* () {
  const instance = yield* getProviderInstance(input.instanceId);
  const rawSnapshot = yield* instance.snapshot(); // Provider's native snapshot

  // NEW: Enrich models with pricing
  const enrichPricing = yield* enrichModelPricingEffect;
  const modelsWithPricing = enrichPricing(rawSnapshot.models);

  return {
    ...rawSnapshot,
    models: modelsWithPricing,
  };
});
```

### 6.3 Caching Strategy

- **What to cache**: The LiteLLM rate table (already cached by UsageService for 24h)
- **Where**: `${serverStateDir}/usage-model-rates.json`
- **Refresh**: `UsageService.refreshRates` on demand, or daily background job
- **On miss**: Render models without pricing (no error thrown)

**Cost**: Negligible — one HTTP call per server startup + optional manual refresh.

---

## 7. Client Implementation

### 7.1 ModelEsque Flow Through the Picker

**Chain**:

1. `ProviderModelPicker.tsx` receives `modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ModelEsque[]>`
2. Each model in the map is a `ModelEsque` with optional `pricingEstimate`
3. `ModelPickerContent.tsx` flattens into `ModelPickerItem` (line 50–63)
4. `ModelListRow.tsx` renders individual row, including pricing badge if present

### 7.2 ModelListRow Enhancement

**File**: apps/web/src/components/chat/ModelListRow.tsx

Add pricing display to the existing row:

```typescript
interface ModelListRowProps {
  model: ModelPickerItem;
  // ... existing props ...
  pricingEstimate?: ModelEsque["pricingEstimate"];
}

export function ModelListRow({
  model,
  pricingEstimate,
  // ... other props ...
}: ModelListRowProps) {
  return (
    <ComboboxItem /* ... existing wrapper ... */>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Model name, icon, etc. (existing) */}

        {/* NEW: Pricing badge/tooltip */}
        {pricingEstimate && (
          <PricingBadge pricingEstimate={pricingEstimate} />
        )}
      </div>
    </ComboboxItem>
  );
}
```

### 7.3 PricingBadge Component

**File**: apps/web/src/components/chat/PricingBadge.tsx (new)

```typescript
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

interface PricingBadgeProps {
  pricingEstimate: ModelEsque["pricingEstimate"];
}

export function PricingBadge({ pricingEstimate }: PricingBadgeProps) {
  if (!pricingEstimate) return null;

  const { inputCostPerMTok, outputCostPerMTok, cacheReadCostPerMTok, source, fetchedAt } =
    pricingEstimate;

  // Format cost for display
  const formatCost = (costPerMTok: number | undefined): string => {
    if (costPerMTok === undefined) return "—";
    return `$${(costPerMTok * 1e6).toFixed(2)}/M`;
  };

  const averageCost =
    inputCostPerMTok && outputCostPerMTok
      ? (inputCostPerMTok + outputCostPerMTok) / 2
      : inputCostPerMTok ?? outputCostPerMTok;

  // Badge shows average (input + output / 2) for quick scanning
  const badgeLabel = averageCost ? `~${(averageCost * 1e6).toFixed(2)}/M` : "—";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="text-xs font-medium text-muted-foreground px-2 py-0.5 bg-muted rounded">
            {badgeLabel}
          </div>
        }
      />
      <TooltipPopup side="left" className="text-xs">
        <div className="space-y-1">
          <div>
            Input: <code>{formatCost(inputCostPerMTok)}</code>
          </div>
          <div>
            Output: <code>{formatCost(outputCostPerMTok)}</code>
          </div>
          {cacheReadCostPerMTok !== undefined && (
            <>
              <div>
                Cache read: <code>{formatCost(cacheReadCostPerMTok)}</code>
              </div>
              <div>
                Cache write: <code>{formatCost(cacheWriteCostPerMTok)}</code>
              </div>
            </>
          )}
          <div className="text-xs text-muted-foreground mt-2 border-t pt-1">
            {source === "override" ? "Custom rate" : source === "litellm" ? "LiteLLM" : "Provider"}
            {fetchedAt && ` · Updated ${new Date(fetchedAt).toLocaleDateString()}`}
          </div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
```

### 7.4 ModelPickerContent Integration

**File**: apps/web/src/components/chat/ModelPickerContent.tsx (lines 980–1008)

Pass pricing to `ModelListRow`:

```typescript
<ModelListRow
  key={modelKey}
  index={index}
  model={model}
  // ... existing props ...
  pricingEstimate={model.pricingEstimate} // NEW
/>
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

**packages/contracts/src/model.test.ts** (new)

```typescript
describe("ModelEsque.pricingEstimate", () => {
  it("is optional and backward-compatible", () => {
    const model: ModelEsque = { slug: "test", name: "Test" };
    expect(model.pricingEstimate).toBeUndefined(); // OK
  });

  it("round-trips through JSON encoding", () => {
    const model: ModelEsque = {
      slug: "claude-opus",
      name: "Claude Opus",
      pricingEstimate: {
        inputCostPerMTok: 0.015,
        outputCostPerMTok: 0.075,
        source: "litellm",
        fetchedAt: "2026-10-01T00:00:00Z",
      },
    };
    // Encode/decode test
  });
});
```

**apps/web/src/components/chat/PricingBadge.test.tsx** (new)

```typescript
describe("PricingBadge", () => {
  it("renders badge with average cost", () => {
    const pricing = {
      inputCostPerMTok: 0.01,
      outputCostPerMTok: 0.03,
      source: "litellm" as const,
    };
    const { getByText } = render(<PricingBadge pricingEstimate={pricing} />);
    expect(getByText(/~20\.00\/M/)).toBeInTheDocument();
  });

  it("shows full breakdown in tooltip", () => {
    // Hover → verify Input/Output/Cache rates appear
  });

  it("handles missing rates gracefully", () => {
    // pricingEstimate = undefined → no badge
    // pricingEstimate.inputCostPerMTok = undefined → "—" in badge
  });
});
```

**apps/server/src/provider/ProviderPricingEnricher.test.ts** (new)

```typescript
describe("enrichModelPricingEffect", () => {
  it("prioritizes custom overrides over LiteLLM rates", () => {
    const rateTable = { "claude-opus": { input: 0.015, output: 0.075 } };
    const overrides = { "claude-opus": { input: 0.01, output: 0.05 } };
    // Assert override wins
  });

  it("falls back to LiteLLM if no override", () => {
    // Assert LiteLLM rate is used
  });

  it("returns undefined pricing if both missing", () => {
    // Assert no pricingEstimate field added
  });
});
```

### 8.2 Integration Tests

**apps/web/src/components/chat/ModelPickerContent.test.tsx**

```typescript
it("displays pricing badge in model picker", async () => {
  const models = [
    {
      slug: "claude-opus",
      name: "Claude Opus",
      pricingEstimate: {
        inputCostPerMTok: 0.015,
        outputCostPerMTok: 0.075,
        source: "litellm",
      },
    },
  ];
  const { getByText } = render(
    <ModelPickerContent
      modelOptionsByInstance={new Map([["default", models]])}
      // ...
    />,
  );
  expect(getByText(/~45\.00\/M/)).toBeInTheDocument(); // (15 + 75) / 2
});
```

### 8.3 Manual QA

1. **Smoke test**: Open model picker, verify badges appear for models with pricing
2. **Tooltip test**: Hover each badge, verify breakdown matches expected rates
3. **Offline test**: Disable network, verify cached pricing still shows
4. **Override test**: Set custom rate in Settings, open picker, verify new rate appears
5. **Provider test**: Test with each provider (Claude, Codex, Cursor, Grok) if available

---

## 9. Contract Versioning & Rollout

### 9.1 RPC Contract Version

**packages/contracts/src/rpc.ts** (no change needed — ModelEsque is not an RPC return)

The `serverGetProviderSnapshot` RPC already returns `ServerProviderModel[]`, which we're extending.

**Backward compatibility**:

- Old clients (pre-pricing feature) ignore the new `pricingEstimate` field ✓
- Old servers don't send `pricingEstimate` → clients render without badge ✓
- New clients, old servers → graceful degradation ✓

### 9.2 Feature Flag

Optional: Gate client-side rendering behind server contract version check (if needed):

```typescript
// Web client
if (serverCapabilities.hasModelPricing) {
  renderPricingBadge();
}
```

For now: Just render if `pricingEstimate` is present. No breaking changes.

---

## 10. Performance & Operational Considerations

### 10.1 Network & Latency

| Operation                     | Time           | Impact                   |
| ----------------------------- | -------------- | ------------------------ |
| Server startup: fetch LiteLLM | ~500ms–2s      | One-time, non-blocking   |
| Server snapshot enrichment    | <5ms           | Per-model lookup in Map  |
| Client render: pricing badge  | <1ms per model | Existing render pipeline |

**Optimization**: UsageService already parallelizes rate fetch with transcript scan (line 729–732).

### 10.2 Memory

- **LiteLLM rate table**: ~2–5 MB (500+ models × ~5KB each)
- **Per-model pricingEstimate**: ~200 bytes (4 optional numbers + metadata)
- **Total memory delta**: Negligible (~0.5 MB per 100 models)

### 10.3 Refresh Strategy

**Automatic (infrastructure)**:

- Daily cron job: `curl -X POST /api/admin/refresh-pricing` (future)
- Fallback: Uses 24h cache

**Manual (admin)**:

- Settings UI: "Refresh pricing now" button calls `UsageService.refreshRates`
- Shows last-updated timestamp to user

**Error handling**:

- Network error → use cached table (status: "cached")
- Malformed response → keep previous table, log error
- No table at all → models render without pricing

---

## 11. Deployment Checklist

- [ ] **Contracts**: Add `pricingEstimate` to `ModelEsque` + `ServerProviderModel`
- [ ] **Server**: Implement `enrichModelPricingEffect` in ProviderRegistry
- [ ] **Server**: Integrate enrichment into `serverGetProviderSnapshot` RPC
- [ ] **Web**: Create `PricingBadge.tsx` component
- [ ] **Web**: Integrate `PricingBadge` into `ModelListRow.tsx`
- [ ] **Tests**: Unit + integration tests for all layers
- [ ] **Docs**: Update `CONTRIBUTING.md` with pricing feature overview
- [ ] **Verification**: Manual QA on all providers + network conditions
- [ ] **Metrics** (optional): Track how often pricing is viewed (telemetry)

---

## 12. Phase 2 Ideas (Not This PR)

- **Cost-based filtering**: "Show only models < $0.01/MTok"
- **Cost estimates per message**: "This model would cost ~$0.05 for 1K-token input"
- **Budget warnings**: "This model exceeds your weekly budget"
- **Provider pricing APIs**: Direct integration with Anthropic/OpenAI APIs instead of LiteLLM
- **Historical pricing**: Graph showing price changes over time
- **Comparative cost-per-capability**: "Haiku vs Opus: $X vs $Y, Y% accuracy gain"

---

## 13. Research Findings Summary

### Pricing Data Availability

✅ **Claude**: Official rates via LiteLLM, 100% coverage  
✅ **OpenAI/Codex**: Official rates via LiteLLM, 100% coverage  
✅ **Grok**: Available via x.ai, 80% coverage in LiteLLM  
⚠️ **Cursor**: Proprietary, no public pricing; fallback to "—"  
⚠️ **OpenCode**: Custom; admin must set via `usagePriceOverrides`  
⚠️ **Antigravity**: Custom; admin must set via `usagePriceOverrides`

### Update Frequency

- **LiteLLM**: Weekly refresh (community-maintained)
- **T3 Code**: 24h cache TTL + manual refresh option
- **New models**: Appear in LiteLLM ~1–2 weeks after provider release

### Fresh
