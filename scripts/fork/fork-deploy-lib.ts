// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";
import * as NodePath from "node:path";

/**
 * Layout under the deploy root:
 *   releases/<sha>/            immutable unpacked app, marked by .release-complete
 *   current -> releases/<sha>  what launchd runs
 *   .previous                  sha that was live before the last swap (rollback target)
 *   .pinned-releases           operator-owned release IDs retained across later swaps
 */
export const COMPLETE_MARKER = ".release-complete";
/** Operator-owned newline-separated release IDs; pruning never rewrites this file. */
export const PINNED_RELEASES_FILE = ".pinned-releases";

/** Classify only while stopped. Any migrated, unreadable or unfamiliar copy is retained. */
export function classifyV2Copy(userdataDir: string): "fresh" | "retained" {
  const path = NodePath.join(userdataDir, STATE_DB_V2);
  if (!NodeFS.existsSync(path)) {
    return ["-wal", "-shm"].some((suffix) => NodeFS.existsSync(`${path}${suffix}`))
      ? "retained"
      : "fresh";
  }
  try {
    const db = new NodeSqlite.DatabaseSync(path, { readOnly: true });
    try {
      const names = db.prepare("select name from sqlite_master where type = 'table'").all();
      const tables = new Set(names.map((row) => String(row.name)));
      if ([...tables].some((name) => name.startsWith("orchestration_v2_"))) return "retained";
      if (!tables.has("projection_threads") || !tables.has("effect_sql_migrations"))
        return "retained";
      const ledger = db
        .prepare("select max(migration_id) as maximum from effect_sql_migrations")
        .get();
      return typeof ledger?.maximum === "number" && ledger.maximum < 55 ? "fresh" : "retained";
    } finally {
      db.close();
    }
  } catch {
    return "retained";
  }
}

export const releaseDir = (root: string, sha: string) => NodePath.join(root, "releases", sha);

export const isComplete = (root: string, sha: string) =>
  NodeFS.existsSync(NodePath.join(releaseDir(root, sha), COMPLETE_MARKER));

export function readCurrent(root: string): string | null {
  try {
    return NodePath.basename(NodeFS.realpathSync(NodePath.join(root, "current")));
  } catch {
    return null;
  }
}

export function readPrevious(root: string): string | null {
  try {
    return NodeFS.readFileSync(NodePath.join(root, ".previous"), "utf8").trim() || null;
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
    NodeFS.writeFileSync(NodePath.join(root, ".previous"), `${before}\n`);
  }
  const tmp = NodePath.join(root, `.current.${process.pid}`);
  NodeFS.rmSync(tmp, { force: true });
  NodeFS.symlinkSync(NodePath.join("releases", sha), tmp);
  NodeFS.renameSync(tmp, NodePath.join(root, "current"));
}

export function listCompleteReleases(root: string): string[] {
  const dir = NodePath.join(root, "releases");
  if (!NodeFS.existsSync(dir)) return [];
  return NodeFS.readdirSync(dir)
    .filter((name) => isComplete(root, name))
    .sort(
      (a, b) =>
        NodeFS.statSync(releaseDir(root, b)).mtimeMs - NodeFS.statSync(releaseDir(root, a)).mtimeMs,
    );
}

/** Keeps current, previous, explicit durable pins and the newest `keep` releases. */
export function pruneReleases(root: string, keep: number): string[] {
  const pinsPath = NodePath.join(root, PINNED_RELEASES_FILE);
  // A present but unreadable pin file must abort pruning rather than discard recovery.
  const pins = NodeFS.existsSync(pinsPath)
    ? NodeFS.readFileSync(pinsPath, "utf8").split(/\s+/).filter(Boolean)
    : [];
  const sacred = new Set([readCurrent(root), readPrevious(root), ...pins]);
  const removed: string[] = [];
  for (const sha of listCompleteReleases(root).slice(keep)) {
    if (sacred.has(sha)) continue;
    NodeFS.rmSync(releaseDir(root, sha), { recursive: true, force: true });
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
  return NodePath.join(home, "userdata", servingUsesV2 ? STATE_DB_V2 : STATE_DB_V1);
}

/**
 * Running-turn query for either database generation. The V2 one matches the server's
 * `t3 drain status` count: queued runs the user has not held start when the active run ends.
 */
export function runningSessionsQuery(stateDb: string): string {
  return NodePath.basename(stateDb) === STATE_DB_V2
    ? "select count(*) from orchestration_v2_projection_runs where status in ('preparing','starting','running') or (status = 'queued' and json_extract(payload_json, '$.queueHeld') is not 1);"
    : "select count(*) from projection_thread_sessions where status = 'running';";
}

/**
 * Threads with a turn in flight, or null when the database cannot be read (a read-only open of a
 * WAL database fails while no server is running). Opens the live database read-only. Prefer the
 * running server's own count (`t3 drain status`); this is the fallback.
 */
export function countRunningSessions(stateDb: string): number | null {
  const result = NodeChildProcess.spawnSync(
    "sqlite3",
    ["-readonly", stateDb, runningSessionsQuery(stateDb)],
    {
      encoding: "utf8",
    },
  );
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
  const result = NodeChildProcess.spawnSync("grep", ["-q", "-a", "-F", STATE_DB_V2, asar]);
  return result.status === 0 ? true : result.status === 1 ? false : null;
}

/**
 * Rows a rollback from V2 to v1 would hide: threads and messages in `statev2.sqlite` that the
 * frozen `state.sqlite` does not have. Both files are opened read-only. Null when unreadable.
 */
export function countV2OnlyRows(
  userdataDir: string,
): { readonly threads: number; readonly messages: number } | null {
  const v1 = NodePath.join(userdataDir, STATE_DB_V1);
  const v2 = NodePath.join(userdataDir, STATE_DB_V2);
  if (!NodeFS.existsSync(v1) || !NodeFS.existsSync(v2)) return null;
  const result = NodeChildProcess.spawnSync(
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
    .map((suffix) => NodePath.join(userdataDir, `${STATE_DB_V2}${suffix}`))
    .filter((file) => NodeFS.existsSync(file));
  const moves = files.map((file) => [file, movedAsideName(file, now)] as const);
  const taken = moves.find(([, target]) => NodeFS.existsSync(target));
  if (taken) throw new Error(`refusing to overwrite ${taken[1]}`);
  for (const [file, target] of moves) NodeFS.renameSync(file, target);
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
  const result = NodeChildProcess.spawnSync("launchctl", ["print", `gui/${uid}/${label}`], {
    encoding: "utf8",
  });
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
  <key>StandardOutPath</key><string>${xml(NodePath.join(options.logDir, "prod.out.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(NodePath.join(options.logDir, "prod.err.log"))}</string>
</dict>
</plist>
`;
}

export function ensureDir(path: string): void {
  NodeFS.mkdirSync(path, { recursive: true });
}

/**
 * The command that runs a release's packaged server CLI (`t3 ...`) under Electron's own Node, or
 * null when the release has no app. The running server's own release is the one to ask: drain mode
 * lives in that process's memory.
 */
export function serverCliCommand(root: string, sha: string): readonly string[] | null {
  const dir = releaseDir(root, sha);
  if (!NodeFS.existsSync(dir)) return null;
  const app = NodeFS.readdirSync(dir).find((name) => name.endsWith(".app"));
  if (!app) return null;
  const macOs = NodePath.join(dir, app, "Contents", "MacOS");
  const executable = NodeFS.existsSync(macOs) ? NodeFS.readdirSync(macOs)[0] : undefined;
  if (!executable) return null;
  return [
    NodePath.join(macOs, executable),
    NodePath.join(
      dir,
      app,
      "Contents",
      "Resources",
      "app.asar",
      "apps",
      "server",
      "dist",
      "bin.mjs",
    ),
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

export function deployFailureMessage(
  sha: string,
  swapped: boolean,
  current: string | null,
): string {
  return swapped
    ? `MANUAL ACTION: deploy of ${sha} failed after the swap; current=${current ?? "unknown"}`
    : `deploy of ${sha} stopped before the swap`;
}

/** Unknown generations cannot prove that automatic recovery preserves V2 history and auth. */
export function automaticRollbackAllowed(
  candidateUsesV2: boolean | null,
  previousUsesV2: boolean | null,
  acceptDataLoss: boolean,
): boolean {
  return releaseTransitionAllowed(candidateUsesV2, previousUsesV2, acceptDataLoss);
}

/** Shared by deploy, explicit rollback and failed-boot recovery before changing generations. */
export function releaseTransitionAllowed(
  currentUsesV2: boolean | null,
  targetUsesV2: boolean | null,
  acceptDataLoss: boolean,
): boolean {
  return acceptDataLoss || currentUsesV2 === false || targetUsesV2 === true;
}
