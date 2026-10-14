import {
  connectionStatusText,
  type ConnectionStatusOptions,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";

/**
 * Status line for mobile environment rows. Mobile has no tooltip like web, so
 * an unsupported environment shows its compatibility detail, which says
 * whether to update the app or the host.
 */
export function environmentStatusText(
  connection: EnvironmentConnectionPresentation,
  options?: ConnectionStatusOptions,
): string {
  return connection.phase === "unsupported" && connection.error !== null
    ? connection.error
    : connectionStatusText(connection, options);
}
