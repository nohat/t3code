import {
  connectionFailureGuidance,
  type ConnectionFailureKind,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";

export type FloatingWorkingStatus =
  | { readonly kind: "working"; readonly startedAt: string }
  | { readonly kind: "syncing"; readonly label: string }
  | { readonly kind: "compacting" }
  | {
      readonly kind: "child-input";
      readonly label: string;
      readonly accessibilityLabel: string;
      readonly onPress: () => void;
    }
  | {
      readonly kind: "background";
      readonly label: string;
      readonly accessibilityLabel: string;
      readonly waiting: boolean;
    }
  | { readonly kind: "goal"; readonly label: string; readonly accessibilityLabel: string }
  | { readonly kind: "preparing"; readonly label: string }
  | {
      readonly kind: "connection";
      readonly tone: "reconnecting" | "unavailable";
      readonly label: string;
      readonly onPress: () => void;
    };

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
 * A sync that has run past the stall limit with no error. The tap target
 * reloads the thread from the server.
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
