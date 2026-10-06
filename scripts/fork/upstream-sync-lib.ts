// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface SyncState {
  intervalHours: number;
  lastRunAt?: string;
  lastCadenceReviewAt?: string;
  lastUpstreamSha?: string;
  lastForkSha?: string;
  lastNotifiedSha?: string;
}

export const INITIAL_STATE: SyncState = { intervalHours: 24 };

export function isDue(timestamp: string | undefined, hours: number, now = Date.now()): boolean {
  if (!timestamp) return true;
  const previous = Date.parse(timestamp);
  if (!Number.isFinite(previous)) throw new Error("invalid sync timestamp");
  return now - previous >= hours * 3_600_000;
}

export function readState(path: string): SyncState {
  if (!NodeFS.existsSync(path)) return { ...INITIAL_STATE };
  const raw: unknown = JSON.parse(NodeFS.readFileSync(path, "utf8"));
  if (
    !raw ||
    typeof raw !== "object" ||
    !("intervalHours" in raw) ||
    typeof raw.intervalHours !== "number" ||
    !Number.isFinite(raw.intervalHours) ||
    raw.intervalHours < 6 ||
    raw.intervalHours > 168
  )
    throw new Error("invalid sync state");
  for (const field of [
    "lastRunAt",
    "lastCadenceReviewAt",
    "lastUpstreamSha",
    "lastForkSha",
    "lastNotifiedSha",
  ]) {
    if (field in raw && typeof Reflect.get(raw, field) !== "string")
      throw new Error(`invalid sync state ${field}`);
  }
  return raw as SyncState;
}

export function writeState(path: string, state: SyncState): void {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  NodeFS.renameSync(temporary, path);
}

export function parsePatches(text: string) {
  const rows = text.trim().split("\n");
  if (rows.shift()?.trim() !== "name\tbranch\tguard") throw new Error("invalid patches header");
  const names = new Set<string>();
  return rows
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [name, branch, guard, ...rest] = line.split("\t");
      if (
        !name ||
        !/^[a-z0-9-]+$/.test(name) ||
        !branch ||
        !guard ||
        rest.length ||
        names.has(name)
      ) {
        throw new Error("invalid or duplicate patch entry");
      }
      names.add(name);
      return { name, branch, guard };
    });
}

export function validateCadence(raw: unknown, previous: number) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("intervalHours" in raw) ||
    !("reason" in raw) ||
    !("analysis" in raw)
  ) {
    throw new Error("cadence agent must return intervalHours, reason, analysis");
  }
  const { intervalHours, reason, analysis } = raw;
  if (
    typeof intervalHours !== "number" ||
    !Number.isFinite(intervalHours) ||
    intervalHours < 6 ||
    intervalHours > 168 ||
    intervalHours < previous / 2 ||
    intervalHours > previous * 2 ||
    typeof reason !== "string" ||
    !reason.trim() ||
    typeof analysis !== "string" ||
    !analysis.trim()
  ) {
    throw new Error("cadence decision outside bounds or missing explanation");
  }
  return { intervalHours, reason: reason.trim(), analysis: analysis.trim() };
}

export function touchedPackages(paths: readonly string[]) {
  return [
    ...new Set(
      paths
        .map(
          (path) =>
            path.match(/^(apps|packages)\/[^/]+\//)?.[0].slice(0, -1) ??
            (path.startsWith("scripts/") ? "scripts" : null),
        )
        .filter((path): path is string => path !== null),
    ),
  ].sort();
}

export function renderSyncIssue(record: {
  forkSha: string;
  upstreamSha: string;
  status: string;
  conflicts: readonly string[];
  failedGuards: readonly string[];
  losses: readonly string[];
  affectedPatches: readonly string[];
  unmappedPatches?: readonly string[];
}) {
  return [
    "Automatic upstream trial held.",
    "",
    `fork: ${record.forkSha}`,
    `upstream: ${record.upstreamSha}`,
    `status: ${record.status}`,
    `conflicts: ${record.conflicts.length}`,
    `failed guards: ${record.failedGuards.length}`,
    `losses: ${record.losses.length}`,
    "",
    "Paths:",
    ...record.conflicts.map((path) => `- ${path}`),
    ...record.losses.map((path) => `- ${path}`),
    "",
    "Guard ids:",
    ...record.failedGuards.map((name) => `- ${name}`),
    "",
    "Affected patch ids:",
    ...record.affectedPatches.map((name) => `- ${name}`),
    "",
    "Unmapped patch ids:",
    ...(record.unmappedPatches ?? []).map((name) => `- ${name}`),
    "",
  ].join("\n");
}

export function renderSyncLaunchAgent(options: {
  node: string;
  script: string;
  config: string;
  root: string;
  path: string;
}) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>local.t3code.upstream-sync</string>
<key>ProgramArguments</key><array>${[options.node, options.script, "run", "--config", options.config].map((arg) => `<string>${escape(arg)}</string>`).join("")}</array>
<key>StartInterval</key><integer>3600</integer>
<key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(options.path)}</string></dict>
<key>StandardOutPath</key><string>${escape(NodePath.join(options.root, "upstream-sync.stdout.log"))}</string>
<key>StandardErrorPath</key><string>${escape(NodePath.join(options.root, "upstream-sync.stderr.log"))}</string>
</dict></plist>\n`;
}
