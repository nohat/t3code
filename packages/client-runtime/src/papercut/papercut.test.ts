import {
  NodeId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  PAPERCUT_MAX_EVENTS,
  PAPERCUT_MAX_MESSAGES,
  PapercutCreateInput,
  ProviderSessionId,
  RunId,
  RuntimeRequestId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { v2Now, v2Projection } from "../state/orchestrationV2TestFixtures.ts";
import { capturePapercut } from "./capture.ts";
import { createPapercutEventBuffer } from "./eventBuffer.ts";
import { papercutThreadContext } from "./threadContext.ts";

const isValidPayload = Schema.is(PapercutCreateInput);

function clock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createPapercutEventBuffer", () => {
  it("keeps only the newest events once the ring is full", () => {
    const time = clock();
    const buffer = createPapercutEventBuffer({ capacity: 3, now: time.now });
    for (const kind of ["a", "b", "c", "d"]) {
      buffer.record(kind);
      time.advance(1);
    }
    expect(buffer.snapshot().map((event) => event.kind)).toEqual(["b", "c", "d"]);
  });

  it("drops events older than the window", () => {
    const time = clock();
    const buffer = createPapercutEventBuffer({ windowMs: 60_000, now: time.now });
    buffer.record("old");
    time.advance(61_000);
    buffer.record("recent", "thread-1");
    expect(buffer.snapshot()).toEqual([{ at: time.now(), kind: "recent", id: "thread-1" }]);
  });

  it("reports the age of an operation until it is acknowledged", () => {
    const time = clock();
    const buffer = createPapercutEventBuffer({ now: time.now });
    const acknowledge = buffer.beginOperation("dispatch", "cmd-1");
    time.advance(40_000);
    expect(buffer.oldestOpenOperationAgeMs()).toBe(40_000);

    acknowledge();
    acknowledge();
    expect(buffer.oldestOpenOperationAgeMs()).toBeNull();
    expect(buffer.snapshot().map((event) => event.kind)).toEqual([
      "dispatch.start",
      "dispatch.ack",
    ]);
  });
});

describe("capturePapercut", () => {
  const fixedNow = () => Date.parse("2026-10-02T12:00:00.000Z");

  it("builds a valid payload with the pending dispatch age from the buffer", () => {
    const time = clock();
    const events = createPapercutEventBuffer({ now: time.now });
    events.beginOperation("dispatch", "cmd-1");
    time.advance(31_000);

    const payload = capturePapercut(
      {
        clientSurface: "desktop",
        buildSha: "abc123",
        where: { threadId: "thread-1", route: "/thread/thread-1" },
        clientState: { sendDisabledReason: "turn running" },
      },
      { events, now: fixedNow },
    );

    expect(isValidPayload(payload)).toBe(true);
    expect(payload.evidence.when).toEqual({
      capturedAt: "2026-10-02T12:00:00.000Z",
      clientSurface: "desktop",
      buildSha: "abc123",
    });
    expect(payload.evidence.clientState).toEqual({
      sendDisabledReason: "turn running",
      pendingDispatchMs: 31_000,
    });
  });

  it("bounds the note, messages, and events so the payload always validates", () => {
    const events = createPapercutEventBuffer();
    for (let index = 0; index < PAPERCUT_MAX_EVENTS + 50; index += 1) events.record("tick");

    const payload = capturePapercut(
      {
        clientSurface: "web",
        note: `  ${"n".repeat(2_000)}  `,
        messages: Array.from({ length: PAPERCUT_MAX_MESSAGES + 4 }, (_, index) => ({
          role: "user" as const,
          text: `${index}:${"m".repeat(10_000)}`,
        })),
      },
      { events, now: fixedNow },
    );

    expect(isValidPayload(payload)).toBe(true);
    expect(payload.evidence.events).toHaveLength(PAPERCUT_MAX_EVENTS);
    expect(payload.messages).toHaveLength(PAPERCUT_MAX_MESSAGES);
    expect(payload.messages?.at(-1)?.text.startsWith(`${PAPERCUT_MAX_MESSAGES + 3}:`)).toBe(true);
  });

  it("drops an oversized screenshot instead of failing the report", () => {
    const payload = capturePapercut(
      {
        clientSurface: "web",
        screenshot: { mimeType: "image/png", dataBase64: "A".repeat(7_000_000) },
      },
      { events: createPapercutEventBuffer(), now: fixedNow },
    );
    expect(payload.screenshot).toBeUndefined();
    expect(isValidPayload(payload)).toBe(true);
  });
});

describe("papercutThreadContext", () => {
  // Only the fields the context reads; the rest of a run or message is irrelevant here.
  const run = (id: string, ordinal: number) =>
    ({ id: RunId.make(id), ordinal, status: "completed" }) as unknown as OrchestrationV2Run;
  const thread: OrchestrationV2ThreadProjection = {
    ...v2Projection,
    // Out of order on purpose: the newest run is picked by ordinal.
    runs: [run("run-1", 1), run("run-3", 3), run("run-2", 2)],
    runtimeRequests: [
      {
        id: RuntimeRequestId.make("approval-1"),
        nodeId: NodeId.make("node-1"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "command",
        status: "pending",
        responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("s-1") },
        createdAt: v2Now,
        resolvedAt: null,
      },
      {
        id: RuntimeRequestId.make("question-1"),
        nodeId: NodeId.make("node-1"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "user_input",
        status: "resolved",
        responseCapability: { type: "message" },
        createdAt: v2Now,
        resolvedAt: v2Now,
      },
    ],
    messages: Array.from(
      { length: PAPERCUT_MAX_MESSAGES + 2 },
      (_, index) =>
        ({
          role: "user",
          text: `message ${index}`,
          createdAt: v2Now,
        }) as unknown as OrchestrationV2ConversationMessage,
    ),
  };

  it("separates evidence ids and state from message text", () => {
    const context = papercutThreadContext({
      environmentId: "env-1",
      thread,
      route: "/env-1/thread-1",
      threadStatus: "live",
      connectionPhase: "connected",
    });

    expect(context.where).toEqual({
      environmentId: "env-1",
      threadId: v2Projection.thread.id,
      turnId: "run-3",
      provider: "codex",
      model: "gpt-5.4",
      runtimeMode: "full-access",
      route: "/env-1/thread-1",
    });
    expect(context.clientState).toEqual({
      connection: "connected",
      threadSyncPhase: "live",
      pendingUserInput: false,
      pendingApproval: true,
    });
    expect(context.messages).toHaveLength(PAPERCUT_MAX_MESSAGES);
    expect(context.messages.at(-1)).toEqual({
      role: "user",
      text: `message ${PAPERCUT_MAX_MESSAGES + 1}`,
      at: "2026-06-20T00:00:00.000Z",
    });
    expect(
      JSON.stringify({ where: context.where, clientState: context.clientState }),
    ).not.toContain("message ");
  });

  it("reports only connection facts when no thread is open", () => {
    expect(
      papercutThreadContext({
        environmentId: "env-1",
        thread: null,
        connectionPhase: "reconnecting",
      }),
    ).toEqual({
      where: { environmentId: "env-1" },
      clientState: { connection: "reconnecting" },
      messages: [],
    });
  });
});
