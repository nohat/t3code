#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import {
  isDue,
  parsePatches,
  readState,
  renderSyncIssue,
  renderSyncLaunchAgent,
  touchedPackages,
  validateCadence,
  writeState,
} from "./upstream-sync-lib.ts";

interface Config {
  readonly root: string;
  readonly repo: string;
  readonly githubRepo: string;
  readonly node?: string;
  readonly path?: string;
  readonly notify?: readonly string[];
  readonly cadenceCommand?: readonly string[];
  /** Set only after the V2 catch-up lands and the matched clients are ready. */
  readonly enabled?: boolean;
}

interface RunRecord {
  at: string;
  forkSha: string;
  upstreamSha: string;
  newCommits: number;
  status: string;
  conflicts: string[];
  guards: { name: string; code: number }[];
  losses: string[];
  affectedPatches: string[];
  unmappedPatches?: string[];
  candidateSha?: string;
  candidateBranch?: string;
}

function run(
  command: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input?: string,
  timeout = 120_000,
) {
  const [file, ...args] = command;
  if (!file) throw new Error("empty command");
  const result = NodeChildProcess.spawnSync(file, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function trial(
  config: Config,
  upstreamRef = "upstream/main",
  forkRef = "fork/prod",
  oldMainRef?: string,
) {
  const env = { ...process.env, ...(config.path ? { PATH: config.path } : {}) };
  const git = (...args: string[]) => {
    const result = run(["git", ...args], config.repo, env);
    if (result.code) throw new Error(`git ${args[0]} failed (${result.code})`);
    return result.stdout.trim();
  };
  const forkSha = git("rev-parse", `${forkRef}^{commit}`);
  const upstreamSha = git("rev-parse", `${upstreamRef}^{commit}`);
  const oldMain = oldMainRef ?? git("merge-base", forkSha, upstreamSha);
  const record: RunRecord = {
    at: new Date().toISOString(),
    forkSha,
    upstreamSha,
    newCommits: Number(git("rev-list", "--count", `${forkSha}..${upstreamSha}`)),
    status: "no-news",
    conflicts: [],
    guards: [],
    losses: [],
    affectedPatches: [],
  };
  if (!record.newCommits) return record;
  NodeFS.mkdirSync(NodePath.join(config.root, "sync-trials"), { recursive: true });
  const scratch = NodeFS.mkdtempSync(NodePath.join(config.root, "sync-trials", "trial-"));
  const logs = NodePath.join(config.root, "sync-logs", `${Date.now()}-${upstreamSha.slice(0, 12)}`);
  NodeFS.mkdirSync(logs, { recursive: true, mode: 0o700 });
  git("worktree", "add", "--detach", scratch, forkSha);
  const workGit = (...args: string[]) => run(["git", ...args], scratch, env);
  try {
    const patches = parsePatches(
      NodeFS.readFileSync(NodePath.join(scratch, "docs/fork/patches.tsv"), "utf8"),
    );
    const merged = workGit("-c", "rerere.enabled=true", "merge", "--no-edit", upstreamSha);
    NodeFS.writeFileSync(NodePath.join(logs, "merge.log"), merged.stdout + merged.stderr);
    if (merged.code) {
      record.conflicts = workGit("diff", "--name-only", "--diff-filter=U")
        .stdout.trim()
        .split("\n")
        .filter(Boolean);
      record.status = record.conflicts.length ? "conflict" : "merge-failed";
      for (const patch of patches) {
        let files = run(
          ["git", "diff", "--name-only", `${oldMain}...${patch.branch}`],
          config.repo,
          env,
        );
        if (files.code)
          files = run(
            ["git", "diff", "--name-only", `${oldMain}...origin/${patch.branch}`],
            config.repo,
            env,
          );
        if (files.code) {
          (record.unmappedPatches ??= []).push(patch.name);
          continue;
        }
        const owned = new Set(files.stdout.trim().split("\n"));
        if (record.conflicts.some((path) => owned.has(path)))
          record.affectedPatches.push(patch.name);
      }
      const abort = workGit("merge", "--abort");
      if (abort.code && workGit("rev-parse", "--verify", "MERGE_HEAD").code === 0)
        throw new Error("trial merge abort failed");
      return record;
    }
    const install = run(["vp", "i"], scratch, env, undefined, 600_000);
    NodeFS.writeFileSync(NodePath.join(logs, "install.log"), install.stdout + install.stderr);
    if (install.code) {
      record.status = "install-failed";
      return record;
    }
    for (const patch of patches) {
      const localTip = run(
        ["git", "rev-parse", "--verify", `${patch.branch}^{commit}`],
        config.repo,
        env,
      );
      const tip =
        localTip.code === 0
          ? localTip
          : run(
              ["git", "rev-parse", "--verify", `origin/${patch.branch}^{commit}`],
              config.repo,
              env,
            );
      const ancestry =
        tip.code === 0 ? workGit("merge-base", "--is-ancestor", tip.stdout.trim(), "HEAD") : tip;
      if (ancestry.code) {
        record.guards.push({ name: patch.name, code: ancestry.code });
        NodeFS.writeFileSync(
          NodePath.join(logs, `${patch.name}.log`),
          "Accepted patch ancestry failed.\n" + ancestry.stderr,
        );
        continue;
      }
      if (patch.guard === "-") continue;
      const result = run(["/bin/sh", "-c", patch.guard], scratch, env, undefined, 600_000);
      record.guards.push({ name: patch.name, code: result.code });
      NodeFS.writeFileSync(NodePath.join(logs, `${patch.name}.log`), result.stdout + result.stderr);
    }
    const allowFile = NodePath.join(scratch, "docs/fork/delta-allow.txt");
    const delta = run(
      [
        config.node ?? process.execPath,
        "scripts/fork/delta-check.ts",
        "--old-main",
        oldMain,
        "--old-fork",
        forkSha,
        "--new-main",
        upstreamSha,
        "--merged",
        "HEAD",
        ...(NodeFS.existsSync(allowFile) ? ["--allow", allowFile] : []),
      ],
      scratch,
      env,
    );
    NodeFS.writeFileSync(NodePath.join(logs, "delta.log"), delta.stdout + delta.stderr);
    record.losses = delta.stdout
      .split("\n")
      .filter((line) => line.startsWith("LOSS "))
      .map((line) => line.split(" ")[2]!)
      .filter(Boolean);
    let typecheckFailed = false;
    const touched = workGit("diff", "--name-only", `${forkSha}..HEAD`).stdout.trim().split("\n");
    for (const directory of touchedPackages(touched)) {
      const packagePath = NodePath.join(scratch, directory, "package.json");
      if (!NodeFS.existsSync(packagePath)) continue;
      const pkg = JSON.parse(NodeFS.readFileSync(packagePath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      if (!pkg.scripts?.typecheck) continue;
      const result = run(
        ["vp", "run", "typecheck"],
        NodePath.join(scratch, directory),
        env,
        undefined,
        600_000,
      );
      NodeFS.writeFileSync(
        NodePath.join(logs, `typecheck-${directory.replaceAll("/", "-")}.log`),
        result.stdout + result.stderr,
      );
      if (result.code) typecheckFailed = true;
    }
    record.status = record.guards.some((guard) => guard.code)
      ? "guard-failed"
      : delta.code
        ? "delta-failed"
        : typecheckFailed
          ? "typecheck-failed"
          : "clean";
    if (workGit("status", "--porcelain").stdout.trim()) record.status = "dirty-trial";
    if (record.status === "clean") {
      const date = record.at.slice(0, 10).replaceAll("-", "");
      let branch = `sync/upstream-${date}`;
      record.candidateSha = workGit("rev-parse", "HEAD").stdout.trim();
      const content = workGit("show", "-s", "--format=%T %P", "HEAD").stdout.trim();
      let suffix = 0;
      while (
        run(["git", "show-ref", "--verify", `refs/heads/${branch}`], config.repo, env).code === 0
      ) {
        if (git("show", "-s", "--format=%T %P", branch) === content) {
          record.candidateSha = git("rev-parse", branch);
          break;
        }
        suffix++;
        branch = `sync/upstream-${date}-${upstreamSha.slice(0, 12)}-${forkSha.slice(0, 12)}-${suffix}`;
      }
      record.candidateBranch = branch;
      if (run(["git", "show-ref", "--verify", `refs/heads/${branch}`], config.repo, env).code !== 0)
        git("branch", branch, record.candidateSha);
    }
    return record;
  } finally {
    // Preserve an unexpected dirty trial for inspection; never remove another
    // session's worktree or overwrite the user's primary checkout.
    if (workGit("status", "--porcelain").stdout.trim())
      console.error(`preserved dirty trial ${scratch}`);
    else git("worktree", "remove", scratch);
  }
}

function cadence(config: Config, state: ReturnType<typeof readState>, env: NodeJS.ProcessEnv) {
  const execute = (command: readonly string[], input?: string, timeout?: number) => {
    const result = run(command, config.repo, env, input, timeout);
    if (result.code) throw new Error(`${command[0]} failed (${result.code})`);
    return result.stdout;
  };
  const ledgerPath = NodePath.join(config.root, "upstream-sync-runs.jsonl");
  const records = NodeFS.existsSync(ledgerPath)
    ? NodeFS.readFileSync(ledgerPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RunRecord)
    : [];
  const histories = [14, 28].map((days) => {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const commits = execute([
      "git",
      "log",
      "upstream/main",
      "--no-merges",
      `--since=${since}`,
      "--format=%cs",
      "--numstat",
    ]);
    const perDay: Record<string, { commits: number; files: number }> = {};
    let date = "";
    for (const line of commits.split("\n")) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(line)) {
        date = line;
        perDay[date] ??= { commits: 0, files: 0 };
        perDay[date]!.commits++;
      } else if (date && /^(?:\d+|-)\t(?:\d+|-)\t/.test(line)) perDay[date]!.files++;
    }
    return { days, perDay };
  });
  const decisionsPath = NodePath.join(config.root, "upstream-sync-decisions.md");
  const previous = NodeFS.existsSync(decisionsPath)
    ? NodeFS.readFileSync(decisionsPath, "utf8").slice(-16_000)
    : "";
  const landed = records.map((record) => ({
    ...record,
    landed: record.candidateSha
      ? run(
          ["git", "merge-base", "--is-ancestor", record.candidateSha, "fork/prod"],
          config.repo,
          env,
        ).code === 0
      : false,
  }));
  const survival = records
    .filter((record) => record.status === "clean")
    .map((clean) => {
      const conflict = records.find(
        (record) => record.at > clean.at && record.status === "conflict",
      );
      return {
        cleanAt: clean.at,
        firstConflictAt: conflict?.at ?? null,
        days: conflict ? (Date.parse(conflict.at) - Date.parse(clean.at)) / 86_400_000 : null,
      };
    });
  const prompt = NodeFS.readFileSync(
    new URL("./upstream-cadence-prompt.md", import.meta.url),
    "utf8",
  );
  const response = execute(
    config.cadenceCommand ?? ["claude", "-p", "--tools", ""],
    `${prompt}\n\nFacts: ${JSON.stringify({ intervalHours: state.intervalHours, histories, runs: landed.slice(-100), survival })}\n\nRecent decisions:\n${previous}`,
    240_000,
  );
  const decision = validateCadence(JSON.parse(response), state.intervalHours);
  const before = state.intervalHours;
  state.intervalHours = decision.intervalHours;
  state.lastCadenceReviewAt = new Date().toISOString();
  NodeFS.appendFileSync(
    decisionsPath,
    `## ${state.lastCadenceReviewAt}\n\n${decision.analysis}\n\n${before}h -> ${decision.intervalHours}h: ${decision.reason}\n\n`,
  );
  if (before !== decision.intervalHours)
    notify(config, `cadence ${before}h to ${decision.intervalHours}h: ${decision.reason}`, env);
}

function notify(config: Config, message: string, env: NodeJS.ProcessEnv) {
  console.log(message);
  if (config.notify?.length) {
    const result = run(
      [...config.notify, "--summary", message.slice(0, 200), "--message", message],
      config.repo,
      env,
      undefined,
      30_000,
    );
    if (result.code) throw new Error("sync notifier failed");
  }
}

async function main() {
  const { values, positionals } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      upstream: { type: "string" },
      fork: { type: "string" },
      "old-main": { type: "string" },
    },
  });
  const mode = positionals[0] ?? "run";
  if (!["run", "trial", "cadence", "plist"].includes(mode))
    throw new Error("usage: upstream-sync.ts <run|trial|cadence|plist> --config <file>");
  const configPath = NodePath.resolve(
    values.config ?? process.env.FORK_SYNC_CONFIG ?? ".t3/upstream-sync-config.json",
  );
  const config: Config = JSON.parse(NodeFS.readFileSync(configPath, "utf8"));
  if (
    !NodePath.isAbsolute(config.root) ||
    !NodePath.isAbsolute(config.repo) ||
    !/^[\w.-]+\/[\w.-]+$/.test(config.githubRepo)
  )
    throw new Error("invalid sync config");
  if (mode === "run" && !config.enabled) return;
  if (mode === "plist") {
    console.log(
      renderSyncLaunchAgent({
        node: config.node ?? process.execPath,
        script: NodePath.join(config.repo, "scripts/fork/upstream-sync.ts"),
        config: configPath,
        root: config.root,
        path: config.path ?? process.env.PATH ?? "/usr/bin:/bin",
      }),
    );
    return;
  }
  NodeFS.mkdirSync(config.root, { recursive: true });
  const lock = NodePath.join(config.root, ".upstream-sync.lock");
  try {
    NodeFS.mkdirSync(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error("sync lock held; inspect before retrying", { cause: error });
    throw error;
  }
  try {
    NodeFS.writeFileSync(NodePath.join(lock, "pid"), String(process.pid));
    const statePath = NodePath.join(config.root, "upstream-sync.json");
    const state = readState(statePath);
    const env = { ...process.env, ...(config.path ? { PATH: config.path } : {}) };
    const execute = (command: readonly string[]) => {
      const result = run(command, config.repo, env);
      if (result.code) throw new Error(`${command[0]} ${command[1]} failed (${result.code})`);
      return result.stdout.trim();
    };
    if (mode === "cadence") {
      execute(["git", "fetch", "upstream", "--prune"]);
      cadence(config, state, env);
      writeState(statePath, state);
      return;
    }
    if (
      mode === "run" &&
      !isDue(state.lastRunAt, state.intervalHours) &&
      !isDue(state.lastCadenceReviewAt, 168)
    )
      return;
    if (mode === "run") {
      execute(["git", "fetch", "upstream", "--prune"]);
      execute(["git", "fetch", "upstream", "main:main"]);
      const mirrored = run(
        ["git", "push", "origin", "refs/heads/main:refs/heads/main"],
        config.repo,
        { ...env, T3CODE_UPSTREAM_MAIN_FF: "1" },
      );
      if (mirrored.code) throw new Error("upstream main mirror push failed");
    }
    if (mode === "trial" || isDue(state.lastRunAt, state.intervalHours)) {
      const upstreamSha = execute(["git", "rev-parse", values.upstream ?? "upstream/main"]);
      const forkSha = execute(["git", "rev-parse", values.fork ?? "fork/prod"]);
      const record =
        mode === "run" && state.lastUpstreamSha === upstreamSha && state.lastForkSha === forkSha
          ? ({
              at: new Date().toISOString(),
              forkSha,
              upstreamSha,
              newCommits: 0,
              status: "no-news",
              conflicts: [],
              guards: [],
              losses: [],
              affectedPatches: [],
            } satisfies RunRecord)
          : trial(config, values.upstream, values.fork, values["old-main"]);
      NodeFS.appendFileSync(
        NodePath.join(config.root, "upstream-sync-runs.jsonl"),
        `${JSON.stringify(record)}\n`,
      );
      if (mode === "run") {
        if (record.status === "clean" && record.candidateBranch && record.candidateSha) {
          execute([
            "git",
            "push",
            "origin",
            `${record.candidateSha}:refs/heads/${record.candidateBranch}`,
          ]);
          notify(
            config,
            `${record.candidateBranch} clean at ${record.candidateSha.slice(0, 12)}`,
            env,
          );
        } else if (record.status !== "no-news") {
          const bodyPath = NodePath.join(config.root, "upstream-sync-issue.md");
          NodeFS.writeFileSync(
            bodyPath,
            renderSyncIssue({
              ...record,
              failedGuards: record.guards.filter((guard) => guard.code).map((guard) => guard.name),
            }),
          );
          execute([
            "gh",
            "label",
            "create",
            "upstream-sync",
            "--repo",
            config.githubRepo,
            "--force",
          ]);
          const issues = JSON.parse(
            execute([
              "gh",
              "issue",
              "list",
              "--repo",
              config.githubRepo,
              "--label",
              "upstream-sync",
              "--state",
              "open",
              "--json",
              "number",
            ]),
          ) as { number: number }[];
          const args = issues[0]
            ? ["edit", String(issues[0].number)]
            : ["create", "--label", "upstream-sync"];
          execute([
            "gh",
            "issue",
            ...args,
            "--repo",
            config.githubRepo,
            "--title",
            `Upstream sync held: ${record.upstreamSha.slice(0, 12)}`,
            "--body-file",
            bodyPath,
          ]);
          if (state.lastNotifiedSha !== record.upstreamSha) {
            notify(
              config,
              `upstream ${record.upstreamSha.slice(0, 12)}: ${record.status}, ${record.conflicts.length} conflicts`,
              env,
            );
            state.lastNotifiedSha = record.upstreamSha;
          }
        }
        state.lastRunAt = record.at;
        state.lastUpstreamSha = record.upstreamSha;
        state.lastForkSha = record.forkSha;
      } else console.log(JSON.stringify(record, null, 2));
    }
    writeState(statePath, state);
    if (mode === "run" && isDue(state.lastCadenceReviewAt, 168)) cadence(config, state, env);
    writeState(statePath, state);
  } finally {
    NodeFS.rmSync(lock, { recursive: true });
  }
}

if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "sync failed");
    process.exitCode = 1;
  });
