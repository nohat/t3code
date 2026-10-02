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

/**
 * Threads with a turn in flight, or null when the database cannot be read (a read-only open of a
 * WAL database fails while no server is running). Opens the live database read-only.
 */
export function countRunningSessions(stateDb: string): number | null {
  const result = spawnSync(
    "sqlite3",
    [
      "-readonly",
      stateDb,
      "select count(*) from projection_thread_sessions where status = 'running';",
    ],
    { encoding: "utf8" },
  );
  return result.status === 0 ? Number.parseInt(result.stdout.trim(), 10) : null;
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
  const env = { T3CODE_HOME: options.home, T3CODE_PORT: String(options.port) };
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
  <key>ExitTimeOut</key><integer>20</integer>
  <key>StandardOutPath</key><string>${xml(join(options.logDir, "prod.out.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(options.logDir, "prod.err.log"))}</string>
</dict>
</plist>
`;
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
