export function aboutMetadata(input: {
  packaged: boolean;
  version: string;
  commitOverride?: string;
  embedded?: {
    version?: string;
    t3codeCommitHash?: string;
    t3codeBuiltAtUTC?: string;
    t3codeCopyright?: string;
  };
}) {
  return {
    applicationVersion: input.version,
    version: input.commitOverride,
    credits: "",
    copyright: "",
  };
}
