import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi, type AuthEnvironmentScope } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as SqlClient from "effect/sql/SqlClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { layerAuthenticatedAuth } from "../auth/http.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as OrchestrationHttp from "./http.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ServerDrainState from "./ServerDrainState.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

class DrainTestApi extends HttpApi.make("environment").add(
  EnvironmentHttpApi.groups.orchestration,
) {}

// One database backs the routes, the drain service, and the rows this test
// writes, so a run inserted here is what the status route counts. The snapshot
// routes share the group but are not exercised, so their services are empty.
const servicesLayer = Layer.mergeAll(
  ServerDrainState.layer.pipe(Layer.provide(ProjectionStore.layer)),
  EnvironmentAuth.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerEnvironment.layerIdentity),
  ),
  Layer.mock(ThreadManagementService.ThreadManagementService)({}),
  Layer.mock(OrchestrationEventStore.OrchestrationEventStore)({}),
  Layer.mock(ProjectStore.ProjectStoreV2)({}),
  Layer.mock(ProjectEnrichmentService.ProjectEnrichmentService)({}),
).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-drain-http-test-" })),
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const makeFixture = Effect.gen(function* () {
  const scope = yield* Scope.Scope;
  const services = yield* Layer.build(servicesLayer);
  const routesLayer = HttpApiBuilder.layer(DrainTestApi).pipe(
    Layer.provide(OrchestrationHttp.layer),
    Layer.provide(layerAuthenticatedAuth),
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
  const sql = Context.get(services, SqlClient.SqlClient);
  const crypto = yield* Crypto.Crypto;
  const requestContext = Context.add(services, Crypto.Crypto, crypto);

  const tokenWith = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
    auth.issueSession({ scopes }).pipe(Effect.map((issued) => issued.token));
  const call = (token: string, method: "GET" | "POST", body?: unknown) =>
    Effect.promise(async () => {
      const response = await web.handler(
        new Request("http://127.0.0.1/api/orchestration/drain", {
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

  let ordinal = 0;
  const insertRun = (status: string, payload: Record<string, unknown> = {}) => {
    ordinal += 1;
    return sql`
      INSERT INTO orchestration_v2_projection_runs
        (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
      VALUES (
        ${`run-${ordinal}`},
        'thread-drain',
        ${ordinal},
        'codex',
        ${status},
        '2026-01-01T00:00:00.000Z',
        ${encodeJson(payload)}
      )
    `;
  };

  return { tokenWith, call, insertRun };
});

const OPERATE = "orchestration:operate" as const;
const READ = "orchestration:read" as const;

it.live("reports drain state and the run counts a deploy waits on", () =>
  Effect.gen(function* () {
    const { tokenWith, call, insertRun } = yield* makeFixture;
    const token = yield* tokenWith([OPERATE]);

    const empty = yield* call(token, "GET");
    assert.strictEqual(empty.status, 200);
    assert.deepStrictEqual(empty.body, {
      draining: false,
      expiresAt: null,
      runningTurns: 0,
      waitingRuns: 0,
    });

    for (const status of ["preparing", "starting", "running", "queued"]) yield* insertRun(status);
    // A held queued run waits for the user, not for the active run.
    yield* insertRun("queued", { queueHeld: true });
    yield* insertRun("waiting");
    for (const status of ["completed", "failed", "interrupted", "cancelled"]) {
      yield* insertRun(status);
    }

    const before = DateTime.toEpochMillis(yield* DateTime.now);
    const on = yield* call(token, "POST", { enable: true, ttlSeconds: 120 });
    const after = DateTime.toEpochMillis(yield* DateTime.now);
    assert.strictEqual(on.status, 200);
    assert.strictEqual(on.body.draining, true);
    const expiresAt = DateTime.toEpochMillis(DateTime.makeUnsafe(String(on.body.expiresAt)));
    assert.isAtLeast(expiresAt, before + 120_000);
    assert.isAtMost(expiresAt, after + 120_000);
    assert.strictEqual(on.body.runningTurns, 4);
    assert.strictEqual(on.body.waitingRuns, 1);

    const status = yield* call(token, "GET");
    assert.deepStrictEqual(status.body, on.body);

    const disabled = yield* call(token, "POST", { enable: false });
    assert.deepStrictEqual(disabled.body, {
      draining: false,
      expiresAt: null,
      runningTurns: 4,
      waitingRuns: 1,
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("requires the operate scope to read or change drain mode", () =>
  Effect.gen(function* () {
    const { tokenWith, call } = yield* makeFixture;
    const readOnly = yield* tokenWith([READ]);

    const read = yield* call(readOnly, "GET");
    assert.strictEqual(read.status, 403);
    assert.strictEqual(read.body.requiredScope, OPERATE);

    const write = yield* call(readOnly, "POST", { enable: true });
    assert.strictEqual(write.status, 403);

    const operator = yield* tokenWith([OPERATE]);
    const status = yield* call(operator, "GET");
    assert.strictEqual(status.body.draining, false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("rejects a ttl outside the allowed range", () =>
  Effect.gen(function* () {
    const { tokenWith, call } = yield* makeFixture;
    const token = yield* tokenWith([OPERATE]);

    for (const ttlSeconds of [0, 24 * 60 * 60 + 1]) {
      const response = yield* call(token, "POST", { enable: true, ttlSeconds });
      assert.strictEqual(response.status, 400);
    }
    const status = yield* call(token, "GET");
    assert.strictEqual(status.body.draining, false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
