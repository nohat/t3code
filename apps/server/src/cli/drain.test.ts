// @effect-diagnostics nodeBuiltinImport:off - the CLI reads a data directory on disk.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/cli";

import { drainCommand } from "./drain.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

it.effect("explains that drain mode needs a running server", () =>
  Effect.gen(function* () {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-cli-drain-down-test-"));
    const error = yield* Command.runWith(drainCommand, { version: "0.0.0" })([
      "status",
      "--base-dir",
      baseDir,
    ]).pipe(Effect.provide(CliRuntimeLayer), Effect.flip);
    assert.include(error.message, "No running T3 Code server found");
  }),
);
