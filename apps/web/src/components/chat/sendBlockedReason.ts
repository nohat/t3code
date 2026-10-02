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

/**
 * Why the composer has nothing to send to, as opposed to why a send is momentarily blocked. A
 * missing project outranks a missing provider, and a provider catalog that has not arrived yet
 * reads as loading rather than as a provider problem.
 */
export function resolveSendTargetBlockedReason(input: {
  readonly projectSelectionRequired: boolean;
  readonly noProviderAvailable: boolean;
  readonly providerCatalogKnown: boolean;
}): string | null {
  if (input.projectSelectionRequired) return "Choose a project";
  if (input.noProviderAvailable) {
    return input.providerCatalogKnown ? "Provider unavailable" : "Loading providers";
  }
  return null;
}
