// @effect-diagnostics globalDate:off -- Calendar formatting for published dates and freshness labels; "now" is always passed in.
/**
 * Freshness and recency helpers for the model catalog.
 *
 * "Now" is always injected so these functions stay pure and testable. Freshness
 * describes when data was observed; recency describes when a model was
 * released. Recency is metadata, never a quality signal.
 *
 * @module modelCatalog/freshness
 */
const ABSOLUTE_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  timeZone: "UTC",
});

const MS_PER_DAY = 86_400_000;

/** `Sep 18, 2026`, or `undefined` when the date is absent or unparsable. */
export function formatAbsoluteDate(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return undefined;
  return ABSOLUTE_DATE.format(instant);
}

/** `Sep 2026`, for compact table cells. */
export function formatMonthYear(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return undefined;
  return MONTH_YEAR.format(instant);
}

/** Whole days between `iso` and `nowMs`, or `undefined` when `iso` is unusable. */
export function daysSince(iso: string | undefined, nowMs: number): number | undefined {
  if (iso === undefined) return undefined;
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return undefined;
  return Math.floor((nowMs - instant) / MS_PER_DAY);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A short relative label: `just now`, `12m ago`, `4h ago`, `3d ago`, `2mo ago`, `1y ago`. */
export function formatAge(fromIso: string | undefined, nowMs: number): string | undefined {
  if (fromIso === undefined) return undefined;
  const instant = Date.parse(fromIso);
  if (Number.isNaN(instant)) return undefined;
  const delta = nowMs - instant;
  if (delta < 0) return "just now";
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < MS_PER_DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 30 * MS_PER_DAY) return `${Math.floor(delta / MS_PER_DAY)}d ago`;
  if (delta < 365 * MS_PER_DAY) return `${Math.floor(delta / (30 * MS_PER_DAY))}mo ago`;
  return `${Math.floor(delta / (365 * MS_PER_DAY))}y ago`;
}

export type RecencyBucket = "lastMonth" | "last3Months" | "lastYear" | "older" | "unknown";

/** Coarse recency bucket for the recency filter. */
export function recencyBucket(releasedAt: string | undefined, nowMs: number): RecencyBucket {
  const days = daysSince(releasedAt, nowMs);
  if (days === undefined) return "unknown";
  if (days <= 31) return "lastMonth";
  if (days <= 92) return "last3Months";
  if (days <= 366) return "lastYear";
  return "older";
}

/** Mechanically generated `New` flag from a fixed age threshold. */
export function isNew(releasedAt: string | undefined, nowMs: number, thresholdDays = 60): boolean {
  const days = daysSince(releasedAt, nowMs);
  return days !== undefined && days >= 0 && days <= thresholdDays;
}
