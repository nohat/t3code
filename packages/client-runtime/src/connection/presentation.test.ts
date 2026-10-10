import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  RelayConnectionTarget,
  type SupervisorConnectionState,
} from "./model.ts";
import {
  connectionCatalogDisplayUrl,
  connectionFailureGuidance,
  environmentMcpUrl,
  connectionStatusText,
  connectionStatusTitle,
  presentEnvironmentConnection,
  presentConnectionState,
  type ConnectionStatusOptions,
} from "./presentation.ts";

const TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  connectionId: "connection-1",
});

const ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: TARGET.connectionId,
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: "https://environment.example.test",
      wsBaseUrl: "wss://environment.example.test",
    }),
  ),
  enabled: true,
};

function supervisorState(overrides: Partial<SupervisorConnectionState>): SupervisorConnectionState {
  return {
    desired: true,
    network: "online",
    phase: "connecting",
    stage: "preparing",
    attempt: 1,
    generation: 0,
    lastFailure: null,
    retryAt: null,
    ...overrides,
  };
}

describe("connection presentation", () => {
  it("labels a blocked protocol as unsupported", () => {
    const connection = presentConnectionState(
      supervisorState({
        phase: "blocked",
        lastFailure: new ConnectionBlockedError({
          reason: "unsupported",
          detail: "Update your app.",
        }),
      }),
    );
    expect(connection.phase).toBe("unsupported");
    expect(connection.error).toBe("Update your app.");
    expect(connectionStatusTitle(connection)).toBe("Client not supported");
    expect(connectionStatusText(connection)).toBe("Update your app.");
  });

  it("says the host needs the update when the client is ahead of its server", () => {
    const connection = presentConnectionState(
      supervisorState({
        phase: "blocked",
        lastFailure: new ConnectionBlockedError({
          reason: "unsupported",
          detail: "This client requires a newer server. Update T3 Code on Mac mini to connect.",
          serverUpdateRequired: true,
        }),
      }),
    );
    expect(connectionStatusText(connection)).toBe(
      "This client requires a newer server. Update T3 Code on Mac mini to connect.",
    );
    expect(connectionStatusText({ ...connection, error: null })).toBe(
      "This app can't connect to this environment. Update the app to continue.",
    );
  });

  it("preserves profile display information without exposing credentials", () => {
    expect(connectionCatalogDisplayUrl(ENTRY)).toBe("https://environment.example.test");
  });

  it("copies the MCP address of the route this device is connected over", () => {
    const route = (connectionId: string, httpBaseUrl: string): ConnectionRoute => {
      const target = new BearerConnectionTarget({ ...TARGET, connectionId });
      return {
        target,
        profile: Option.some(
          new BearerConnectionProfile({
            connectionId,
            environmentId: TARGET.environmentId,
            label: TARGET.label,
            httpBaseUrl,
            wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
          }),
        ),
      };
    };
    const lan = route("lan", "http://192.168.4.53:3773/");
    const tailnet = route("tailnet", "http://100.115.1.44:3773/");
    const serve = route("serve", "https://machine.tailnet.ts.net/");
    const entry: ConnectionCatalogEntry = {
      ...ENTRY,
      target: lan.target,
      profile: lan.profile,
      alternateRoutes: [tailnet, serve],
    };

    expect(environmentMcpUrl({ entry, connectedTarget: tailnet.target })).toBe(
      "http://100.115.1.44:3773/mcp",
    );
    // Not connected: the preferred route, plain http or not.
    expect(environmentMcpUrl({ entry })).toBe("http://192.168.4.53:3773/mcp");
  });

  it("passes over routes without an address of their own", () => {
    const relay = new RelayConnectionTarget({
      environmentId: TARGET.environmentId,
      label: TARGET.label,
    });
    const entry: ConnectionCatalogEntry = {
      ...ENTRY,
      target: relay,
      profile: Option.none(),
      alternateRoutes: [{ target: ENTRY.target, profile: ENTRY.profile }],
    };

    // Relay discovery has not reported the tunnel address yet.
    expect(environmentMcpUrl({ entry, connectedTarget: relay })).toBe(
      "https://environment.example.test/mcp",
    );
    expect(
      environmentMcpUrl({
        entry,
        connectedTarget: relay,
        relayHttpBaseUrl: "https://tunnel.example.test",
      }),
    ).toBe("https://tunnel.example.test/mcp");
  });

  it("distinguishes initial connection, reconnect, and retry errors", () => {
    expect(presentConnectionState(supervisorState({ phase: "connecting", attempt: 1 }))).toEqual({
      phase: "connecting",
      error: null,
      traceId: null,
      failureKind: null,
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "connecting",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Socket closed.",
            traceId: "trace-previous",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Socket closed.",
      traceId: "trace-previous",
      failureKind: "unreachable",
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "backoff",
          attempt: 2,
          retryAt: 1,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Disconnected.",
            traceId: "trace-1",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Disconnected.",
      traceId: "trace-1",
      failureKind: "unreachable",
    });
  });

  it("preserves the latest failure while the next attempt is active", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          phase: "connecting",
          stage: "opening",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Relay connection timed out.",
            traceId: "trace-retry",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Relay connection timed out.",
      traceId: "trace-retry",
      failureKind: "unreachable",
    });
  });

  it("combines reconnect progress with the latest failure", () => {
    const connection = {
      phase: "reconnecting",
      error: "Relay request timed out.",
      traceId: "trace-retry",
      failureKind: "unreachable",
    } as const;
    expect(connectionStatusText(connection, { label: "Remote environment" })).toBe(
      "Can't reach Remote environment. Check your network or VPN, then reconnect.",
    );
    expect(connectionStatusTitle(connection, { label: "Remote environment" })).toBe(
      "Reconnecting to Remote environment...",
    );
  });

  it("presents the supervisor's offline state without consulting shell state", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          network: "offline",
          phase: "offline",
          stage: null,
        }),
      ),
    ).toEqual({
      phase: "offline",
      error: null,
      traceId: null,
      failureKind: "offline",
    });
  });

  it("presents a connected supervisor snapshot as connected", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          phase: "connected",
          stage: null,
          generation: 1,
        }),
      ),
    ).toEqual({
      phase: "connected",
      error: null,
      traceId: null,
      failureKind: null,
    });
  });

  it("preserves an explicitly available environment while offline", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          desired: false,
          network: "offline",
          phase: "available",
          stage: null,
          attempt: 0,
        }),
      ),
    ).toEqual({
      phase: "available",
      error: null,
      traceId: null,
      failureKind: null,
    });
  });

  it("names the target in one actionable sentence per failure category", () => {
    const label = "My Mac mini";
    const state = (lastFailure: SupervisorConnectionState["lastFailure"]) =>
      supervisorState({ phase: "blocked", stage: null, lastFailure });

    expect(connectionFailureGuidance(presentConnectionState(state(null)), { label })).toBeNull();

    expect(
      connectionFailureGuidance(
        presentConnectionState(
          state(new ConnectionTransientError({ reason: "timeout", detail: "Timed out." })),
        ),
        { label },
      ),
    ).toBe("Can't reach My Mac mini. Check your network or VPN, then reconnect.");

    expect(
      connectionFailureGuidance(
        presentConnectionState(
          state(new ConnectionTransientError({ reason: "network", detail: "No route." })),
        ),
        { label },
      ),
    ).toBe("Your network can't reach My Mac mini. Check your Wi-Fi or VPN, then reconnect.");

    expect(
      connectionFailureGuidance(
        presentConnectionState(
          state(new ConnectionBlockedError({ reason: "authentication", detail: "401." })),
        ),
        { label },
      ),
    ).toBe("Can't sign in to My Mac mini. Reconnect and sign in again.");

    expect(
      connectionFailureGuidance(
        presentConnectionState(
          state(new ConnectionBlockedError({ reason: "permission", detail: "403." })),
        ),
        { label },
      ),
    ).toBe("You don't have permission to reach My Mac mini. Check your account access.");

    expect(
      connectionFailureGuidance(
        presentConnectionState(
          state(new ConnectionBlockedError({ reason: "configuration", detail: "Bad URL." })),
        ),
        { label },
      ),
    ).toBe("Can't connect to My Mac mini. Check its connection settings.");

    expect(
      connectionFailureGuidance(
        presentConnectionState(
          state(new ConnectionBlockedError({ reason: "unsupported", detail: "Too old." })),
        ),
        { label },
      ),
    ).toBe("Too old.");
  });

  it("falls back to a generic target and one actionable offline sentence", () => {
    const options: ConnectionStatusOptions = {};
    expect(
      connectionStatusText(
        {
          phase: "reconnecting",
          error: "Socket closed.",
          traceId: null,
          failureKind: "unreachable",
        },
        options,
      ),
    ).toBe("Can't reach the environment. Check your network or VPN, then reconnect.");
    expect(connectionStatusText({ phase: "offline", error: null, traceId: null })).toBe(
      "You're offline",
    );
    expect(connectionFailureGuidance({ phase: "offline", error: null, traceId: null })).toContain(
      "You're offline",
    );
  });
});
