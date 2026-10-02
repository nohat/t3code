import type { PapercutCreateInput } from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";

import { request } from "../rpc/client.ts";

/** Sends a captured papercut to the environment bound to the current supervisor. */
export const submitPapercut = (input: PapercutCreateInput) =>
  request(WS_METHODS.papercutCreate, input);
