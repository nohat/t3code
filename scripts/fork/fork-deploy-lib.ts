// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

/**
 * Layout under the deploy root:
 *   releases/<sha>/            immutable unpacked app, marked by .release-complete
 *   current -> releases/<sha>  what launchd runs
 *   .previous                  sha that was live before the last swap (rollback target)
 */
export const COMPLETE_MARKER = ".release-complete";

export const releaseDir = (root: string, sha: string) => join(root, "releases", sha);

export const isComplete = (root: string, sha: string) =>
  existsSync(join(releaseDir(root, sha), COMPLETE_MARKER));

export function readCurrent(root: string): string | null {
  try {
    return basename(realpathSync(join(root, "current")));
  } catch {
    return null;
  }
}

export function readPrevious(root: string): string | null {
  try {
    return readFileSync(join(root, ".previous"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Repoint `current` in one rename, so launchd never sees a missing link. */
export function atomicSwap(
  root: string,
  sha: string,
  options?: { readonly rollback?: boolean },
): void {
  if (!isComplete(root, sha)) throw new Error(`release ${sha} is missing or incomplete`);
  const before = readCurrent(root);
  // A rollback must not make the release it abandoned the next rollback target.
  if (before && before !== sha && !options?.rollback) {
    writeFileSync(join(root, ".previous"), `${before}\n`);
  }
  const tmp = join(root, `.current.${process.pid}`);
  rmSync(tmp, { force: true });
  symlinkSync(join("releases", sha), tmp);
  renameSync(tmp, join(root, "current"));
}

export function listCompleteReleases(root: string): string[] {
  const dir = join(root, "releases");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => isComplete(root, name))
    .sort((a, b) => statSync(releaseDir(root, b)).mtimeMs - statSync(releaseDir(root, a)).mtimeMs);
}

/** Keeps `current`, the rollback target, and the newest `keep` releases. */
export function pruneReleases(root: string, keep: number): string[] {
  const sacred = new Set([readCurrent(root), readPrevious(root)]);
  const removed: string[] = [];
  for (const sha of listCompleteReleases(root).slice(keep)) {
    if (sacred.has(sha)) continue;
    rmSync(releaseDir(root, sha), { recursive: true, force: true });
    removed.push(sha);
  }
  return removed;
}

export const STATE_DB_V1 = "state.sqlite";
export const STATE_DB_V2 = "statev2.sqlite";

/** Selects the serving release's database, including after a rollback that retains V2 data. */
export function resolveStateDb(home: string, servingUsesV2: boolean | null): string {
  if (servingUsesV2 === null) {
    throw new Error("cannot identify the serving release database generation");
  }
  return join(home, "userdata", servingUsesV2 ? STATE_DB_V2 : STATE_DB_V1);
}

/**
 * Running-turn query for either database generation. The V2 one matches the server's
 * `t3 drain status` count: queued runs the user has not held start when the active run ends.
 */
export function runningSessionsQuery(stateDb: string): string {
  return basename(stateDb) === STATE_DB_V2
    ? "select count(*) from orchestration_v2_projection_runs where status in ('preparing','starting','running') or (status = 'queued' and json_extract(payload_json, '$.queueHeld') is not 1);"
    : "select count(*) from projection_thread_sessions where status = 'running';";
}

/**
 * Threads with a turn in flight, or null when the database cannot be read (a read-only open of a
 * WAL database fails while no server is running). Opens the live database read-only. Prefer the
 * running server's own count (`t3 drain status`); this is the fallback.
 */
export function countRunningSessions(stateDb: string): number | null {
  const result = spawnSync("sqlite3", ["-readonly", stateDb, runningSessionsQuery(stateDb)], {
    encoding: "utf8",
  });
  return result.status === 0 ? Number.parseInt(result.stdout.trim(), 10) : null;
}

/**
 * Whether a release's server uses `statev2.sqlite` (orchestration V2), or null when its bundle
 * cannot be read. The packaged server names the file, so its presence in `app.asar` marks a V2
 * build; asar stores files uncompressed.
 */
export function releaseUsesV2State(root: string, sha: string): boolean | null {
  const bin = serverCliCommand(root, sha)?.[1];
  if (!bin) return null;
  const asar = bin.slice(0, bin.indexOf("app.asar") + "app.asar".length);
  const result = spawnSync("grep", ["-q", "-a", "-F", STATE_DB_V2, asar]);
  return result.status === 0 ? true : result.status === 1 ? false : null;
}

/**
 * Rows a rollback from V2 to v1 would hide: threads and messages in `statev2.sqlite` that the
 * frozen `state.sqlite` does not have. Both files are opened read-only. Null when unreadable.
 */
export function countV2OnlyRows(
  userdataDir: string,
): { readonly threads: number; readonly messages: number } | null {
  const v1 = join(userdataDir, STATE_DB_V1);
  const v2 = join(userdataDir, STATE_DB_V2);
  if (!existsSync(v1) || !existsSync(v2)) return null;
  const result = spawnSync(
    "sqlite3",
    [
      "-readonly",
      v2,
      `attach 'file:${v1.replaceAll("'", "''")}?mode=ro' as v1;`,
      "select (select count(*) from orchestration_v2_projection_threads t where not exists (select 1 from v1.projection_threads o where o.thread_id = t.thread_id)) || ' ' || (select count(*) from orchestration_v2_projection_messages m where not exists (select 1 from v1.projection_thread_messages o where o.message_id = m.message_id));",
    ],
    { encoding: "utf8" },
  );
  const [threads, messages] = result.stdout.trim().split(" ").map(Number);
  return result.status === 0 && Number.isInteger(threads) && Number.isInteger(messages)
    ? { threads: threads!, messages: messages! }
    : null;
}

/**
 * Where a failed V2 boot's database goes: `statev2.sqlite-wal` becomes
 * `statev2.failed-<stamp>.sqlite-wal`, so the three files still open together.
 */
export function movedAsideName(file: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return file.replace(STATE_DB_V2, `statev2.failed-${stamp}.sqlite`);
}

/**
 * Renames `statev2.sqlite` and its WAL and SHM files aside so the next V2 boot copies
 * `state.sqlite` again instead of reusing a copy from a failed attempt. Never deletes, never
 * overwrites. Returns the new paths. Call only while no server has the files open.
 */
export function moveStateV2Aside(userdataDir: string, now: Date): string[] {
  const files = ["", "-wal", "-shm"]
    .map((suffix) => join(userdataDir, `${STATE_DB_V2}${suffix}`))
    .filter((file) => existsSync(file));
  const moves = files.map((file) => [file, movedAsideName(file, now)] as const);
  const taken = moves.find(([, target]) => existsSync(target));
  if (taken) throw new Error(`refusing to overwrite ${taken[1]}`);
  for (const [file, target] of moves) renameSync(file, target);
  return moves.map(([, target]) => target);
}

/** Reads a whole number of seconds from a flag, or throws naming the flag. */
export function parseSeconds(raw: string | undefined, flag: string): number {
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error(`${flag} must be a whole number of seconds, got "${raw}"`);
  }
  return seconds;
}

export async function probeHealth(port: number, timeoutMs = 5000): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export function launchdPid(label: string, uid: number): number | null {
  const result = spawnSync("launchctl", ["print", `gui/${uid}/${label}`], { encoding: "utf8" });
  const match = /^\s*pid = (\d+)/m.exec(result.stdout);
  return match?.[1] ? Number(match[1]) : null;
}

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * How long launchd waits between SIGTERM and SIGKILL. A V2 server spends this capturing
 * restart-continuation intent and reconciling runs, so it must outlast a busy shutdown.
 */
export const LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS = 60;

/**
 * LaunchAgent that runs the app from the `current` link. Restarts only after a crash, so a
 * deliberate quit stays quit. Nothing here names a checkout, so a file save cannot touch it.
 */
export function renderLaunchAgent(options: {
  readonly label: string;
  readonly executable: string;
  readonly userDataDir: string;
  readonly home: string;
  readonly port: number;
  readonly logDir: string;
}): string {
  const env = {
    T3CODE_HOME: options.home,
    T3CODE_PORT: String(options.port),
    T3CODE_TELEMETRY_ENABLED: "false",
  };
  const envEntries = Object.entries(env)
    .map(([key, value]) => `    <key>${key}</key><string>${xml(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.executable)}</string>
    <string>--user-data-dir=${xml(options.userDataDir)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ExitTimeOut</key><integer>${LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS}</integer>
  <key>StandardOutPath</key><string>${xml(join(options.logDir, "prod.out.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(options.logDir, "prod.err.log"))}</string>
</dict>
</plist>
`;
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/**
 * The command that runs a release's packaged server CLI (`t3 ...`) under Electron's own Node, or
 * null when the release has no app. The running server's own release is the one to ask: drain mode
 * lives in that process's memory.
 */
export function serverCliCommand(root: string, sha: string): readonly string[] | null {
  const dir = releaseDir(root, sha);
  if (!existsSync(dir)) return null;
  const app = readdirSync(dir).find((name) => name.endsWith(".app"));
  if (!app) return null;
  const macOs = join(dir, app, "Contents", "MacOS");
  const executable = existsSync(macOs) ? readdirSync(macOs)[0] : undefined;
  if (!executable) return null;
  return [
    join(macOs, executable),
    join(dir, app, "Contents", "Resources", "app.asar", "apps", "server", "dist", "bin.mjs"),
  ];
}

export interface DrainStatus {
  readonly draining: boolean;
  readonly runningTurns: number;
}

/** Reads the `t3 drain ... --json` output, or null when it is not a drain status. */
export function parseDrainStatus(stdout: string): DrainStatus | null {
  try {
    const value: unknown = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    if (typeof value !== "object" || value === null) return null;
    const { draining, runningTurns } = value as Record<string, unknown>;
    return typeof draining === "boolean" && typeof runningTurns === "number"
      ? { draining, runningTurns }
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether the running-turn counts say it is safe to swap: the last `required` polls were all zero.
 * One zero is not proof, because a command that passed the drain guard just before it switched on
 * can still start a turn.
 */
export function isQuiet(polls: readonly number[], required: number): boolean {
  return polls.length >= required && polls.slice(-required).every((count) => count === 0);
}
