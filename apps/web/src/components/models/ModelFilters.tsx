import type { ReactNode } from "react";
import type { BenchmarkFamily, CatalogMaker, CatalogServingProvider } from "@t3tools/contracts";
import { SearchIcon } from "lucide-react";

import { BENCHMARK_FAMILY_LABELS, formatContextWindow } from "@t3tools/shared/modelCatalog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { cn } from "../../lib/utils";
import { CAPABILITY_BAND_LABELS, FEATURE_LABELS, RECENCY_LABELS } from "./modelCatalogDisplay";
import {
  EMPTY_FILTERS,
  type CapabilityBand,
  type FeatureFilter,
  type ModelFilters,
} from "./modelCatalogView";
import type { RecencyBucket } from "@t3tools/shared/modelCatalog";

const PRICE_PRESETS: readonly {
  readonly label: string;
  readonly min: number;
  readonly max: number;
}[] = [
  { label: "Under $0.50", min: 0, max: 0.5 },
  { label: "$0.50–$2", min: 0.5, max: 2 },
  { label: "$2–$5", min: 2, max: 5 },
  { label: "Over $5", min: 5, max: Number.POSITIVE_INFINITY },
];

const CAPABILITY_BANDS: readonly CapabilityBand[] = [
  "ge90",
  "80to89",
  "70to79",
  "lt70",
  "unpublished",
];

const FEATURES: readonly FeatureFilter[] = [
  "images",
  "tools",
  "structuredOutput",
  "reasoningControl",
  "openWeights",
];

const RECENCY: readonly RecencyBucket[] = ["lastMonth", "last3Months", "lastYear", "older"];

interface ModelFiltersProps {
  readonly filters: ModelFilters;
  readonly makers: readonly CatalogMaker[];
  readonly servingProviders: readonly CatalogServingProvider[];
  readonly specializationFamilies: readonly BenchmarkFamily[];
  readonly onChange: (filters: ModelFilters) => void;
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function FilterPopover({
  label,
  activeCount,
  children,
}: {
  label: string;
  activeCount: number;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant={activeCount > 0 ? "secondary" : "outline"} size="sm" />}
      >
        {label}
        {activeCount > 0 ? ` (${activeCount})` : ""}
      </PopoverTrigger>
      <PopoverPopup width="sm" align="start" padding="compact">
        {children}
      </PopoverPopup>
    </Popover>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted/50">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="flex-1">{label}</span>
    </label>
  );
}

export function ModelFiltersBar({
  filters,
  makers,
  servingProviders,
  specializationFamilies,
  onChange,
}: ModelFiltersProps) {
  const set = (patch: Partial<ModelFilters>) => onChange({ ...filters, ...patch });
  const hasFilters =
    filters.query.length > 0 ||
    filters.makerIds.length > 0 ||
    filters.servingProviderIds.length > 0 ||
    filters.capabilityBands.length > 0 ||
    filters.priceMin !== undefined ||
    filters.priceMax !== undefined ||
    filters.priceAvailableOnly ||
    filters.contextMin !== undefined ||
    filters.features.length > 0 ||
    filters.specializationFamilies.length > 0 ||
    filters.recency.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="min-w-56 flex-1">
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          size="sm"
          placeholder="Search models, makers, aliases…"
          aria-label="Search models"
          value={filters.query}
          onChange={(event) => set({ query: event.currentTarget.value })}
        />
      </InputGroup>

      <FilterPopover label="Maker" activeCount={filters.makerIds.length}>
        {makers.map((maker) => (
          <CheckRow
            key={maker.id}
            label={maker.name}
            checked={filters.makerIds.includes(maker.id)}
            onToggle={() => set({ makerIds: toggle(filters.makerIds, maker.id) })}
          />
        ))}
      </FilterPopover>

      <FilterPopover label="Provider" activeCount={filters.servingProviderIds.length}>
        {servingProviders.map((provider) => (
          <CheckRow
            key={provider.id}
            label={provider.name}
            checked={filters.servingProviderIds.includes(provider.id)}
            onToggle={() =>
              set({ servingProviderIds: toggle(filters.servingProviderIds, provider.id) })
            }
          />
        ))}
      </FilterPopover>

      <FilterPopover label="Capability" activeCount={filters.capabilityBands.length}>
        {CAPABILITY_BANDS.map((band) => (
          <CheckRow
            key={band}
            label={CAPABILITY_BAND_LABELS[band]}
            checked={filters.capabilityBands.includes(band)}
            onToggle={() => set({ capabilityBands: toggle(filters.capabilityBands, band) })}
          />
        ))}
      </FilterPopover>

      <FilterPopover
        label="Price"
        activeCount={
          (filters.priceMin !== undefined ? 1 : 0) +
          (filters.priceMax !== undefined ? 1 : 0) +
          (filters.priceAvailableOnly ? 1 : 0)
        }
      >
        <div className="flex flex-col gap-1 px-1 py-1">
          {PRICE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={cn(
                "rounded px-1 py-1.5 text-left text-sm hover:bg-muted/50",
                filters.priceMin === preset.min &&
                  filters.priceMax === preset.max &&
                  "bg-muted text-foreground",
              )}
              onClick={() =>
                set({
                  priceMin: preset.min,
                  priceMax: Number.isFinite(preset.max) ? preset.max : undefined,
                })
              }
            >
              {preset.label}
            </button>
          ))}
          <CheckRow
            label="Price available only"
            checked={filters.priceAvailableOnly}
            onToggle={() => set({ priceAvailableOnly: !filters.priceAvailableOnly })}
          />
          <button
            type="button"
            className="rounded px-1 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/50"
            onClick={() => set({ priceMin: undefined, priceMax: undefined })}
          >
            Any price
          </button>
        </div>
      </FilterPopover>

      <FilterPopover label="Features" activeCount={filters.features.length}>
        {FEATURES.map((feature) => (
          <CheckRow
            key={feature}
            label={FEATURE_LABELS[feature]}
            checked={filters.features.includes(feature)}
            onToggle={() => set({ features: toggle(filters.features, feature) })}
          />
        ))}
      </FilterPopover>

      <FilterPopover label="Specialization" activeCount={filters.specializationFamilies.length}>
        {specializationFamilies.map((family) => (
          <CheckRow
            key={family}
            label={BENCHMARK_FAMILY_LABELS[family]}
            checked={filters.specializationFamilies.includes(family)}
            onToggle={() =>
              set({ specializationFamilies: toggle(filters.specializationFamilies, family) })
            }
          />
        ))}
      </FilterPopover>

      <FilterPopover label="Recency" activeCount={filters.recency.length}>
        {RECENCY.map((bucket) => (
          <CheckRow
            key={bucket}
            label={RECENCY_LABELS[bucket]}
            checked={filters.recency.includes(bucket)}
            onToggle={() => set({ recency: toggle(filters.recency, bucket) })}
          />
        ))}
      </FilterPopover>

      <Select
        value={filters.contextMin === undefined ? "any" : String(filters.contextMin)}
        onValueChange={(value) => set({ contextMin: value === "any" ? undefined : Number(value) })}
      >
        <SelectTrigger size="sm">
          <SelectValue>
            {filters.contextMin === undefined
              ? "Any context"
              : `≥ ${formatContextWindow(filters.contextMin)}`}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem value="any">Any context</SelectItem>
          <SelectItem value="128000">≥ 128K</SelectItem>
          <SelectItem value="200000">≥ 200K</SelectItem>
          <SelectItem value="1000000">≥ 1M</SelectItem>
        </SelectPopup>
      </Select>

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}
