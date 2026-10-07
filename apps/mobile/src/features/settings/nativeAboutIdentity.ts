export interface NativeAboutIdentity {
  version: string;
  build: string;
  builtAtUTC: string;
  copyright: string;
  variant: string;
}
export function nativeAboutIdentity(_native: NativeAboutIdentity | null) {
  throw new Error("not implemented");
}
