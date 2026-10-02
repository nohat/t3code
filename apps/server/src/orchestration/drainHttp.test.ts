import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentHttpApi,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { environmentAuthenticatedAuthLayer } from "../auth/http.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { ProjectionThreadSessionRepositoryLive } from "../persistence/Layers/ProjectionThreadSessions.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { orchestrationHttpApiLayer } from "./http.ts";
import { OrchestrationLayerLive } from "./runtimeLayer.ts";
import * as ServerDrainState from "./ServerDrainState.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";

class DrainTestApi extends HttpApi.make("environment").add(
  EnvironmentHttpApi.groups.orchestration,
) {}

const projectId = ProjectId.make("project-drain");
const idleThreadId = ThreadId.make("thread-idle");
const runningThreadId = ThreadId.make("thread-running");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };
const createdAt = "2026-01-01T00:00:00.000Z";

// One database and one set of service instances back both the routes and the
// test's direct engine and auth access, so a command dispatched here is the
// state the routes read.
const servicesLayer = Layer.mergeAll(
  OrchestrationLayerLive.pipe(Layer.provideMerge(RepositoryIdentityResolver.layer)),
  ProjectionThreadSessionRepositoryLive,
  ServerDrainState.layer,
  EnvironmentAuth.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerEnvironment.identityLayer),
  ),
  WorkspacePaths.layer,
  Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({
    get: () => Effect.succeed(null),
    discard: () => Effect.void,
  }),
).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-drain-http-test-" })),
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const makeFixture = Effect.gen(function* () {
  const scope = yield* Scope.Scope;
  const services = yield* Layer.build(servicesLayer);
  const routesLayer = HttpApiBuilder.layer(DrainTestApi).pipe(
    Layer.provide(orchestrationHttpApiLayer),
    Layer.provide(environmentAuthenticatedAuthLayer),
    Layer.provideMerge(
      HttpPlatform.layer.pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(Etag.layerWeak),
      ),
    ),
    Layer.provide(Layer.succeedContext(services)),
    Layer.provide(NodeServices.layer),
  );
  const web = HttpRouter.toWebHandler(routesLayer, { disableLogger: true });
  yield* Scope.addFinalizer(
    scope,
    Effect.promise(() => web.dispose()),
  );

  const auth = Context.get(services, EnvironmentAuth.EnvironmentAuth);
  const engine = Context.get(services, OrchestrationEngineService);
  const crypto = yield* Crypto.Crypto;
  const requestContext = Context.add(services, Crypto.Crypto, crypto);

  const tokenWith = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
    auth.issueSession({ scopes }).pipe(Effect.map((issued) => issued.token));
  const call = (token: string, method: "GET" | "POST", path: string, body?: unknown) =>
    Effect.promise(async () => {
      const response = await web.handler(
        new Request(`http://127.0.0.1${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: encodeJson(body) }),
        }),
        requestContext,
      );
      // A request the schema rejects answers with an empty body.
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : decodeJson(text)) as Record<string, unknown>,
      };
    });

  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("cmd-project"),
    projectId,
    title: "Drain",
    workspaceRoot: process.cwd(),
    createdAt,
  });
  for (const threadId of [idleThreadId, runningThreadId]) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`cmd-create-${threadId}`),
      threadId,
      projectId,
      title: "Thread",
      modelSelection,
      interactionMode: "default",
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt,
    });
  }
  yield* engine.dispatch({
    type: "thread.session.set",
    commandId: CommandId.make("cmd-session-running"),
    threadId: runningThreadId,
    session: {
      threadId: runningThreadId,
      status: "running",
      providerName: "codex",
      runtimeMode: "approval-required",
      activeTurnId: null,
      lastError: null,
      updatedAt: createdAt,
    },
    createdAt,
  });

  const turnStart = (threadId: ThreadId, label: string) => ({
    type: "thread.turn.start",
    commandId: CommandId.make(`cmd-turn-${label}`),
    threadId,
    message: {
      messageId: MessageId.make(`message-${label}`),
      role: "user",
      text: "hello",
      attachments: [],
    },
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdAt,
  });

  return { auth, engine, tokenWith, call, turnStart };
});

const OPERATE = "orchestration:operate" as const;
const READ = "orchestration:read" as const;

it.live("reports drain state and the count of running turns", () =>
  Effect.gen(function* () {
    const { tokenWith, call } = yield* makeFixture;
    const token = yield* tokenWith([OPERATE]);

    const off = yield* call(token, "GET", "/api/orchestration/drain");
    assert.strictEqual(off.status, 200);
    assert.deepStrictEqual(off.body, { draining: false, expiresAt: null, runningTurns: 1 });

    const before = DateTime.toEpochMillis(yield* DateTime.now);
    const on = yield* call(token, "POST", "/api/orchestration/drain", {
      enable: true,
      ttlSeconds: 120,
    });
    const after = DateTime.toEpochMillis(yield* DateTime.now);
    assert.strictEqual(on.status, 200);
    assert.strictEqual(on.body.draining, true);
    const expiresAt = DateTime.toEpochMillis(DateTime.makeUnsafe(String(on.body.expiresAt)));
    assert.isAtLeast(expiresAt, before + 120_000);
    assert.isAtMost(expiresAt, after + 120_000);
    assert.strictEqual(on.body.runningTurns, 1);

    const status = yield* call(token, "GET", "/api/orchestration/drain");
    assert.deepStrictEqual(status.body, on.body);

    const disabled = yield* call(token, "POST", "/api/orchestration/drain", { enable: false });
    assert.deepStrictEqual(disabled.body, { draining: false, expiresAt: null, runningTurns: 1 });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("requires the operate scope to read or change drain mode", () =>
  Effect.gen(function* () {
    const { tokenWith, call } = yield* makeFixture;
    const readOnly = yield* tokenWith([READ]);

    const read = yield* call(readOnly, "GET", "/api/orchestration/drain");
    assert.strictEqual(read.status, 403);
    assert.strictEqual(read.body.requiredScope, OPERATE);

    const write = yield* call(readOnly, "POST", "/api/orchestration/drain", { enable: true });
    assert.strictEqual(write.status, 403);

    const operator = yield* tokenWith([OPERATE]);
    const status = yield* call(operator, "GET", "/api/orchestration/drain");
    assert.strictEqual(status.body.draining, false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("rejects a ttl outside the allowed range", () =>
  Effect.gen(function* () {
    const { tokenWith, call } = yield* makeFixture;
    const token = yield* tokenWith([OPERATE]);

    for (const ttlSeconds of [0, 24 * 60 * 60 + 1]) {
      const response = yield* call(token, "POST", "/api/orchestration/drain", {
        enable: true,
        ttlSeconds,
      });
      assert.strictEqual(response.status, 400);
    }
    const status = yield* call(token, "GET", "/api/orchestration/drain");
    assert.strictEqual(status.body.draining, false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("refuses a new turn over HTTP with a 503 that keeps the message", () =>
  Effect.gen(function* () {
    const { tokenWith, call, turnStart } = yield* makeFixture;
    const token = yield* tokenWith([OPERATE]);
    yield* call(token, "POST", "/api/orchestration/drain", { enable: true });

    const refused = yield* call(
      token,
      "POST",
      "/api/orchestration/dispatch",
      turnStart(idleThreadId, "refused"),
    );
    assert.strictEqual(refused.status, 503);
    assert.strictEqual(refused.body.code, "server_draining");
    assert.strictEqual(refused.body.message, ServerDrainState.DRAIN_REFUSAL_MESSAGE);

    yield* call(token, "POST", "/api/orchestration/drain", { enable: false });
    const accepted = yield* call(
      token,
      "POST",
      "/api/orchestration/dispatch",
      turnStart(idleThreadId, "accepted"),
    );
    assert.strictEqual(accepted.status, 200);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("keeps running turns finishing while draining", () =>
  Effect.gen(function* () {
    const { tokenWith, call, turnStart, engine } = yield* makeFixture;
    const token = yield* tokenWith([OPERATE]);
    yield* call(token, "POST", "/api/orchestration/drain", { enable: true });

    const steer = yield* call(
      token,
      "POST",
      "/api/orchestration/dispatch",
      turnStart(runningThreadId, "steer"),
    );
    assert.strictEqual(steer.status, 200);

    const interrupt = yield* call(token, "POST", "/api/orchestration/dispatch", {
      type: "thread.turn.interrupt",
      commandId: CommandId.make("cmd-interrupt"),
      threadId: runningThreadId,
      createdAt,
    });
    assert.strictEqual(interrupt.status, 200);

    // The server starts turns itself too (compaction replay, an answered async
    // question). They go through the engine, not a client transport, so a
    // drain never blocks them.
    const internal = yield* engine.dispatch({
      ...turnStart(idleThreadId, "internal"),
      commandId: CommandId.make("server:compaction-replay:test"),
    } as never);
    assert.isAbove(internal.sequence, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
