# Upstream sync automation

Status: **ratified 2026-10-05** ("i like the sync automation plan, let's ratify it", plus the weekly cadence review below). Tracked in nohat/t3code#6; the first sync, a one-off port, is #36. Background and rejected alternatives are in [maintenance.md](./maintenance.md). Built so far: the facts it rests on (`upstream` has `no_push`, `rerere` is on), and the two gates below, `docs/fork/patches.tsv` and `scripts/fork/delta-check.ts` (2026-10-05, `feat/sync-gates`). The job itself is not built.

## What it does

`scripts/fork/upstream-sync.ts`, run by the launchd job `local.t3code.upstream-sync` (the README's working name was `t3.upstream-sync`; the `local.t3code.*` prefix matches the other fork jobs). One run:

1. Take a lock. `git fetch upstream --prune`. Fast-forward `main` with `git fetch upstream main:main` (it refuses a non-fast-forward) and push `main` to `origin`. Stop quietly if there are no new upstream commits.
2. Trial-merge `upstream/main` into the current `fork/prod` tip in a scratch worktree under the deploy root, with `rerere` on.
3. **Conflict:** abort. Record counts and file paths, each mapped to the `patches.tsv` entry that owns it. Create or update one issue labeled `upstream-sync`. The repo is public, so the issue carries ids, paths, and counts, never message text. Notify once per upstream sha.
4. **Clean:** run each `patches.tsv` guard, then `delta-check`, then targeted typecheck for the touched packages. If all pass, push `sync/upstream-<date>` at the merge commit and send a one-line digest. If a guard fails or a fork file lost lines, file the issue instead.
5. **It never changes `fork/prod`.** Landing is a fast-forward of `fork/prod` to the sync branch, done by the orchestrating session, followed by `fork-deploy` ("merged" is not "deployed"). Auto-landing after N green days is a possible later step, not part of the build.
6. Quiet by default: silence for no news, one line for a clean candidate, a buzz only for a conflict, a loss, or a failing guard.

## What makes "clean" mean something

- `docs/fork/patches.tsv`: name, branch, guard command, one row per accepted fork feature. The guard is a test that fails if an upstream merge drops the feature. This is the primary signal. A guard is a shell command run from the repository root; `-` marks a feature with no guard test (only the fork docs and agent config today). Partly guarded: the mobile Send-blocked text and the desktop papercut menu have no test of their own.
- `scripts/fork/delta-check.ts` (`node scripts/fork/delta-check.ts --old-main <ref> --old-fork <ref> --new-main <ref> --merged <ref> [--allow <file>]`): the net for features without a guard. It compares the fork's delta before and after the trial merge and flags a fork file whose added lines dropped or vanished. It follows renames (`git diff -M --numstat`) and compares against the new base (`upstream/main` against the merge result), not `main` before the sync, because a rewrite such as the V2 orchestrator auto-merges many fork files onto code that no longer exists. `git range-diff` is not used; it skips merge commits. A file upstream deleted is listed, not flagged. `--allow` takes a list of paths whose loss was decided on purpose (a dropped feature), so one decision does not fail every later run of the same merge.

## Cadence

Default: once a day. launchd wakes the job hourly (`StartInterval` 3600) and the script exits at once unless `intervalHours` have passed since the last run, so changing the cadence is editing one number, not reloading a plist. A run missed while the Mac slept happens on wake.

**Cadence review.** Once a week, or whenever I ask (`node scripts/fork/upstream-sync.ts cadence`, or by telling a session to run it), the script gathers facts and runs one agent turn that analyzes recent upstream merges and the sync history and adjusts the frequency itself.

- Facts, gathered by the script (deterministic, no model): upstream commits and changed files per day over the last 14 and 28 days; the run ledger (date, new commits, trial-merge result, conflict count, conflicted paths, guard results, whether the candidate landed); how many days of upstream a clean merge survived before it first conflicted.
- The agent turn (`scripts/fork/upstream-cadence-prompt.md` run through the installed agent CLI) reads the facts and the last entries of the decision ledger, writes a short analysis (what changed upstream, what it did to the fork, whether syncing more or less often would have cut conflicts or noise), and returns one decision: `intervalHours` and a one-paragraph reason. Rules in the prompt: more often when upstream volume or conflict size is growing and conflicts get worse with age; less often when runs are clean no-ops; change by at most a factor of two per review; never leave the bounds.
- The script validates and applies the decision. Bounds are enforced there, not trusted to the prompt: `intervalHours` between 6 and 168. The agent makes the adjustment on its own; nobody approves it first.
- Reporting: the analysis and the decision go to `upstream-sync-decisions.md` in the deploy root, and the notifier gets one line ("cadence 24h to 12h: 61 commits/day, conflicts doubling per week"). An unchanged cadence is a ledger entry, not a notification.

State lives in the deploy root, machine-local and out of git, next to `fork-versions.json`: `upstream-sync.json` (`intervalHours`, `lastRunAt`, `lastCadenceReviewAt`), `upstream-sync-runs.jsonl`, `upstream-sync-decisions.md`.

## Build order

1. Guard hooks (#6 item 1). 2. Commit the versioning work. 3. `patches.tsv` and `delta-check`. 4. The V2 catch-up (#36), gated by 3. 5. `upstream-sync.ts`, trial-merge mode first (it is also the pre-flight for #36), then the launchd job and the cadence review, enabled only after #36 lands so it does not report the same conflicts every morning.

## Assumptions (change by saying so)

Daily start cadence; `sync/upstream-<date>` branches pushed to `origin`; no auto-land; the visual diff in the README waits for the design-system gate; cadence bounds 6 to 168 hours; a change of at most 2x per review.
