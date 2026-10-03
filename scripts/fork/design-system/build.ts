// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeFS from "node:fs";

import { GENERATED_CSS_PATH, readTokens, renderWarmBrutalismCss } from "./lib.ts";

const css = renderWarmBrutalismCss(readTokens());
NodeFS.writeFileSync(GENERATED_CSS_PATH, css);
console.log(`design:build wrote ${GENERATED_CSS_PATH}`);
