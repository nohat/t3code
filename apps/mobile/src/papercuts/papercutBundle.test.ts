import { describe, expect, it } from "vite-plus/test";

import {
  bundleToCreateInput,
  isJsUnresponsive,
  parseBundle,
  type PapercutBundle,
  type PapercutContextSnapshot,
} from "./papercutBundle";

const fallback = { clientSurface: "ipad", platform: "ios" } as const;
const stored: PapercutContextSnapshot = {
  input: {
    clientSurface: "ipad",
    buildSha: "1.2.3 (45)",
    where: { threadId: "thread-1", environmentId: "env-1" },
    clientState: { connection: "connected", threadSyncPhase: "live" },
    messages: [{ role: "user", text: "hello" }],
  },
  events: [{ at: 1_000, kind: "connection.connected", id: "env-1" }],
};
const live: PapercutContextSnapshot = {
  input: { clientSurface: "ipad", where: { threadId: "thread-2" } },
  events: [{ at: 9_000, kind: "thread.live", id: "thread-2" }],
};

function bundle(overrides: Partial<PapercutBundle> = {}): PapercutBundle {
  return {
    id: "bundle-1",
    trigger: "shake",
    capturedAtMs: Date.UTC(2026, 9, 4, 18, 20, 0),
    jsHeartbeatAgeMs: 100,
    context: JSON.stringify(stored),
    screenshot: { mimeType: "image/jpeg", dataBase64: "AAAA" },
    ...overrides,
  };
}

describe("bundleToCreateInput", () => {
  it("marks a bundle captured while JavaScript was blocked and keeps its stored context", () => {
    const result = bundleToCreateInput(bundle({ jsHeartbeatAgeMs: 41_000 }), { live, fallback });

    expect(result.evidence.when.capturedAt).toBe("2026-10-04T18:20:00.000Z");
    expect(result.evidence.where?.threadId).toBe("thread-1");
    expect(result.evidence.events).toEqual([
      { at: 1_000, kind: "connection.connected", id: "env-1" },
      { at: Date.UTC(2026, 9, 4, 18, 20, 0), kind: "client.js-unresponsive", id: "41000" },
      { at: Date.UTC(2026, 9, 4, 18, 20, 0), kind: "papercut.shake" },
    ]);
    expect(result.screenshot?.dataBase64).toBe("AAAA");
    expect(result.messages).toEqual([{ role: "user", text: "hello" }]);
  });

  it("prefers the live snapshot when JavaScript was responding", () => {
    const result = bundleToCreateInput(bundle({ trigger: "manual" }), {
      live,
      note: " slow ",
      fallback,
    });

    expect(result.evidence.where?.threadId).toBe("thread-2");
    expect(result.evidence.events?.map((event) => event.kind)).toEqual([
      "thread.live",
      "papercut.manual",
    ]);
    expect(result.note).toBe("slow");
  });

  it("falls back to the surface input when the stored context is unreadable", () => {
    const result = bundleToCreateInput(bundle({ context: "{not json" }), { fallback });

    expect(result.evidence.when.clientSurface).toBe("ipad");
    expect(result.evidence.where).toBeUndefined();
  });
});

describe("parseBundle", () => {
  it("round-trips a native bundle and rejects garbage", () => {
    const parsed = parseBundle(JSON.stringify(bundle()));
    expect(parsed && isJsUnresponsive(parsed)).toBe(false);
    expect(parseBundle(JSON.stringify({ id: "x", trigger: "other", capturedAtMs: 1 }))).toBeNull();
    expect(parseBundle("nope")).toBeNull();
  });
});
