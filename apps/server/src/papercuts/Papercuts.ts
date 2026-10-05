/**
 * Papercuts - stores one-tap reports of unwanted behavior.
 *
 * Each report is one JSON file under `<stateDir>/papercuts/` plus an optional
 * screenshot file beside it. Records keep evidence (ids, timestamps, state,
 * trace-span references) apart from local-only content (screenshot, message
 * text, note) so a later stage can publish the evidence alone.
 *
 * The server snapshot is read once when a report arrives and never feeds on
 * per-event bookkeeping: each field is a single indexed query or a bounded
 * trace-file scan, and a field that cannot be read cheaply is omitted.
 *
 * @module Papercuts
 */
import {
  PAPERCUT_MAX_FAILED_SPANS,
  type PapercutCreateInput,
  type PapercutCreateResult,
  type PapercutFailedSpan,
  PapercutRecord,
  type PapercutServerSnapshot,
  PapercutStoreError,
  type PapercutStoredScreenshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import { streamTraceFileLines } from "../diagnostics/TraceDiagnostics.ts";

/** Failed spans older than this are not evidence for the report being filed. */
const FAILED_SPAN_WINDOW_MS = 15 * 60_000;
const SNAPSHOT_TIMEOUT = Duration.seconds(2);

const SCREENSHOT_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

const encodeRecord = Schema.encodeSync(Schema.fromJsonString(PapercutRecord));
const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(PapercutRecord));

export const papercutsDirectory = (path: Path.Path, stateDir: string) =>
  path.join(stateDir, "papercuts");

/**
 * Reads every record in the directory, newest first. Unreadable files, and
 * files that are not records, are skipped so one bad file never hides the rest.
 */
export const listPapercutRecords = Effect.fn("Papercuts.list")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
  const records: PapercutRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const text = yield* fs.readFileString(path.join(directory, name)).pipe(Effect.option);
    if (Option.isNone(text)) continue;
    const record = decodeRecord(text.value);
    if (Option.isSome(record)) records.push(record.value);
  }
  return records.toSorted((left, right) => right.id.localeCompare(left.id));
});

/**
 * Collects failed spans that mention `threadId`. Trace attributes are not
 * indexed by thread, so a cheap substring test gates the JSON parse and only
 * lines naming the thread cost anything.
 */
export function makeFailedSpanCollector(threadId: string, sinceMs: number) {
  const spans: PapercutFailedSpan[] = [];

  const addLine = (line: string) => {
    if (!line.includes(threadId)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const span = parsed as Record<string, unknown>;
    const exit = span.exit;
    if (
      typeof exit !== "object" ||
      exit === null ||
      (exit as Record<string, unknown>)._tag !== "Failure"
    ) {
      return;
    }
    if (
      typeof span.name !== "string" ||
      typeof span.traceId !== "string" ||
      typeof span.spanId !== "string" ||
      typeof span.durationMs !== "number" ||
      typeof span.endTimeUnixNano !== "string"
    ) {
      return;
    }
    let endedAtMs: number;
    try {
      endedAtMs = Number(BigInt(span.endTimeUnixNano) / 1_000_000n);
    } catch {
      return;
    }
    if (endedAtMs < sinceMs) return;
    const endedAt = DateTime.make(endedAtMs);
    if (Option.isNone(endedAt)) return;
    spans.push({
      name: span.name.slice(0, 256),
      traceId: span.traceId.slice(0, 256),
      spanId: span.spanId.slice(0, 256),
      endedAt: DateTime.formatIso(endedAt.value),
      durationMs: span.durationMs,
    });
  };

  const finish = (): ReadonlyArray<PapercutFailedSpan> =>
    spans
      .toSorted((left, right) => right.endedAt.localeCompare(left.endedAt))
      .slice(0, PAPERCUT_MAX_FAILED_SPANS);

  return { addLine, finish };
}

export class Papercuts extends Context.Service<
  Papercuts,
  {
    readonly create: (
      input: PapercutCreateInput,
    ) => Effect.Effect<PapercutCreateResult, PapercutStoreError>;
  }
>()("t3/papercuts/Papercuts") {}

const storeError = (detail: string) => (cause: { readonly message: string }) =>
  new PapercutStoreError({ detail: `${detail}: ${cause.message}` });

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const directory = papercutsDirectory(path, config.stateDir);

  // Reads the orchestration V2 projections. `sessionStatus` joins the latest
  // run's status with the newest bound provider session's status, for
  // example "run=running session=running"; either half is left out when the
  // thread has no run or no provider session.
  const readSessionSnapshot = (threadId: string) =>
    Effect.gen(function* () {
      const [run] = yield* sql<{ readonly status: string }>`
        SELECT status
        FROM orchestration_v2_projection_runs
        WHERE thread_id = ${threadId}
        ORDER BY ordinal DESC
        LIMIT 1
      `;
      // Matches the shell's activeRunId: `waiting` is post-turn background work.
      const [activeRun] = yield* sql<{ readonly runId: string }>`
        SELECT run_id AS "runId"
        FROM orchestration_v2_projection_runs
        WHERE thread_id = ${threadId}
          AND status IN ('preparing', 'starting', 'running')
        ORDER BY ordinal DESC
        LIMIT 1
      `;
      const [session] = yield* sql<{ readonly status: string; readonly updatedAt: string }>`
        SELECT sessions.status AS "status", sessions.updated_at AS "updatedAt"
        FROM orchestration_v2_projection_provider_session_bindings AS bindings
        JOIN orchestration_v2_projection_provider_sessions AS sessions
          ON sessions.provider_session_id = bindings.provider_session_id
        WHERE bindings.thread_id = ${threadId}
        ORDER BY sessions.updated_at DESC
        LIMIT 1
      `;
      // The last persisted event of any kind, user events included, so it is
      // the thread's last event rather than strictly its last provider event.
      const [event] = yield* sql<{ readonly occurredAt: string }>`
        SELECT occurred_at AS "occurredAt"
        FROM orchestration_v2_events
        WHERE thread_id = ${threadId}
        ORDER BY sequence DESC
        LIMIT 1
      `;
      const sessionStatus = [
        ...(run ? [`run=${run.status}`] : []),
        ...(session ? [`session=${session.status}`] : []),
      ].join(" ");
      return {
        ...(sessionStatus === "" ? {} : { sessionStatus }),
        ...(activeRun ? { activeTurnId: activeRun.runId } : {}),
        ...(session ? { sessionUpdatedAt: session.updatedAt } : {}),
        ...(event ? { lastProviderEventAt: event.occurredAt } : {}),
      } satisfies PapercutServerSnapshot;
    });

  // Runs holding the provider now or about to: active runs plus queued runs
  // whose queue is not held. `waiting` runs are post-turn background work.
  const readRunningTurnCount = Effect.gen(function* () {
    const [row] = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS "count"
      FROM orchestration_v2_projection_runs
      WHERE status IN ('preparing', 'starting', 'running')
        OR (
          status = 'queued'
          AND CASE WHEN json_valid(payload_json)
            THEN json_extract(payload_json, '$.queueHeld') IS NOT 1
            ELSE 1 END
        )
    `;
    return row?.count ?? 0;
  });

  // The live trace file and its newest backup cover the recent window; older
  // backups are skipped to keep the scan to about two files.
  const readRecentFailedSpans = (threadId: string, nowMs: number) =>
    Effect.gen(function* () {
      const collector = makeFailedSpanCollector(threadId, nowMs - FAILED_SPAN_WINDOW_MS);
      for (const tracePath of [config.serverTracePath, `${config.serverTracePath}.1`]) {
        yield* streamTraceFileLines(fs, tracePath, collector.addLine);
      }
      return collector.finish();
    });

  const readServerSnapshot = Effect.fn("Papercuts.readServerSnapshot")(function* (
    threadId: string | undefined,
    nowMs: number,
  ) {
    const runningTurnCount = yield* readRunningTurnCount.pipe(Effect.option);
    const session =
      threadId === undefined
        ? Option.none()
        : yield* readSessionSnapshot(threadId).pipe(Effect.option);
    const failedSpans =
      threadId === undefined
        ? Option.none()
        : yield* readRecentFailedSpans(threadId, nowMs).pipe(Effect.option);
    return {
      ...Option.getOrElse(session, () => ({})),
      ...(Option.isSome(runningTurnCount) ? { runningTurnCount: runningTurnCount.value } : {}),
      ...(Option.isSome(failedSpans) && failedSpans.value.length > 0
        ? { recentFailedSpans: failedSpans.value }
        : {}),
    } satisfies PapercutServerSnapshot;
  });

  const create: Papercuts["Service"]["create"] = Effect.fn("Papercuts.create")(function* (input) {
    const now = yield* DateTime.now;
    const nowIso = DateTime.formatIso(now);
    const uuid = yield* crypto.randomUUIDv4.pipe(Effect.mapError(storeError("generate an id")));
    // Sortable by creation time, and safe as a file name.
    const id = `${nowIso.replace(/[-:.]/g, "")}-${uuid.slice(0, 8)}`;

    yield* fs
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.mapError(storeError("create the papercuts directory")));

    let screenshot: PapercutStoredScreenshot | undefined;
    if (input.screenshot) {
      const bytes = Base64.decode(input.screenshot.dataBase64);
      // A broken screenshot must not lose the rest of the report.
      if (Result.isSuccess(bytes)) {
        const file = `${id}.screenshot.${SCREENSHOT_EXTENSIONS[input.screenshot.mimeType]}`;
        yield* fs
          .writeFile(path.join(directory, file), bytes.success)
          .pipe(Effect.mapError(storeError("write the screenshot")));
        screenshot = {
          file,
          mimeType: input.screenshot.mimeType,
          sizeBytes: bytes.success.byteLength,
        };
      }
    }

    const server = yield* readServerSnapshot(
      input.evidence.where?.threadId,
      DateTime.toEpochMillis(now),
    ).pipe(
      Effect.timeoutOption(SNAPSHOT_TIMEOUT),
      Effect.map(Option.filter((snapshot) => Object.keys(snapshot).length > 0)),
    );

    yield* writeFileStringAtomically({
      filePath: path.join(directory, `${id}.json`),
      contents: `${encodeRecord({
        id,
        createdAt: nowIso,
        status: "new",
        statusUpdatedAt: nowIso,
        evidence: {
          ...input.evidence,
          ...(Option.isSome(server) ? { server: server.value } : {}),
        },
        localOnly: {
          ...(input.note ? { note: input.note } : {}),
          ...(input.messages && input.messages.length > 0 ? { messages: input.messages } : {}),
          ...(screenshot ? { screenshot } : {}),
        },
      })}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(storeError("write the record")),
    );

    return { id, status: "new" } satisfies PapercutCreateResult;
  });

  return Papercuts.of({ create });
});

export const layer = Layer.effect(Papercuts, make);

/** Accepts reports without storing them, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  Papercuts,
  Papercuts.of({ create: () => Effect.succeed({ id: "test-papercut", status: "new" }) }),
);
