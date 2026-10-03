// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeFS from "node:fs";

import {
  GENERATED_CSS_PATH,
  checkTokens,
  readThemeFiles,
  readTokens,
  renderWarmBrutalismCss,
} from "./lib.ts";

const failures: string[] = [];
const tokens = readTokens();

const expected = renderWarmBrutalismCss(tokens);
const actual = NodeFS.readFileSync(GENERATED_CSS_PATH, "utf8");
if (actual.trim() !== expected.trim()) {
  failures.push("warm-brutalism.generated.css is stale; run `pnpm design:build`");
}

failures.push(...checkTokens(tokens));

for (const { id, json } of readThemeFiles()) {
  try {
    const theme = JSON.parse(json) as {
      version?: number;
      id?: string;
      appearance?: string;
      colors?: Record<string, string>;
    };
    if (theme.version !== 1) {
      failures.push(`${id}: theme version must be 1`);
    }
    if (theme.id !== id) {
      failures.push(`${id}: id "${theme.id}" does not match filename`);
    }
    if (theme.appearance !== "light" && theme.appearance !== "dark") {
      failures.push(`${id}: appearance must be light or dark`);
    }
    const roles = Object.keys(theme.colors ?? {}).length;
    if (roles < 20) {
      failures.push(`${id}: expected at least 20 color roles, found ${roles}`);
    }
  } catch (error) {
    failures.push(`${id}: invalid JSON (${String(error)})`);
  }
}

if (failures.length > 0) {
  console.error("design:check failed:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}
console.log(
  `design:check ok (ledger ${tokens.version}): generated CSS current, contrast pairs pass, theme files valid`,
);
