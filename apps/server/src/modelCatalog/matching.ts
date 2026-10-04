/**
 * Source crosswalk matching.
 *
 * Matches retained source records to canonical models through source-qualified
 * aliases. Exact keys are preferred, then a normalized fallback, then a
 * variant-stripped fallback (publishers append release dates and variant
 * suffixes such as `-20260921` or `:free`). A fallback tier only applies when
 * its key is unambiguous, so two distinct models never silently collapse.
 *
 * @module modelCatalog/matching
 */
const VARIANT_SUFFIX =
  /[-_.](latest|preview|thinking|reasoning|chat|instruct|it|free|alpha|beta|experimental|exp)$/;

/**
 * The model identifier is the last path segment: publishers prefix it with a
 * routed provider, a maker, or both (`openrouter/anthropic/claude-sonnet-4-5`).
 */
function lastSegment(value: string): string {
  const parts = value.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? value;
}

/** Lowercase, take the model segment, drop tags, strip separators. */
export function normalizeKey(value: string): string {
  return lastSegment(value.toLowerCase())
    .replace(/[:@].*$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Like `normalizeKey`, but also strips trailing release dates and variant suffixes. */
export function normalizeBaseKey(value: string): string {
  let result = lastSegment(value.toLowerCase()).replace(/[:@].*$/, "");
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result
      .replace(/[-_.]\d{8}$/, "")
      .replace(/[-_.]\d{4}-\d{2}-\d{2}$/, "")
      .replace(VARIANT_SUFFIX, "");
  }
  return result.replace(/[^a-z0-9]+/g, "");
}

export interface SourceIndex<T> {
  readonly byExact: ReadonlyMap<string, T>;
  readonly byNormalized: ReadonlyMap<string, T>;
  readonly byNormalizedBase: ReadonlyMap<string, T>;
}

function uniqueIndex<T>(
  entries: readonly (readonly [string, T])[],
  build: (key: string) => string,
): Map<string, T> {
  // Ambiguity is per distinct target, not per entry: many aliases of the same
  // model must not make its own normalized key look ambiguous.
  const valuesByKey = new Map<string, Set<T>>();
  for (const [rawKey, value] of entries) {
    const key = build(rawKey);
    if (key.length === 0) continue;
    const values = valuesByKey.get(key) ?? new Set<T>();
    values.add(value);
    valuesByKey.set(key, values);
  }
  const result = new Map<string, T>();
  for (const [key, values] of valuesByKey) {
    if (values.size === 1) {
      const only = values.values().next();
      if (!only.done) result.set(key, only.value);
    }
  }
  return result;
}

export function buildSourceIndex<T>(entries: Iterable<readonly [string, T]>): SourceIndex<T> {
  const list = [...entries];
  return {
    byExact: new Map(list.map(([key, value]) => [key.toLowerCase(), value])),
    byNormalized: uniqueIndex(list, normalizeKey),
    byNormalizedBase: uniqueIndex(list, normalizeBaseKey),
  };
}

export function matchSource<T>(
  candidates: readonly string[],
  index: SourceIndex<T>,
): { readonly key: string; readonly value: T } | undefined {
  for (const candidate of candidates) {
    const value = index.byExact.get(candidate.toLowerCase());
    if (value !== undefined) return { key: candidate, value };
  }
  for (const candidate of candidates) {
    const value = index.byNormalized.get(normalizeKey(candidate));
    if (value !== undefined) return { key: candidate, value };
  }
  for (const candidate of candidates) {
    const value = index.byNormalizedBase.get(normalizeBaseKey(candidate));
    if (value !== undefined) return { key: candidate, value };
  }
  return undefined;
}
