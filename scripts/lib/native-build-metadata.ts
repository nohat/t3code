import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

/** Calendar rollover such as February 30 parses, but formats back as a different instant. */
function isExactUtcTimestamp(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Option.exists(DateTime.make(value), (parsed) => DateTime.formatIso(parsed) === value)
  );
}

/** Capture once while packaging; never regenerate this value when opening About. */
export function createNativeBuildMetadata(builtAtUTC: string) {
  if (!isExactUtcTimestamp(builtAtUTC)) {
    throw new Error("Native build metadata requires an exact UTC timestamp");
  }
  return { t3codeBuiltAtUTC: builtAtUTC, t3codeCopyright: "Copyright (c) 2026 T3 Tools Inc." };
}

export function nativeBuildEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  builtAtUTC: string,
) {
  return {
    ...environment,
    T3CODE_BUILD_DATE_UTC: createNativeBuildMetadata(builtAtUTC).t3codeBuiltAtUTC,
  };
}
