/**
 * The one sentence that explains a disabled Send button, or null when nothing but an empty
 * composer is in the way. A lost connection outranks a transient connecting state, which outranks
 * the composer's own reason.
 */
export function resolveSendBlockedReason(input: {
  readonly environmentUnavailable: boolean;
  readonly isConnecting: boolean;
  readonly sendDisabledReason: string | null;
}): string | null {
  if (input.environmentUnavailable) return "Environment disconnected";
  if (input.isConnecting) return "Connecting to the server";
  return input.sendDisabledReason;
}
