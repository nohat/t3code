import { describe, expect, it } from "vite-plus/test";

import { resolveSendBlockedReason } from "./sendBlockedReason";

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
