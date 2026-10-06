# Maintaining the fork

Status: **decided 2026-10-03**, from a research pass on long-lived forks, Claude Code and Codex configuration, and git behavior, checked against the installed tools (Claude Code 2.1.287, codex-cli 0.159.3). Where a claim is only read, not tested, this page says so.

## Upstream's agent files are never edited

`AGENTS.md` and `CLAUDE.md` (which is `@AGENTS.md`) belong to upstream. 14 upstream commits touched `AGENTS.md` since August, so any local edit conflicts on a sync, and a dirty, never-committed edit is lost the day someone resets a worktree. The rejected alternatives, all tested or checked against git's docs:

- `merge=ours` keeps the fork's side whenever both sides changed, which silently drops upstream's guidance. The driver config is also per clone.
- `skip-worktree` and `assume-unchanged` are not meant for ignoring tracked changes; a merge touching the file fails or overwrites it.
- A one-line pointer in tracked `CLAUDE.md` dangles on every branch cut from `main`.

## How the posture reaches agents

**Primary (Claude, in place):** a user-level `SessionStart` hook, `~/.claude/hooks/t3code-fork-posture.sh`, registered in `~/.claude/settings.json`. In any checkout whose `origin` is `nohat/t3code` it prints `docs/fork/posture.md` from one git ref, so every worktree sees it, including `feat/*` branches cut from `main` that lack `docs/fork/`. T3 starts Claude with the user, project, and local settings sources and the thread's worktree as the working directory (`ClaudeAdapter.ts`), so the user hook applies there. Tested: `claude -p` in this repo quoted the posture, and a T3 session resumed on 2026-10-03 showed the hook's output. The source of the hook and of the `/defect-session` skill is `scripts/fork/agent-config/` and `.agents/skills/defect-session/`; run `scripts/fork/agent-config/install.sh` on a new machine, or after editing either.

The script reads `docs/fork/posture.md` from `fork/prod`, then `origin/fork/prod`, so a fresh clone or another machine finds the docs after `git fetch`. It prints which ref it used so an agent can read the other pages with `git show <ref>:docs/fork/<page>.md`. If neither has the page it prints a one-line warning instead of nothing, because silence looks the same as "no posture". The standalone `docs/fork` branch was retired on 2026-10-03 once `fork/prod` contained the pages.

**Fallback and Codex (not built):** if the hook proves unreliable, generate `CLAUDE.local.md` and `AGENTS.override.md` (posture plus upstream's `AGENTS.md`, since an override replaces the file at that level) from a `post-checkout` hook, and list both in `$(git rev-parse --git-common-dir)/info/exclude`. Gitignored files are not copied to new worktrees, so they need regenerating. Codex support for a start-of-session hook is unchecked. After installing the guards, `core.hooksPath` points at `fork-hooks` in the common Git directory. This protects every worktree, including upstream `main`, which lacks fork scripts. The stable dispatcher delegates formatting to the tracked `.vite-hooks/pre-commit`; Vite leaves a custom hooks path intact.

## Syncing with upstream

- Merge, never rebase, on `fork/prod`. Sync daily and small. `git-imerge` only for a catch-up like the 396-file merge in the README survey.
- `rerere` is on globally (`rerere.enabled`, `rerere.autoUpdate`; `merge.conflictStyle=zdiff3` was already set). The `rr-cache` lives in the common git dir, so every worktree shares it.
- Lockfiles and generated files are never hand-merged: take upstream's `pnpm-lock.yaml` and regenerate; regenerate `routeTree.gen.ts`.
- Patch-queue and stacking tools (git-machete, branchless, Graphite) add machinery without cutting conflicts at 100+ upstream commits a week. Hosted sync bots (`wei/pull`) hard-reset and cannot run my gates. Neither is used.

## Catching a clean merge that dropped fork behavior

Two checks, both local, run by the sync job before it reports "clean":

1. Every accepted branch's guard test, plus `git merge-base --is-ancestor <tip> HEAD`, from a short list of fork patches (name, branch, guard command).
2. A fork-delta check: record `git diff --numstat main fork/prod` before and after the trial merge and flag any fork file whose added lines dropped or vanished. `git range-diff` is weak here because it skips merge commits.

Design reasoning, not a tested tool.

## Guards against agent mistakes

Done: `git remote set-url --push upstream no_push` (a push to upstream now fails; tested), so no agent can publish to upstream by accident.

Installed with `scripts/fork/agent-config/install.sh`: a Claude `PreToolUse` mistake guard denies `gh repo delete`, `gh repo fork --fork-name`, force pushes, and `-X ours` or `-X theirs` merges during fork work. Git hooks refuse commits on `main`, pushes to `main`, and non-fast-forward updates or deletion of `fork/prod`. The sync job has one narrow exception: `T3CODE_UPSTREAM_MAIN_FF=1` permits a fast-forward push of exactly `upstream/main` to `main`. The tracked `.vite-hooks` checks remain; a stable common-directory dispatcher additionally covers upstream branches where those files are absent. These are guards against ordinary shell mistakes, not a sandbox for arbitrary code. Codex gets the Git guards; its provider hook mirror remains pending. These are the "mechanism, not convention" follow-up in [posture.md](./posture.md). Real incidents motivated them: an agent deleted a user's fork with `gh repo fork --fork-name` (2026-05-24), and another emptied `main` branches, where a pre-push hook was the guard that held (2026-08-28).

## Fork builds

Not changed yet. The desktop app id is a constant in `scripts/build-desktop-artifact.ts`; the artifact version and update feed come from environment variables. The fork builds in a scrubbed environment with a fork-suffixed version (for example `0.0.44-nohat.<sha>`), leaves the update repository unset so there is no feed, patches the bundle id on a scratch copy at build time, and never edits `package.json` versions. Tag `fork/prod` as `fork/<date>-<sha>`. Unverified: that the environment version is what the running app reports.

## Keeping fixes upstreamable

One concern per branch, cut from `main`. To prove isolation, apply the branch's commits to a scratch worktree from `upstream/main` with `git cherry-pick`. If they apply and the guard test passes, it can become an upstream PR whenever I ask. `git cherry upstream/main <branch>` shows whether upstream already landed an equivalent.
