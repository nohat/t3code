import { describe, expect, it } from "vite-plus/test";

import { resolveSendBlockedReason, resolveSendTargetBlockedReason } from "./sendBlockedReason";

describe("resolveSendBlockedReason", () => {
  it("prefers a lost connection over connecting and the composer reason", () => {
    expect(
      resolveSendBlockedReason({
        environmentUnavailable: true,
        isConnecting: true,
        sendDisabledReason: "Messages loading",
      }),
    ).toBe("Environment disconnected");
  });

  it("prefers connecting over the composer reason", () => {
    expect(
      resolveSendBlockedReason({
        environmentUnavailable: false,
        isConnecting: true,
        sendDisabledReason: "Messages loading",
      }),
    ).toBe("Connecting to the server");
  });

  it("passes the composer reason through, and is silent when there is none", () => {
    const base = { environmentUnavailable: false, isConnecting: false };
    expect(resolveSendBlockedReason({ ...base, sendDisabledReason: "Preparing worktree" })).toBe(
      "Preparing worktree",
    );
    expect(resolveSendBlockedReason({ ...base, sendDisabledReason: null })).toBeNull();
  });
});

describe("resolveSendTargetBlockedReason", () => {
  const base = {
    projectSelectionRequired: false,
    noProviderAvailable: false,
    providerCatalogKnown: true,
  };

  it("is silent when a project and a provider are available", () => {
    expect(resolveSendTargetBlockedReason(base)).toBeNull();
  });

  it("names a missing project ahead of a missing provider", () => {
    expect(
      resolveSendTargetBlockedReason({
        ...base,
        projectSelectionRequired: true,
        noProviderAvailable: true,
      }),
    ).toBe("Choose a project");
  });

  it("names an unavailable provider, but only calls it loading before the catalog arrives", () => {
    expect(resolveSendTargetBlockedReason({ ...base, noProviderAvailable: true })).toBe(
      "Provider unavailable",
    );
    expect(
      resolveSendTargetBlockedReason({
        ...base,
        noProviderAvailable: true,
        providerCatalogKnown: false,
      }),
    ).toBe("Loading providers");
  });
});
