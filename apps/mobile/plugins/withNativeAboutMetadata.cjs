const COPYRIGHT = "Copyright (c) 2026 T3 Tools Inc.";
function metadata(config) {
  const extra = config.extra ?? {};
  const date = extra.t3codeBuiltAtUTC ?? "";
  if (
    date !== "" &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString() !== date)
  ) {
    throw new Error("Native About date must be an exact UTC timestamp");
  }
  const variant = extra.appVariant ?? "production";
  if (!["production", "preview", "development"].includes(variant))
    throw new Error("Invalid native About variant");
  if (extra.t3codeCopyright !== undefined && extra.t3codeCopyright !== COPYRIGHT)
    throw new Error("Native About copyright must preserve the declared notice");
  return { date, variant, copyright: COPYRIGHT };
}
function applyInfoPlist(plist, config) {
  const value = metadata(config);
  Object.assign(plist, {
    T3AboutBuiltAtUTC: value.date,
    T3AboutVariant: value.variant,
    T3AboutCopyright: value.copyright,
  });
  return plist;
}
function applyStrings(strings, config) {
  const value = metadata(config);
  const entries = {
    t3_about_built_at_utc: value.date,
    t3_about_variant: value.variant,
    t3_about_copyright: value.copyright,
  };
  strings.resources ??= {};
  const existing = strings.resources.string ?? [];
  strings.resources.string = [
    ...existing.filter((s) => !Object.hasOwn(entries, s.$?.name)),
    ...Object.entries(entries).map(([name, text]) => ({
      $: { name, translatable: "false" },
      _: text,
    })),
  ];
  return strings;
}
function applyManifest(application, config) {
  metadata(config);
  const names = ["built_at_utc", "variant", "copyright"];
  application["meta-data"] = [
    ...(application["meta-data"] ?? []).filter(
      (item) => !names.some((name) => item.$?.["android:name"] === `t3.about.${name}`),
    ),
    ...names.map((name) => ({
      $: { "android:name": `t3.about.${name}`, "android:value": `@string/t3_about_${name}` },
    })),
  ];
  return application;
}
module.exports = function withNativeAboutMetadata(config) {
  const {
    withInfoPlist,
    withStringsXml,
    withAndroidManifest,
    AndroidConfig,
  } = require("expo/config-plugins");
  config = withInfoPlist(config, (next) => {
    applyInfoPlist(next.modResults, next);
    return next;
  });
  config = withAndroidManifest(config, (next) => {
    applyManifest(AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults), next);
    return next;
  });
  return withStringsXml(config, (next) => {
    applyStrings(next.modResults, next);
    return next;
  });
};
module.exports.applyInfoPlist = applyInfoPlist;
module.exports.applyStrings = applyStrings;

module.exports.applyManifest = applyManifest;
