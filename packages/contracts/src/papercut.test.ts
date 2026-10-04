import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  PAPERCUT_MAX_EVENTS,
  PAPERCUT_MAX_NOTE_CHARS,
  PapercutCreateInput,
  PapercutRecord,
} from "./papercut.ts";

const decodeInput = Schema.decodeUnknownSync(PapercutCreateInput);
const decodeRecord = Schema.decodeUnknownSync(PapercutRecord);

const minimalEvidence = {
  when: { capturedAt: "2026-10-02T12:00:00.000Z", clientSurface: "web" },
};

describe("papercut contracts", () => {
  it("accepts a report with only the required capture time and surface", () => {
    expect(decodeInput({ evidence: minimalEvidence })).toEqual({ evidence: minimalEvidence });
  });

  it("bounds the client event buffer and the note", () => {
    const events = Array.from({ length: PAPERCUT_MAX_EVENTS + 1 }, (_, at) => ({
      at,
      kind: "dispatch.start",
    }));
    expect(() => decodeInput({ evidence: { ...minimalEvidence, events } })).toThrow();
    expect(() =>
      decodeInput({
        evidence: minimalEvidence,
        note: "x".repeat(PAPERCUT_MAX_NOTE_CHARS + 1),
      }),
    ).toThrow();
  });

  it("keeps message text out of the evidence group of a stored record", () => {
    const record = decodeRecord({
      id: "pc_1",
      createdAt: "2026-10-02T12:00:00.000Z",
      status: "new",
      statusUpdatedAt: "2026-10-02T12:00:00.000Z",
      evidence: minimalEvidence,
      localOnly: {
        note: "Send was dead",
        messages: [{ role: "user", text: "private text" }],
      },
    });
    expect(JSON.stringify(record.evidence)).not.toContain("private text");
    expect(record.localOnly.messages).toHaveLength(1);
  });
});
