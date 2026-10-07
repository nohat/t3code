export function mobileAboutMetadata(
  builtAtUTC: string | undefined,
  copyright: string | undefined,
  build: string | number | null | undefined,
) {
  const validDate =
    builtAtUTC !== undefined &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(builtAtUTC) &&
    Number.isFinite(Date.parse(builtAtUTC)) &&
    new Date(builtAtUTC).toISOString() === builtAtUTC;
  return {
    date: validDate ? builtAtUTC : "Build date unavailable",
    copyright:
      copyright ??
      "Copyright (c) 2026 T3 Tools Inc. Fork modifications copyright (c) 2026 David Friedland.",
    build: build == null ? "unknown" : String(build),
  };
}
