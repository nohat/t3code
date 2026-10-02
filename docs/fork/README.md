# The nohat fork: vision and strategy

This fork (`github.com/nohat/t3code`, upstream `pingdotgg/t3code`) is the one place where I improve my own T3 Code experience across every surface I use: web, desktop, mobile, and the chat and notification channels around them. This page records why the fork exists, how it relates to my other systems, what hurts today, how code gets from an idea to my daily-driver instance, and what to work on first. Upstream-facing guidance stays in `AGENTS.md`; this file is fork-only and never goes in a PR.

Last reconciled: 2026-10-01 against the live machine, `~/code/scaffold`, `~/code/project-app`, and about 30 of my T3 threads (the `t3code`, `t3code-main`, and `pr-visual-evidence` projects, plus T3 mentions in `scaffold` and `project-app` threads).

## Intent

I switched to T3 Code for two reasons: it is provider-agnostic, and because it is open source and coding agents are good now, I can tailor it to my own productivity, in how it looks and feels as well as how it works. It is my bespoke agent manager: the cockpit where I see only the information I need to decide, and where friction between "an agent finished" and "I acted on it" is removed.

Consequences:

- **Not upstream-driven.** Upstream acceptance is not a goal. A feature does not need to be PR-ready, and I do not trim scope to please upstream. I still keep changes additive and at the edges where that is cheap, because every line I diverge costs a merge later.
- **iPad and iPhone are first-class surfaces**, not an afterthought to the Mac. I want to build my own there too, and get features and fixes onto iOS devices as easily as onto the Mac.
- **Visual quality is a requirement, not polish.** Density and trustworthiness targets are set for me personally.
- **Admin is automated.** Servers, processes, builds, tunnels, and upstream sync should take none of my attention.

Two tests for any change, from `project-app/docs/motivation.md`: lazy input and professional output; complexity serves simplicity.

## Where the fork sits

| System               | Role            | What it owns                                                                                                                                                                               |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `~/code/scaffold`    | Nervous system  | Always-on agent runtime (Telegram bridge, scheduled jobs, heartbeat), attention providers, the gated deploy pipeline (`components/deploy-ops`), the dispatch fleet, `agent_inbox` handoffs |
| `~/code/project-app` | Product factory | Schema-driven runtime for one-off apps (drawerkit first), the agent-native workflow (`scripts/dev`, `.agent-workflow/`), evidence and review records                                       |
| `~/code/design-kit`  | Visual system   | Tokens, component specs, gate scripts; the source for the fork's visual grammar                                                                                                            |
| **this fork**        | **Cockpit**     | The human-facing surface for running and supervising agents: threads, worktrees, review, model choice, notifications, on every client                                                      |

Seams already declared elsewhere:

- `project-app` ADR 0006: consume T3 Code as an external local service behind a thin `ConversationProvider`; extract adapters only when a missing capability forces it. For the fork this means: keep `packages/contracts` changes small and additive.
- `project-app` F-0029 / F-0003: evidence-packet review is built in a T3 session. T3 is the review workbench for that workflow.
- `scaffold` declared-interfaces spec: the 2026-08-20 tunnel incident (declared origin `3773`, server bound `3774`) is the model failure. A service exposes its real port, and checks read the declaration from the artifact that configures the service.
- `scaffold` handoffs: `agent_inbox` is the single path from any agent to my phone. The fork feeds it rather than growing a second notification channel.

## What hurts (evidence from my threads)

Ranked by cost. Each item cites what I actually said or what the database shows.

1. **Prod and dev share a lifecycle, so work and sessions die.** "you keep killing yourself" and "the dev one keeps crashing" (2026-10-01 04:15); "this session has gotten forked between my main T3Code instance and the dev one"; "the dev instance is running, but pointing at the `main` data, not my `work` data". Later that day, I asked "what happened?" in three threads within 15 minutes (15:22 to 15:36), and five `OpenCode server exited unexpectedly` errors landed across three threads (15:53 to 15:57). Recovery was by hand: `RESUME-*.md` files, a "recovered WIP" commit, and a research subagent's findings that were lost outright. I have not traced each failure to its trigger, but the structural cause is on the machine today: production is `vp run dev:desktop` on a live checkout, so any file save restarts it, and the embedded provider servers go with it.
2. **State is not glanceable.** "what happened?" (x3), "status update?", "provide a status update, _then_ continue working" (x3), "how are we doing?", "what artifacts are there for me to review?", "how can i browse the results", and 22 bare "continue" messages across threads. Long-running agent work gives me no at-a-glance answer to "what is it doing, is it stuck, is it waiting on me, what is ready to review".
3. **Continuity between threads is hand-carried.** Plans live in gitignored `.plans/` and are absent from worktrees, so every handoff prompt says "(absolute paths, .plans/ is gitignored, not present in this worktree)". I asked for hand-written "prompt for a new thread" at least five times, and once moved a session to a non-T3 harness "to avoid the session failure issues".
4. **Getting a feature into my daily driver is a ritual.** "deploy it to local dev", "commit the fix to a feature branch and push it to my fork... a way to push fixes to it for immediate use", "deploy it to my local work branch so i can use it". The cost picker was developed twice on two branches, and merging them produced a conflict that killed the instance.
5. **Test and dev tooling touches my real environment.** The test suite "keeps spawning tabs in my main browser session"; the Nightly app and the dev-desktop share one live SQLite home; finding the original cost-picker thread meant searching three data homes.
6. **Worktrees cost disk and have no on-demand cleanup.** "each worktree eats up substantial disk space, so I would like to be able to trigger cleanups on demand." Settling a thread does not remove its worktree, and the rules are easy to misread (see `docs/user/project-settings.md#storage-cleanup`).
7. **Choosing a model is blind and the picker fights me.** I want to "pick the right model and be confident there's no better one for my balance of priorities"; the first cost badge was unclear (`~$x ln`) and the labeled picker "cuts off the model names". Provider rough edges also block me: the OpenCode agent selector showed only "Build", a provider rate limit killed a turn, and the same instruction-loading test had to be run in three threads because a provider did not follow my global rules.

8. **Thread state can't be trusted, especially on iPad** (reported 2026-10-01, from the iPad). Send is sometimes unavailable "for no reason", threads get out of sync, and there is no easy way to force a complete resync and redraw. "I'm not sure why the send button should ever be unavailable." This ranks with pain 2 in priority.
   - What the code shows (not yet root-caused for the iPad case): the web Send button is disabled by a union of five states in `ComposerPrimaryActions.tsx`: send busy, connecting, environment unavailable, no sendable content, or a `sendDisabledReason` (rewinding, feedback upload, **"Messages loading"** while `threadSyncPhase` is `loading`, preparing worktree, project clone). The reason is carried only in the button's `aria-label`, so on touch the button is simply dead with no visible explanation. Any of those flags sticking after a missed update produces exactly this symptom.
   - `docs/internals/connection-runtime.md` describes reconnect and foreground-probe behavior, but I found no user-invoked "resync this thread" action on web, desktop, or mobile.

## State today (2026-10-01)

Facts verified on the machine:

- **"Production" is dev mode.** `vp run dev:desktop --home-dir ~/.t3`, from `~/code/t3code` on `local/t3-work`, against the live `~/.t3/userdata`, up for about a day.
- **A second writer is installed.** `T3 Code (Nightly)` (0.0.45-nightly) in `/Applications` shares the same data home. Single-writer is enforced only by memory.
- **Two checkouts of one repo** (`~/code/t3code`, and the linked worktree `~/code/t3code-main`), more worktrees under `~/.t3/worktrees`, and about 14 local branches.
- **The fork drifted.** `main` equals `origin/main` but is 34 commits behind `upstream/main`.
- **Operator knowledge is private and manual.** Layout, ports, and hard rules live in gitignored `.t3/LOCAL_SETUP.md` plus a dirty, never-to-be-committed `AGENTS.md` pointer. Tunnel, dev stacks, and the deploy merge (`.t3/deploy.sh`) are all started and checked by hand.
- **Scaffold already solved this for Python.** Primary checkout is not production; production is an immutable release behind a symlink; a poller gates, swaps, health-checks, and rolls back; heartbeat speaks only when something is broken.

## Target model

### 1. Production is a build with its own lifecycle

Production runs a packaged build of `fork/prod` from an immutable release directory (`~/code/t3code-deploy/releases/<sha>`, with `current` as a symlink), supervised by launchd. Nothing an agent does in a checkout can restart it. This is the fix for pain 1 and the foundation for everything else.

Instances never share a data home:

| Instance            | Code                             | Data home                          |
| ------------------- | -------------------------------- | ---------------------------------- |
| Prod (daily driver) | `current` release of `fork/prod` | `~/.t3` (live)                     |
| Dev stack           | any worktree, `vp run dev`       | that worktree's `.t3`              |
| Nightly             | upstream                         | retire it, or give it its own home |

A dev stack started by an agent must be unable to reach the live home and unable to open my main browser. Both become defaults in the dev tooling, not rules for me to repeat (pains 1 and 5).

### 2. One branch model

- `main`: fast-forward-only mirror of `upstream/main`. Never commit here.
- `fork/prod` (rename of `local/t3-work`): `main` plus the features I have accepted. The only branch ever built for production.
- `feat/*`, `fix/*`: feature branches off `main`, merged into `fork/prod` when accepted. A feature lives on exactly one branch; drop any stale copy from `fork/prod` before moving it (the cost-picker rule).
- Upstream sync merges `main` into `fork/prod`, never rebases, so production history is stable and rollback by SHA is meaningful. Opening an upstream PR is an opt-in side effect, only when I ask.

### 3. One checkout rule

`~/code/t3code` is the primary checkout: on `fork/prod`, never edited by hand, written only by deploy tooling. All development happens in worktrees (T3's own **New worktree**). `t3code-main` stops being special.

### 4. A deploy command, not a ritual

`fork-deploy` (a script in `scripts/fork/`, not a new service) is scaffold's `deploy.py` scaled down:

1. **Gate.** Targeted typecheck and tests for the packages the diff touches. Not repo-wide; CI owns that.
2. **Build** into a new `releases/<sha>`.
3. **Drain.** Refuse to restart while any thread has a running turn, unless forced. Restarting kills running agents, which is the costliest side effect of today's setup.
4. **Swap** `current` and restart prod.
5. **Health check** the new server (version and port from the server itself). On failure, swap back and restart.
6. **Report** through `agent_inbox`. Silence means success.

I recommend keeping this in the fork rather than registering it in scaffold's `deploy-ops`: scaffold's pipeline is built around Python batteries and launchd units, and coupling two release trains conflicts with "one clear place". Scaffold watches the result. This is reversible.

### 5. Automation of the admin

Small launchd jobs, each doing one thing, installed by one script (job names are working names):

| Job                        | Does                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t3.prod`                  | Keeps the production server and desktop shell running from `current`                                                                                                                    |
| `t3.tunnel`                | Runs `cloudflared`; its origin is read from the server's exposed port, never declared twice                                                                                             |
| `t3.upstream-sync`         | Daily: fetch upstream, fast-forward `main`, trial-merge into `fork/prod` in a scratch worktree, run the gate, report "N new commits, clean" or "conflict in X". It never lands anything |
| scaffold `t3_attention.py` | Heartbeat reads prod health, Tailscale exposure health, deploy failure, and sync result. Heartbeat already stays silent unless something is broken                                      |

### 6. iPad and iPhone

The target is the native app on iPad and iPhone, built from this fork and updated as easily as the Mac. The full strategy, with decisions, activation triggers, and staged plan, is in [mobile.md](./mobile.md). It is **parked** until iPad friction becomes the top priority. Decided: enroll in the paid Apple Developer Program when it activates, and use Tailscale instead of running my own T3 Connect stack. The one real cost of skipping Connect is push notifications, which mobile.md covers. The pull-to-reload design below can be prototyped sooner in the existing dev client.

### 7. Where knowledge lives

- This page: vision, branch model, deploy model, priorities.
- Gitignored `.t3/LOCAL_SETUP.md`: volatile facts only (PIDs, ports); mostly replaced by `fork-deploy status` over time.
- The `AGENTS.md` operator pointer stays local. Pointing agents at this page is a one-line edit to upstream's file and needs my sign-off.
- Backlog: GitHub issues on the fork, per upstream's no-committed-plans rule. Plans that must survive across threads and worktrees live at one absolute path outside any checkout, not in per-worktree `.plans/` (pain 3).

## What other forks teach

Surveyed 2026-10-02 from GitHub (6,300 forks of a 24,000-star repo). Reddit and Hacker News searches returned nothing usable, so this is GitHub evidence only.

- **Most forks are shallow.** The active ones either rebrand and move to their own data directory (`akeru-bot` uses `~/.akeru` so it never touches `~/.t3`, `upcomputer`, `t3libre`) or build a different UX on the same runtime (`t3kanban`: a task board; `openbot`: browser-only). They ship desktop builds from their own GitHub Releases. None of the ones I read ship their own iOS app, and none list mobile as a platform. I found no one who has done the native-iOS path in this plan, so expect to be early.
- **Keeping up with upstream is the recurring cost.** Syncs run 88 to 123 commits at a time (one merged 396 files, +22k lines) and are always done as merge commits, never squashes, because a squash makes the next sync conflict everywhere. The same files conflict repeatedly: `packages/contracts/src/settings.ts`, `serverSettings.ts`, `CommandPalette.tsx`, `routes/__root.tsx`, `pnpm-lock.yaml`. One fork's PR names the real danger: files that merge cleanly while silently dropping fork behavior. Two forks automate it: a bot opens an issue on conflict and an agent resolves it, merging only after CI passes.
- **Upstream's mobile app has the same sync class of bugs.** Issue #13994 reports a client stuck on "Syncing threads" or reconnecting after the host restarts. Other open iOS bugs include a hidden question while settling (#10192) and opening a thread during compaction (#12133). Upstream also has a separate SwiftUI client in TestFlight beside the React Native app, so the official mobile direction may change under me. That argues for a small mobile footprint of my own.
- **Upstream already supports building with your own bundle id** (issue #3994, closed), which is the first step of the iOS path.

Consequences for this fork: sync upstream often and in small merges, as merge commits; put my features in new files rather than editing settings, contracts, the command palette, or the root route, so conflicts stay rare; give every feature a test that fails if a merge drops it; and make `t3.upstream-sync` open a conflict report the way those forks do.

## Where to spend feature effort

Filter: a change earns time if it removes a friction I hit weekly and works on the surfaces I use (desktop, web via tunnel, mobile). In priority order:

1. **Trustworthy thread state** (pain 8). Three changes, each across web, desktop, and mobile, since all three share `packages/client-runtime`:
   - **Send is never dead.** If the thread is not ready, the message goes into a visible outbox and sends when it is, instead of the button disabling. Truly blocking states (such as an in-progress rewind) show their reason as text beside the composer, never only in an `aria-label`. This is a proposal that needs a decision about what the server accepts during each state.
   - **A real resync, as pull-to-reload.** One action that drops the cached projection for the current thread, resubscribes from the server, and redraws. Design:
     - _Where the gesture lives._ The mobile feed rests at the newest message (`ThreadFeed.tsx` uses `maintainScrollAtEnd` and a live-follow latch), so the standard top-edge pull would force me to scroll to the oldest message first, and it is the natural place for loading older history. The primary gesture is therefore **overscroll past the newest message**: drag up from the end of the feed to resync. If an on-device prototype shows that fights the feed's end-anchoring or the keyboard-aware list, fall back to dragging down on the thread header. Pick by trying both on the iPad, not by argument.
     - _Feel._ The indicator tracks the drag with rubber-band resistance, has one fixed threshold (about 72 pt) marked by a haptic tick, and settles to "Resyncing" then "Synced just now". It begins only when the drag starts while the feed is at its end, so it never competes with ordinary scrolling, and it is disabled while the keyboard is up or a selection is active. It honors Reduce Motion.
     - _Never gesture-only._ Apple's guidance is that a gesture needs a non-gesture equivalent: a "Reload thread" item in the thread menu, the same action in the command palette, a hardware-keyboard shortcut on iPad, and a VoiceOver custom action. Web and desktop get the menu, palette, and keybinding. A visible "last synced" age is the reverse state, so I can tell when it is needed.
   - **Diagnose before fixing the iPad case.** Find which disable reason or stale flag is sticking, and surface it. The first step is making the reason visible, which turns the next occurrence into a bug report.
2. **Attention and glanceable state** (pains 2 and 3). One view of every running thread: working, stuck, waiting on me, ready to review, plus handoffs from other repos. Scaffold's attention providers already model "what needs David now"; the cockpit renders the same signal. A stalled turn should say so, which also targets the 22 "continue" nudges. The triage playbook work is the start.
3. **Thread continuity** (pain 3). A first-class handoff: start a new thread or worktree carrying the plan, branch, and checkpoint, with no hand-written prompt.
4. **Worktree lifecycle** (pain 6). On-demand cleanup with sizes, settle and unsettle, PR status. The reverse-state rule applies.
5. **Model choice with confidence** (pain 7). Finish the cost picker as built (blended rate, configurable display, hover details, evidence), then the catalog pipeline from published benchmark data with provenance links (no benchmarking of my own), then the visual grammar for model strengths, provenance, and density from `design-kit`.
6. **Provider parity.** OpenCode support-gaps waves 0 to 2 and the agents surface, in the order already planned. Instruction-loading parity across harnesses is a provider-adapter decision, per adapter.
7. **Review workbench.** Evidence-packet review for the project-app workflow (F-0029). The visual-evidence skill already moved to its own repo, which is the right shape.

Each feature gets a recorded decision per surface and per provider, the same checklist as upstream's "Hit every surface".

## Status (2026-10-02)

- **Packaged build spike passed.** An unsigned arm64 build of the `local/t3-work` tip runs from an unpacked release directory, serves its own port, and reads only the data home it is given. Two traps cost time, and both are now handled in `fork-deploy`: builds must run in a scrubbed environment (agent shells inherit the dev-desktop's `T3CODE_*` and `VITE_*` variables, which launch a dev Electron and bake localhost origins into the bundle), and the resource monitor needs a newer Rust than Homebrew ships, so the build `PATH` carries an isolated rustup toolchain.
- **`fork-deploy` exists** (`scripts/fork/`, branch `feat/fork-deploy`): gate, build, drain, swap, probe, roll back, report. It was rehearsed against a copy of the live data on a throwaway launchd label: a held deploy, a good deploy, and a broken release that rolled back. The rehearsal found two launchd traps: `kickstart -k` hangs on a job stuck in "spawn failed", and `bootstrap` fails with an I/O error right after `bootout`. The script times out and reloads the job.
- **Thread state, first slice** (branches `fix/send-blocked-reason`, `feat/thread-resync`): a disabled Send button now says why, as text, on web and mobile; `requestThreadResync` in the client runtime reloads a thread from a fresh snapshot, exposed on web as **Reload thread** (thread menu, command palette) and `mod+alt+r`. Mobile has no entry point yet; it needs the on-device pull-to-reload prototype.
- **One cost-picker copy.** `wip/triage-model-cost-picker` is canonical; the copy on `local/t3-work` is tagged `superseded/cost-picker-on-local-t3-work`.

## Order of work

1. **Stop the bleeding (first).** Make dev stacks incapable of touching the live home or my main browser; decide Nightly; delete the duplicate cost-picker copy from `local/t3-work`; rename it `fork/prod`; trial-merge `upstream/main` in a scratch branch to size the drift.
2. **Production as a build.** Spike a local packaged build of `fork/prod` (`dist:desktop:dmg:arm64`, unsigned, own bundle id, update feed off), prove it runs against a copy of the live data, then write `fork-deploy` with drain, swap, health, and rollback. The first feature through it is the cost picker, since it is already built.
3. **Automate.** The four jobs above, then the scaffold attention provider.
4. **iOS path** is parked; see [mobile.md](./mobile.md) for its triggers and stages. The pull-to-reload prototype can start before it, in the existing dev client.
5. **Feature work** from the list above, each a small branch through the new pipeline. Trustworthy thread state (Send, resync) comes first, then attention and handoff, because they attack the pains that cost me the most work.

## Decisions

Decided 2026-10-01:

- **Production form: packaged desktop app**, built locally from `fork/prod`. The build spike must prove it runs against a copy of the live data before anything else depends on it; if it cannot, fall back to a headless `t3` server from the release dir with the browser as the client.
- **Mobile: native app, paid Apple Developer enrollment, Tailscale instead of T3 Connect.** Parked until activated; see [mobile.md](./mobile.md).
- **Retire the Nightly app.** Removal waits until the packaged fork build is verified, so there is always a working fallback.

Decided 2026-10-02 (deploys must not lose work):

- **Order of defenses:** (1) **Continue threads after restarts** stays on, so a forced deploy resumes interrupted threads from their stored resume cursor; (2) a **drain mode** in the server's command gate that refuses or queues new turn starts while `fork-deploy` waits for running turns to reach zero; (3) a durable "interrupted by deploy, resumed" activity on each affected thread so a stalled resume is never silent; (4) `--force` remains the fallback, now safe because of (1). Build (2) as its own branch, starting with a spike on what the client shows for a refused send (not yet traced).
- Known limits of (1): Claude resumes from its last completed assistant message, so partial in-flight work is lost; approval-required threads stall waiting for a person; terminal commands die; OpenCode can leave orphans after a hard kill.
- The fork's GitHub Issues are now enabled and are the backlog (nohat/t3code#1, #2).
- A **papercuts** capture is planned: see [papercuts.md](./papercuts.md).

Still open:

- Rename `local/t3-work` to `fork/prod` and `~/code/t3code-main` to something that is not "main".
- Where the shared cross-thread plans directory lives.
- How to replace push notifications without Connect (mobile.md lists three options; Telegram through `agent_inbox` first).
- Which exact app I use on the iPad today (the App Store release, assumed here) and whether I rely on Live Activities, widgets, or the share extension.
- What the server should accept while a thread is not ready (the basis for an outbox instead of a disabled Send).
