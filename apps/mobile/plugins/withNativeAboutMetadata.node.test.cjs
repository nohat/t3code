const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyInfoPlist, applyStrings } = require("./withNativeAboutMetadata.cjs");
const config = {
  extra: {
    appVariant: "preview",
    t3codeBuiltAtUTC: "2026-10-06T12:00:00.000Z",
    t3codeCopyright: "Copyright (c) 2026 T3 Tools Inc.",
  },
};
test("stamps native plist without modifying standard bundle identity", () => {
  const plist = { CFBundleVersion: "42", CFBundleShortVersionString: "1.0.0" };
  applyInfoPlist(plist, config);
  assert.equal(plist.T3AboutBuiltAtUTC, config.extra.t3codeBuiltAtUTC);
  assert.equal(plist.T3AboutVariant, "preview");
  assert.equal(plist.T3AboutCopyright, config.extra.t3codeCopyright);
  assert.equal(plist.CFBundleVersion, "42");
  assert.equal(plist.CFBundleShortVersionString, "1.0.0");
});
test("resource stamping is idempotent and preserves unrelated resources", () => {
  const strings = { resources: { string: [{ $: { name: "app_name" }, _: "T3" }] } };
  applyStrings(strings, config);
  applyStrings(strings, config);
  assert.equal(strings.resources.string.length, 4);
  assert.equal(strings.resources.string[0]._, "T3");
  assert.equal(
    strings.resources.string.find((s) => s.$.name === "t3_about_built_at_utc")._,
    config.extra.t3codeBuiltAtUTC,
  );
});
test("missing date removes a prior stamp rather than inventing or retaining it", () => {
  const plist = { T3AboutBuiltAtUTC: config.extra.t3codeBuiltAtUTC };
  applyInfoPlist(plist, {});
  assert.equal(plist.T3AboutBuiltAtUTC, "");
  const strings = { resources: { string: [{ $: { name: "t3_about_built_at_utc" }, _: "old" }] } };
  applyStrings(strings, {});
  assert.equal(strings.resources.string.find((s) => s.$.name === "t3_about_built_at_utc")._, "");
});
test("malformed date/variant/copyright refuses before mutating native metadata", () => {
  for (const extra of [
    { t3codeBuiltAtUTC: "2026-02-30T12:00:00.000Z" },
    { appVariant: "wrong" },
    { t3codeCopyright: "wrong" },
  ]) {
    const plist = { preserved: true };
    assert.throws(() => applyInfoPlist(plist, { extra }));
    assert.deepEqual(plist, { preserved: true });
    const strings = { resources: { string: [] } };
    assert.throws(() => applyStrings(strings, { extra }));
    assert.deepEqual(strings, { resources: { string: [] } });
  }
});
