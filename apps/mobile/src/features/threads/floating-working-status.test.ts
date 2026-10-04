import { describe, expect, it, vi } from "vite-plus/test";

import { connectionFloatingStatus, syncStalledFloatingStatus } from "./floating-working-status";

const status = (
  connectionState: Parameters<typeof connectionFloatingStatus>[0]["connectionState"],
  overrides: {
    connectionError?: string | null;
    connectionFailureKind?: Parameters<typeof connectionFloatingStatus>[0]["connectionFailureKind"];
    environmentLabel?: string | null;
  } = {},
) =>
  connectionFloatingStatus({
    connectionError: overrides.connectionError ?? null,
    connectionState,
    connectionFailureKind: overrides.connectionFailureKind ?? null,
    environmentLabel:
      overrides.environmentLabel === undefined ? "Mac mini" : overrides.environmentLabel,
    onReconnect: () => {},
  });

describe("connectionFloatingStatus", () => {
  it("yields the pill to sync and working state once connected", () => {
    expect(status("connected")).toBeNull();
  });

  it("names the environment it is retrying, and says so only after a failure", () => {
    expect(status("connecting")).toMatchObject({
      tone: "reconnecting",
      label: "Reconnecting to Mac mini...",
    });
    expect(status("reconnecting", { connectionError: "ECONNREFUSED" })).toMatchObject({
      tone: "reconnecting",
      label: "Failed to connect. Retrying Mac mini...",
    });
  });

  it("reports why the environment is unreachable", () => {
    expect(status("offline")).toMatchObject({
      tone: "unavailable",
      label: "You are offline",
    });
    expect(status("available")).toMatchObject({
      tone: "unavailable",
      label: "Mac mini is not connected",
    });
    expect(status("error", { connectionError: "handshake timed out" })).toMatchObject({
      label: "Failed to connect to Mac mini: handshake timed out",
    });
    expect(status("error")).toMatchObject({ label: "Failed to connect to Mac mini" });
  });

  it("gives one actionable sentence when the failure category is known", () => {
    expect(
      status("error", {
        connectionError: "Connection refused",
        connectionFailureKind: "unreachable",
      }),
    ).toMatchObject({
      tone: "unavailable",
      label: "Can't reach Mac mini. Check your network or VPN, then reconnect.",
    });
    expect(
      status("reconnecting", {
        connectionError: "401 Unauthorized",
        connectionFailureKind: "authentication",
      }),
    ).toMatchObject({
      tone: "reconnecting",
      label: "Can't sign in to Mac mini. Reconnect and sign in again.",
    });
    expect(status("unsupported", { connectionFailureKind: "unsupported" })).toMatchObject({
      label: "Client not supported",
    });
  });

  it("falls back to a generic name when the environment has no label", () => {
    expect(status("error", { environmentLabel: null })).toMatchObject({
      label: "Failed to connect to Environment",
    });
  });

  it("carries the reconnect handler so the pill can trigger it", () => {
    const onReconnect = vi.fn();
    const pill = connectionFloatingStatus({
      connectionError: null,
      connectionState: "offline",
      environmentLabel: "Mac mini",
      onReconnect,
    });
    if (pill?.kind !== "connection") throw new Error("expected a connection pill");
    pill.onPress();
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});

describe("syncStalledFloatingStatus", () => {
  it("is a tappable pill that runs the retry", () => {
    const onRetry = vi.fn();
    const pill = syncStalledFloatingStatus({ onRetry });
    expect(pill).toMatchObject({ kind: "connection", tone: "unavailable" });
    if (pill.kind === "connection") pill.onPress();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
