import { assert, it } from "@effect/vitest";
import type { PapercutRecord } from "@t3tools/contracts";

import { formatPapercutTable } from "./papercuts.ts";

function record(overrides: Partial<PapercutRecord> & Pick<PapercutRecord, "id">): PapercutRecord {
  return {
    createdAt: "2026-10-02T12:00:00.000Z",
    status: "new",
    statusUpdatedAt: "2026-10-02T12:00:00.000Z",
    evidence: {
      when: { capturedAt: "2026-10-02T12:00:00.000Z", clientSurface: "desktop" },
      where: { threadId: "thread-1" },
    },
    localOnly: {
      note: "Send did nothing",
      screenshot: { file: "a.png", mimeType: "image/png", sizeBytes: 8 },
    },
    ...overrides,
  };
}

it("lists one aligned row per report with status, surface, thread, screenshot, and note", () => {
  const table = formatPapercutTable([
    record({ id: "20261002T120000Z-aaaaaaaa" }),
    record({
      id: "20261002T110000Z-bbbbbbbb",
      status: "dismissed",
      evidence: { when: { capturedAt: "2026-10-02T11:00:00.000Z", clientSurface: "web" } },
      localOnly: {},
    }),
  ]).split("\n");

  assert.strictEqual(table.length, 3);
  assert.match(table[0]!, /^id\s+status\s+surface\s+thread\s+screenshot\s+note$/);
  assert.match(
    table[1]!,
    /20261002T120000Z-aaaaaaaa\s+new\s+desktop\s+thread-1\s+yes\s+Send did nothing$/,
  );
  assert.match(table[2]!, /20261002T110000Z-bbbbbbbb\s+dismissed\s+web\s+-\s+no$/);
});
