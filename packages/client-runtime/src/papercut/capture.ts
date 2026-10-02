import {
  PAPERCUT_MAX_MESSAGE_CHARS,
  PAPERCUT_MAX_MESSAGES,
  PAPERCUT_MAX_NOTE_CHARS,
  PAPERCUT_MAX_SCREENSHOT_BASE64_CHARS,
  type PapercutClientState,
  type PapercutClientSurface,
  type PapercutCreateInput,
  type PapercutMessage,
  type PapercutScreenshotUpload,
  type PapercutWhere,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { papercutEvents, type PapercutEventBuffer } from "./eventBuffer.ts";

const MAX_SHORT_CHARS = 256;

export interface PapercutCaptureInput {
  readonly clientSurface: PapercutClientSurface;
  readonly buildSha?: string | undefined;
  readonly platform?: string | undefined;
  readonly where?: PapercutWhere | undefined;
  /**
   * What the surface knows about the UI right now. `pendingDispatchMs` is
   * filled from the event buffer when the surface leaves it out.
   */
  readonly clientState?: PapercutClientState | undefined;
  readonly note?: string | undefined;
  /** Recent thread messages, oldest first. The newest ones are kept. */
  readonly messages?: ReadonlyArray<PapercutMessage> | undefined;
  readonly screenshot?: PapercutScreenshotUpload | undefined;
}

export interface PapercutCaptureOptions {
  readonly events?: PapercutEventBuffer;
  /** Epoch milliseconds; defaults to the wall clock. */
  readonly now?: () => number;
}

function short(value: string): string {
  return value.length > MAX_SHORT_CHARS ? value.slice(0, MAX_SHORT_CHARS) : value;
}

/** Drops undefined values and clamps strings so the payload always satisfies the contract. */
function compactShortRecord<T extends Record<string, unknown>>(
  input: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } | undefined {
  const entries = Object.entries(input).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, typeof value === "string" ? short(value) : value] as const],
  );
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as { [K in keyof T]?: Exclude<T[K], undefined> });
}

/**
 * Builds the `papercut.create` payload from what a surface knows plus the
 * shared event buffer. Pure apart from reading the clock and the buffer, and
 * shared by web, desktop, and mobile so every surface reports the same shape.
 * Text and screenshot are bounded here; an oversized screenshot is dropped
 * rather than failing the report.
 */
export function capturePapercut(
  input: PapercutCaptureInput,
  options: PapercutCaptureOptions = {},
): PapercutCreateInput {
  const events = options.events ?? papercutEvents;
  const capturedAt = DateTime.formatIso(DateTime.makeUnsafe((options.now ?? Date.now)()));

  const where = input.where ? compactShortRecord(input.where) : undefined;
  const pendingDispatchMs =
    input.clientState?.pendingDispatchMs ?? events.oldestOpenOperationAgeMs();
  const clientState = compactShortRecord({
    ...input.clientState,
    pendingDispatchMs: pendingDispatchMs ?? undefined,
  });
  const recordedEvents = events.snapshot();
  const note = input.note?.trim().slice(0, PAPERCUT_MAX_NOTE_CHARS);
  const messages = input.messages
    ?.slice(-PAPERCUT_MAX_MESSAGES)
    .map((message) => ({ ...message, text: message.text.slice(0, PAPERCUT_MAX_MESSAGE_CHARS) }));
  const screenshot =
    input.screenshot && input.screenshot.dataBase64.length <= PAPERCUT_MAX_SCREENSHOT_BASE64_CHARS
      ? input.screenshot
      : undefined;

  return {
    evidence: {
      ...(where ? { where } : {}),
      when: {
        capturedAt,
        clientSurface: input.clientSurface,
        ...(input.buildSha ? { buildSha: short(input.buildSha) } : {}),
        ...(input.platform ? { platform: short(input.platform) } : {}),
      },
      ...(clientState ? { clientState } : {}),
      ...(recordedEvents.length > 0 ? { events: recordedEvents } : {}),
    },
    ...(note ? { note } : {}),
    ...(messages && messages.length > 0 ? { messages } : {}),
    ...(screenshot ? { screenshot } : {}),
  };
}
