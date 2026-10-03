import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { type PapercutCreateInput, PapercutRecord, ThreadId, TurnId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { ProjectionThreadSessionRepositoryLive } from "../persistence/Layers/ProjectionThreadSessions.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionThreadSessionRepository } from "../persistence/Services/ProjectionThreadSessions.ts";
import * as Papercuts from "./Papercuts.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(PapercutRecord));

const testLayer = Papercuts.layer.pipe(
  Layer.provideMerge(ProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-papercuts-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_BASE64 = "iVBORw0KGgo=";

const baseInput = (overrides: Partial<PapercutCreateInput> = {}): PapercutCreateInput => ({
  evidence: {
    when: { capturedAt: "2026-10-02T12:00:00.000Z", clientSurface: "web" },
    where: { threadId: "thread-1", route: "/thread/thread-1" },
    events: [{ at: 1, kind: "dispatch.start", id: "cmd-1" }],
  },
  ...overrides,
});

const traceSpan = (input: {
  readonly name: string;
  readonly threadId: string;
  readonly endedAtMs: number;
  readonly exit: "Failure" | "Success";
}) =>
  encodeJson({
    type: "effect-span",
    name: input.name,
    traceId: `trace-${input.name}`,
    spanId: `span-${input.name}`,
    durationMs: 12,
    endTimeUnixNano: String(BigInt(input.endedAtMs) * 1_000_000n),
    attributes: { "thread.id": input.threadId },
    exit: { _tag: input.exit, cause: "the failure text stays out of the snapshot" },
  });

describe("Papercuts", () => {
  it.live("stores evidence, local-only content, and a screenshot as separate fields", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const papercuts = yield* Papercuts.Papercuts;

      const result = yield* papercuts.create(
        baseInput({
          note: "Send did nothing",
          messages: [{ role: "user", text: "secret prompt text" }],
          screenshot: { mimeType: "image/png", dataBase64: PNG_BASE64 },
        }),
      );
      assert.strictEqual(result.status, "new");

      const directory = Papercuts.papercutsDirectory(path, config.stateDir);
      const record = decodeRecord(
        yield* fs.readFileString(path.join(directory, `${result.id}.json`)),
      );
      assert.strictEqual(record.status, "new");
      assert.strictEqual(record.localOnly.note, "Send did nothing");
      assert.strictEqual(record.localOnly.messages?.[0]?.text, "secret prompt text");
      assert.strictEqual(record.localOnly.screenshot?.mimeType, "image/png");
      assert.strictEqual(record.localOnly.screenshot?.sizeBytes, PNG_BYTES.byteLength);
      const screenshotBytes = yield* fs.readFile(
        path.join(directory, record.localOnly.screenshot!.file),
      );
      assert.deepStrictEqual([...screenshotBytes], [...PNG_BYTES]);

      // The evidence group is the only one a public issue may include.
      const evidenceJson = encodeJson(record.evidence);
      assert.notInclude(evidenceJson, "secret prompt text");
      assert.notInclude(evidenceJson, "Send did nothing");
      assert.notInclude(evidenceJson, record.localOnly.screenshot!.file);

      const listed = yield* Papercuts.listPapercutRecords(directory);
      assert.deepStrictEqual(
        listed.map((entry) => entry.id),
        [result.id],
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("adds the server snapshot for the reported thread", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const sql = yield* SqlClient.SqlClient;
      const sessions = yield* ProjectionThreadSessionRepository;
      const papercuts = yield* Papercuts.Papercuts;

      const upsertSession = (
        threadId: string,
        status: "running" | "ready",
        turnId: string | null,
      ) =>
        sessions.upsert({
          threadId: ThreadId.make(threadId),
          status,
          providerName: "codex",
          providerInstanceId: null,
          runtimeMode: "full-access",
          activeTurnId: turnId === null ? null : TurnId.make(turnId),
          lastError: null,
          updatedAt: "2026-10-02T11:59:00.000Z",
        });
      yield* upsertSession("thread-1", "running", "turn-7");
      yield* upsertSession("thread-2", "running", "turn-8");
      yield* upsertSession("thread-3", "ready", null);
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        VALUES
          ('a1', 'thread-1', 'turn-7', 'info', 'tool.started', 's', '{}', 1, '2026-10-02T11:50:00.000Z'),
          ('a2', 'thread-1', 'turn-7', 'info', 'tool.completed', 's', '{}', 2, '2026-10-02T11:58:00.000Z'),
          ('a3', 'thread-2', 'turn-8', 'info', 'tool.completed', 's', '{}', 3, '2026-10-02T11:59:30.000Z')
      `;

      const nowMs = yield* Clock.currentTimeMillis;
      yield* fs.writeFileString(
        config.serverTracePath,
        [
          traceSpan({
            name: "ws.send",
            threadId: "thread-1",
            endedAtMs: nowMs - 60_000,
            exit: "Failure",
          }),
          traceSpan({
            name: "ws.other",
            threadId: "thread-2",
            endedAtMs: nowMs - 60_000,
            exit: "Failure",
          }),
          traceSpan({
            name: "ws.old",
            threadId: "thread-1",
            endedAtMs: nowMs - 3_600_000,
            exit: "Failure",
          }),
          traceSpan({
            name: "ws.ok",
            threadId: "thread-1",
            endedAtMs: nowMs - 60_000,
            exit: "Success",
          }),
        ].join("\n") + "\n",
      );

      const { id } = yield* papercuts.create(baseInput());
      const record = decodeRecord(
        yield* fs.readFileString(
          path.join(Papercuts.papercutsDirectory(path, config.stateDir), `${id}.json`),
        ),
      );

      assert.strictEqual(record.evidence.server?.sessionStatus, "running");
      assert.strictEqual(record.evidence.server?.activeTurnId, "turn-7");
      assert.strictEqual(record.evidence.server?.lastProviderEventAt, "2026-10-02T11:58:00.000Z");
      assert.strictEqual(record.evidence.server?.runningTurnCount, 2);
      assert.deepStrictEqual(
        record.evidence.server?.recentFailedSpans?.map((span) => span.name),
        ["ws.send"],
      );
      assert.notInclude(encodeJson(record.evidence), "the failure text");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("still stores the report when the thread, trace file, and screenshot are unusable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const papercuts = yield* Papercuts.Papercuts;

      const { id } = yield* papercuts.create(
        baseInput({
          evidence: {
            when: { capturedAt: "2026-10-02T12:00:00.000Z", clientSurface: "desktop" },
            where: { threadId: "thread-that-does-not-exist" },
          },
          screenshot: { mimeType: "image/png", dataBase64: "not base64!" },
        }),
      );
      const record = decodeRecord(
        yield* fs.readFileString(
          path.join(Papercuts.papercutsDirectory(path, config.stateDir), `${id}.json`),
        ),
      );

      assert.strictEqual(record.status, "new");
      assert.isUndefined(record.localOnly.screenshot);
      assert.isUndefined(record.evidence.server?.sessionStatus);
      assert.isUndefined(record.evidence.server?.recentFailedSpans);
    }).pipe(Effect.provide(testLayer)),
  );
});

describe("makeFailedSpanCollector", () => {
  it("keeps only recent failed spans that name the thread, newest first", () => {
    const collector = Papercuts.makeFailedSpanCollector("thread-1", 1_000_000);
    const lines = [
      traceSpan({ name: "older", threadId: "thread-1", endedAtMs: 1_500_000, exit: "Failure" }),
      traceSpan({ name: "newer", threadId: "thread-1", endedAtMs: 1_900_000, exit: "Failure" }),
      traceSpan({ name: "stale", threadId: "thread-1", endedAtMs: 900_000, exit: "Failure" }),
      traceSpan({ name: "success", threadId: "thread-1", endedAtMs: 1_900_000, exit: "Success" }),
      traceSpan({ name: "elsewhere", threadId: "thread-2", endedAtMs: 1_900_000, exit: "Failure" }),
      "thread-1 but not json",
    ];
    lines.forEach(collector.addLine);

    assert.deepStrictEqual(
      collector.finish().map((span) => span.name),
      ["newer", "older"],
    );
  });
});
