#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
/**
 * Gated deploy of a packaged build to a single launchd-managed production instance.
 *
 *   node scripts/fork/fork-deploy.ts build <ref> [--bump <major|minor|patch>] [--version <x.y.z>] [--summary <t>] [--why <t>]
 *   node scripts/fork/fork-deploy.ts deploy <ref> [--force] [--drain-timeout <seconds>] [--first-boot-budget-seconds <seconds>] [--accept-data-loss] [same version flags]
 *   node scripts/fork/fork-deploy.ts rollback [--to <sha>] [--accept-data-loss]
 *   node scripts/fork/fork-deploy.ts status
 *   node scripts/fork/fork-deploy.ts version <ref> [--bump ...] [--version ...]
 *   node scripts/fork/fork-deploy.ts plist
 *
 * The first boot of an orchestration V2 build copies state.sqlite into statev2.sqlite before it
 * answers, so that one deploy probes for --first-boot-budget-seconds (default 240) and,
 * if it rolls back, moves only a proven fresh copy aside. Existing migrated V2 history is retained.
 * V2-to-V1 recovery hides new history/auth and requires --accept-data-loss; fix forward by default.
 * Versions: the fork ships its own semver line from 1.0.0. A fresh sha mints
 * the next version (bump level, default patch); a rebuild reuses the recorded
 * one. Minting requires --summary (what ships) and --why (why this level), so
 * the decision ledger in the deploy root records the reasoning. See
 * docs/fork/versioning.md for the bump rules.
 *
 * Machine-specific settings (paths, port, notifier) live in a JSON file outside git, named by
 * --config or FORK_DEPLOY_CONFIG. Only failures, holds, and rollbacks are reported; silence
 * means the deploy succeeded.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import {
  atomicSwap,
  releaseTransitionAllowed,
  classifyV2Copy,
  deployFailureMessage,
  COMPLETE_MARKER,
  countRunningSessions,
  countV2OnlyRows,
  ensureDir,
  isComplete,
  isQuiet,
  launchdPid,
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
import { restartStoppedJob } from "./fork-deploy-restart.ts";
import { FIRST_V2_BOOT_BUDGET_SECONDS, runGovernedCommand } from "./fork-deploy-command.ts";
import {
  appendBumpDecision,
  FORK_INITIAL_VERSION,
  type ForkBumpLevel,
  isForkVersion,
  latestRegistryVersion,
  listVersionedReleases,
  readReleaseVersion,
  readVersionRegistry,
  recordForkVersion,
  resolveForkVersion,
  versionForSha,
  writeReleaseVersion,
} from "./fork-versions.ts";

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

const { positionals, values } = NodeUtil.parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    force: { type: "boolean", default: false },
    "drain-timeout": { type: "string", default: "600" },
    to: { type: "string" },
    "first-boot-budget-seconds": { type: "string", default: String(FIRST_V2_BOOT_BUDGET_SECONDS) },
    "accept-data-loss": { type: "boolean", default: false },
    // Which segment to bump when a build mints a fresh version. Rebuilds of an
    // already-released sha reuse its version and ignore this.
    bump: { type: "string", default: "patch" },
    // Explicit version for this build, bypassing the bump. Must be unused.
    version: { type: "string" },
    // One line: what ships. Recorded in the decision ledger with --why.
    summary: { type: "string" },
    // Why this level and not the neighbors. Required when minting a version.
    why: { type: "string" },
  },
});

const configPath = values.config ?? process.env.FORK_DEPLOY_CONFIG ?? ".t3/fork-deploy.json";
const config: Config = JSON.parse(NodeFS.readFileSync(configPath, "utf8"));
const uid = process.getuid?.() ?? 501;
const agentPath = NodePath.join(
  NodeOS.homedir(),
  "Library",
  "LaunchAgents",
  `${config.label}.plist`,
);
const userdataDir = NodePath.join(config.home, "userdata");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message: string) => console.log(`fork-deploy: ${message}`);

function report(summary: string, body: string): void {
  console.error(`fork-deploy: ${summary}\n${body}`);
  if (!config.notify?.length) return;
  const [command, ...args] = config.notify;
  // A hung notifier (it once sat on a network call for hours) must not hold up the deploy.
  NodeChildProcess.spawnSync(
    command!,
    [...args, "--summary", summary.slice(0, 200), "--message", body],
    {
      stdio: "ignore",
      timeout: 30_000,
    },
  );
}

/** Runs a command with extra env vars, still scrubbed of the dev shell. */
function runWithEnv(
  command: readonly string[],
  cwd: string,
  extraEnv: Readonly<Record<string, string>>,
): void {
  runGovernedCommand({
    command,
    cwd,
    home: NodeOS.homedir(),
    buildPath: config.buildPath,
    callerEnv: process.env,
    extraEnv,
  });
}

/** Runs a command with only PATH and HOME, so nothing from an agent or dev shell leaks in. */
function run(command: readonly string[], cwd: string): void {
  runWithEnv(command, cwd, {});
}

function git(...args: string[]): string {
  const result = NodeChildProcess.spawnSync("git", ["-C", config.buildTree, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

const BUMP_LEVELS = ["major", "minor", "patch"] as const;

function parseBumpLevel(raw: string | undefined): ForkBumpLevel {
  const level = (raw ?? "patch").trim().toLowerCase();
  if (level === "major" || level === "minor" || level === "patch") return level;
  throw new Error(`--bump must be one of ${BUMP_LEVELS.join(", ")}, got "${raw}"`);
}

/**
 * Resolves the version a build of this sha ships as. A rebuild reuses the
 * recorded version; a fresh sha mints one from the bump level (or an explicit
 * --version) and records it, plus the decision rationale, before building.
 */
function resolveBuildVersion(fullSha: string): {
  readonly version: string;
  readonly fresh: boolean;
} {
  const registry = readVersionRegistry(config.root);
  const existing = versionForSha(registry, fullSha);
  if (existing) {
    log(`${existing.sha.slice(0, 10)} already shipped as ${existing.version}; reusing it`);
    return { version: existing.version, fresh: false };
  }
  const explicit = values.version?.trim();
  if (explicit) {
    if (!isForkVersion(explicit)) throw new Error(`--version "${explicit}" is not semver`);
    if (versionForSha(registry, fullSha)) {
      throw new Error(`sha ${fullSha} already has a version`);
    }
    for (const entry of Object.values(registry)) {
      if (entry.version === explicit) {
        throw new Error(`version ${explicit} already maps to ${entry.sha}; pick another`);
      }
    }
    const summary = values.summary?.trim();
    const why = values.why?.trim();
    if (!summary || !why) {
      throw new Error("--summary and --why are required when minting a version with --version");
    }
    recordForkVersion(config.root, fullSha, explicit);
    appendBumpDecision(config.root, {
      version: explicit,
      level: latestRegistryVersion(registry) ? parseBumpLevel(values.bump) : "patch",
      sha: fullSha,
      summary,
      rationale: `explicit --version: ${why}`,
    });
    return { version: explicit, fresh: true };
  }
  const level = parseBumpLevel(values.bump);
  const { version } = resolveForkVersion(registry, fullSha, level);
  const summary = values.summary?.trim();
  const why = values.why?.trim();
  if (!summary || !why) {
    throw new Error(
      `minting ${version} (${level} from ${latestRegistryVersion(registry) ?? "nothing"}): ` +
        "--summary and --why are required so the ledger records the bump decision",
    );
  }
  recordForkVersion(config.root, fullSha, version);
  appendBumpDecision(config.root, { version, level, sha: fullSha, summary, rationale: why });
  log(`minted fork version ${version} (${level}) for ${fullSha.slice(0, 10)}`);
  return { version, fresh: true };
}

function buildRelease(sha: string, version: string): void {
  if (git("status", "--porcelain"))
    throw new Error("build tree has local changes; refusing to build");
  git("checkout", "--detach", sha);
  for (const command of config.gate) run(command, config.buildTree);
  run(["vp", "i"], config.buildTree);

  const out = NodePath.join(config.root, `.build-${sha}`);
  const partial = `${releaseDir(config.root, sha)}.partial`;
  NodeFS.rmSync(out, { recursive: true, force: true });
  NodeFS.rmSync(partial, { recursive: true, force: true });
  // One version for every surface: the artifact, the bundled server, the web
  // client, and the mobile build when it runs through this path all read
  // T3CODE_FORK_VERSION.
  const versionEnv = { T3CODE_FORK_VERSION: version };
  runWithEnv(
    [
      "node",
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      "--arch",
      "arm64",
      "--build-version",
      version,
      "--output-dir",
      out,
    ],
    config.buildTree,
    versionEnv,
  );
  const zip = NodeChildProcess.spawnSync("sh", ["-c", `ls "${out}"/*.zip`], {
    encoding: "utf8",
  }).stdout.trim();
  if (!zip) throw new Error("build produced no zip");
  NodeFS.mkdirSync(partial, { recursive: true });
  run(["ditto", "-x", "-k", zip, partial], config.buildTree);
  NodeFS.writeFileSync(NodePath.join(partial, COMPLETE_MARKER), `${sha}\n`);
  writeReleaseVersion(config.root, `${sha}.partial`, version);
  // The release dir name is the destination: rename moves the version marker
  // with it, so the marker must be written to the partial path first.
  NodeFS.renameSync(partial, releaseDir(config.root, sha));
  NodeFS.rmSync(out, { recursive: true, force: true });
}

/**
 * Stops the job with `bootout` (SIGTERM, then SIGKILL after the plist's ExitTimeOut) so a V2
 * server shuts down gracefully and records restart-continuation intent; `kickstart -k` kills it
 * outright. Reloading also picks up a rewritten plist. `whileStopped` runs once the job is gone.
 */
function restartJob(whileStopped?: () => void): void {
  const target = `gui/${uid}/${config.label}`;
  const options = { stdio: "inherit", timeout: 20_000 } as const;
  const originalPid = launchdPid(config.label, uid);
  restartStoppedJob(
    {
      plistExists: () => NodeFS.existsSync(agentPath),
      bootout: () =>
        NodeChildProcess.spawnSync("launchctl", ["bootout", target], {
          ...options,
          timeout: 120_000,
        }).status,
      pid: () => {
        // launchd can forget the job before its process exits. Check the recorded PID too.
        if (originalPid !== null) {
          try {
            process.kill(originalPid, 0);
            return originalPid;
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
          }
        }
        return launchdPid(config.label, uid);
      },
      bootstrap: () =>
        NodeChildProcess.spawnSync("launchctl", ["bootstrap", `gui/${uid}`, agentPath], options)
          .status,
      now: () => Date.now(),
      wait: () => {
        NodeChildProcess.spawnSync("sleep", ["2"]);
      },
    },
    whileStopped,
  );
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
  const result = NodeChildProcess.spawnSync(
    file!,
    [...prefix, "drain", ...args, "--json", "--base-dir", config.home],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: { HOME: NodeOS.homedir(), PATH: config.buildPath, ELECTRON_RUN_AS_NODE: "1" },
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
  const fullSha = git("rev-parse", `${ref}^{commit}`);
  const before = readCurrent(config.root);
  if (before === sha) {
    const live = readReleaseVersion(config.root, sha);
    return (log(`${sha} is already live${live ? ` as fork ${live}` : ""}`), 0);
  }

  ensureDir(NodePath.join(config.root, "releases"));
  const lock = NodePath.join(config.root, ".deploy.lock");
  try {
    NodeFS.mkdirSync(lock);
  } catch {
    report("deploy refused: another deploy holds the lock", `lock: ${lock}`);
    return 1;
  }
  let draining = false;
  let swapped = false;
  try {
    const { version } = resolveBuildVersion(fullSha);
    if (!isComplete(config.root, sha)) {
      log(`building ${sha} as fork ${version}`);
      buildRelease(sha, version);
    } else if (readReleaseVersion(config.root, sha) !== version) {
      throw new Error(
        "cached artifact does not carry this fork version; build a new revision instead",
      );
    }

    const currentUsesV2 = before ? releaseUsesV2State(config.root, before) : null;
    const targetUsesV2 = releaseUsesV2State(config.root, sha);
    if (!releaseTransitionAllowed(currentUsesV2, targetUsesV2, false)) {
      const warning =
        "This transition can hide new V2 history and authentication sessions. statev2.sqlite is preserved; fix forward by default.";
      console.error(`fork-deploy: ${warning}`);
      if (!releaseTransitionAllowed(currentUsesV2, targetUsesV2, values["accept-data-loss"])) {
        report(
          `deploy of ${sha} refused: V2 history/auth loss was not accepted`,
          `current=${before ?? "unknown"}; ${warning} Use --accept-data-loss only after explicitly accepting that loss.`,
        );
        return 1;
      }
    }

    // A binary V1-to-V2 transition needs the longer probe budget. Copy ownership is separate.
    const firstV2Boot = before !== null && targetUsesV2 === true && currentUsesV2 === false;
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
    const servingUsesV2 = currentUsesV2;
    const countRunning = async () =>
      drainCommand(["status"])?.runningTurns ??
      (servingUsesV2 === null
        ? null
        : countRunningSessions(resolveStateDb(config.home, servingUsesV2))) ??
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
    log(`swapped current ${before ?? "(none)"} -> ${sha} (fork ${version})`);
    let ownsFreshV2Copy = false;
    if (
      await restartAndProbe(
        oldPid,
        bootBudget,
        firstV2Boot
          ? () => {
              ownsFreshV2Copy = classifyV2Copy(userdataDir) === "fresh";
            }
          : undefined,
      )
    ) {
      pruneReleases(config.root, config.keepReleases ?? 3);
      log(`${sha} (fork ${version}) is live and healthy on port ${config.port}`);
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
    if (
      !releaseTransitionAllowed(
        releaseUsesV2State(config.root, sha),
        releaseUsesV2State(config.root, previous),
        values["accept-data-loss"],
      )
    ) {
      report(
        `MANUAL ACTION: ${sha} failed health check; automatic rollback to ${previous} refused`,
        `current=${sha}; statev2.sqlite is preserved. Fix forward by default: rollback to V1 or an unknown generation can hide new V2 history and authentication sessions. Use rollback --to ${previous} --accept-data-loss only after explicitly accepting that loss.`,
      );
      return 3;
    }
    atomicSwap(config.root, previous, { rollback: true });
    const recovered = await restartAndProbe(
      launchdPid(config.label, uid),
      90,
      ownsFreshV2Copy
        ? () =>
            log(
              `moved the failed V2 copy aside (${moveStateV2Aside(userdataDir, new Date()).join(", ")}); ` +
                "run v2-cutover-prepare again before the next attempt",
            )
        : undefined,
    );
    if (firstV2Boot && !ownsFreshV2Copy)
      log(
        "retained existing statev2.sqlite; preserve V2 history on the next attempt, do not recopy V1",
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
      deployFailureMessage(sha, swapped, readCurrent(config.root)),
      String(error instanceof Error ? error.message : error),
    );
    return 1;
  } finally {
    if (draining && !swapped) stopDrain();
    NodeFS.rmSync(lock, { recursive: true, force: true });
  }
}

/** Builds a release without touching production, so the later deploy is only a swap. */
async function build(ref: string): Promise<number> {
  const sha = git("rev-parse", "--short=10", `${ref}^{commit}`);
  const fullSha = git("rev-parse", `${ref}^{commit}`);
  if (isComplete(config.root, sha)) {
    const existing = readReleaseVersion(config.root, sha);
    if (!existing) throw new Error("cached artifact is unversioned; build a new revision instead");
    return (log(`${sha} is already built${existing ? ` as fork ${existing}` : ""}`), 0);
  }
  ensureDir(NodePath.join(config.root, "releases"));
  const lock = NodePath.join(config.root, ".deploy.lock");
  try {
    NodeFS.mkdirSync(lock);
  } catch {
    report("build refused: another deploy holds the lock", `lock: ${lock}`);
    return 1;
  }
  try {
    const { version } = resolveBuildVersion(fullSha);
    log(`building ${sha} as fork ${version}`);
    buildRelease(sha, version);
    return 0;
  } catch (error) {
    report(`build of ${sha} failed`, String(error instanceof Error ? error.message : error));
    return 1;
  } finally {
    NodeFS.rmSync(lock, { recursive: true, force: true });
  }
}

async function rollback(to?: string): Promise<number> {
  const target = to ?? readPrevious(config.root);
  if (!target || !isComplete(config.root, target)) {
    report("rollback impossible: no complete target release", `target=${target ?? "(none)"}`);
    return 1;
  }
  const current = readCurrent(config.root);
  const currentUsesV2 = current ? releaseUsesV2State(config.root, current) : null;
  const targetUsesV2 = releaseUsesV2State(config.root, target);
  if (!releaseTransitionAllowed(currentUsesV2, targetUsesV2, false)) {
    const hidden = countV2OnlyRows(userdataDir);
    const counts = hidden
      ? `${hidden.threads} thread(s) and ${hidden.messages} message(s)`
      : "an unknown number of threads and messages";
    console.error(
      `fork-deploy: ${target} may read state.sqlite as of the V2 cutover; ${counts} created on V2 ` +
        "may be hidden (statev2.sqlite is kept), and authentication sessions paired since may need pairing again. Fix forward by default.",
    );
    if (!releaseTransitionAllowed(currentUsesV2, targetUsesV2, values["accept-data-loss"])) {
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
  const current = readCurrent(config.root);
  const previous = readPrevious(config.root);
  const versionOf = (sha: string | null) =>
    sha ? (readReleaseVersion(config.root, sha) ?? "(unversioned)") : "(none)";
  log(`current=${current ?? "(none)"} fork=${versionOf(current)} previous=${previous ?? "(none)"}`);
  const releases = listVersionedReleases(config.root);
  log(
    `releases: ${
      releases.map((sha) => `${sha}@${readReleaseVersion(config.root, sha) ?? "?"}`).join(", ") ||
      "(none)"
    }`,
  );
  const registry = readVersionRegistry(config.root);
  const latest = latestRegistryVersion(registry);
  log(
    `fork line: latest=${latest ?? `(none; next build mints ${FORK_INITIAL_VERSION})`} ` +
      `registry=${Object.keys(registry).length} release(s)`,
  );
  log(
    `launchd pid=${launchdPid(config.label, uid) ?? "(not running)"} healthy=${await probeHealth(config.port)}`,
  );
  const servingUsesV2 = current ? releaseUsesV2State(config.root, current) : null;
  const stateDb = servingUsesV2 === null ? null : resolveStateDb(config.home, servingUsesV2);
  log(
    `running turns: ${drainCommand(["status"])?.runningTurns ?? (stateDb === null ? "(unknown serving generation)" : NodeFS.existsSync(stateDb) ? (countRunningSessions(stateDb) ?? "(unreadable)") : "(no database)")} (${stateDb ?? "unknown"})`,
  );
  return 0;
}

/** Prints the version a ref would ship as, without building. */
function version(ref: string): number {
  const fullSha = git("rev-parse", `${ref}^{commit}`);
  const registry = readVersionRegistry(config.root);
  const existing = versionForSha(registry, fullSha);
  if (existing) {
    log(`${fullSha.slice(0, 10)} already shipped as fork ${existing.version}`);
    return 0;
  }
  const explicit = values.version?.trim();
  if (explicit) {
    if (!isForkVersion(explicit)) throw new Error(`--version "${explicit}" is not semver`);
    log(`${fullSha.slice(0, 10)} would ship as fork ${explicit} (explicit)`);
    return 0;
  }
  const level = parseBumpLevel(values.bump);
  const { version: next } = resolveForkVersion(registry, fullSha, level);
  log(
    `${fullSha.slice(0, 10)} would ship as fork ${next} ` +
      `(${level} from ${latestRegistryVersion(registry) ?? "nothing"})`,
  );
  return 0;
}

function plist(): number {
  const logDir = NodePath.join(config.root, "logs");
  ensureDir(logDir);
  const app = NodePath.join(config.root, "current");
  const executable = NodeChildProcess.spawnSync(
    "sh",
    ["-c", `ls -d "${app}"/*.app/Contents/MacOS/*`],
    {
      encoding: "utf8",
    },
  ).stdout.trim();
  if (!executable) throw new Error("no app under current; deploy a release first");
  NodeFS.writeFileSync(
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
    case "version":
      if (ref) return version(ref);
      break;
    case "plist":
      return plist();
  }
  console.error(
    "usage: fork-deploy <build <ref> [--bump <major|minor|patch>] [--version <x.y.z>] [--summary <text>] [--why <text>] | deploy <ref> [same version flags] [--force] [--first-boot-budget-seconds 240] [--accept-data-loss] | rollback [--accept-data-loss] | status | version <ref> | plist>",
  );
  return 64;
})();
process.exit(exitCode);
