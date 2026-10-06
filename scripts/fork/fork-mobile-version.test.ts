// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repo = NodeURL.fileURLToPath(new URL("../../", import.meta.url));

describe("fork mobile release config", () => {
  it("uses the release version and disables upstream OTA even if updates were requested", () => {
    const result = NodeChildProcess.execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'const {default: config} = await import("./apps/mobile/app.config.ts"); console.log(JSON.stringify({version: config.version, updates: config.updates.enabled}));',
      ],
      {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, T3CODE_FORK_VERSION: "2.3.4", T3CODE_MOBILE_UPDATES_ENABLED: "1" },
      },
    );
    expect(JSON.parse(result)).toEqual({ version: "2.3.4", updates: false });
  });

  it("leaves a literal version for upstream's fingerprint reader", () => {
    const config = NodeFS.readFileSync(
      new URL("../../apps/mobile/app.config.ts", import.meta.url),
      "utf8",
    );
    expect(config.match(/^ {2}version: "(\d+)\./m)?.[1]).toBeDefined();
  });
});
