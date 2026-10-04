import { expect, it } from "@effect/vitest";

import { openCodeSnapshotRefreshOptions } from "./OpenCodeDriver.ts";

it("re-probes a local OpenCode server on settings changes and the health interval", () => {
  const options = openCodeSnapshotRefreshOptions("");
  expect(options.refreshOnInterval).toBe(true);
  expect(options.checkProviderOnSettingsChange).toBeUndefined();
});

it("does not poll an external OpenCode server", () => {
  const options = openCodeSnapshotRefreshOptions("https://remote.example");
  expect(options.refreshOnInterval).toBe(false);
  expect(options.checkProviderOnSettingsChange?.()).toBe(false);
});
