// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it, vi } from "vite-plus/test";

import { FIRST_V2_BOOT_BUDGET_SECONDS, runGovernedCommand } from "./fork-deploy-command.ts";

const options = {
  command: ["node", "scripts/build-desktop-artifact.ts"],
  cwd: "/build tree",
  home: "/home",
  buildPath: "/tools/bin",
  callerEnv: {
    BUILDCTL: "/governor/buildctl.py",
    TMPDIR: "/scratch",
    VITE_HTTP_URL: "unsafe",
    T3CODE_HOME: "unsafe",
  },
  extraEnv: { T3CODE_FORK_VERSION: "1.0.0" },
};

describe("runGovernedCommand", () => {
  it("submits through the governor with a scrubbed environment and the fork version", () => {
    const spawn = vi.fn<(file: string, args: string[], options: unknown) => { status: number }>(
      () => ({ status: 0 }),
    );
    runGovernedCommand(options, { exists: () => true, spawn });
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      "/home/code/scaffold/venv/bin/python",
      [
        "/governor/buildctl.py",
        "run",
        "--cwd",
        "/build tree",
        "--label",
        "t3-deploy",
        "--",
        ...options.command,
      ],
      {
        cwd: options.cwd,
        stdio: "inherit",
        env: {
          HOME: "/home",
          PATH: "/tools/bin",
          TMPDIR: "/scratch",
          LANG: "en_US.UTF-8",
          T3CODE_FORK_VERSION: "1.0.0",
        },
      },
    );
  });

  it("uses the home-relative governor by default", () => {
    const spawn = vi.fn<(file: string, args: string[], options: unknown) => { status: number }>(
      () => ({ status: 0 }),
    );
    runGovernedCommand({ ...options, callerEnv: {}, extraEnv: {} }, { exists: () => true, spawn });
    expect(spawn.mock.calls[0]?.[1]?.[0]).toBe(
      "/home/code/scaffold/components/deploy-ops/buildctl.py",
    );
  });

  it("refuses missing admission tooling without launching the command", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(() => runGovernedCommand(options, { exists: () => false, spawn })).toThrow(
      /build governor.*missing/,
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("propagates governor refusal and launch failure", () => {
    expect(() =>
      runGovernedCommand(options, { exists: () => true, spawn: () => ({ status: 75 }) }),
    ).toThrow(/exited 75/);
    expect(() =>
      runGovernedCommand(options, {
        exists: () => true,
        spawn: () => ({ status: null, error: new Error("cannot launch") }),
      }),
    ).toThrow(/cannot launch/);
  });

  it("allows 240 seconds for the first V2 boot by default", () => {
    expect(FIRST_V2_BOOT_BUDGET_SECONDS).toBe(240);
  });
});
