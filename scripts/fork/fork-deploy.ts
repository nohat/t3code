#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
/**
 * Gated deploy of a packaged build to a single launchd-managed production instance.
 *
 *   node scripts/fork/fork-deploy.ts build <ref>
 *   node scripts/fork/fork-deploy.ts deploy <ref> [--force] [--drain-timeout <seconds>]
 *   node scripts/fork/fork-deploy.ts rollback [--to <sha>]
 *   node scripts/fork/fork-deploy.ts status
 *   node scripts/fork/fork-deploy.ts plist
 *
 * Machine-specific settings (paths, port, notifier) live in a JSON file outside git, named by
 * --config or FORK_DEPLOY_CONFIG. Only failures, holds, and rollbacks are reported; silence
 * means the deploy succeeded.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  atomicSwap,
  COMPLETE_MARKER,
  countRunningSessions,
  ensureDir,
  isComplete,
  launchdPid,
  listCompleteReleases,
  probeHealth,
  pruneReleases,
  readCurrent,
  readPrevious,
  releaseDir,
  renderLaunchAgent,
} from "./fork-deploy-lib.ts";

interface Config {
  /** Deploy root holding releases/, current, and the lock. */
  readonly root: string;
  /** Dedicated git worktree used only for building; it is checked out detached. */
  readonly buildTree: string;
  /** T3CODE_HOME of the production instance. */
  readonly home: string;
  readonly port: number;
  readonly label: string;
  /** Electron userData directory, so desktop settings carry over. */
  readonly userDataDir: string;
  /** Command prefix that delivers a message; `--summary <text> --message <body>` is appended. */
  readonly notify?: readonly string[];
  /** PATH for the scrubbed build environment (toolchains the build needs). */
  readonly buildPath: string;
  /** Commands run in the build tree before building; each must exit 0. */
  readonly gate: readonly (readonly string[])[];
  readonly keepReleases?: number;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    force: { type: "boolean", default: false },
    "drain-timeout": { type: "string", default: "600" },
    to: { type: "string" },
  },
});

const configPath = values.config ?? process.env.FORK_DEPLOY_CONFIG ?? ".t3/fork-deploy.json";
const config: Config = JSON.parse(readFileSync(configPath, "utf8"));
const uid = process.getuid?.() ?? 501;
const agentPath = join(homedir(), "Library", "LaunchAgents", `${config.label}.plist`);
const stateDb = join(config.home, "userdata", "state.sqlite");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message: string) => console.log(`fork-deploy: ${message}`);

function report(summary: string, body: string): void {
  console.error(`fork-deploy: ${summary}\n${body}`);
  if (!config.notify?.length) return;
  const [command, ...args] = config.notify;
  spawnSync(command!, [...args, "--summary", summary.slice(0, 200), "--message", body], {
    stdio: "ignore",
  });
}

/** Runs a command with only PATH and HOME, so nothing from an agent or dev shell leaks in. */
function run(command: readonly string[], cwd: string): void {
  const [file, ...args] = command;
  const result = spawnSync(file!, args, {
    cwd,
    stdio: "inherit",
    env: {
      HOME: homedir(),
      PATH: config.buildPath,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: "en_US.UTF-8",
    },
  });
  if (result.status !== 0) throw new Error(`${command.join(" ")} exited ${result.status}`);
}

function git(...args: string[]): string {
  const result = spawnSync("git", ["-C", config.buildTree, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function buildRelease(sha: string): void {
  if (git("status", "--porcelain"))
    throw new Error("build tree has local changes; refusing to build");
  git("checkout", "--detach", sha);
  for (const command of config.gate) run(command, config.buildTree);
  run(["vp", "i"], config.buildTree);

  const out = join(config.root, `.build-${sha}`);
  const partial = `${releaseDir(config.root, sha)}.partial`;
  rmSync(out, { recursive: true, force: true });
  rmSync(partial, { recursive: true, force: true });
  run(
    [
      "node",
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      "--arch",
      "arm64",
      "--output-dir",
      out,
    ],
    config.buildTree,
  );
  const zip = spawnSync("sh", ["-c", `ls "${out}"/*.zip`], { encoding: "utf8" }).stdout.trim();
  if (!zip) throw new Error("build produced no zip");
  mkdirSync(partial, { recursive: true });
  run(["ditto", "-x", "-k", zip, partial], config.buildTree);
  writeFileSync(join(partial, COMPLETE_MARKER), `${sha}\n`);
  renameSync(partial, releaseDir(config.root, sha));
  rmSync(out, { recursive: true, force: true });
}

/** A job stuck in "spawn failed" can hang or ignore kickstart, so fall back to reloading it. */
function restartJob(): void {
  const target = `gui/${uid}/${config.label}`;
  const options = { stdio: "inherit", timeout: 20_000 } as const;
  if (spawnSync("launchctl", ["kickstart", "-k", target], options).status === 0) return;
  spawnSync("launchctl", ["bootout", target], options);
  // bootout finishes asynchronously, and bootstrap fails with an I/O error until it has.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    spawnSync("sleep", ["2"]);
    if (spawnSync("launchctl", ["bootstrap", `gui/${uid}`, agentPath], options).status === 0)
      return;
  }
}

async function restartAndProbe(previousPid: number | null): Promise<boolean> {
  restartJob();
  for (let waited = 0; waited < 90; waited += 3) {
    await sleep(3000);
    const pid = launchdPid(config.label, uid);
    if (pid && pid !== previousPid && (await probeHealth(config.port))) {
      await sleep(10_000); // a crash loop passes the first probe and fails the second
      return launchdPid(config.label, uid) === pid && (await probeHealth(config.port));
    }
  }
  return false;
}

async function deploy(ref: string): Promise<number> {
  const sha = git("rev-parse", "--short=10", `${ref}^{commit}`);
  const before = readCurrent(config.root);
  if (before === sha) return (log(`${sha} is already live`), 0);

  ensureDir(join(config.root, "releases"));
  const lock = join(config.root, ".deploy.lock");
  try {
    mkdirSync(lock);
  } catch {
    report("deploy refused: another deploy holds the lock", `lock: ${lock}`);
    return 1;
  }
  try {
    if (!isComplete(config.root, sha)) {
      log(`building ${sha}`);
      buildRelease(sha);
    }

    const deadline = Date.now() + Number(values["drain-timeout"]) * 1000;
    // Unreadable means no server holds the database; if one is answering, assume it is busy.
    const countRunning = async () =>
      countRunningSessions(stateDb) ?? ((await probeHealth(config.port)) ? 1 : 0);
    let running = await countRunning();
    while (running > 0 && !values.force && Date.now() < deadline) {
      log(`waiting for ${running} running turn(s)`);
      await sleep(15_000);
      running = await countRunning();
    }
    if (running > 0 && !values.force) {
      report(
        `deploy of ${sha} held: ${running} turn(s) still running`,
        "Re-run with --force to interrupt them.",
      );
      return 2;
    }

    const oldPid = launchdPid(config.label, uid);
    atomicSwap(config.root, sha);
    log(`swapped current ${before ?? "(none)"} -> ${sha}`);
    if (await restartAndProbe(oldPid)) {
      pruneReleases(config.root, config.keepReleases ?? 3);
      return 0;
    }

    const previous = readPrevious(config.root);
    if (!previous || !isComplete(config.root, previous)) {
      report(
        `MANUAL ACTION: ${sha} failed health check and there is no release to roll back to`,
        `current=${sha}`,
      );
      return 3;
    }
    atomicSwap(config.root, previous, { rollback: true });
    const recovered = await restartAndProbe(launchdPid(config.label, uid));
    report(
      recovered
        ? `deploy of ${sha} failed health check; rolled back to ${previous}`
        : `MANUAL ACTION: ${sha} failed and rollback to ${previous} is also unhealthy`,
      `label=${config.label} port=${config.port}`,
    );
    return recovered ? 4 : 3;
  } catch (error) {
    report(
      `deploy of ${sha} stopped before the swap`,
      String(error instanceof Error ? error.message : error),
    );
    return 1;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Builds a release without touching production, so the later deploy is only a swap. */
async function build(ref: string): Promise<number> {
  const sha = git("rev-parse", "--short=10", `${ref}^{commit}`);
  if (isComplete(config.root, sha)) return (log(`${sha} is already built`), 0);
  ensureDir(join(config.root, "releases"));
  const lock = join(config.root, ".deploy.lock");
  try {
    mkdirSync(lock);
  } catch {
    report("build refused: another deploy holds the lock", `lock: ${lock}`);
    return 1;
  }
  try {
    log(`building ${sha}`);
    buildRelease(sha);
    return 0;
  } catch (error) {
    report(`build of ${sha} failed`, String(error instanceof Error ? error.message : error));
    return 1;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

async function rollback(to?: string): Promise<number> {
  const target = to ?? readPrevious(config.root);
  if (!target || !isComplete(config.root, target)) {
    report("rollback impossible: no complete target release", `target=${target ?? "(none)"}`);
    return 1;
  }
  const oldPid = launchdPid(config.label, uid);
  atomicSwap(config.root, target, { rollback: true });
  const healthy = await restartAndProbe(oldPid);
  if (!healthy)
    report(`MANUAL ACTION: rollback to ${target} is unhealthy`, `label=${config.label}`);
  return healthy ? 0 : 3;
}

async function status(): Promise<number> {
  log(
    `current=${readCurrent(config.root) ?? "(none)"} previous=${readPrevious(config.root) ?? "(none)"}`,
  );
  log(`releases: ${listCompleteReleases(config.root).join(", ") || "(none)"}`);
  log(
    `launchd pid=${launchdPid(config.label, uid) ?? "(not running)"} healthy=${await probeHealth(config.port)}`,
  );
  log(
    `running turns: ${existsSync(stateDb) ? (countRunningSessions(stateDb) ?? "(unreadable)") : "(no database)"}`,
  );
  return 0;
}

function plist(): number {
  const logDir = join(config.root, "logs");
  ensureDir(logDir);
  const app = join(config.root, "current");
  const executable = spawnSync("sh", ["-c", `ls -d "${app}"/*.app/Contents/MacOS/*`], {
    encoding: "utf8",
  }).stdout.trim();
  if (!executable) throw new Error("no app under current; deploy a release first");
  writeFileSync(
    agentPath,
    renderLaunchAgent({
      label: config.label,
      executable,
      userDataDir: config.userDataDir,
      home: config.home,
      port: config.port,
      logDir,
    }),
  );
  log(`wrote ${agentPath}; load with: launchctl bootstrap gui/${uid} ${agentPath}`);
  return 0;
}

const [command, ref] = positionals;
const exitCode = await (async () => {
  switch (command) {
    case "build":
      if (ref) return build(ref);
      break;
    case "deploy":
      if (ref) return deploy(ref);
      break;
    case "rollback":
      return rollback(values.to);
    case "status":
      return status();
    case "plist":
      return plist();
  }
  console.error("usage: fork-deploy <build <ref> | deploy <ref> | rollback | status | plist>");
  return 64;
})();
process.exit(exitCode);
