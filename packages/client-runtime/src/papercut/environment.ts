import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

/**
 * The papercut command for one surface's connection runtime. Run it with an
 * environment id and a payload from `capturePapercut`.
 */
export function createPapercutEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:papercut:create",
      tag: WS_METHODS.papercutCreate,
    }),
  };
}
