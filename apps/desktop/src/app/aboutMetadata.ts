import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export function aboutMetadata(input: {
  packaged: boolean;
  version: string;
  commitOverride?: string | undefined;
  embedded?:
    | {
        readonly version?: string | undefined;
        readonly t3codeCommitHash?: string | undefined;
        readonly t3codeBuiltAtUTC?: string | undefined;
        readonly t3codeCopyright?: string | undefined;
      }
    | undefined;
}) {
  const commit = input.packaged ? input.embedded?.t3codeCommitHash : input.commitOverride;
  const builtAt = input.embedded?.t3codeBuiltAtUTC;
  const validDate =
    builtAt !== undefined &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(builtAt) &&
    Option.exists(DateTime.make(builtAt), (parsed) => DateTime.formatIso(parsed) === builtAt);
  return {
    applicationVersion: input.packaged ? (input.embedded?.version ?? input.version) : input.version,
    version:
      commit !== undefined && /^[0-9a-f]{7,40}$/i.test(commit.trim())
        ? commit.trim().slice(0, 12).toLowerCase()
        : "unknown",
    credits: validDate ? `Built (UTC): ${builtAt}` : "Build date unavailable",
    copyright:
      input.embedded?.t3codeCopyright ??
      "Copyright (c) 2026 T3 Tools Inc. Fork modifications copyright (c) 2026 David Friedland.",
  };
}
