import type {
  ConnectionFailureKind,
  EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { describe, expect, it } from "vite-plus/test";

import { presentSavedCloudEnvironmentConnection } from "./cloudEnvironmentConnectionPresentation";

function connection(
  phase: EnvironmentConnectionPresentation["phase"],
  error: string | null = null,
  failureKind: ConnectionFailureKind | null = null,
): EnvironmentConnectionPresentation {
  return { phase, error, traceId: null, failureKind };
}

describe("saved cloud environment connection presentation", () => {
  it("only labels a live connection as connected", () => {
    expect(presentSavedCloudEnvironmentConnection(connection("connected"))).toEqual({
      buttonLabel: "Connected",
      statusText: "Connected",
      tone: "connected",
    });

    expect(presentSavedCloudEnvironmentConnection(connection("connecting"))).toEqual({
      buttonLabel: "Connecting…",
      statusText: "Connecting to the environment...",
      tone: "connecting",
    });
  });

  it("surfaces a failed attempt while the supervisor reconnects", () => {
    expect(
      presentSavedCloudEnvironmentConnection(
        connection("reconnecting", "Relay environment endpoint is unavailable.", "unreachable"),
      ),
    ).toEqual({
      buttonLabel: "Reconnecting…",
      statusText: "Can't reach the environment. Check your network or VPN, then reconnect.",
      tone: "connecting",
    });
  });

  it.each([
    [
      "error",
      "Connection failed",
      "Can't sign in to the environment. Reconnect and sign in again.",
      "error",
    ],
    [
      "unsupported",
      "Client not supported",
      "This app can't connect to this environment. Update the app to continue.",
      "idle",
    ],
    ["offline", "Offline", "You're offline", "idle"],
    ["available", "Not connected", "Available", "idle"],
  ] as const)(
    "presents %s without claiming the environment is connected",
    (phase, buttonLabel, statusText, tone) => {
      const failureKind: ConnectionFailureKind | null =
        phase === "error" ? "authentication" : phase === "offline" ? "offline" : null;
      expect(
        presentSavedCloudEnvironmentConnection(
          connection(phase, phase === "error" ? "Access denied." : null, failureKind),
        ),
      ).toEqual({ buttonLabel, statusText, tone });
    },
  );
});
