import { PAPERCUT_MAX_EVENTS, type PapercutClientEvent } from "@t3tools/contracts";

/** A papercut only needs the last few minutes of what the client was doing. */
export const PAPERCUT_EVENT_WINDOW_MS = 5 * 60_000;

const MAX_KIND_CHARS = 64;
const MAX_ID_CHARS = 256;
const MAX_OPEN_OPERATIONS = 64;

export interface PapercutEventBuffer {
  /** Appends one event. Constant time, allocation of one small object. */
  readonly record: (kind: string, id?: string) => void;
  /**
   * Starts a client operation that the server has not acknowledged yet, such as
   * a command dispatch. Records `<kind>.start` now and `<kind>.ack` when the
   * returned function runs. An operation that never completes shows up as the
   * pending age in `oldestOpenOperationAgeMs`.
   */
  readonly beginOperation: (kind: string, id?: string) => () => void;
  /** Age of the longest-running unacknowledged operation, or null when none. */
  readonly oldestOpenOperationAgeMs: () => number | null;
  /** Events inside the window, oldest first, capped at the buffer size. */
  readonly snapshot: () => ReadonlyArray<PapercutClientEvent>;
  readonly clear: () => void;
}

/**
 * A fixed-size ring of timestamps, short labels, and ids. It never stores
 * payloads, message text, or error bodies: the buffer feeds evidence that a
 * later stage may publish.
 */
export function createPapercutEventBuffer(
  options: {
    readonly capacity?: number;
    readonly windowMs?: number;
    readonly now?: () => number;
  } = {},
): PapercutEventBuffer {
  const capacity = options.capacity ?? PAPERCUT_MAX_EVENTS;
  const windowMs = options.windowMs ?? PAPERCUT_EVENT_WINDOW_MS;
  const now = options.now ?? Date.now;
  const ring = Array.from<PapercutClientEvent | undefined>({ length: capacity });
  let next = 0;
  let size = 0;
  const openOperations = new Map<number, number>();
  let nextOperationKey = 0;

  const record = (kind: string, id?: string) => {
    const label = kind.slice(0, MAX_KIND_CHARS);
    ring[next] = {
      at: Math.max(0, Math.round(now())),
      kind: label,
      ...(id === undefined ? {} : { id: id.slice(0, MAX_ID_CHARS) }),
    };
    next = (next + 1) % capacity;
    size = Math.min(size + 1, capacity);
  };

  return {
    record,
    beginOperation: (kind, id) => {
      record(`${kind}.start`, id);
      if (openOperations.size >= MAX_OPEN_OPERATIONS) {
        // A leak must not grow without bound; drop the oldest open entry.
        const oldest = openOperations.keys().next().value;
        if (oldest !== undefined) openOperations.delete(oldest);
      }
      const key = nextOperationKey++;
      openOperations.set(key, now());
      return () => {
        if (openOperations.delete(key)) record(`${kind}.ack`, id);
      };
    },
    oldestOpenOperationAgeMs: () => {
      let oldest: number | null = null;
      for (const startedAt of openOperations.values()) {
        if (oldest === null || startedAt < oldest) oldest = startedAt;
      }
      return oldest === null ? null : Math.max(0, Math.round(now() - oldest));
    },
    snapshot: () => {
      const cutoff = now() - windowMs;
      const events: PapercutClientEvent[] = [];
      for (let offset = size; offset > 0; offset -= 1) {
        const event = ring[(next - offset + capacity) % capacity];
        if (event !== undefined && event.at >= cutoff) events.push(event);
      }
      return events;
    },
    clear: () => {
      ring.fill(undefined);
      next = 0;
      size = 0;
      openOperations.clear();
    },
  };
}

/** The process-wide buffer that surfaces feed and `capturePapercut` reads. */
export const papercutEvents = createPapercutEventBuffer();

export function recordPapercutEvent(kind: string, id?: string): void {
  papercutEvents.record(kind, id);
}

export function beginPapercutOperation(kind: string, id?: string): () => void {
  return papercutEvents.beginOperation(kind, id);
}
