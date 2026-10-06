// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const FIRST_V2_BOOT_BUDGET_SECONDS = 240;

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

/** Submits release commands to buildctl with only the build's intended environment. */
export function runGovernedCommand(
  options: CommandOptions,
  dependencies: CommandDependencies = {
    exists: NodeFS.existsSync,
    spawn: NodeChildProcess.spawnSync,
  },
): void {
  const scaffoldRoot = NodePath.join(options.home, "code", "scaffold");
  const buildctl =
    options.callerEnv.BUILDCTL ??
    NodePath.join(scaffoldRoot, "components", "deploy-ops", "buildctl.py");
  const python = NodePath.join(scaffoldRoot, "venv", "bin", "python");
  if (!dependencies.exists(buildctl) || !dependencies.exists(python)) {
    throw new Error(`build governor missing: ${buildctl} or ${python}; refusing unmanaged build`);
  }
  const result = dependencies.spawn(
    python,
    [buildctl, "run", "--cwd", options.cwd, "--label", "t3-deploy", "--", ...options.command],
    {
      cwd: options.cwd,
      stdio: "inherit",
      env: {
        HOME: options.home,
        PATH: options.buildPath,
        TMPDIR: options.callerEnv.TMPDIR ?? "/tmp",
        LANG: "en_US.UTF-8",
        ...options.extraEnv,
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${options.command.join(" ")} exited ${result.status}`);
}
