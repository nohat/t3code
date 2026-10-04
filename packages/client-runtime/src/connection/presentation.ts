import type { ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import type { ConnectionAttemptError, SupervisorConnectionState } from "./model.ts";

export type EnvironmentConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error"
  | "unsupported";

/**
 * A coarse category for the latest connection failure, so every surface can
 * turn the same underlying reason into one actionable sentence. `network` and
 * `unreachable` are distinct because the fix differs: a device with no
 * connectivity is not the same as a device that cannot reach a host.
 */
export type ConnectionFailureKind =
  | "offline"
  | "network"
  | "unreachable"
  | "authentication"
  | "permission"
  | "configuration"
  | "unsupported"
  | "unknown";

export interface EnvironmentConnectionPresentation {
  readonly phase: EnvironmentConnectionPhase;
  readonly error: string | null;
  readonly traceId: string | null;
  /** Category of the latest failure when one is known, for actionable guidance. */
  readonly failureKind?: ConnectionFailureKind | null;
}

export interface ConnectionStatusOptions {
  /** Environment label used to name the target in actionable messages. */
  readonly label?: string | null;
}

export interface EnvironmentPresentation {
  readonly entry: ConnectionCatalogEntry;
  readonly connection: EnvironmentConnectionPresentation;
  readonly serverConfig: ServerConfig | null;
}

function failureKindFromError(error: ConnectionAttemptError | null): ConnectionFailureKind | null {
  if (error === null) {
    return null;
  }
  if (error._tag === "ConnectionBlockedError") {
    switch (error.reason) {
      case "authentication":
        return "authentication";
      case "permission":
        return "permission";
      case "configuration":
        return "configuration";
      case "unsupported":
        return "unsupported";
    }
  }
  switch (error.reason) {
    case "network":
      return "network";
    case "timeout":
    case "transport":
    case "endpoint-unavailable":
    case "relay-unavailable":
    case "remote-unavailable":
      return "unreachable";
  }
}

export function presentConnectionState(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  const failureKind = failureKindFromError(state.lastFailure);
  switch (state.phase) {
    case "available":
      return { phase: "available", error: null, traceId: null, failureKind: null };
    case "offline":
      return { phase: "offline", error: null, traceId: null, failureKind: "offline" };
    case "connecting":
      return {
        phase: state.attempt <= 1 && state.lastFailure === null ? "connecting" : "reconnecting",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
        failureKind,
      };
    case "connected":
      return { phase: "connected", error: null, traceId: null, failureKind: null };
    case "backoff":
      return {
        phase: "reconnecting",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
        failureKind,
      };
    case "blocked":
      return {
        phase: state.lastFailure?.reason === "unsupported" ? "unsupported" : "error",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
        failureKind,
      };
  }
}

function connectionTargetName(options?: ConnectionStatusOptions): string {
  const label = options?.label?.trim();
  return label !== undefined && label.length > 0 ? label : "the environment";
}

function effectiveFailureKind(
  connection: EnvironmentConnectionPresentation,
): ConnectionFailureKind | null {
  if (connection.failureKind != null) {
    return connection.failureKind;
  }
  if (connection.phase === "offline") {
    return "offline";
  }
  if (connection.phase === "unsupported") {
    return "unsupported";
  }
  return null;
}

/**
 * One actionable sentence describing what went wrong and what to try. Returns
 * null while a connection is healthy or newly connecting (no failure yet).
 */
export function connectionFailureGuidance(
  connection: EnvironmentConnectionPresentation,
  options?: ConnectionStatusOptions,
): string | null {
  const name = connectionTargetName(options);
  switch (effectiveFailureKind(connection)) {
    case "offline":
      return "You're offline. Check your Wi-Fi or cellular connection, then reconnect.";
    case "network":
      return `Your network can't reach ${name}. Check your Wi-Fi or VPN, then reconnect.`;
    case "unreachable":
      return `Can't reach ${name}. Check your network or VPN, then reconnect.`;
    case "authentication":
      return `Can't sign in to ${name}. Reconnect and sign in again.`;
    case "permission":
      return `You don't have permission to reach ${name}. Check your account access.`;
    case "configuration":
      return `Can't connect to ${name}. Check its connection settings.`;
    case "unsupported":
      return "This app can't connect to this environment. Update the app to continue.";
    case "unknown":
    case null:
      return null;
  }
}

export function connectionStatusText(
  connection: EnvironmentConnectionPresentation,
  options?: ConnectionStatusOptions,
): string {
  const name = connectionTargetName(options);
  switch (connection.phase) {
    case "available":
      return "Available";
    case "offline":
      return "You're offline";
    case "connecting":
      return `Connecting to ${name}...`;
    case "reconnecting":
      return connectionFailureGuidance(connection, options) ?? `Reconnecting to ${name}...`;
    case "connected":
      return "Connected";
    case "unsupported":
      return "This app can't connect to this environment. Update the app to continue.";
    case "error":
      return connectionFailureGuidance(connection, options) ?? `Can't connect to ${name}.`;
  }
}

export function connectionStatusTitle(
  connection: EnvironmentConnectionPresentation,
  options?: ConnectionStatusOptions,
): string {
  const name = connectionTargetName(options);
  switch (connection.phase) {
    case "available":
      return "Available";
    case "offline":
      return "You're offline";
    case "connecting":
      return `Connecting to ${name}...`;
    case "reconnecting":
      return `Reconnecting to ${name}...`;
    case "connected":
      return "Connected";
    case "unsupported":
      return "Client not supported";
    case "error":
      return `Can't connect to ${name}`;
  }
}

export function presentEnvironmentConnection(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  return presentConnectionState(state);
}

export function connectionCatalogDisplayUrl(entry: ConnectionCatalogEntry): string | null {
  switch (entry.target._tag) {
    case "PrimaryConnectionTarget":
      return entry.target.httpBaseUrl;
    case "RelayConnectionTarget":
      return null;
    case "BearerConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "BearerConnectionProfile"
        ? entry.profile.value.httpBaseUrl
        : null;
    case "SshConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "SshConnectionProfile"
        ? `${entry.profile.value.target.username}@${entry.profile.value.target.hostname}`
        : null;
  }
}
