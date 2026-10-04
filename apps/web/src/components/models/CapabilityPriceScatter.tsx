import { useMemo } from "react";

import { formatBlendedPrice, formatScore } from "@t3tools/shared/modelCatalog";
import type { ModelRow } from "./modelCatalogView";
import { cn } from "../../lib/utils";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 360;
const PAD_LEFT = 52;
const PAD_RIGHT = 20;
const PAD_TOP = 16;
const PAD_BOTTOM = 40;

export interface ScatterPoint {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly capability: number;
  readonly price: number;
}

export interface ScatterLayout {
  readonly points: readonly ScatterPoint[];
  readonly xDomain: { readonly min: number; readonly max: number; readonly log: boolean };
  readonly yDomain: { readonly min: number; readonly max: number };
  readonly excluded: number;
}

/**
 * Lay out models with both a published capability and a blended price.
 * Missing either dimension excludes the point rather than plotting it at zero.
 */
export function buildScatterLayout(rows: readonly ModelRow[]): ScatterLayout {
  const plottable = rows.filter(
    (row): row is ModelRow & { capability: number; blendedPrice: number } =>
      row.capabilityPublished && row.capability !== undefined && row.blendedPrice !== undefined,
  );
  const excluded = rows.length - plottable.length;
  if (plottable.length === 0) {
    return {
      points: [],
      xDomain: { min: 0, max: 1, log: false },
      yDomain: { min: 0, max: 100 },
      excluded,
    };
  }

  const prices = plottable.map((row) => row.blendedPrice).filter((price) => price > 0);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const log = prices.length === plottable.length && minPrice > 0 && maxPrice / minPrice > 50;
  const xDomain = {
    min: log ? minPrice : 0,
    max: maxPrice * 1.02,
    log,
  };

  const capabilityValues = plottable.map((row) => row.capability);
  const yDomain = {
    min: Math.max(0, Math.floor(Math.min(...capabilityValues)) - 2),
    max: Math.ceil(Math.max(...capabilityValues)) + 2,
  };

  const ranks = plottable.map((row) => row.usageRank ?? Number.NaN);
  const definedRanks = ranks.filter((rank) => Number.isFinite(rank));
  const worstRank = definedRanks.length === 0 ? 50 : Math.max(...definedRanks);

  const points = plottable.map((row) => ({
    id: row.model.id,
    name: row.model.canonicalName,
    x: priceToX(row.blendedPrice, xDomain),
    y: capabilityToY(row.capability, yDomain),
    radius:
      row.usageRank === undefined
        ? 4
        : 4 + 5 * (1 - Math.min(row.usageRank, worstRank) / Math.max(worstRank, 1)),
    capability: row.capability,
    price: row.blendedPrice,
  }));

  return { points, xDomain, yDomain, excluded };
}

function priceToX(
  price: number,
  domain: { readonly min: number; readonly max: number; readonly log: boolean },
): number {
  const plotWidth = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
  if (domain.log) {
    const min = Math.log10(Math.max(domain.min, 1e-9));
    const max = Math.log10(Math.max(domain.max, 1e-9));
    return PAD_LEFT + ((Math.log10(price) - min) / (max - min)) * plotWidth;
  }
  return PAD_LEFT + ((price - domain.min) / (domain.max - domain.min)) * plotWidth;
}

function capabilityToY(
  capability: number,
  domain: { readonly min: number; readonly max: number },
): number {
  const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
  return PAD_TOP + (1 - (capability - domain.min) / (domain.max - domain.min)) * plotHeight;
}

/** Evenly spaced ticks across a domain. */
export function tickValues(min: number, max: number, count: number): readonly number[] {
  if (count <= 1) return [min];
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

export function CapabilityPriceScatter({
  rows,
  selectedIds,
}: {
  rows: readonly ModelRow[];
  selectedIds: ReadonlySet<string>;
}) {
  const layout = useMemo(() => buildScatterLayout(rows), [rows]);

  if (layout.points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No models have both a published capability and a blended price.
      </p>
    );
  }

  const yTicks = tickValues(layout.yDomain.min, layout.yDomain.max, 4);
  const xTicks = layout.xDomain.log
    ? tickValues(Math.log10(layout.xDomain.min), Math.log10(layout.xDomain.max), 4).map(
        (value) => 10 ** value,
      )
    : tickValues(layout.xDomain.min, layout.xDomain.max, 4);

  return (
    <div className="flex flex-col gap-2">
      <svg
        className="h-80 w-full text-muted-foreground"
        preserveAspectRatio="none"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      >
        {yTicks.map((tick) => {
          const y = capabilityToY(tick, layout.yDomain);
          return (
            <g key={`y-${tick}`}>
              <line
                className="stroke-border"
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
                x1={PAD_LEFT}
                x2={VIEW_WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
              />
              <text
                className="fill-muted-foreground"
                fontSize={11}
                x={PAD_LEFT - 8}
                y={y + 3}
                textAnchor="end"
              >
                {formatScore(tick)}
              </text>
            </g>
          );
        })}
        {xTicks.map((tick) => {
          const x = priceToX(tick, layout.xDomain);
          return (
            <text
              key={`x-${tick}`}
              className="fill-muted-foreground"
              fontSize={11}
              textAnchor="middle"
              x={x}
              y={VIEW_HEIGHT - PAD_BOTTOM + 16}
            >
              {formatBlendedPrice(tick)}
            </text>
          );
        })}
        <text
          className="fill-muted-foreground"
          fontSize={11}
          textAnchor="middle"
          x={PAD_LEFT + (VIEW_WIDTH - PAD_LEFT - PAD_RIGHT) / 2}
          y={VIEW_HEIGHT - 4}
        >
          Blended price per 1M tokens
        </text>
        {layout.points.map((point) => (
          <circle
            key={point.id}
            className={cn(
              selectedIds.has(point.id) ? "fill-primary" : "fill-muted-foreground/40",
              "stroke-background",
            )}
            cx={point.x}
            cy={point.y}
            r={point.radius}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${point.name} · capability ${formatScore(point.capability)} · ${formatBlendedPrice(point.price)}`}</title>
          </circle>
        ))}
      </svg>
      <p className="text-xs text-muted-foreground">
        Point size encodes OpenRouter usage rank. Capability is frontier-relative and only shown for
        models that meet the coverage rule.
        {layout.excluded > 0 ? ` ${layout.excluded} models omitted for missing evidence.` : ""}
      </p>
    </div>
  );
}
