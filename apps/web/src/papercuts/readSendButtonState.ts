import type { PapercutClientState } from "@t3tools/contracts";

// Labels the button wears when nothing explains why it is disabled.
const DEFAULT_SEND_LABELS: ReadonlySet<string> = new Set(["Send message", "Queue message"]);

/**
 * Reads the composer's send button as the user sees it. Its accessible label
 * already names the reason it is disabled (a disconnect, a pending send, a
 * running turn), so a report can carry that text without the composer
 * exposing its state to anything else. A disabled button that still wears its
 * default label has no visible reason, which is itself worth reporting.
 */
export function readSendButtonState(root: ParentNode): PapercutClientState {
  const button = root.querySelector<HTMLButtonElement>("button[data-chat-composer-send]");
  if (!button) return {};
  const label = button.getAttribute("aria-label");
  return {
    ...(label ? { sendLabel: label } : {}),
    ...(button.disabled
      ? {
          sendDisabledReason:
            label && !DEFAULT_SEND_LABELS.has(label) ? label : "disabled with no reason shown",
        }
      : {}),
  };
}
