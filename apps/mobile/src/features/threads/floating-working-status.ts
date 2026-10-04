import {
  connectionFailureGuidance,
  type ConnectionFailureKind,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";

/**
 * What the floating pill says. Connection, syncing, and working share one
 * element so the label swaps in place instead of one pill fading out for
 * another. The connection variant is tappable and triggers a reconnect.
 */
export type FloatingWorkingStatus =
  | { readonly kind: "working"; readonly startedAt: string }
  | { readonly kind: "syncing"; readonly label: string }
  | { readonly kind: "compacting" }
  // A task whose thread the server has not created yet: the worktree may
  // still be checking out, so there is no turn to time.
  | { readonly kind: "preparing"; readonly label: string }
  | {
      readonly kind: "connection";
      readonly tone: "reconnecting" | "unavailable";
      readonly label: string;
      readonly onPress: () => void;
    };

/**
 * The pill's connection variant, or null once the environment is connected and
 * the pill is free to report sync and working state instead.
 */
export function connectionFloatingStatus(input: {
  readonly connectionError: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionFailureKind?: ConnectionFailureKind | null;
  readonly environmentLabel: string | null;
  readonly onReconnect: () => void;
}): FloatingWorkingStatus | null {
  const environmentLabel = input.environmentLabel ?? "Environment";
  const connection = {
    phase: input.connectionState,
    error: input.connectionError,
    traceId: null,
    failureKind: input.connectionFailureKind ?? null,
  } as const;
  const guidance = connectionFailureGuidance(connection, { label: environmentLabel });
  const unavailable = (label: string): FloatingWorkingStatus => ({
    kind: "connection",
    tone: "unavailable",
    label,
    onPress: input.onReconnect,
  });

  switch (input.connectionState) {
    case "connecting":
    case "reconnecting":
      return {
        kind: "connection",
        tone: "reconnecting",
        label:
          input.connectionError === null
            ? `Reconnecting to ${environmentLabel}...`
            : (guidance ?? `Failed to connect. Retrying ${environmentLabel}...`),
        onPress: input.onReconnect,
      };
    case "offline":
      return unavailable("You are offline");
    case "unsupported":
      return unavailable("Client not supported");
    case "error":
      return unavailable(
        guidance ??
          (input.connectionError
            ? `Failed to connect to ${environmentLabel}: ${input.connectionError}`
            : `Failed to connect to ${environmentLabel}`),
      );
    case "available":
      return unavailable(`${environmentLabel} is not connected`);
    case "connected":
      return null;
  }
}

/**
 * A sync that has run past the stall limit with no error. The tap target is
 * the environment reconnect, which resubscribes the thread.
 */
export function syncStalledFloatingStatus(input: {
  readonly onRetry: () => void;
}): FloatingWorkingStatus {
  return {
    kind: "connection",
    tone: "unavailable",
    label: "Messages are taking too long to load. Tap to retry.",
    onPress: input.onRetry,
  };
}
