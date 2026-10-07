import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeAboutIdentity } from "./nativeAboutIdentity.ts";
const native = {
  version: "1.0.0",
  build: "42",
  builtAtUTC: "2026-10-06T12:00:00.000Z",
  copyright: "Copyright (c) 2026 T3 Tools Inc.",
  variant: "preview",
};
test("About identity is derived exclusively from native bundle metadata", () => {
  const value = nativeAboutIdentity(native);
  assert.equal(value.version, "1.0.0");
  assert.equal(value.build, "42");
  assert.equal(value.date, native.builtAtUTC);
  assert.equal(value.variant, "preview");
  assert.equal(value.copyright, native.copyright);
  // Changing the OTA/dev manifest cannot change the function's native-only input.
  const manifests = [
    { version: "OTA", extra: { t3codeBuiltAtUTC: "2099-01-01T00:00:00.000Z" } },
    {},
  ];
  for (const manifest of manifests) {
    const fixture = { native, manifest };
    assert.deepEqual(nativeAboutIdentity(fixture.native), value);
  }
});
test("legacy native module cannot fall back to manifest identity", () => {
  const value = nativeAboutIdentity(null);
  assert.equal(value.version, "unknown");
  assert.equal(value.build, "unknown");
  assert.equal(value.date, "Build date unavailable");
  assert.equal(value.variant, "unknown");
});
test("malformed native stamp stays unavailable and unknown variant stays unknown", () => {
  const value = nativeAboutIdentity({
    ...native,
    builtAtUTC: "2026-02-30T12:00:00.000Z",
    variant: "arbitrary",
  });
  assert.equal(value.date, "Build date unavailable");
  assert.equal(value.variant, "unknown");
});
