// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// Flags fork work that an upstream merge silently dropped.
//
//   node scripts/fork/delta-check.ts --old-main <ref> --old-fork <ref> \
//     --new-main <ref> --merged <ref> [--allow <file>]
//
// The fork's delta before the merge is `git diff -M --numstat old-main old-fork`;
// after it is `git diff -M --numstat new-main merged`. A fork file is a loss when
// its added-line count fell, or when it vanished although upstream did not delete
// it. Renames on either side (upstream's, or git's rename-following during the
// merge) are followed. `--allow` names a file of paths (one per line, `#` starts a
// comment) whose loss was decided on purpose, such as a dropped feature. Prints
// counts and paths only; exits 1 on any unallowed loss.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface NumstatEntry {
  readonly path: string;
  readonly added: number;
}

export type FileVerdict =
  | { readonly kind: "kept"; readonly path: string; readonly at: string }
  | { readonly kind: "absorbed"; readonly path: string; readonly at: string }
  | { readonly kind: "deleted-upstream"; readonly path: string }
  | {
      readonly kind: "lines-dropped";
      readonly path: string;
      readonly at: string;
      readonly before: number;
      readonly after: number;
    }
  | { readonly kind: "vanished"; readonly path: string };

export interface DeltaInputs {
  /** Fork delta before the merge, keyed by fork path. */
  readonly before: ReadonlyMap<string, number>;
  /** Fork delta after the merge, keyed by merged path. */
  readonly after: ReadonlyMap<string, number>;
  /** Upstream renames between the two bases (old path to new path). */
  readonly upstreamRenames: ReadonlyMap<string, string>;
  /** Renames git applied to fork files during the merge (old-fork path to merged path). */
  readonly mergeRenames: ReadonlyMap<string, string>;
  /** Paths that existed in the old base and are gone from the new base. */
  readonly upstreamDeleted: ReadonlySet<string>;
  /** Paths present in the merged tree with content identical to the new base. */
  readonly identicalToUpstream: (path: string) => boolean;
}

/** Parses `git diff --numstat -z` output; a rename yields its destination path. */
export function parseNumstatZ(output: string): NumstatEntry[] {
  const fields = output.split("\0");
  const entries: NumstatEntry[] = [];
  let index = 0;
  while (index < fields.length) {
    const head = fields[index];
    if (head === undefined || head === "") {
      index += 1;
      continue;
    }
    const [addedText = "", , pathText = ""] = head.split("\t");
    const added = addedText === "-" ? 0 : Number(addedText);
    if (pathText === "") {
      // Rename or copy: the next two fields are the source and destination.
      const destination = fields[index + 2] ?? "";
      entries.push({ path: destination, added });
      index += 3;
    } else {
      entries.push({ path: pathText, added });
      index += 1;
    }
  }
  return entries;
}

/** Parses `git diff --name-status -z -M` output into renames and deletions. */
export function parseNameStatusZ(output: string): {
  renames: Map<string, string>;
  deleted: Set<string>;
} {
  const fields = output.split("\0");
  const renames = new Map<string, string>();
  const deleted = new Set<string>();
  let index = 0;
  while (index < fields.length) {
    const status = fields[index] ?? "";
    if (status === "") {
      index += 1;
      continue;
    }
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = fields[index + 1] ?? "";
      const to = fields[index + 2] ?? "";
      if (status.startsWith("R")) renames.set(from, to);
      index += 3;
      continue;
    }
    if (status === "D") deleted.add(fields[index + 1] ?? "");
    index += 2;
  }
  return { renames, deleted };
}

export function classify(inputs: DeltaInputs): FileVerdict[] {
  const verdicts: FileVerdict[] = [];
  for (const [path, before] of inputs.before) {
    if (before === 0) continue;
    const candidates = [
      path,
      inputs.upstreamRenames.get(path),
      inputs.mergeRenames.get(path),
    ].filter((candidate): candidate is string => candidate !== undefined);
    const found = candidates.find((candidate) => inputs.after.has(candidate));
    if (found !== undefined) {
      const after = inputs.after.get(found) ?? 0;
      verdicts.push(
        after >= before
          ? { kind: "kept", path, at: found }
          : { kind: "lines-dropped", path, at: found, before, after },
      );
      continue;
    }
    const absorbed = candidates.find((candidate) => inputs.identicalToUpstream(candidate));
    if (absorbed !== undefined) {
      verdicts.push({ kind: "absorbed", path, at: absorbed });
      continue;
    }
    if (inputs.upstreamDeleted.has(path) && !inputs.upstreamRenames.has(path)) {
      verdicts.push({ kind: "deleted-upstream", path });
      continue;
    }
    verdicts.push({ kind: "vanished", path });
  }
  return verdicts;
}

export function isLoss(verdict: FileVerdict): boolean {
  return verdict.kind === "lines-dropped" || verdict.kind === "vanished";
}

export function parseAllowList(text: string): Set<string> {
  return new Set(
    text
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim())
      .filter((line) => line !== ""),
  );
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function numstat(from: string, to: string): Map<string, number> {
  const entries = parseNumstatZ(git(["diff", "-M", "--numstat", "-z", from, to]));
  return new Map(entries.map((entry) => [entry.path, entry.added]));
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    const value = argv[index + 1];
    if (key === undefined || value === undefined) throw new Error(`bad argument near ${key}`);
    args[key] = value;
  }
  for (const required of ["old-main", "old-fork", "new-main", "merged"]) {
    if (args[required] === undefined) throw new Error(`missing --${required}`);
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const [oldMain, oldFork, newMain, merged] = [
    args["old-main"]!,
    args["old-fork"]!,
    args["new-main"]!,
    args.merged!,
  ];
  const upstream = parseNameStatusZ(git(["diff", "-M", "--name-status", "-z", oldMain, newMain]));
  const mergeSide = parseNameStatusZ(git(["diff", "-M", "--name-status", "-z", oldFork, merged]));
  const identical = (path: string): boolean => {
    try {
      return (
        git(["rev-parse", `${newMain}:${path}`]).trim() ===
        git(["rev-parse", `${merged}:${path}`]).trim()
      );
    } catch {
      return false;
    }
  };
  const allow = args.allow ? parseAllowList(readFileSync(args.allow, "utf8")) : new Set<string>();
  const verdicts = classify({
    before: numstat(oldMain, oldFork),
    after: numstat(newMain, merged),
    upstreamRenames: upstream.renames,
    mergeRenames: mergeSide.renames,
    upstreamDeleted: upstream.deleted,
    identicalToUpstream: identical,
  });

  const counts = new Map<string, number>();
  for (const verdict of verdicts) counts.set(verdict.kind, (counts.get(verdict.kind) ?? 0) + 1);
  console.log(
    `fork files: ${verdicts.length}; ` +
      [...counts].map(([kind, count]) => `${kind} ${count}`).join(", "),
  );
  for (const verdict of verdicts) {
    if (verdict.kind === "deleted-upstream") console.log(`deleted-upstream ${verdict.path}`);
  }
  const losses = verdicts.filter(isLoss);
  let unallowed = 0;
  for (const loss of losses) {
    const allowed = allow.has(loss.path);
    if (!allowed) unallowed += 1;
    const tag = allowed ? "allowed " : "LOSS ";
    console.log(
      loss.kind === "lines-dropped"
        ? `${tag}lines-dropped ${loss.path} -> ${loss.at} (+${loss.before} -> +${loss.after})`
        : `${tag}vanished ${loss.path}`,
    );
  }
  console.log(`losses: ${losses.length} (${losses.length - unallowed} allowed, ${unallowed} not)`);
  process.exitCode = unallowed > 0 ? 1 : 0;
}

if (import.meta.main) main();
