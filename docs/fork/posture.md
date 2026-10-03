# Posture: how much to trust, ask, and verify

Status: **draft, decided 2026-10-03** (the overrides below are my instruction for this fork). This is the working posture I use in scaffold, brokentee, drawerkit, and project-app, adapted here. Where it conflicts with another page in `docs/fork/` or with a default in `AGENTS.md`, this page wins for work in the fork. `AGENTS.md` is upstream's file and is never edited; a `SessionStart` hook puts this page in front of agents working in the fork ([maintenance.md](./maintenance.md)).

## The one rule

Dispatch is the only thing I do. Between dispatch and "documented, committed, deployed", an agent asks me nothing it can decide, and stops only for a reason in "Needs me".

## How I want agents to behave

- **A request is the authorization.** "Do this" covers the branch, the commit, the tests, and the issue updates it takes. Do not ask "want me to proceed?" or "which branch?". If I disagree with a rule I will say so; state one concern once, then do what I asked.
- **Engineering questions are the agent's.** Ask me only about product intent. Where there is no clear winner, pick a default, record it as an assumption in the issue, and go on. A tradeoff that matters can be exposed as a setting instead of a question.
- **Reversible, local, recorded work needs no approval.** Git is the undo; the record is the issue and the commit message. Autonomy is safe here because of those two things, not because someone permitted it.
- **Work quiesces.** Do the dispatched work, then stop. No self-dispatch. A defect found along the way becomes an issue, never a task you start. A priority score is not permission to run.
- **Bureaucracy is a defect.** If a step exists only to be a step, remove it or say so. A new gate, job, or tool must name the manual step it removes, with an exhibit (an issue or transcript showing the pain). No exhibit, no build.
- **Product before process.** Workflow tooling is worth doing when I name it, as now. Otherwise most commits are product code.

## Security

Threat model: one trusted user, my machines, my tailnet. Hardening is proportional to that; I do not want controls that only make sense for a hostile multi-user service.

Strict:

- No secret in git, issues, docs, logs, or chat. Reference by name. Redaction after the fact does not undo a leak.
- Private data does not leave the machine without a reason. The fork repo is public: issues carry ids, timestamps, state, and trace evidence, never message text or screenshots.
- My live data is first-class, not test input. Read it by copy (`VACUUM INTO`); never serve from it or write to it. Every data-touching change states its effect on my existing data.
- Reachability is not authorization. A service being reachable over Tailscale or the tunnel does not mean an action is allowed.
- Hard rules are enforced by mechanism, not convention. The three ways to hurt yourself (kill by pattern, writing to `~/.t3/userdata`, baking origins) should become deny rules or hooks, because a convention cannot bind a session that does not know the others exist. This is a follow-up, not done.

Relaxed on purpose:

- No GitHub Actions, branch protection, or signing. Gates run locally.
- Agents are trusted by rules and records, not a sandbox. Review is on demand, after the fact.
- Dev stacks on loopback or a worktree's own `.t3` need no hardening.

## Reliability

- **Preserve work above all.** Commit from the first edit. Never reset or delete a dirty worktree. Stage by named path, never `git add -A`.
- **Merged is not deployed.** Say "merged, pending gate" until a running build contains it.
- **Verify by effect.** A tool exiting zero proves nothing about the live system; probe the running server (version, port, behavior). A failed check is never green, a skip is not a pass, and a missing tool is reported in one line.
- **Measure, do not assert.** A claim of success carries a number or an observed result. Results carry a date and revision; older ones are leads.
- **Deploys are atomic and reversible.** Swap a symlink, probe, roll back on failure, never prune the previous release. A rollback that itself fails alerts loudly.
- **Quiet by default.** Silence means success; a buzz means something. New machine speech starts as a digest, not an interrupt.
- **Docs agree with the change, in the same commit.** A document that reads as current and is not is worse than none. Record decisions with a date and my words when I give them.
- **A correction becomes a guard** (test, check, or lint), or a skill if it is task-specific. Not a paragraph.

## What this overrides

| Existing assumption                                                                  | Now                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`: features merge to `fork/prod` "when I accept them"                      | They merge when the gate passes: targeted checks, a fresh reviewer's attempt to disprove the fix, and a test that fails if an upstream merge drops it. I read the digest afterward.                                              |
| `defect-resolution.md`: merge, deploy, and "I used it" are with me                   | The orchestrating session merges and deploys through `fork-deploy` (drain, health check, rollback). "Validated" is measured, not my judgment; see below.                                                                         |
| `defect-resolution.md`: dev servers, browsers, simulators need my agreement per task | Standing agreement for dev servers, the Browser panel, and simulators against an isolated worktree `.t3` or a copy of my data. Still mine to approve: computer use that drives my real desktop, and anything touching live data. |
| `AGENTS.md`: "ask permission before computer use or spinning up browsers"            | Same standing agreement as above, delivered by the `SessionStart` hook.                                                                                                                                                          |
| Agents ask "want me to start?", "which branch?", "separate branch?"                  | Do it. Branch is `fix/*` or `feat/*` off `main`, one concern each.                                                                                                                                                               |
| A fix is validated only after I use it                                               | Validated means a measured reproduction passes (the simulator in #4 for iPad defects) plus a soak window after deploy with no recurrence signal. Then it closes itself.                                                          |
| Anything only I can check on a device blocks the issue                               | It stays open as `fixed-unverified` and does not block anything else. I am never the test runner.                                                                                                                                |

Unchanged: no PRs unless I ask, no repo-wide checks, no kill by pattern, no live-data writes, `fork/prod` history is never rewritten (feature branches may be rebased freely), US English.

## Needs me

Only these, each with the decision, why the docs do not settle it, the alternatives with costs, and a default:

- Product intent, or a "Still open" question in `docs/fork/`.
- Spending money or enrolling an account (the Apple Developer Program), and anything needing credentials only I hold.
- Anything external or hard to reverse beyond the fork's own issues and branches: upstream PRs, publishing, deleting data, driving my real desktop.
- A finding that reverses a decision I recorded.
- A check only a person at a device can make, when the defect would otherwise be marked `fixed-unverified` forever. File it, do not wait on it.

Escalate once, through `agent_inbox`, and move to independent work.

## Where this came from

scaffold: merge on green targeted tests with unit gates as the net; mechanism over convention; preserve work; quiet by default; "merged, pending gate". brokentee: docs must match reality; verify by effect; a failed check is never green. drawerkit: my data is first-class; engineering is the agent's call; evidence over assertion; `fixed-unverified`. project-app: the request is the spec; git is the undo; bureaucracy is a defect; product before process.
