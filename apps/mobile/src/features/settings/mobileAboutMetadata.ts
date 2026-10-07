export function mobileAboutMetadata(
  builtAtUTC: string | undefined,
  copyright: string | undefined,
  build: string | number | null | undefined,
) {
  return { date: builtAtUTC, copyright: copyright ?? "", build: String(build) };
}
