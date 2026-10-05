#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
/**
 * Gated deploy of a packaged build to a single launchd-managed production instance.
 *
 *   node scripts/fork/fork-deploy.ts build <ref>
 *   node scripts/fork/fork-deploy.ts deploy <ref> [--force] [--drain-timeout <seconds>]
 *       [--first-boot-budget-seconds <seconds>]
 *   node scripts/fork/fork-deploy.ts rollback [--to <sha>] [--accept-data-loss]
 *   node scripts/fork/fork-deploy.ts status
 *   node scripts/fork/fork-deploy.ts plist
 *
 * The first boot of an orchestration V2 build copies state.sqlite into statev2.sqlite before it
 * answers, so that one deploy probes for --first-boot-budget-seconds (default 90; use 240) and,
 * if it rolls back, moves the copy aside so the next attempt copies again. Rolling back from V2
 * to v1 hides everything written since the cutover, so it needs --accept-data-loss.
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
  countV2OnlyRows,
  ensureDir,
  isComplete,
  isQuiet,
  launchdPid,
  listCompleteReleases,
  moveStateV2Aside,
  parseDrainStatus,
  parseSeconds,
  probeHealth,
  pruneReleases,
  readCurrent,
  readPrevious,
  releaseDir,
  releaseUsesV2State,
  renderLaunchAgent,
  resolveStateDb,
  serverCliCommand,
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
    "first-boot-budget-seconds": { type: "string", default: "90" },
    "accept-data-loss": { type: "boolean", default: false },
  },
});

const configPath = values.config ?? process.env.FORK_DEPLOY_CONFIG ?? ".t3/fork-deploy.json";
const config: Config = JSON.parse(readFileSync(configPath, "utf8"));
const uid = process.getuid?.() ?? 501;
const agentPath = join(homedir(), "Library", "LaunchAgents", `${config.label}.plist`);
const userdataDir = join(config.home, "userdata");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message: string) => console.log(`fork-deploy: ${message}`);

function report(summary: string, body: string): void {
  console.error(`fork-deploy: ${summary}\n${body}`);
  if (!config.notify?.length) return;
  const [command, ...args] = config.notify;
  // A hung notifier (it once sat on a network call for hours) must not hold up the deploy.
  spawnSync(command!, [...args, "--summary", summary.slice(0, 200), "--message", body], {
    stdio: "ignore",
    timeout: 30_000,
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

/**
 * Stops the job with `bootout` (SIGTERM, then SIGKILL after the plist's ExitTimeOut) so a V2
 * server shuts down gracefully and records restart-continuation intent; `kickstart -k` kills it
 * outright. Reloading also picks up a rewritten plist. `whileStopped` runs once the job is gone.
 */
function restartJob(whileStopped?: () => void): void {
  const target = `gui/${uid}/${config.label}`;
  const options = { stdio: "inherit", timeout: 20_000 } as const;
  if (!existsSync(agentPath)) {
    log(`no ${agentPath}; restarting with kickstart, which skips graceful shutdown`);
    spawnSync("launchctl", ["kickstart", "-k", target], options);
    return;
  }
  spawnSync("launchctl", ["bootout", target], { ...options, timeout: 120_000 });
  // bootout finishes asynchronously, and bootstrap fails with an I/O error until it has.
  for (let waited = 0; waited < 90 && launchdPid(config.label, uid) !== null; waited += 2) {
    spawnSync("sleep", ["2"]);
  }
  try {
    whileStopped?.();
  } catch (error) {
    // The job must come back regardless; the caller's report covers the rest.
    log(`while stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    spawnSync("sleep", ["2"]);
    if (spawnSync("launchctl", ["bootstrap", `gui/${uid}`, agentPath], options).status === 0)
      return;
  }
}

async function restartAndProbe(
  previousPid: number | null,
  budgetSeconds = 90,
  whileStopped?: () => void,
): Promise<boolean> {
  restartJob(whileStopped);
  for (let waited = 0; waited < budgetSeconds; waited += 3) {
    await sleep(3000);
    const pid = launchdPid(config.label, uid);
    if (pid && pid !== previousPid && (await probeHealth(config.port))) {
      await sleep(10_000); // a crash loop passes the first probe and fails the second
      return launchdPid(config.label, uid) === pid && (await probeHealth(config.port));
    }
  }
  return false;
}

/**
 * Runs `t3 drain <args>` from the release that is serving now, since drain mode lives in that
 * process's memory. Null when that release has no drain command (a server built before drain mode
 * existed), the server is not running, or the call fails.
 */
function drainCommand(args: readonly string[]) {
  const release = readCurrent(config.root);
  const command = release ? serverCliCommand(config.root, release) : null;
  if (!command) return null;
  const [file, ...prefix] = command;
  const result = spawnSync(
    file!,
    [...prefix, "drain", ...args, "--json", "--base-dir", config.home],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: { HOME: homedir(), PATH: config.buildPath, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  return result.status === 0 ? parseDrainStatus(result.stdout) : null;
}

/** Switches drain mode on, so new turns are refused while running ones finish. */
function startDrain(ttlSeconds: number): boolean {
  const status = drainCommand(["on", "--ttl", String(Math.min(ttlSeconds, 86_400))]);
  if (status?.draining) return (log("drain mode on: new turns are refused until the swap"), true);
  log("the running release has no drain mode; waiting for turns without it");
  return false;
}

function stopDrain(): void {
  const status = drainCommand(["off"]);
  log(status && !status.draining ? "drain mode off" : "could not confirm drain mode is off");
}

/** Polls of the running-turn count that must all read zero before a drained swap. */
const QUIET_POLLS = 3;

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
  let draining = false;
  let swapped = false;
  try {
    if (!isComplete(config.root, sha)) {
      log(`building ${sha}`);
      buildRelease(sha);
    }

    // A first V2 boot copies the v1 database before it answers, so it gets the longer budget,
    // and a failed one leaves a copy that must not be reused (see moveStateV2Aside).
    const firstV2Boot =
      before !== null &&
      releaseUsesV2State(config.root, sha) === true &&
      releaseUsesV2State(config.root, before) === false;
    const bootBudget = firstV2Boot
      ? parseSeconds(values["first-boot-budget-seconds"], "--first-boot-budget-seconds")
      : 90;
    if (firstV2Boot) log(`first V2 boot: probing for up to ${bootBudget}s`);

    const drainSeconds = Number(values["drain-timeout"]);
    const deadline = Date.now() + drainSeconds * 1000;
    // Drain first, so the count can only fall; --force interrupts instead and needs no drain.
    draining = !values.force && startDrain(drainSeconds + 600);
    // The serving release's own count first; then the database it uses. Unreadable means no
    // server holds the database; if one is answering, assume it is busy.
    const countRunning = async () =>
      drainCommand(["status"])?.runningTurns ??
      countRunningSessions(resolveStateDb(config.home)) ??
      ((await probeHealth(config.port)) ? 1 : 0);
    // Drained, a single zero is not proof: a command that cleared the guard just before it came
    // on can still start a turn, so require several in a row.
    const quietPolls = draining ? QUIET_POLLS : 1;
    const polls = [await countRunning()];
    while (!values.force && !isQuiet(polls, quietPolls) && Date.now() < deadline) {
      log(`waiting for ${polls.at(-1)} running turn(s)`);
      await sleep(draining ? 5_000 : 15_000);
      polls.push(await countRunning());
    }
    if (!values.force && !isQuiet(polls, quietPolls)) {
      report(
        `deploy of ${sha} held: ${polls.at(-1)} turn(s) still running`,
        "Re-run with --force to interrupt them.",
      );
      return 2;
    }

    const oldPid = launchdPid(config.label, uid);
    atomicSwap(config.root, sha);
    swapped = true; // the restart clears drain mode, so it is only switched off when no swap happened
    log(`swapped current ${before ?? "(none)"} -> ${sha}`);
    if (await restartAndProbe(oldPid, bootBudget)) {
      pruneReleases(config.root, config.keepReleases ?? 3);
      log(`${sha} is live and healthy on port ${config.port}`);
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
    const recovered = await restartAndProbe(
      launchdPid(config.label, uid),
      90,
      firstV2Boot
        ? () =>
            log(
              `moved the failed V2 copy aside (${moveStateV2Aside(userdataDir, new Date()).join(", ")}); ` +
                "run v2-cutover-prepare again before the next attempt",
            )
        : undefined,
    );
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
    if (draining && !swapped) stopDrain();
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
  const current = readCurrent(config.root);
  if (
    current !== null &&
    releaseUsesV2State(config.root, current) === true &&
    releaseUsesV2State(config.root, target) !== true
  ) {
    const hidden = countV2OnlyRows(userdataDir);
    const counts = hidden
      ? `${hidden.threads} thread(s) and ${hidden.messages} message(s)`
      : "an unknown number of threads and messages";
    console.error(
      `fork-deploy: ${target} reads state.sqlite as of the V2 cutover; ${counts} created on V2 ` +
        "will be hidden (statev2.sqlite is kept), and sessions paired since must pair again.",
    );
    if (!values["accept-data-loss"]) {
      console.error("fork-deploy: re-run with --accept-data-loss to roll back anyway");
      return 1;
    }
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
  const stateDb = resolveStateDb(config.home);
  log(
    `running turns: ${drainCommand(["status"])?.runningTurns ?? (existsSync(stateDb) ? (countRunningSessions(stateDb) ?? "(unreadable)") : "(no database)")} (${stateDb})`,
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
  console.error(
    "usage: fork-deploy <build <ref> | deploy <ref> [--first-boot-budget-seconds 240] | rollback [--accept-data-loss] | status | plist>",
  );
  return 64;
})();
process.exit(exitCode);
