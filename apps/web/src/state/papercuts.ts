import { createPapercutEnvironmentAtoms } from "@t3tools/client-runtime/papercut";

import { connectionAtomRuntime } from "../connection/runtime";

export const papercutEnvironment = createPapercutEnvironmentAtoms(connectionAtomRuntime);
