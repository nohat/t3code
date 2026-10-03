---
name: defect-session
description: Run one scoped defect-resolution session for David's T3 Code fork (nohat/t3code). Only when David invokes /defect-session or asks for a defect session in the fork. Arguments - issue numbers, an area, "triage", or "sweep".
disable-model-invocation: true
argument-hint: "[#N ...] | [area ...] | triage | sweep"
---

# Defect session

You are running one session, started by David, on a fixed scope. This file is only the order of operations. The rules and reasons are in the fork docs, which you must read from git first because most worktrees do not contain `docs/fork/`.

## 1. Check where you are and load the rules

1. `git remote get-url origin` must contain `nohat/t3code`. If not, stop and say this skill is for the fork only.
2. Find the docs ref: the first of `fork/prod`, `local/t3-work`, `docs/fork` where `git show <ref>:docs/fork/defect-resolution.md` works.
3. Read `docs/fork/posture.md` and `docs/fork/defect-resolution.md` in full from that ref (`git show <ref>:docs/fork/<page>.md`). They override `AGENTS.md` where they conflict. Read the other pages in `docs/fork/` only when the defect needs them.

## 2. Fix the scope from the arguments

- Issue numbers: those issues on `nohat/t3code`.
- An area (for example `send`, `sync`, `mobile`): the verified open issues in it, plus read-only discovery in that area.
- `triage`: classify open candidate issues (real, stale, intended, open question, duplicate, test defect, environmental). No fixes.
- `sweep`: one read-only audit of one subsystem, per "First steps" in the charter. File verified candidates. No fixes.
- No arguments: the baseline step in the charter's "First steps".

The scope does not widen. A defect found along the way becomes an issue and is not started.

## 3. Work each defect

Follow "The loop here" in the charter: verify before fixing, fix on a `fix/*` or `feat/*` branch off `main` in its own worktree, walk "Hit every surface", add a test that fails if an upstream merge drops the fix, validate with the smallest proof, then have a fresh read-only reviewer try to disprove the fix. Land and deploy only through the gate in the posture. Update the issue (status vocabulary and template from the charter) and any doc the change makes wrong, in the same change.

The hard stops stay on: no kill by pattern, nothing touches `~/.t3/userdata`, no baked origins, no PRs unless David asks, no live data, no repo-wide checks, no commits to `main`. The fork is public, so issues carry ids, timestamps, state, and trace evidence only.

## 4. Finish

Reply with one short digest: each issue touched, its status, and anything in "Needs me". Say nothing else. Escalate through `agent_inbox` only for a "Needs me" item.
