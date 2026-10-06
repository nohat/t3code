// @effect-diagnostics nodeBuiltinImport:off
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const FIRST_V2_BOOT_BUDGET_SECONDS = 90;

interface CommandOptions {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly home: string;
  readonly buildPath: string;
  readonly callerEnv: Readonly<Record<string, string | undefined>>;
  readonly extraEnv: Readonly<Record<string, string>>;
}

interface CommandDependencies {
  readonly exists: (path: string) => boolean;
  readonly spawn: (
    file: string,
    args: string[],
    options: {
      cwd: string;
      stdio: "inherit";
      env: Record<string, string>;
    },
  ) => { status: number | null; error?: Error };
}

/** Runs release commands with an environment scrubbed of the agent's dev shell. */
export function runGovernedCommand(
  options: CommandOptions,
  dependencies: CommandDependencies = { exists: existsSync, spawn: spawnSync },
): void {
  const [file, ...args] = options.command;
  const result = dependencies.spawn(file!, args, {
    cwd: options.cwd,
    stdio: "inherit",
    env: {
      HOME: options.home,
      PATH: options.buildPath,
      TMPDIR: options.callerEnv.TMPDIR ?? "/tmp",
      LANG: "en_US.UTF-8",
      ...options.extraEnv,
    },
  });
  if (result.status !== 0) throw new Error(`${options.command.join(" ")} exited ${result.status}`);
}
