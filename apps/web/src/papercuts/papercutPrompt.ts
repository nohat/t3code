import { recordPapercutEvent, type PapercutCaptureInput } from "@t3tools/client-runtime/papercut";
import type { EnvironmentId, PapercutScreenshotUpload } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * What the reporter component knows when a report starts: everything but the
 * screenshot and the note. The environment is the one the report is sent to.
 */
export interface PapercutContextSnapshot {
  readonly environmentId: EnvironmentId | null;
  readonly input: Omit<PapercutCaptureInput, "screenshot" | "note">;
}

export interface PapercutPromptRequest extends PapercutContextSnapshot {
  readonly screenshot: PapercutScreenshotUpload | undefined;
}

export const usePapercutPromptRequest = create<{ request: PapercutPromptRequest | null }>(() => ({
  request: null,
}));

let readContext: (() => PapercutContextSnapshot) | null = null;
let opening = false;

/** The mounted reporter registers how to read the current app state. */
export function registerPapercutContext(read: () => PapercutContextSnapshot): () => void {
  readContext = read;
  return () => {
    if (readContext === read) readContext = null;
  };
}

/** Main-window screenshot from the desktop shell; browsers have none in this stage. */
async function captureScreenshot(): Promise<PapercutScreenshotUpload | undefined> {
  const capture = window.desktopBridge?.captureScreenshot;
  if (typeof capture !== "function") return undefined;
  try {
    return (await capture()) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Starts a report from any entry point (keybinding, command palette, menu).
 * State is read and the screenshot taken before the prompt renders, so neither
 * shows the prompt itself.
 */
export async function openPapercutPrompt(): Promise<void> {
  if (opening || usePapercutPromptRequest.getState().request !== null || readContext === null) {
    return;
  }
  opening = true;
  try {
    recordPapercutEvent("papercut.open");
    const context = readContext();
    const screenshot = await captureScreenshot();
    usePapercutPromptRequest.setState({ request: { ...context, screenshot } });
  } finally {
    opening = false;
  }
}

export function closePapercutPrompt(): void {
  usePapercutPromptRequest.setState({ request: null });
}
