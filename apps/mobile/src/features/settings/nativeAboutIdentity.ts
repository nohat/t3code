import { mobileAboutMetadata } from "./mobileAboutMetadata.ts";

export interface NativeAboutIdentity {
  version: string;
  build: string;
  builtAtUTC: string;
  copyright: string;
  variant: string;
}
export function nativeAboutIdentity(native: NativeAboutIdentity | null) {
  return {
    ...mobileAboutMetadata(
      native?.builtAtUTC,
      native?.copyright || undefined,
      native?.build || null,
    ),
    version: native?.version || "unknown",
    variant:
      native !== null && ["production", "preview", "development"].includes(native.variant)
        ? native.variant
        : "unknown",
  };
}
