# Defect resolution

Status: **draft**. How I want an orchestrating agent to drive down defects in the fork without being handed a list. Adapted from a charter written for another project, which assumed a product spec, interaction contract, and stylebook. This repo has none of those, so this page says what stands in for them and what is missing. Rules in `AGENTS.md` and [README.md](./README.md) are linked, not repeated. How much to ask, trust, and verify is in [posture.md](./posture.md), which wins over anything here that conflicts.

Start a session with `/defect-session` (the skill in `.agents/skills/defect-session/`, installed user-wide by `scripts/fork/agent-config/install.sh`; see [maintenance.md](./maintenance.md)).

The loop: baseline, discover, verify, prioritize, fix, validate, hand to me, re-audit, repeat. Stop when I am needed, when independent audits find only duplicates and low-impact edges (then do one more broad audit), or when the harness stops you.

## What counts as a defect

A meaningful discrepancy between the product I intend and the product that runs. Crashes and failing tests are the small part. Look for stuck states (a flag, lane, or spinner with no timeout or way out; #1 to #3 are all this); wrong or lost state; a behavior missing on one surface, provider, or connection mode; contract or data damage; interaction and accessibility gaps (state shown only in an `aria-label`, touch targets, reduced motion); drift from upstream's default appearance or the selected profile ([design-system.md](./design-system.md)); performance with evidence of felt impact, never speculative; and doc defects, where two sources disagree. Record a doc discrepancy; do not quietly pick a side.

## Authority

There is no `product.md`, interaction contract, `current-state.md`, or decisions log. When sources disagree, use this order:

1. **`AGENTS.md` hard rules** and its "never compromise" list: open at the core, performance, remote ready, multi-surface.
2. **Fork decisions**: the Decisions sections of the pages in `docs/fork/`. The newest dated decision wins.
3. **Upstream behavior**: `docs/user/`, `docs/internals/`, `packages/contracts`, and how upstream `main` behaves. Appearance parity with upstream is the default.
4. **Current code**, only where nothing above speaks.

Stand-ins: the README's "What hurts" and "Where to spend feature effort" for product intent; `docs/internals/glossary.md` and `packages/contracts` for the domain model; `design-system.md` and the `/stylebook` route for the stylebook; open issues for current state.

Never fix toward stale behavior because the code does it. Never promote a "Still open" item to a requirement. If intended behavior is not grounded in 1 to 3, the issue is a question for me, not a bug.

## The ledger

GitHub issues on `nohat/t3code` are the ledger. No local ledger file, no committed plans, audit notes, or evidence packets: the issue, its comments, and the fix commit message are the record.

The fork is public. Issues carry ids, timestamps, state, and trace-span evidence only. No screenshots and no message text; those stay in the local papercut record, and the issue names its id.

Status uses issue state and existing labels (do not create labels):

- **Candidate:** open, `question`, body says "Not verified". **Needs my decision:** open, `question`, with the decision and alternatives.
- **Verified:** open, `bug` (or `enhancement` for a missing capability). **Blocked:** a "Blocked on #N" line.
- **In progress:** a "Fix branch: `fix/...`" line, plus "cause unknown" if it is only a mitigation.
- **Merged, pending gate:** on `fork/prod`, not yet in a running build. **Fixed, awaiting soak:** deployed, with the build SHA in a comment, watching for recurrence.
- **Fixed, unverified:** deployed, but only a person at a device can confirm it. Does not block anything.
- **Validated:** closed by the agent when the reproduction passes and the soak window ends with no recurrence signal. Otherwise close as `duplicate`, `invalid`, or `wontfix` with one line of reason.

Severity is a line in the body, as in #1. High: data loss or a core flow dead. Medium: recoverable, misleading, or lossy. Low: cosmetic or rare. The iPad counts as my main surface.

Issue template, from #1 to #3. Title: `bug(scope): symptom`.

```
## Problem            what I saw, surface and build, when (UTC), thread id
## What the code shows   (or: What the logs show) cited files and spans
## Likely trigger        (or: Not yet known) verified vs. not; name the unknowns
## Proposed fixes        (or: Next steps) numbered, smallest first, with surfaces
## Diagnostic for next time   what to read so no one reconstructs it by hand
## Related               issues, upstream issues, fix branch
Severity: ...
```

## The loop here

**Discover**, cheapest first: open issues and the README pain list; papercut records once they exist; server traces and provider logs; read-only audits by subsystem against rules 1 to 3; upstream issues for the same symptom. Subagents are for read-heavy audits only; each returns candidates with observed behavior, expected behavior and its source, evidence, and confidence. They never edit.

**Verify before fixing.** Classify each candidate: real, stale, intended, open question, duplicate, test defect, or environmental. Evidence is a trace, log, quoted rule, or reproduction, never "looks wrong". Check whether upstream `main` has the bug too; that decides whether the fix is isolatable ([upstream-issues.md](./upstream-issues.md)).

**Prioritize** by reasoned order, not a score: data loss and dead core flows, then wrong results, then frequent confusion, then rare edges. Prefer verified over suspected and a shared cause over local patches. Break ties with the README priority list ("Trustworthy thread state" first).

**Fix** on a `fix/*` or `feat/*` branch off `main`, one concern each, in new files where practical. Fix the cause: if five places lack a timeout, consider the shared primitive. Walk "Hit every surface" and say in the issue which entries applied and which were decided "not here". Add a test that fails if an upstream merge drops the fix. For data-touching fixes, inspect real variants by copy first; never rewrite my data to make a test pass.

**Validate** with the smallest proof: `vp test run <files>`, targeted lint and typecheck, no repo-wide checks, receipts and drains instead of sleeps. Then have a fresh reviewer try to disprove the fix: is the symptom gone, was a sibling surface missed, does the test only mirror the implementation. A defect is validated only when the original behavior was verified, the intended behavior is grounded in rules 1 to 3, a focused test passes, a reproduction of the original symptom no longer fails (on the simulator for iPad defects, once #4 exists), the fix is deployed, and the soak window passes with no recurrence signal. I am never the test runner.

**Re-audit** the touched subsystem and shared primitives after each merged batch, file what turns up, and reprioritize.

**Land.** When the gate passes (targeted checks, a fresh reviewer's attempt to disprove the fix, a test that fails if a merge drops it), the orchestrating session merges to `fork/prod` and deploys with `fork-deploy`, then updates the issue and the docs in the same change. Subagents never merge or deploy.

**Handoff.** The issues are the handoff: state, branch, next action. Anything in "Needs me" in [posture.md](./posture.md) goes through `agent_inbox`.

## Fork rules

- The three ways to hurt yourself in `AGENTS.md` have no exceptions: no kill by pattern, nothing writes to or serves from `~/.t3/userdata` (copy with `VACUUM INTO`), never set `VITE_HTTP_URL` or `VITE_WS_URL`.
- Branches follow the README: off `main`, merged to `fork/prod` when the gate passes. Never commit to `main`.
- No PRs unless I ask. Dev servers, the Browser panel, and simulators are fine against an isolated worktree `.t3` or a copy of my data. Computer use that drives my real desktop, and anything touching live data, still needs me. Subagents never launch servers.

## iPad and mobile

Most defects first appear on the iPad, where server traces cannot see a blocked JS thread and agents cannot read the local cache.

- **Evidence a report needs.** The time (UTC, within minutes, since the trace rotates about every minute at 10 MB), thread id, exact on-screen text (sync label, Send `aria-label`), whether another thread still opens, whether the same thread opens on web or desktop against the same server, and whether reload or force-quit clears it. Record the installed iPad build when known (open in the README).
- **Proceeds without the simulator.** Server causes, and `packages/client-runtime` logic that web shares, can be tested on web with seeded data. A bounded mitigation (timeout, size cap, retry) can ship on a branch, but the issue stays open as "mitigated, cause unknown" until the cause is shown.
- **Blocks on #4.** A blocked JS thread, the contents of the app's local cache, native rendering, gestures. Mark "Blocked on #4", move to independent work, and do not claim a root cause from code reading alone.
- **When papercut capture takes over.** Stage 1 (web, desktop) ends hand reconstruction there; stage 2 (iPad shake and header action) ends it on the iPad. After that, an iPad report without a papercut record id is incomplete unless the app could not respond. A hung JS thread cannot capture itself, so the stall detector from #4 comes first. Until then "Not yet known" in the template is expected.

## Alone, or with me

Alone: everything in the loop above, including fixing on a branch, committing, pushing to the fork, merging to `fork/prod` when the gate passes, deploying through `fork-deploy`, filing and closing fork issues, and recording a decision I already made in `docs/fork`. Choose a default and record it rather than asking.

With me: only the list in "Needs me" in [posture.md](./posture.md).

## Gaps

Documents the charter would use that do not exist. None has an owner issue yet except #4. Titles are proposals.

- **Intended behavior for core thread flows** (send, sync, resync, what a thread accepts while not ready). Only the README's priorities and its "Still open" item exist, so #2 and #3 lack acceptance criteria. Issue: "decision: what a thread accepts while not ready".
- **A verification baseline** (targeted checks already failing on `fork/prod`). Issue: "baseline: targeted checks on fork/prod".
- **Stalled-turn detection**, which `papercuts.md` says the server lacks. Issue: "feat(server): detect a running turn with no provider events".
- **Papercut capture** has a branch (`feat/papercuts-stage1`) and a page but no issue. Issue: "feat: papercut capture".
- **The instrumentable iPad simulator** is #4.

## First steps

1. **Baseline from what exists.** Read #1 to #4, the README status and priorities, and the open `fix/*` branches. For #1 to #3, add the fix branch, merge state, and deploy state to the issue. Record targeted test results for those branches only.
2. **First audit slice: stuck states.** One read-only pass for "no timeout, no way out" in the command lane, local dispatch, sync state, and awaited provider control calls, across web, mobile, and each provider adapter. File verified candidates with the template under the shared cause in #2.
3. **Close gaps in order:** the baseline issue, #4, then the not-ready decision, which unblocks acceptance for #2 and #3. File the other two gap issues alongside.
