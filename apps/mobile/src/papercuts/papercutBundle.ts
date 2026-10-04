import {
  capturePapercut,
  createPapercutEventBuffer,
  type PapercutCaptureInput,
} from "@t3tools/client-runtime/papercut";
import {
  PAPERCUT_MAX_EVENTS,
  type PapercutClientEvent,
  type PapercutCreateInput,
  type PapercutScreenshotUpload,
} from "@t3tools/contracts";

/** A shake bundle with a heartbeat older than this was written while JavaScript was blocked. */
export const JS_UNRESPONSIVE_MS = 3000;

/**
 * What one report keeps on the device until it is uploaded. The native module
 * writes it the instant a report starts, so it exists even when JavaScript
 * cannot run; `context` is whatever JavaScript last handed over.
 */
export interface PapercutBundle {
  readonly id: string;
  readonly trigger: "shake" | "manual";
  readonly capturedAtMs: number;
  /** Age of the last JavaScript heartbeat at capture, or null when there is no native heartbeat. */
  readonly jsHeartbeatAgeMs: number | null;
  /** JSON of a `PapercutContextSnapshot`. */
  readonly context?: string | undefined;
  readonly screenshot?: PapercutScreenshotUpload | undefined;
}

export type PapercutSurfaceInput = Omit<PapercutCaptureInput, "note" | "screenshot">;

/** The state a surface can describe, plus the event ring, as one value to store and replay. */
export interface PapercutContextSnapshot {
  readonly input: PapercutSurfaceInput;
  readonly events: ReadonlyArray<PapercutClientEvent>;
}

export function isJsUnresponsive(bundle: PapercutBundle): boolean {
  return bundle.jsHeartbeatAgeMs !== null && bundle.jsHeartbeatAgeMs >= JS_UNRESPONSIVE_MS;
}

export function parseBundle(raw: string): PapercutBundle | null {
  try {
    const value = JSON.parse(raw) as Partial<PapercutBundle> | null;
    if (
      !value ||
      typeof value.id !== "string" ||
      typeof value.capturedAtMs !== "number" ||
      (value.trigger !== "shake" && value.trigger !== "manual")
    ) {
      return null;
    }
    return {
      id: value.id,
      trigger: value.trigger,
      capturedAtMs: value.capturedAtMs,
      jsHeartbeatAgeMs: typeof value.jsHeartbeatAgeMs === "number" ? value.jsHeartbeatAgeMs : null,
      context: typeof value.context === "string" ? value.context : undefined,
      screenshot: value.screenshot,
    };
  } catch {
    return null;
  }
}

function parseContext(json: string | undefined): PapercutContextSnapshot | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<PapercutContextSnapshot> | null;
    if (!value?.input || typeof value.input.clientSurface !== "string") return null;
    return { input: value.input, events: Array.isArray(value.events) ? value.events : [] };
  } catch {
    return null;
  }
}

/**
 * Builds the `papercut.create` payload for a bundle. A bundle written while
 * JavaScript was blocked can only carry the context from before the block, so
 * it gets an explicit event saying so; a bundle from a responsive app uses the
 * `live` snapshot taken now, which is fresher than the stored one.
 */
export function bundleToCreateInput(
  bundle: PapercutBundle,
  options: {
    readonly note?: string | undefined;
    readonly live?: PapercutContextSnapshot | undefined;
    /** Used when the bundle's own context is missing or unreadable. */
    readonly fallback: PapercutSurfaceInput;
  },
): PapercutCreateInput {
  const unresponsive = isJsUnresponsive(bundle);
  const snapshot =
    (unresponsive ? null : options.live) ??
    parseContext(bundle.context) ??
    ({ input: options.fallback, events: [] } satisfies PapercutContextSnapshot);

  const events: PapercutClientEvent[] = [
    ...snapshot.events,
    ...(unresponsive && bundle.jsHeartbeatAgeMs !== null
      ? [
          {
            at: bundle.capturedAtMs,
            kind: "client.js-unresponsive",
            id: String(bundle.jsHeartbeatAgeMs),
          },
        ]
      : []),
    { at: bundle.capturedAtMs, kind: `papercut.${bundle.trigger}` },
  ].slice(-PAPERCUT_MAX_EVENTS);

  const created = capturePapercut(
    { ...snapshot.input, note: options.note, screenshot: bundle.screenshot },
    // Events come from the snapshot, not the live buffer.
    { events: createPapercutEventBuffer(), now: () => bundle.capturedAtMs },
  );
  return { ...created, evidence: { ...created.evidence, events } };
}
