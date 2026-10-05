import {
  AuthOrchestrationOperateScope,
  EnvironmentHttpApi,
  type EnvironmentOrchestrationDrainStatus,
  ORCHESTRATION_DRAIN_MAX_TTL_SECONDS,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

export class DrainServerNotRunningError extends Schema.TaggedError<DrainServerNotRunningError>()(
  "DrainServerNotRunningError",
  {},
) {
  override get message(): string {
    return "No running T3 Code server found. Drain mode is in memory, so it only applies to a running server; check --base-dir if it uses a custom data directory.";
  }
}

export class DrainServerRequestError extends Schema.TaggedError<DrainServerRequestError>()(
  "DrainServerRequestError",
  {
    origin: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to reach the T3 Code server at ${this.origin}.`;
  }
}

type DrainOperation =
  | { readonly kind: "status" }
  | { readonly kind: "set"; readonly enable: boolean; readonly ttlSeconds?: number };

const DRAIN_CLI_REQUEST_TIMEOUT = Duration.seconds(10);

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable output."),
  Flag.withDefault(false),
);

const formatDrainStatus = (status: EnvironmentOrchestrationDrainStatus, json: boolean) =>
  json
    ? JSON.stringify(status)
    : [
        `draining: ${status.draining ? "yes" : "no"}`,
        ...(status.expiresAt === null ? [] : [`expires: ${status.expiresAt}`]),
        `running turns: ${status.runningTurns}`,
        `waiting runs: ${status.waitingRuns}`,
      ].join("\n");

/**
 * Drain mode lives in a running server's memory, so every drain command talks
 * to that server over HTTP. The origin comes from the runtime state the server
 * persists, and the credential is a short-lived session minted from the same
 * data directory, then revoked.
 */
const runDrainRequest = Effect.fn("runDrainRequest")(function* (
  flags: CliAuthLocationFlags & { readonly json: boolean },
  operation: DrainOperation,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const minimumLogLevel = flags.json ? "Error" : config.logLevel;

  return yield* Effect.gen(function* () {
    const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtimeState)) {
      return yield* new DrainServerNotRunningError();
    }
    const origin = runtimeState.value.origin;
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const status = yield* Effect.acquireUseRelease(
      environmentAuth.issueSession({
        scopes: [AuthOrchestrationOperateScope],
        label: "t3 drain cli",
      }),
      (issued) =>
        Effect.gen(function* () {
          const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });
          const headers = { authorization: `Bearer ${issued.token}` };
          return operation.kind === "status"
            ? yield* client.orchestration.drainStatus({ headers })
            : yield* client.orchestration.setDrain({
                headers,
                payload: {
                  enable: operation.enable,
                  ...(operation.ttlSeconds === undefined
                    ? {}
                    : { ttlSeconds: operation.ttlSeconds }),
                },
              });
        }).pipe(
          Effect.timeout(DRAIN_CLI_REQUEST_TIMEOUT),
          Effect.mapError((cause) => new DrainServerRequestError({ origin, cause })),
        ),
      (issued) =>
        environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
    );
    yield* Console.log(formatDrainStatus(status, flags.json));
  }).pipe(
    Effect.provide(
      EnvironmentAuth.runtimeLayer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
      ),
    ),
  );
});

const drainOnCommand = Command.make("on", {
  ...projectLocationFlags,
  ttlSeconds: Flag.Int("ttl").pipe(
    Flag.withSchema(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: ORCHESTRATION_DRAIN_MAX_TTL_SECONDS }),
      ),
    ),
    Flag.withDescription(
      "Seconds until drain mode expires on its own (default 1800, maximum 86400).",
    ),
    Flag.optional,
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Refuse new turns so running ones can finish. Expires on its own and clears on restart.",
  ),
  Command.withHandler((flags) =>
    runDrainRequest(flags, {
      kind: "set",
      enable: true,
      ...(Option.isSome(flags.ttlSeconds) ? { ttlSeconds: flags.ttlSeconds.value } : {}),
    }),
  ),
);

const drainOffCommand = Command.make("off", { ...projectLocationFlags, json: jsonFlag }).pipe(
  Command.withDescription("Accept new turns again."),
  Command.withHandler((flags) => runDrainRequest(flags, { kind: "set", enable: false })),
);

const drainStatusCommand = Command.make("status", {
  ...projectLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Show whether drain mode is on and how many turns are still running or waiting.",
  ),
  Command.withHandler((flags) => runDrainRequest(flags, { kind: "status" })),
);

export const drainCommand = Command.make("drain").pipe(
  Command.withDescription("Stop new turns from starting so a deploy can wait for running turns."),
  Command.withSubcommands([drainOnCommand, drainOffCommand, drainStatusCommand]),
);
