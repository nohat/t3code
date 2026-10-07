import test from "node:test";
import assert from "node:assert/strict";
import { createNativeBuildMetadata } from "./native-build-metadata.ts";
import { aboutMetadata } from "../../apps/desktop/src/app/aboutMetadata.ts";
test("immutable UTC build metadata preserves upstream copyright", () => {
  const info = createNativeBuildMetadata("2026-10-06T12:34:56.000Z");
  assert.deepEqual(info, {
    t3codeBuiltAtUTC: "2026-10-06T12:34:56.000Z",
    t3codeCopyright: "Copyright (c) 2026 T3 Tools Inc.",
  });
  for (const value of [
    "invalid",
    "2026-10-06T12:34:56+03:00",
    "",
    "2026-02-30T12:34:56.000Z",
    "2026-13-01T12:34:56.000Z",
    "2026-10-06T24:00:00.000Z",
    "2026-10-06T12:34:56Z",
  ])
    assert.throws(() => createNativeBuildMetadata(value));
});
test("packaged about identifies artifact rather than development override", () => {
  const fields = aboutMetadata({
    packaged: true,
    version: "wrong",
    commitOverride: "abcdef0",
    embedded: {
      version: "1.0.0",
      t3codeCommitHash: "0123456789abcdef",
      ...createNativeBuildMetadata("2026-10-06T12:34:56.000Z"),
    },
  });
  assert.equal(fields.applicationVersion, "1.0.0");
  assert.equal(fields.version, "0123456789ab");
  assert.equal(fields.credits, "Built (UTC): 2026-10-06T12:34:56.000Z");
  assert.equal(fields.copyright, "Copyright (c) 2026 T3 Tools Inc.");
});
test("legacy metadata is visibly unavailable without invented launch date", () => {
  const fields = aboutMetadata({ packaged: true, version: "1.0.0", commitOverride: "abcdef0" });
  assert.equal(fields.version, "unknown");
  assert.equal(fields.credits, "Build date unavailable");
});

test("mobile immutable identity is offline and missing date stays visible", async () => {
  const { mobileAboutMetadata } =
    await import("../../apps/mobile/src/features/settings/mobileAboutMetadata.ts");
  assert.deepEqual(
    mobileAboutMetadata("2026-10-06T12:34:56.000Z", "Copyright (c) 2026 T3 Tools Inc.", "42"),
    {
      date: "2026-10-06T12:34:56.000Z",
      copyright: "Copyright (c) 2026 T3 Tools Inc.",
      build: "42",
    },
  );
  assert.equal(mobileAboutMetadata(undefined, undefined, null).date, "Build date unavailable");
  assert.equal(mobileAboutMetadata("invalid", undefined, 1).date, "Build date unavailable");
});

test("one build timestamp reaches all native packaging commands without mutating parent", async () => {
  const { nativeBuildEnvironment } = await import("./native-build-metadata.ts");
  const parent = { APP_VARIANT: "preview", T3CODE_BUILD_DATE_UTC: "old" };
  const result = nativeBuildEnvironment(parent, "2026-10-06T12:34:56.000Z");
  assert.equal(result.T3CODE_BUILD_DATE_UTC, "2026-10-06T12:34:56.000Z");
  assert.equal(result.APP_VARIANT, "preview");
  assert.equal(parent.T3CODE_BUILD_DATE_UTC, "old");
  assert.throws(() => nativeBuildEnvironment(parent, "invalid"));
});
