/** Capture once while packaging; never regenerate this value when opening About. */
export function createNativeBuildMetadata(builtAtUTC: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(builtAtUTC) ||
    new Date(builtAtUTC).toISOString() !== builtAtUTC
  ) {
    throw new Error("Native build metadata requires an exact UTC timestamp");
  }
  return { t3codeBuiltAtUTC: builtAtUTC, t3codeCopyright: "Copyright (c) 2026 T3 Tools Inc." };
}
