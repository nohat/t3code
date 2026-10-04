import * as Schema from "effect/Schema";

import { NonNegativeInt } from "./baseSchemas.ts";

/**
 * A papercut is a one-tap report of a small unwanted behavior. The client sends
 * the evidence it can gather without typing; the server adds its own snapshot
 * and stores the record under the environment's T3 home.
 *
 * Fields split into two groups so a later stage can file a public issue
 * without leaking private content:
 *
 * - `evidence` holds ids, timestamps, state, and trace-span references. Only
 *   this group may leave the machine.
 * - `localOnly` holds the screenshot, message text, and the free-form note. It
 *   never leaves the environment's disk.
 */

export const PAPERCUT_MAX_EVENTS = 200;
export const PAPERCUT_MAX_MESSAGES = 8;
export const PAPERCUT_MAX_MESSAGE_CHARS = 4_000;
export const PAPERCUT_MAX_NOTE_CHARS = 500;
/** Base64 characters, about 4.5 MB of image bytes. Clients downscale to fit. */
export const PAPERCUT_MAX_SCREENSHOT_BASE64_CHARS = 6_000_000;
export const PAPERCUT_MAX_FAILED_SPANS = 10;

const PapercutShortString = Schema.String.check(Schema.isMaxLength(256));

export const PapercutStatus = Schema.Literals([
  "new",
  "triaged",
  "issue-linked",
  "fixed",
  "dismissed",
]);
export type PapercutStatus = typeof PapercutStatus.Type;

export const PapercutClientSurface = Schema.Literals([
  "web",
  "desktop",
  "ipad",
  "iphone",
  "android",
]);
export type PapercutClientSurface = typeof PapercutClientSurface.Type;

/** One ring-buffer entry: a timestamp, a short event label, and an optional id. */
export const PapercutClientEvent = Schema.Struct({
  at: NonNegativeInt,
  kind: Schema.String.check(Schema.isMaxLength(64)),
  id: Schema.optionalKey(PapercutShortString),
});
export type PapercutClientEvent = typeof PapercutClientEvent.Type;

export const PapercutWhere = Schema.Struct({
  environmentId: Schema.optionalKey(PapercutShortString),
  threadId: Schema.optionalKey(PapercutShortString),
  turnId: Schema.optionalKey(PapercutShortString),
  provider: Schema.optionalKey(PapercutShortString),
  model: Schema.optionalKey(PapercutShortString),
  runtimeMode: Schema.optionalKey(PapercutShortString),
  route: Schema.optionalKey(PapercutShortString),
});
export type PapercutWhere = typeof PapercutWhere.Type;

export const PapercutWhen = Schema.Struct({
  /** ISO timestamp from the client clock. */
  capturedAt: Schema.String.check(Schema.isMaxLength(64)),
  buildSha: Schema.optionalKey(PapercutShortString),
  clientSurface: PapercutClientSurface,
  platform: Schema.optionalKey(PapercutShortString),
});
export type PapercutWhen = typeof PapercutWhen.Type;

export const PapercutClientState = Schema.Struct({
  connection: Schema.optionalKey(PapercutShortString),
  threadSyncPhase: Schema.optionalKey(PapercutShortString),
  sendDisabledReason: Schema.optionalKey(PapercutShortString),
  sendLabel: Schema.optionalKey(PapercutShortString),
  /** Age of the oldest local dispatch or command that has not been acknowledged. */
  pendingDispatchMs: Schema.optionalKey(NonNegativeInt),
  pendingUserInput: Schema.optionalKey(Schema.Boolean),
  pendingApproval: Schema.optionalKey(Schema.Boolean),
});
export type PapercutClientState = typeof PapercutClientState.Type;

/** What the client gathers. Safe to include in a public issue. */
export const PapercutClientEvidence = Schema.Struct({
  where: Schema.optionalKey(PapercutWhere),
  when: PapercutWhen,
  clientState: Schema.optionalKey(PapercutClientState),
  events: Schema.optionalKey(
    Schema.Array(PapercutClientEvent).check(Schema.isMaxLength(PAPERCUT_MAX_EVENTS)),
  ),
});
export type PapercutClientEvidence = typeof PapercutClientEvidence.Type;

export const PapercutFailedSpan = Schema.Struct({
  name: PapercutShortString,
  traceId: PapercutShortString,
  spanId: PapercutShortString,
  endedAt: Schema.String,
  durationMs: Schema.Number,
});
export type PapercutFailedSpan = typeof PapercutFailedSpan.Type;

/**
 * Added by the server on receipt. Every field is optional: a field is omitted
 * when it is not cheap to read, and no per-event bookkeeping exists to feed it.
 * Failure causes are left out on purpose because they can quote user content.
 */
export const PapercutServerSnapshot = Schema.Struct({
  sessionStatus: Schema.optionalKey(PapercutShortString),
  activeTurnId: Schema.optionalKey(PapercutShortString),
  sessionUpdatedAt: Schema.optionalKey(Schema.String),
  lastProviderEventAt: Schema.optionalKey(Schema.String),
  runningTurnCount: Schema.optionalKey(NonNegativeInt),
  recentFailedSpans: Schema.optionalKey(
    Schema.Array(PapercutFailedSpan).check(Schema.isMaxLength(PAPERCUT_MAX_FAILED_SPANS)),
  ),
});
export type PapercutServerSnapshot = typeof PapercutServerSnapshot.Type;

export const PapercutScreenshotUpload = Schema.Struct({
  mimeType: Schema.Literals(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: Schema.String.check(Schema.isMaxLength(PAPERCUT_MAX_SCREENSHOT_BASE64_CHARS)),
});
export type PapercutScreenshotUpload = typeof PapercutScreenshotUpload.Type;

export const PapercutMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String.check(Schema.isMaxLength(PAPERCUT_MAX_MESSAGE_CHARS)),
  at: Schema.optionalKey(Schema.String),
});
export type PapercutMessage = typeof PapercutMessage.Type;

export const PapercutCreateInput = Schema.Struct({
  evidence: PapercutClientEvidence,
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(PAPERCUT_MAX_NOTE_CHARS))),
  messages: Schema.optionalKey(
    Schema.Array(PapercutMessage).check(Schema.isMaxLength(PAPERCUT_MAX_MESSAGES)),
  ),
  screenshot: Schema.optionalKey(PapercutScreenshotUpload),
});
export type PapercutCreateInput = typeof PapercutCreateInput.Type;

export const PapercutCreateResult = Schema.Struct({
  id: PapercutShortString,
  status: PapercutStatus,
});
export type PapercutCreateResult = typeof PapercutCreateResult.Type;

export class PapercutStoreError extends Schema.TaggedError<PapercutStoreError>()(
  "PapercutStoreError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to store the papercut: ${this.detail}`;
  }
}

/** Where a stored record keeps its screenshot, relative to the papercuts directory. */
export const PapercutStoredScreenshot = Schema.Struct({
  file: PapercutShortString,
  mimeType: PapercutShortString,
  sizeBytes: NonNegativeInt,
});
export type PapercutStoredScreenshot = typeof PapercutStoredScreenshot.Type;

/** The JSON file stored for one papercut. */
export const PapercutRecord = Schema.Struct({
  id: PapercutShortString,
  createdAt: Schema.String,
  status: PapercutStatus,
  statusUpdatedAt: Schema.String,
  /** The only group a public issue may include. */
  evidence: Schema.Struct({
    ...PapercutClientEvidence.fields,
    server: Schema.optionalKey(PapercutServerSnapshot),
  }),
  /** Never leaves the environment's disk. */
  localOnly: Schema.Struct({
    note: Schema.optionalKey(Schema.String),
    messages: Schema.optionalKey(Schema.Array(PapercutMessage)),
    screenshot: Schema.optionalKey(PapercutStoredScreenshot),
  }),
});
export type PapercutRecord = typeof PapercutRecord.Type;
