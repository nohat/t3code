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
  for (const value of ["invalid", "2026-10-06T12:34:56+03:00", ""])
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
