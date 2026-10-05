# Upstream orchestration V2: what it is and what it means for the fork

Status: **report, 2026-10-05**, against `upstream/main` 3e6b45028c and `fork/prod` 79da40fabd. Written for the V2 catch-up (nohat/t3code#36) under the sync plan in [upstream-sync.md](./upstream-sync.md) (#6). Four read-only research passes produced Parts 1 to 4; each tags claims **verified** (read in code or measured with a read-only command) or **inferred**. Nothing was built, run, or deployed. Numbers marked as measured came from a `VACUUM INTO` copy of the live database (counts and timings only, never content), deleted afterward.

## Summary

**What it is.** Upstream commit `de34391427` (2026-10-02, 1907 files) replaced the server's orchestration core, its provider adapters, its wire contract, and the client state layer with a new design called orchestration V2. Server, web, desktop, and mobile move together under a hard protocol gate (`ORCHESTRATION_PROTOCOL_VERSION = 2`; mismatches get HTTP 426).

**How it differs.** V1 was a global command queue, a decider/projector pair, and reactors that reacted to events. V2 plans each command under a per-thread lock, commits events, projections, the idempotency receipt, and outbox effects in one SQL transaction, and runs side effects as leased, retried outbox effects. Provider knowledge sits entirely behind one adapter interface. The thread model changed from "turns and activities" to runs, attempts, execution nodes, and a 25-kind timeline-item union. Subagents are first-class child threads. Details in Part 1.

**Benefits that are real.**
- Restart safety: stale-writer guards, leased effects, durable restart continuation.
- Background work and subagents: first-class nodes, mailbox delivery of completions, wakes that keep their timers.
- A bounded wire: cold open is a capped snapshot plus `afterSequence` catch-up, and command events shrink on the wire (the upstream fixtures show 8,790 B to at most 1,024 B for a command event, and 10.4 MB to at most 131 KB for a snapshot, measured against V2's own earlier variants, not against V1).
- Client features the fork wanted anyway: multi-route environments with LAN and tailnet learning, `expectedEnvironmentId` before a pairing code is spent, jittered reconnect backoff, queued and steered follow-ups, provider switching with context handoff, `delegate_task`, PR watch agents.
- Upstream's own fix for the class of bug behind fork issue #3 (mobile shell-cache encoding yields to the host).

**Costs and risks.**
- Size and newness: about 81k non-test lines in `orchestration-v2/`, 177 upstream commits in the 3.5 days after it landed, 39 of which touch V2 and 28 of those are fixes, mostly run lifecycle. Expect churn under every port.
- A one-time data cutover: `statev2.sqlite` is a copy of `state.sqlite` (1.09 GB live); only thread shells and user/assistant text carry over; no tool calls, diffs, plans, or approvals.
- Rollback to a v1 release loses everything created on V2 (Part 4).
- It strands the fork code built on V1 (below).

**Bottom line.** Take it. Every day adds about 45 upstream commits on top of the 69-file conflict, and nothing upstream targets V1 any more. But it is a port, not a merge: 8 fork features are obsolete or mostly obsolete, 13 need real porting, 5 are mechanical. One blocker the earlier trial merge missed: the live database already contains migration id 55 (`PushDevices`, from the APNs branch), the same id V2 uses for its schema, so V2's tables would silently never be created (Part 4, section 1).

## Fork conflicts and recommendations, consolidated

Disposition: **Drop** (upstream does it or the code is deleted), **Port** (reimplement on V2), **Adapt** (small change at a V2 hook), **Mechanical** (textual conflict only), **Defer** (after the catch-up). The hook points and evidence are in Parts 1 to 4.

| # | Fork work | Disposition | One-line reason |
| --- | --- | --- | --- |
| 1 | Drain mode (`c45ea87d87`) and mobile drain hold (`993d7994dc`) | **Port, first** | The deploy depends on it. State file reused; gate at `ThreadMessageIntake` for user-started turns, steers allowed; count from `orchestration_v2_projection_runs`; add `reason` to the V2 error types; mobile outbox must match the V2 error tags. About 300 lines. |
| 2 | `fork-deploy` (counter, restart, budget, rollback) | **Port, with 1** | Its running-turn count reads the frozen v1 table and would be silently wrong forever. Detail in Part 4, section 4. |
| 3 | Papercut server snapshot (`Papercuts.ts`) | **Adapt** | Queries read frozen v1 tables. Rewrite to runs, provider sessions, and the event log. |
| 4 | Papercut client (`papercut/threadContext.ts`) | **Adapt** | The only client-runtime file typed on the deleted `OrchestrationThread`. Rebuild from `OrchestrationV2ThreadProjection`. |
| 5 | Send never settles (#2, `679239af06`) | **Port** | V2 keeps Send busy while a run is preparing/starting/queued and never clears the local dispatch on success, so a hung provider start still pins Send. Port the expiry through a wrapper around the send body (not a 700-line re-indent). |
| 6 | Say why Send is disabled (web `c13bd158e5`, mobile `c345b67ecf`) | **Port** | Self-contained; "Environment disconnected" is still the wrong message upstream. |
| 7 | Reconnect feedback (#7, `97e365f61c`) | **Adapt** | `failureKind` must be added to `EnvironmentConnectionSummary` and its equality check or it goes stale silently. Drop the supervisor test that upstream now asserts the opposite of. Fix the "update the app" text for hosts that need the server updated. |
| 8 | Mobile cache bound and stall retry (#3, `9ad46d7618`) | **Port, after 9** | The retry must call thread resync, since an explicit reconnect now probes a healthy session and leaves it. V2 paging may remove the trigger; reproduce on V2 first. |
| 9 | Reload thread on demand (`9bc244ab1d`) | **Port (rewrite)** | Client only; the V2 server already serves snapshots. Hook: `ThreadHistoryHandler` and the `resubscribe` stream in `client-runtime/state/threads.ts`. |
| 10 | Composer draft persistence (#8, `4caaa9217b`) | **Mechanical** | Web clean; mobile keeps both edits around `schedulePersistComposerState`. |
| 11 | Model picker dismissal and starred group (#9, `ee48c89e4b`) | **Mechanical** | Drop the fork's "thread bound to its harness" filter; V2 can switch provider. |
| 12 | Model pricing and cost display (`031c71c95e`, `b3ec61b2e9`, `badf71a3ec`) | **Mechanical** | Four small conflicts plus four re-applied deltas in `ws.ts`. |
| 13 | Claude silent-CLI fix (#1, `68194b330a`) | **Drop** the patch, **Adapt** two bounds | The mechanism is gone (V2 queues the message without waiting on the CLI). Two calls remain unbounded and can hold a start or a Stop; add 3 s bounds. |
| 14 | OpenCode wave 0/1, child-agent `task.*` (`46f2aae328`, `9d566b4c3f`, `313cd677f5`, `dacc1f0aa2`, `c76491554d`) | **Drop** | V2's OpenCode adapter has native child threads, token usage, rollback, fork, compaction. |
| 15 | OpenCode scoped agents (`f602765a91`) | **Port** | Upstream still loads agents machine-wide; only the 1.x branch matters (installed `opencode` is 1.18.34). |
| 16 | OpenCode startup, #18 #19 #20 | **Port #18 #20; reframe #19** | Still a single attempt with raw stderr. Upstream documents one server per thread for 1.x on purpose, so #19 as written contradicts it. |
| 17 | OpenCode snapshot refresh policy | **Drop** | Conflicts with upstream's "refresh from Settings" rule. |
| 18 | Subagent dispatch, #21 | **Drop** the V1 toolkit; **Adapt** pricing and skill | `delegate_task` and `t3_thread_launch` cover dispatch. Add pricing and recent-use counts to `orchestrator_capabilities` and rewrite the model-selection skill for the upstream tool names. |
| 19 | Stall watchdog and `stalledSince` (`911e4b6fe9`, `442110291b`), #28 | **Defer** | V2 has nothing equivalent, but only #28 consumes it, and the surface needs a durable timeline item instead of an in-memory flag. Revisit after a V2 stall is seen. |
| 20 | Direct APNs (#15) | **Port, after the catch-up** | Not on `fork/prod`. Must not use migrator id 55; use a file store. Relay hook redone on V2 events. |
| 21 | iPad feed-jump patch (#17, `4bc98892fa`) | **Take upstream's patch, re-verify** | Upstream shipped its own keyboard-controller patch. The fork's guard test forbids what it does and must change with the decision. Replay the 19k-pixel thread on the simulator. |
| 22 | `feat/model-catalog` | **Defer** | Narrow overlap, but two new upstream text-generation classes would fail typecheck until they implement it. |
| 23 | Design-system scaffold | **Mechanical** | Regenerate `routeTree.gen.ts`, run `design:check`. |
| 24 | Environment discovery and notifications proposals | **Re-scope** | D0 and D2 shrink: the route catalog, route learning, and `expectedEnvironmentId` shipped upstream. Re-check the notifications "approvals are not timeline rows" assumption; V2 has `approval_request` and `user_input_request` items. |
| 25 | Analytics default (#23) | **Unchanged** | Upstream still defaults to its PostHog key. The opt-out must ride in the first V2 launchd plist. |
| 26 | File chips (#14) | **Unaffected** | Never started; build on upstream's descriptive-label work. |

## Decisions recorded as assumptions

The research passes raised questions; the engineering ones are answered here, and the three that touch product feel have a default so the work does not stop. Change any by saying so.

- **Drain ships in the first V2 merge.** `continueThreadsAfterServerUpdate` is already `true` in the live `settings.json` (verified), so a forced deploy would resume interrupted threads that have a durable run and native resume id. Migrated v1 threads have neither, so drain stays the safe path.
- **`waiting` runs are reported, not blocking,** for deploy drain. They are post-turn background work that a restart cancels and tells the agent about.
- **Version label.** By [versioning.md](./versioning.md) the first versioned build mints 1.0.0 and a data migration is a major bump after that. If the V2 deploy is the first versioned build it is 1.0.0; if any versioned build ships before it, it is 2.0.0. The rule decides; do not pick by hand.
- **Rollback policy: fix forward after the first real V2 turn.** Before cutover: a `VACUUM INTO` backup of `state.sqlite` under `~/.t3/fork-backups`, the last v1 release pinned against pruning, and the previous iPad build kept installable. `fork-deploy rollback` onto a v1 release from V2 prints what will be hidden and needs `--accept-data-loss`.
- **`PushDevices` rows are dropped.** Device tokens re-register on next app launch. The v1 file is never edited; the row is removed from the new copy only.
- **OpenCode stays on 1.x.** The installed binary is 1.18.34; moving to 2.x is not part of this.
- **Hung provider start (product feel): keep the fork's 30 s expiry** that frees Send, via a wrapper, because the owner reported the stuck button as a defect (#2). Re-measure after the port; the 120 s start timeout is dropped because V2 replies at commit.
- **Reload thread is web-first,** mobile reaches resync through the stall pill. Pull-to-reload stays parked per the README.
- **`stalledSince` (#28): kept as an open issue, blocked on the watchdog port,** which waits for a V2 stall in the field.
- **Cross-project parent link (#21): not required.** `t3_thread_launch` plus a prompt-level reference is enough. If wanted later, propose an optional `projectId` on `delegate_task` upstream.
- **The model-selection skill stays fork-only.**
- **Cut a candidate, do not land it.** The sync agent produces `sync/upstream-20261005` and a report. Landing on `fork/prod` and deploying are separate steps, each its own dispatch.

## An unexplained write to live data

The live `state.sqlite` ledger records migration 55 `PushDevices` at 2026-10-04 16:57:36, but the running prod release (`7345a87552`) does not contain the APNs branch. Something that ran the `feat/direct-apns-push*` code opened `~/.t3/userdata`. The process is gone, so the cause is unknown (a dev stack started with `--home-dir ~/.t3`, or the Nightly app, are the candidates). This is the "writing to the live install" hazard; the guard-hook work in #6 should include a mechanism that refuses to start a non-prod server against `~/.t3/userdata`. It also means a v1 server with the APNs code could have been writing to the same file the V2 cutover will copy.

## Recommended sequence

1. Pre-flight (read-only): record the measurements below on #36; check free disk (the volume is 96% full; the cutover duplicates about 1.1 GB); back up `state.sqlite`.
2. Build the gates from #6: guard hooks, `patches.tsv` and `delta-check`.
3. Merge `upstream/main` into a scratch worktree cut from `fork/prod`, `rerere` on, upstream's `pnpm-lock.yaml` taken and regenerated, `fe417dff4c` kept.
4. Port in this order: drain and `fork-deploy` V2 changes; papercut tables and client context; send-never-settles; reconnect feedback; resync; stall retry; send-blocked reasons; drafts; scoped agents; OpenCode retry; Claude bounds; picker and pricing; subagent pricing and skill. Each keeps or rewrites its guard test.
5. Gate: guards and `delta-check` green; targeted typecheck and tests only.
6. Later, separately dispatched: land, build, stage, cutover (Part 4 section 4 gives the sequence), 48 h soak, then APNs, the watchdog, `feat/model-catalog`, and re-diagnosing #3 and #18 to #20 on V2.

Measurements (live data, counts and timings only): `state.sqlite` is 1,088,491,520 bytes; `VACUUM INTO` took 26.4 s; the server's own copy method (`readOnly` plus `backup()`) took 5.1 s warm; migration 55 is DDL only; the shell import query on 203 threads took 0.19 s. `fork-deploy`'s 90 s first-boot probe is thin for a cold disk; use 240 s for the first V2 boot.

---

# Part 1. Server core architecture

### 1. V2 server core architecture

Evidence tags: **[R]** read in code or docs, or computed with a read-only command; **[I]** inferred. Upstream paths are at `upstream/main` (3e6b45028c); `apps/server/src/orchestration-v2/` is abbreviated `ov2/`.

#### 1.1 Domain model

V2 replaces V1's thread/turn/activity/session aggregate with a graph of durable records (contracts: `packages/contracts/src/orchestrationV2.ts`, 3,465 lines) [R].

| Concept | V2 record | Notes |
| --- | --- | --- |
| Project | `projection_projects` (kept) plus project events in the shared application log | `ProjectStore`, `ProjectCommands` |
| Thread | `OrchestrationV2AppThread` (`orchestration_v2_projection_threads`) | Holds lineage/fork, settle/snooze/pin, `limitRecovery`, `deletedAt`. Provider identity is `activeProviderThreadId`, not the thread itself. |
| Run (a "turn" in the glossary) | `OrchestrationV2Run` | Statuses: preparing, queued, starting, running, waiting, completed, interrupted, failed, cancelled, rolled_back. Carries `queuePosition`, `queueHeld`, `workStartedAt`, `restartContinuationOfRunId`, `delegatedCompletion`. |
| Attempt | `RunAttempt` | A run can be retried. Stale-writer guards key on `(runId, activeAttemptId)`. |
| Execution node | `ExecutionNode` | Tree under a run (`root_turn`, `tool_call`, `subagent`, and others). Checkpoint scopes and runtime requests hang off nodes. |
| Provider session / thread / turn | `ProviderSession`, `ProviderThread`, `ProviderTurn` | The native side. Sessions are runtime containers that can host several provider threads. |
| Message | `ConversationMessage` | Separate from timeline rows. |
| Timeline row | `TurnItem` | A 25-member union: assistant_message, command_execution, subagent, approval_request, user_input_request, checkpoint, error, system_notice, and others. Positions live in `orchestration_v2_turn_item_positions`. |
| Request | `RuntimeRequest` | Statuses pending, resolved, expired, cancelled; `responseCapability` is live, message, or not_resumable. |
| Checkpoint | `CheckpointScope` + `Checkpoint` | Per node scope, so subagents and tools get their own refs. |
| Settlement | `settledOverride`, `settledAt`, `unsettledAt` on the thread | Server-owned. `thread.auto-settle` is a guarded command. |

Tables: 24 `orchestration_v2_*` tables [R]. Besides the 17 projection tables there are `events`, `command_receipts`, `effect_outbox`, `turn_item_positions`, `legacy_imports`, and `thread_launch_workflows`. Most projection rows are an indexed key plus `payload_json`, so a port reads non-indexed fields with `json_extract`.

#### 1.2 Command in, event out

1. **Entry.** ws `dispatchCommand` (`ws.ts:1797`) and `launchThread` (`ws.ts:1953`), plus two MCP handlers (`mcp/toolkits/project/handlers.ts:107`, `attachment/handlers.ts:62`), all call `ThreadMessageIntake` (`ov2/ThreadMessageIntake.ts`). Intake only claims or releases pending attachments and then calls `ThreadManagementService.dispatch`. It is **not** a policy gate [R]. Scheduled tasks, restart continuation, usage-limit recovery, the PR watch reactor, and delegated-task wakes call `ThreadManagementService` or the orchestrator directly and skip intake [R].
2. **Decide.** `Orchestrator.dispatch` (`Orchestrator.ts`, 10,293 lines) takes a per-thread `KeyedLock` (`ThreadCommandExecutor.ts`). It checks `orchestration_v2_command_receipts` first. A replay returns the stored result, and a previously rejected id fails. It plans events plus outbox effects. "Pure, no I/O" in AGENTS.md is aspirational: planning reads the projection store and provider-session capabilities (`Orchestrator.ts:4506`, `:4606`) [R].
3. **Delivery resolution.** `message.dispatch` carries `dispatchMode` (defer_start, steer_active, restart_active, queue_after_active, start_immediately) and optional `deliveryIntent` auto/steer/restart. `CommandPolicy.resolveMessageDispatchIntent` (`ov2/CommandPolicy.ts:120`) resolves "auto" inside the lock from the live projection, so the client never decides steer versus start [R].
4. **Commit.** `EventSink.commitCommand` writes events, applies `ProjectionStore.apply`, writes the receipt, inserts outbox effects, and advances `orchestration_v2_projection_metadata`, all in one SQL transaction. `commitThenPublish` (`EventSink.ts:239`) takes a one-slot publish lane as the last step of the transaction and holds it until subscribers are notified. Without it, a descheduled writer could publish after a later commit, and clients drop any event at or below their newest applied sequence [R].
5. **Sequence.** One global autoincrement `sequence` covers project and thread events. Indexes exist for thread, thread+type, run, and command. Resume replays at most 128 events or 1 MiB, then falls back to a snapshot (`docs/internals/performance-regressions.md`) [R].
6. **Effects.** The outbox types are provider-turn.start/interrupt/steer/restart, provider-runtime.continue, provider-session.detach, runtime-request.respond, provider-thread.rollback, checkpoint.capture, terminal.cleanup, attachment.cleanup, and thread-title.generate (`EffectOutbox.ts:28-102`). `EffectWorker` claims them with leases and retry backoff and feeds results back as commands. Tests wait on `EffectWorker.drain` or a persisted event instead of sleeping [R].

#### 1.3 Run lifecycle and wake semantics

- **Active** (shell "working") means a run in `preparing`, `starting`, or `running`. `waiting` is **post-terminal drain**: the agent turn is over and background work is pending (`Orchestrator.ts:470`, `ProjectionStore.ts:1464`). The shell exposes `activeRunId` (without `waiting`) and `activityRunStatus` (with it). SQL at `ProjectionStore.ts:4826-4846` [R].
- A provider turn ending and finalization (checkpoint capture, PR discovery) are separate milestones. Finalization runs as the `checkpoint.capture` effect, so `runs.status` can be terminal while an outbox effect is still in flight (`overview.md`, "Turn completion") [R].
- A **wake** is a queued message from the server or provider with `notification` or `delegatedCompletion`, dispatched `queue_after_active`. When the thread is idle it starts a normal run. `workStartedAt` keeps the working timer from resetting (`#15029`) [R].
- Restart. `ProviderRuntimeRecoveryService` retires effects tied to the dead process, cancels stale runs, and holds queued runs (`queueHeld`). If the environment setting `continueThreadsAfterServerUpdate` is on (default **off**, per-project override), `RestartContinuation` dispatches `"Continue where you left off."` for an unfinished root turn. It requires a strong native resume id, and it declines if the user stopped the run or newer work exists. Stable command and message ids make retries idempotent (`docs/internals/server-updates.md`) [R].

#### 1.4 Services that react

| Service | Role | Started from |
| --- | --- | --- |
| `ThreadSettlementService` | 1-minute sweep over `ProjectionStore.getSettlementCandidates`. Applies PR-merge and inactivity rules, then dispatches guarded `thread.auto-settle`. | `server.ts:469` [R] |
| `PullRequestSyncReactor` | 1-minute sweep. One host read per distinct PR, stack discovery. Already existed in V1, moved. | `server.ts:518` [R] |
| `PullRequestWatchReactor` | New. Agent `watch_pull_request`, wakes the thread on checks, comments, or conflicts. | `server.ts:528` [R] |
| `ResourceCleanupService` | A `Context.Reference` with a no-op default. Live version closes terminals and deletes attachments for the cleanup effects. | `server.ts:451` [R] |
| `ThreadSearch` | `LIKE` over `json_extract(payload_json,'$.text')` of finished user and assistant messages. No FTS. V1 had the same feature (`searchThreads`), so this is a port, not a gain. Untouched V1 transcripts are not searched. | `ws.ts:1200` [R] |
| `Notification` / `NotificationMailbox` | **Agent-facing** background-work reports and at-least-once mailbox steers. Unrelated to the fork's push notifications. | Orchestrator [R] |
| `ProjectionMaintenance` | `verify`, `rebuild`, and `compactEventStore`. | startup [R] |

New workers belong in `RuntimeCoreDependenciesBaseLive` (`server.ts:509`) as `Layer.effectDiscard`. Long roots use `forkParked`, which parks at the activation gate (`serverActivation.ts`) [R].

#### 1.5 V1 to V2 mapping

Verified on `fork/prod` V1 files [R]: V1 already had durable command receipts, event and projection in one transaction (`OrchestrationEngine.ts:274`), and a global in-process command queue.

| V1 | V2 | Verdict |
| --- | --- | --- |
| `decider.ts` | `Orchestrator.ts` + `CommandPolicy.ts` | Replaced (reads state, 10k lines) |
| `projector.ts` + `ProjectionPipeline` | `ProjectionStore.apply`, same transaction | Kept in spirit, rewritten |
| `OrchestrationEngine` global queue | Per-thread `KeyedLock` + startup command gate | Replaced |
| Command receipts | `orchestration_v2_command_receipts` | Kept |
| `RuntimeReceiptBus` (test-only signals) | `EffectWorker.drain` or persisted events | Dropped |
| `ProviderCommandReactor`, `CheckpointReactor`, `ThreadDeletionReactor` | Outbox effects + `EffectWorker` | Replaced: durable, leased, retried |
| `ProviderRuntimeIngestion` | `ProviderEventIngestor` + `RunExecutionService` | Replaced |
| `ThreadSettlementReactor/Policy`, `PullRequestSyncReactor`, `ThreadPullRequestReactor` | Same-named V2 services | Kept, ported |
| `ThreadBackgroundLiveness` | `derivePendingBackgroundWork` (shared helper, called at `ProjectionStore.ts:1343`) | Replaced |
| `ThreadTurnActivity/Watchdog`, `ServerDrainState` (fork) | none | Fork-only |

#### 1.6 Benefits, with evidence

- **Correctness and restart safety [R].** Stale-writer guards (`writeIfRunCurrent`, `writeIfProviderThreadOwner`) stop a late event from clobbering a newer attempt. The outbox has leases and backoff. Recovery picks candidates from projection state (queued runs, pending requests, live sessions, background work) without loading completed histories. `ProjectionMaintenance` can verify and rebuild.
- **Background, subagent, and wake model [R].** Subagents are first-class nodes and threads. Delegated completions are mailbox-delivered. Wakes keep their timers. Restart notes tell the agent which background work was cancelled.
- **Wire performance [R], with limits.** `vp run test:perf:v2-wire` (not run) pins a synthetic 600-row thread with 8 KiB outputs (`ThreadTransportPerformance.test.ts`). The full snapshot is 10,375,121 B and the bounded one is 1,038,647 B. Payload omission brings it to at most 131,072 B (first measured 67,412), under 2% of full. A command event drops from 8,790 B to at most 1,024 B (first 586). These are pre-compression RPC JSON sizes of **V2's own earlier variants**, not V1 against V2, and not server memory (the docs say so). The 10-turn, 75-item, 1 MiB window is explicitly "match the V1 conversation windows" (`threadHistoryPaging.ts:10`), so paging itself is not new. The new part is wire-boundary omission of command output and indexed catch-up.
- **Transcript paging [R].** Bounded snapshot, HTTP older-page fetch, and `afterSequence` resume.
- **Not new [R].** Search, and the shell and thread snapshot split.

#### 1.7 Costs and risks

- **Size [R].** `ov2/` has 278 `.ts` files. Non-test, non-testkit code is 81,304 lines (adapters 39,115), against 20,897 non-test lines in V1 `orchestration/` on `fork/prod`. The V1 adapters lived elsewhere, so the comparison is rough. `Orchestrator.ts` is 10,293 lines and `ProjectionStore.ts` is 6,176. Test code is 105,537 lines.
- **Newness [R].** `de34391427` landed 2026-10-02. By 2026-10-05, 177 upstream commits followed. Of those, **39 touch `ov2/` or the V2 contract, and 28 are titled "fix"**. The directory changed 106 files (+14,087/-5,046) after landing. The fix titles cluster on run lifecycle: stuck runs (#15048, #15055, #15770, #15224), restart (#15323, #15604), settlement (#15024, #15388, #16095), and Stop (#15355, #15546). Drain and watchdog touch this same surface, so expect churn under any port. The ratio is a rate over 3.5 days, not a defect density [I].
- **Data [R].** `statev2.sqlite` is a one-time copy of `state.sqlite`. Only shells and user/assistant text migrate, with no checkpoints, tool calls, plans, or approvals (`legacy-orchestration-migration.md`). The protocol is a hard cutover (HTTP 426 on a version mismatch).
- **Search scalability [I].** `ThreadSearch` scans message rows with `LIKE`; the cost grows with history.

#### 1.8 Fork features against V2

**Drain mode (`c45ea87d87`).**
- *V2 already provides:* `continueThreadsAfterServerUpdate` with durable continuation intent and graceful-shutdown capture. This makes the fork's "forced deploy" defense (README "order of defenses", item 1) much stronger than on V1, so drain becomes an optimization that avoids cutting tool calls mid-flight. V2 does not provide a way to stop new turns.
- *Hooks:*
  - **State.** Reuse `ServerDrainState.ts` unchanged (139 lines; Ref plus TTL). Provide it as a layer next to the orchestrator.
  - **Gate.** `ThreadMessageIntake.dispatchCommand` for `message.dispatch` with `createdBy === "user"`, and `ThreadMessageIntake.launchThread`, since a refused launch must not create a thread (fork's `bootstrapThreadDisposition: "not-created"`). Refuse unless the target is a steer, meaning `dispatchMode.type === "steer_active"` or `deliveryIntent === "steer"`, or the thread's shell shows `activityRunStatus === "running"`. Read it with `ProjectionStore.getThreadShell` only while draining, so the non-draining path costs one Ref read. A full projection read at intake would regress the send path that `performance-regressions.md` says was optimized away. For an airtight version, check after `resolveMessageDispatchIntent` at `Orchestrator.ts:4506`; it costs an Orchestrator layer dependency.
  - **Bypass.** Server-started paths skip intake, which matches V1 intent. Scheduled tasks and `UsageLimitRecoveryWorker` (createdBy "user") also bypass. Leave them, because they are rare.
  - **Errors.** `OrchestrationV2DispatchCommandError` and `OrchestrationV2ThreadLaunchError` have no `reason` field. Add an optional `reason: "server-draining"`. Mobile's outbox matches the tag `OrchestrationDispatchCommandError` (`thread-outbox-model.ts:270`), which V2 no longer throws, so it must match the V2 tags. Add the message to `UserFacingErrors.ts`.
  - **Transports.** HTTP and CLI move to `ov2/http.ts` and `cli/`. Contract `environmentHttp.ts` additions are unchanged.
- *"Running" in V2:* `SELECT count(*) FROM orchestration_v2_projection_runs WHERE status IN ('preparing','starting','running')`. The partial index `orchestration_v2_projection_runs_recovery_idx` makes it cheap. Add `queued AND queueHeld IS NOT TRUE` (the "runtime" predicate at `ProjectionStore.ts:527`), because a queued run starts when the active one ends and would restart the count. Report `waiting` separately: restart cancels that background work and tells the agent, but the turn is over. Also consider `orchestration_v2_effect_outbox` rows pending or running of type `provider-turn.*` or `checkpoint.capture`, since finalization is decoupled from run status. Keep the "N consecutive zeros" poll in `fork-deploy`.
- **Recommendation: port, small.** About 300 lines, drain state unchanged. Do not describe it as the safety net; the safety net is the continuation setting. Verify that setting is on in the live environment.

**Turn-activity registry and stalled-turn watchdog (`911e4b6fe9`, `442110291b`).**
- *V2 provides:* nothing equivalent [R] (grep for stall, watchdog, and heartbeat finds only idle-session release in `ProviderSessionManager`). Stale-writer guards limit harm from a hung attempt, but nothing detects silence.
- *Hooks:*
  - **Stamp** each provider event before filtering, at `RunExecutionService.ts:1173` (the per-run `Stream.tap`, before `filterAssistantEvent`). `ProviderSessionManager.ts:1615` is the session-level alternative.
  - **Sweep** from a new `Layer.effectDiscard` in `RuntimeCoreDependenciesBaseLive`.
  - **Exempt** when the thread has a pending runtime request (`orchestration_v2_projection_runtime_requests`, status `pending`), `pendingBackgroundTasks` is non-empty, or the run is `waiting`.
  - **Candidates:** runs with `status = 'running'` joined to `provider_turns.status = 'running'`.
  - **Surface** (the main design change). The V2 shell stream is sequence-driven, so an in-memory flag cannot push an update. Append a durable item through `EventSink.writeIfRunCurrent` (a `turn-item.updated` of type `system_notice`, open until resumed) and derive `stalledSince` from that item. This needs no in-memory read in `getThreadShell`. Resume is an update of the same item. The contract change is one optional shell field.
- **Recommendation: defer.** Only #28 consumes it, the contract and projection change is real, and V2's `ClaudeAdapterV2` reopens the query (that is #1's cause) [per #36]. Revisit after a V2 stall is observed in the field.

**Thread reload and resync.** Reload is client-side: discard the cached projection, then fetch a fresh snapshot and resubscribe. Server support already exists in `subscribeThread` (no `afterSequence` returns a snapshot, `acceptBoundedSnapshot` returns a bounded one) and in the bounded HTTP snapshot. **Port the client only** (`client-runtime/src/state/threadDetail.ts`, `threadHistoryController.ts`). The 8 MB cache cap and 5 s restore limit for #3 are the client's cache format, and V2's bounded snapshots may remove the cause. Repro on V2 first.

**Papercut server snapshot (`Papercuts.ts`).** The queries read `projection_thread_sessions` and `projection_thread_activities`, which are frozen copies in `statev2.sqlite`, so they fail silently stale. The contract fields are plain strings and can stay. Rewrite as follows [R, SQL is a design]:

| Field | V2 source |
| --- | --- |
| `runningTurnCount` | the running count above |
| `sessionStatus` | latest run for the thread: `orchestration_v2_projection_runs` by `(thread_id, ordinal DESC)`, plus `provider_sessions.status` through `provider_session_bindings` |
| `activeTurnId` | the active run id (or the `provider_turns` row with `status='running'`) |
| `sessionUpdatedAt` | `provider_sessions.updated_at` |
| `lastProviderEventAt` | `SELECT occurred_at FROM orchestration_v2_events WHERE thread_id=? ORDER BY sequence DESC LIMIT 1`. Persisted events are coalesced, and user events are included, so label it "last event" |
| `recentFailedSpans` | trace-file scan, unchanged |

The client helper `papercutThreadContext` reads V1's `OrchestrationThread` (`latestTurn`, `session.activeTurnId`, `activities`). That type is gone upstream. Rebuild it from `OrchestrationV2ThreadProjection`: runs for the turn id, and `runtimeRequests` with status pending for the pending flags. **Recommendation: adapt**, small.

_The open questions raised in this part are answered under "Decisions recorded as assumptions" above._

---

# Part 2. Providers, adapters, subagents, and MCP


Source: `upstream/main` (3e6b45028c) at `/tmp/t3-upstream-main`, `fork/prod`, fork issues #1, #18-#21, #36. "Verified" means read in code or a read-only command; "inferred" means reasoned from code, not run.

### 1. What V2 gives the provider side

**Boundary.** `orchestration-v2/ProviderAdapter.ts` (600 lines) defines `ProviderAdapterV2` (capabilities, `planSelectionTransition`, `openSession`) and `ProviderAdapterV2SessionRuntime` (`ensureThread`, `resumeThread`, `startTurn`, optional `compactThread`, `steerTurn`, `interruptTurn`, `respondToRuntimeRequest`, `readThreadSnapshot`, `rollbackThread`, `forkThread`, `injectHistory`, `unloadThread`, `hasPendingBackgroundWork`). An adapter emits typed `ProviderAdapterV2Event`s (app threads, provider turns, turn items, subagents, runtime requests, nodes). It never touches orchestration state.

| Piece | Role (verified) |
| --- | --- |
| `ProviderAdapterRegistry` + `builtInProviderAdapterDrivers.ts` | Per-instance adapter creation from driver config; `getMetadata` returns capabilities and continuation key |
| `ProviderSessionManager` (2078 lines) | Live session residency: open, idle release, `maxIdlePinMs` pin while `hasPendingBackgroundWork`, release on runtime failure. Deliberately does not resurrect persisted sessions |
| `ProviderEventIngestor` | Normalizes adapter events into domain events through `ThreadCommandExecutor`; emits `provider.turn.completed` analytics |
| `ProviderTurnStartService`, `ProviderTurnControlService`, `ProviderContinuationService`, `ProviderRuntimeRecoveryService` | Start, interrupt/steer/restart, promptless wake turns, process-loss recovery |
| `ProviderSwitchService` + `ProviderSessionTransitionPolicy` + `ProviderSelectionTransition` | Switch plan: `reuse`, `switch_model_in_session`, `restart_and_resume`, `create_with_handoff`, `reject` |

Compared with V1 (provider adapters feeding a decider/projector/reactor chain), the adapter is now the only place with provider knowledge, and capabilities are declared per adapter instead of switch statements in orchestration. V1 `provider/Layers/*Adapter.ts` no longer exist upstream (verified: `provider/Layers` holds only `*Provider.ts` snapshot code).

### 2. Adapters present, size, maturity

Lines of `Adapters/*AdapterV2.ts`; "fixes" = upstream commits touching that file after de34391427 (verified with `git log de34391427..upstream/main`).

| Adapter | Lines (test) | Fixes | Notes |
| --- | --- | --- | --- |
| Claude | 7871 (8228) | 11 | Most churn: background agents, wake turns, plan mode, Windows path, MCP presentation. Still maturing |
| Codex | 6325 (7331) | 4 | Archived-session resume, Stop after settle |
| Acp (generic) | 8010 (14381) | 2 | Base for Grok (455 lines) and Antigravity (241 lines, no fixes) |
| AcpRegistry | 331 | 1 | Local provider commands (#16021) |
| OpenCode 1.x | 3796 (2689) | 1 | One chat server per thread |
| OpenCode 2.x (`OpenCode2AdapterV2`) | 4262 (3921) | 2 | One server per instance, per-thread `t3-code-<thread>` MCP entry |
| Cursor | 2684 (+SDK 612) | 2 | |
| Pi | 3017 (2530) | 2 | |

The `opencode` driver probes the installed version and picks 1.x or 2.x (`opencodeVersionProbe.ts`). The machine here has `/opt/homebrew/bin/opencode` 1.18.34 (verified), so the fork runs the 1.x adapter. Every adapter shipped in the first commit; Claude has had the most follow-up work and Antigravity/Grok the least (they are thin ACP flavors).

### 3. Switching, handoffs, subagents, MCP

- **Switching.** Same driver and continuation key: model change applies on the next turn (`turnScopedSelectionTransition`) or in-session when `supportsModelSwitchInSession`. Different driver or continuation key: `create_with_handoff`.
- **Handoffs.** `ContextHandoffService` builds a textual summary from user/assistant messages, commands, file changes, checkpoints (240-char `compactText`), either full history or delta since that provider last participated. No native-state parity (`docs/internals/context-handoffs.md`). Fork code does not touch this.
- **Child threads.** A subagent is an `OrchestrationV2AppThread` with `lineage.parentThreadId` and `relationshipToParent` of `"fork"` or `"subagent"`, plus an execution node of kind `subagent`. Provider-native subagents (OpenCode `task`, Claude `Task`) are created in the adapter via `makeSubagentChildThread` (`SubagentProjection.ts`); app-owned ones come from `delegate_task`.
- **MCP toolkit** (`mcp/toolkits/*`, gated by per-thread `McpCapability`: preview, orchestration, worktree, device, pull-requests). `orchestrator` toolkit: `orchestrator_capabilities`, `delegate_task`, `task_status`, `task_cancel`, `schedule_task`, `create_threads`, `t3_thread_list/read/update/send/wait/interrupt`. `project` toolkit adds `t3_thread_launch` (top-level thread with `projectId`, `modelSelection`, `workspaceStrategy`, `scratch`). #15219 (06e627448b) gave the thread/project tools explicit targets.
- **`delegate_task`**: child of THIS thread; `target` = `providerInstanceId`/`driverKind`, `model`, `options`; inherits runtime and interaction mode; async or wait; completion wakes the parent. Cross-provider works, cross-project does not (verified: input has no project field; child lives under the parent's thread).
- **Model manifest** (`provider/model-manifest.json`, `docs/internals/model-manifest.md`): bundled and remotely refreshable provider model metadata. Claude uses it for its whole catalog.
- **Device hub** (`docs/internals/devices.md`): supervised child of the server, exposed through the `device` MCP capability. It does not touch provider selection or adapters; no fork conflict from this section.

### 4. Fork conflicts and recommendations

#### (1) Claude silent-CLI fix, issue #1, `68194b330a` - DROP the patch, ADAPT two small bounds

The fork patch is in `provider/Layers/ClaudeAdapter.ts`, a deleted file. Reading the V2 send path:

- **Verified, gone.** `startTurn` (`ClaudeAdapterV2.ts` ~7084-7250) delivers the message with `querySession.query.offer(userMessage)`. `offer` is `Queue.offer` on an unbounded `promptQueue` (line ~700), so it never waits on the CLI. A model change never calls `setModel`: `openQuery` (~6921) compares `queryPolicyKey` and `selectionKey` and closes and reopens the query. A plan/default switch changes the policy key, so `setPermissionMode` is not used for it either. The hostage mechanism (awaiting a control reply before queuing) no longer exists on this path.
- **Verified, still unbounded.** (a) `openQuery` line ~6945: `yield* existing.query.setPermissionMode(existing.openedPermissionMode)`, run when Claude drifted into plan mode by itself (added by aad732901e). A silent CLI blocks `startTurn` there with `activeTurn` still null. (b) `interruptTurn` (~7338): `yield* existing.query.interrupt` before `close`, with no timeout; the 10 s `Deferred.await` only starts after it. A silent CLI can hold Stop.
- **Stop reported as failure.** V2 maps adapter failures to fixed text (`ProviderFailure.ts`: "The provider could not start this turn. Retry the turn..."), so the raw `ProviderAdapterSessionClosedError` string of #1 no longer reaches the user. Stop before the turn is active takes the `currentTurn === null && requestRuntimeRestart` branch (`closeLiveQueryForNativeThread`), which closes the query; a pending `startTurn` then fails and likely shows that fixed text (inferred, not run).
- **Not fixed upstream:** no silent-provider detection (no watchdog in `orchestration-v2`; verified by grep). The 18-minute silence in #1 would look identical to a user.

Recommendation: drop the old patch and its 2 tests. Port two one-line hardenings as a small fork patch at the hook points above: wrap (a) and (b) in `Effect.timeoutOption("3 seconds")` with a warning log; on timeout in (b) fall through to `close`. The visible-wait state and the watchdog belong with the stall-watchdog port (hook: `ProviderEventIngestor.ingestNormalized`, or the per-session event pump in `ProviderSessionManager` which already tracks `lastActivityAtMs`).

#### (2) OpenCode wave 0/1 and child-agent `task.*` - DROP most; PORT one web item

Fork changes were all in deleted `provider/Layers/OpenCodeAdapter.ts`. Against `OpenCodeAdapterV2` (1.x):

| Fork capability | V2 status |
| --- | --- |
| Child sessions as `task.*` events, parent-leak fixes (313cd677f5, dacc1f0aa2, c76491554d) | Obsolete. Native: `emitSubagent` creates child app threads, routes child permissions/questions to the owner, `session.children` sweep, `canForkFromSubagentThread: true`. Parent-leak class is structurally avoided (child traffic is routed by session id) - inferred |
| Token usage synthesis | Present (`OpenCodeTurnTokenUsageAccumulator`, per-turn `turnTokenUsage`) |
| Rollback / fork / thread snapshot | Present (`readThreadSnapshot`, `rollbackThread`, `forkThread`; capabilities all true) |
| Compaction | Present: `compactThread` sends `/compact` |
| Skills and slash commands | Present in `OpenCodeProvider.ts` (`COMPACT_SLASH_COMMAND`, skills, commands) |
| File-change diffs | Different model: `file_change` turn items carry `diffStr` from tool metadata (`OpenCodeToolItems.ts`); checkpoints are app-owned |
| `tool.progress`/`tool.summary` dual emission, `files.persisted` | N/A, V1 event vocabulary |
| Promptless turn continuation | Absent on 1.x, present on 2.x (`ProviderContinuationRequests`). Low value: 1.x `task` blocks inside the parent turn (inferred) |
| `tool.denied` on permission reject | Not verified; V2 resolves the runtime request (`permission.replied`) |
| Resume-compaction banner for any compaction-capable provider (web) | **Still missing upstream**: `shouldOfferResumeCompaction` is Claude-only (`ContextWindowMeter.logic.ts:63`). Port (small, web only) |
| Snapshot refresh policy (`openCodeSnapshotRefreshOptions`) | Conflicts: upstream sets `refreshOnInterval: false` and `checkProviderOnSettingsChange: () => false` for all instances (`OpenCodeDriver.ts:457`). Drop, or re-decide with product |

#### (3) OpenCode scoped agents, `f602765a91` - PORT (adapt)

Verified still missing: upstream builds the `agent` option from the machine-wide inventory (`openCodeCapabilitiesForModel`, server cwd), and `snapshotForCwd` (`OpenCodeDriver.ts:493`) refreshes only skills and commands in both its `v1` and `v2` branches. `ServerProviderWorkspaceSnapshot` has no `agents`. Only the 1.x adapter consumes an `agent` option (`OpenCodeAdapterV2.ts:3269`); the 2.x adapter hardcodes `build`/plan, so only the `v1` branch matters (and it is the installed version). Port: re-add `loadOpenCodeAgents` in `opencodeRuntime.ts`, the `v1` branch call and `openCodeModelsWithAgents` in `Layers/OpenCodeProvider.ts`, the additive `agents`/`agentCurrentValue` fields in `contracts/src/server.ts`, and the `client-runtime/providerSkills.ts` plus web/mobile composer hunks. Contract change is additive (decoding default). Keep its existing tests.

#### (4) OpenCode startup, #18 #19 #20 - PARTLY changed; re-diagnose on 1.x

- `startOpenCodeServerProcess` (`opencodeRuntime.ts:668-830`) is unchanged in the relevant way: single attempt, no retry on "database is locked", raw stdout/stderr in the error (#18, #20 remain). Only `loadInventoryFromCli` serializes and retries once (lines ~999-1010).
- **1.x (installed):** `OpenCodeAdapterV2.openSession` (line ~959) calls `runtime.connectToOpenCodeServer` per session, and `docs/internals/providers.md` states "one T3-managed chat server per thread" as a design rule (MCP registrations are directory-scoped). So #19's "share one serve per instance" now contradicts documented upstream intent for chat sessions; do not port it as written. #18 and #20 still apply.
- **2.x:** one server per instance via `OpenCodeServerOwner` behind a `Semaphore(1)`, so #19 is solved by design and concurrent startup is serialized. Still no lock retry.
- New upstream asset: `OpenCodeServerLedger` records each spawn (pid, port, group) and reaps orphans after a crash. It can supply the "concurrent serve count" #20 asks for.

Recommendation: port #18 as a bounded retry (2-3 attempts, backoff) around `startOpenCodeServerProcess`, matching `/database is locked|SQLITE_BUSY/` on the exit error's `cause.stderr`; port #20 by adding attempt count, a hint, and the ledger's live entry count to the same error. Close #19 as superseded for 2.x and reframe for 1.x (a startup mutex, not sharing).

#### (5) Provider-agnostic subagents, #21 - dispatch OBSOLETE; pricing and skill still ours (ADAPT)

The branch `feat/provider-agnostic-subagents` has no unique commits. The work is uncommitted in `/Users/nohat/code/t3code-provider-agnostic-subagents`: a `toolkits/delegation` toolkit (`list_agent_models`, `dispatch_subagent`, `get_subagent_status`, 961 lines) built on V1 `OrchestrationEngine`, an `"agents"` MCP capability, and `.agents/skills/t3-model-selection/SKILL.md`. Against upstream:

| #21 acceptance item | Upstream status |
| --- | --- |
| Catalog of configured provider/model choices | Done: `orchestrator_capabilities` (live catalog, options, constraints) |
| Launch in an explicit project, any provider/model | Done by `t3_thread_launch` (`projectId`, `modelSelection`, worktree strategy) |
| Cross-provider child with durable parent link and status/result | Done for same-project: `delegate_task`, `task_status`, `task_cancel` |
| Cross-project child that keeps the parent link | **Missing.** `delegate_task` has no project field; `t3_thread_launch` makes an unlinked top-level thread |
| Pricing in the catalog | **Missing.** `OrchestratorMcpProviderCapability.models[]` carries only `id`, `label`, `options`. Pricing exists upstream only in `usage/usagePricing.ts` (`RateTable`, `lookupRate`) |
| Recent-usage counts per model | **Missing** (fork computed 14-day thread counts) |
| Portable model-selection skill | **Missing.** No equivalent skill upstream |

Recommendation: drop the three fork tools and the V1 handlers. Hook point for pricing: `OrchestratorMcpService.capabilities` (`OrchestratorMcpService.ts:1459`), adding an optional `pricing`/`recentThreadCount` per model, plus the optional fields in `contracts/src/orchestratorMcp.ts`. Source rates from `usagePricing`, not from the fork's `ServerProviderModel.pricing` (which does not exist upstream; fork's mobile pricing UI has a separate decision). Rewrite the skill's tool names to `orchestrator_capabilities`, `delegate_task`, `t3_thread_launch`, `task_status`. The cross-project parent link is an upstream-shaped gap; defer it unless the fork owner needs it, then propose it upstream as an optional `projectId` on `delegate_task`.

#### (6) `feat/model-catalog` (`3d69a83155`) - DEFER

One WIP commit, 64 files, not on `fork/prod`. A throwaway `merge-tree` against `upstream/main` conflicts in only two files (`CursorTextGeneration.ts`, `contracts/src/index.ts`; verified). The overlap is narrow: it adds `generateModelSummary` to `TextGeneration.ts` and to the Claude, Codex, Cursor, Grok, OpenCode, and Antigravity implementations. Upstream also now has `OpenCode2TextGeneration.ts` and `PiTextGeneration.ts`, which lack it, so the union type in `TextGeneration.ts:122` will fail typecheck until those two implement it or are excluded. It does not overlap the upstream model manifest: that file feeds provider catalogs; the fork's `modelCatalog` is a separate `/models` dashboard with its own artifact. Land the V2 catch-up first, then rebase this branch.

### 5. Ordered port list, provider side

1. Drop: Claude `68194b330a`, OpenCode wave 0/1 and child `task.*` (46f2aae328, 9d566b4c3f, 313cd677f5, dacc1f0aa2, c76491554d), and the three-tool #21 toolkit. Record the reasons in the merge notes.
2. OpenCode scoped agents (3), 1.x branch of `snapshotForCwd`, with contract and client hunks. User-visible and the installed version needs it.
3. OpenCode startup retry and error detail (#18, #20), then close or reframe #19.
4. Claude hardening: 3 s bounds on `setPermissionMode` (line ~6945) and `interrupt` (~7338) in `ClaudeAdapterV2.ts`, with one test each.
5. Stall watchdog (`stalledSince`) onto the V2 event path, which also answers the "silent CLI looks dead" part of #1.
6. Pricing and recent-usage fields in `orchestrator_capabilities`, then the rewritten model-selection skill.
7. Web: resume-compaction banner for any compaction-capable provider.
8. Deferred: cross-project `delegate_task`, `feat/model-catalog`, OpenCode snapshot refresh policy.

_The open questions raised in this part are answered under "Decisions recorded as assumptions" above._

---

# Part 3. Wire protocol, contracts, and clients


Scope: `upstream/main` 3e6b45028c versus the fork sync point 54084ae1e6. "Verified" means I read the code or ran a read-only git command (including a throwaway `git merge-tree --write-tree fork/prod upstream/main`, whose conflict list I used below). "Inferred" is marked.

### 1. Contracts and wire protocol

- `packages/contracts/src/orchestration.ts` (2,454 lines) is deleted. `orchestrationV2.ts` (3,465 lines) replaces it, with `orchestrationDispatch.ts` (a leftover V1 error class), `orchestrationProject.ts`, `chatAttachment.ts`, `checkpointDiff.ts`, `modelSelection.ts`, and `threadPullRequest.ts` split out beside it.
- Model: V1 had one `OrchestrationThread` (turns, activities, session). V2 has a `OrchestrationV2ThreadProjection` of entities: runs, attempts, nodes, subagents, provider sessions/threads/turns, runtime requests, messages, plans, turn items, checkpoints, handoffs. Events are entity upserts (`run.updated`, `message.updated`, `turn-item.updated`), not V1's fine-grained names. There are 55 client command literals. A separate `OrchestrationV2InternalCommand` union (PR watch sync, rollback fail, background-work settle) is server-only and never reaches `dispatchCommand`.
- The shell is `OrchestrationV2ThreadShell` (dozens of fields, including `pendingRuntimeRequest`, `lastVisitedAt`, `pinOrderKey`, `pendingBackgroundTasks`). Most late additions are `Schema.optional` with decoding defaults.
- RPC surface (`ORCHESTRATION_V2_WS_METHODS`, orchestrationV2.ts:3022): `dispatchCommand`, `launchThread`, `getThreadProjection`, `getTurnItem`, `getTurnDiff`, `getFullThreadDiff`, `searchThreads`, `getWorkflowScript`, `getArchivedShellSnapshot`, `subscribeShell`, `subscribeThread`, `subscribeArchivedShell`. Eight of the twelve method strings equal V1's, so the version gate below is the only thing separating V1 and V2 payloads.
- Sync model (verified in `state/threads.ts` and `state/shell.ts`):
  - Shell: cached or HTTP snapshot (`GET /api/orchestration/shell`), then `subscribeShell{afterSequence}` replays missed events. `thread.updated`/`thread.removed` carry `location: active|archive`.
  - Thread cold open: `GET /api/orchestration/threads/:id/bounded` (falls back to `/threads/:id` on 404 or invalid JSON from an older server) with a 20 s timeout, then `subscribeThread{afterSequence, requestCompletionMarker, acceptBoundedSnapshot}`. The bounded window is 10 user turns, 75 items, 1 MiB (`threadHistoryPaging.ts`). `THREAD_HISTORY_SNAPSHOT_ROW_LIMIT` = 77 = `maxItems + 2`: two extra rows keep an inclusive cursor and prove another page exists. Older pages come from `GET .../history?cursor=` (opaque `historyCursor`, `hasMoreHistory`, `latestLocalTurnOrdinal`). The server marks "caught up" with `{kind:"synchronized"}`.
  - Live thread streams are budgeted at 1,000 items / 8 MiB per subscription (`LiveStreamBudget.ts`); an overrun is an error and the client resubscribes from its sequence (inferred from `retryExpectedFailureAfter: "250 millis"`).
- Versioning: `ORCHESTRATION_PROTOCOL_VERSION = 2` (environment.ts:13). The client sends `?orchestrationProtocol=2` on the socket and `x-t3-orchestration-protocol` on HTTP. The server requires strict equality, else `HTTP 426 orchestration_protocol_incompatible` (ws.ts:3770). `connection/compatibility.ts` reads `descriptor.orchestrationProtocolVersion ?? 1` before connecting: a newer server returns "update your app"; an older one returns "requires a newer server" and, when the host supports self-update, `serverUpdateRequired: true`, so the client can update the host (`outdatedHostUpdate.ts`, `onboarding.ts:128` still saves such a host).
- Forward compatibility (#15951, #16118): `ForwardCompatibleUnion/Array/Optional` (baseSchemas.ts) decode unknown tags to `UnknownUnionMember` or drop them. The thread stream decodes unknown event types to `{kind:"unknown-event", sequence}` that the client skips while still advancing its cursor (`threads.ts` `applyEventsLocked`). The shell stream union has no unknown member. Rule for fork contract additions: optional, defaulted, and server-to-client only.

### 2. client-runtime

- Deleted: `state/threadReducer.ts` (875 lines) and `pendingRequests.ts`. Added: `orchestrationV2Projection.ts` (event reducer), `threadHistoryController.ts`/`threadHistoryMerge.ts`/`threadHistoryHttp.ts` (paging), `threadRequests.ts` (replaces `pendingRequests`), `threadExecution.ts`, `threadInbox.ts`, `threadRelationships.ts`, `threadWorkflows.ts`, `platform/orchestrationCache.ts`.
- `threads.ts` is a single state machine per thread: cache → HTTP bounded snapshot → socket resume. Cache entries skip running threads and expanded (paged-in) timelines. `ORCHESTRATION_CACHE_SCHEMA_VERSION = 3` is shared by web and mobile, so fork-era caches fail the literal check and are discarded (inferred from `loadDecodedCache`'s catch-and-remove).
- `EnvironmentConnectionSummary` now lives in `state/presentation.ts` (mobile `WorkspaceEnvironment` is an alias). Its atom returns the previous object when eight named fields match, so a new field omitted from that comparison goes stale silently.
- Supervisor (#14897, #15467/#15468): jittered backoff (ceiling doubles from 2 s to 5 min), and `retryNow` on a healthy session now probes (3 s) instead of replacing it. Multi-route: `connection/routes.ts` ranks loopback < lan < tailnet < public < ssh < relay; the catalog entry has `alternateRoutes`; the server's `DirectEndpoints.ts` reports its LAN/tailnet addresses so a connected client saves them (`learnRoutes`); `onboarding.ts` accepts `expectedEnvironmentId` and checks it before spending the one-time code.

### 3. Surfaces

- Web: ChatView grew about 4,400 lines. New: queued runs, steer/queue follow-ups, thread details/relationships, subagent bar, usage-limit recovery banner, scheduled tasks, ACP registry, V2 item inspector, chat canvas, route editing UI.
- Mobile: the shell cache encodes thread rows in chunks and yields to the host (`shell-cache-encoding.ts`), so upstream hit the same JS-thread blocking class as fork issue #3. New: queue control, agents sheet, scheduled-task editor, provider switching, model-option memory, `EnvironmentRoutesSection`. The durable outbox gained `dispatchMode`.
- Desktop: V2 uses a new Electron profile (`t3code-v2`), not V1's. #15072 reads V1's LevelDB localStorage once at launch and merges it in the preload, copying every key V2 lacks (prompt stash and drafts merged by entry), except `t3.backgroundActivity.clientId` and the snap-shot setup-resume key. Cookies, caches, and website sign-ins do not carry over. The fork's desktop changes (IPC handler, channel, menu, preload line) auto-merge.
- Users see: bounded fast cold opens with "load earlier"; queued and steered follow-ups; handoff between providers; routes by LAN/tailnet/relay with automatic failback; fewer reconnect storms (jittered backoff, healthy sockets kept); and a "this client needs a newer server" message with an update button.

### 4. Fork items against V2 (hook points on upstream/main)

| Item | Verdict | Verified hook and V2 types |
| --- | --- | --- |
| Send never settles (679239af06, #2) | Adapt | `commands.ts:625` `startThreadTurn` now has three paths (`launchThread` L667, `message.dispatch` start, auto). The V1 comment "replies after the provider accepts" is stale: server replies at commit and prepares in `ThreadLaunchService.prepareInBackground`. Still hangable behind `startup.enqueueCommand` (ws.ts) and `persistAttachments`. Wrap the whole generator body, not just `dispatch`. `threadCommands.ts:283` `interruptTurn` and `:313` `stopSession` take the parallel lane. ChatView: no try/finally (12 conflict hunks in `ChatView.tsx` from the fork's re-indent). V2 trap: `hasServerAcknowledgedLocalDispatch` (ChatView.logic.ts:1254) returns false while run is `preparing/starting/queued`, and success leaves `localDispatch` set (ChatView.tsx ~9672). A hung provider start keeps Send busy. Stop is offered there (`session-logic.ts:1023`). Port the expiry, but release via a wrapper around the send body, not a 700-line re-indent. |
| Say why Send is disabled (c13bd158e5) | Port | Self-contained `sendBlockedReason.ts` plus tests. Upstream added a tooltip and `submitStatus` but still passes `environmentUnavailable \|\| noProviderAvailable \|\| projectSelectionRequired` as `isEnvironmentUnavailable` (ChatComposer L6726/7411/7535), so "Environment disconnected" is still wrong. Hooks: `sendDisabledReason` L2160, banner list L5068/L5568. `useDelayedStatus` already imported (L1129). |
| Same, mobile (c345b67ecf) | Port | `ThreadComposer.tsx:536-540`; render near "Model unavailable" (~L806). Mobile mostly queues in the outbox instead of blocking (inferred), so low value. |
| Reconnect feedback (97e365f61c, #7) | Adapt, partly drop | Keep `failureKind` + `connectionFailureGuidance` (connection/presentation.ts is untouched upstream). Add `failureKind` to `state/presentation.ts` `EnvironmentConnectionSummary`, `projectEnvironmentConnectionSummary`, and its equality check; mobile moves `connectionFailureKind/Label` onto `WorkspaceConnectionState` (`workspaceModel.ts` 5 hunks). Drop the supervisor test "explicit retry replaces a healthy session": upstream test L818 asserts the opposite. Fix the "unsupported" text ("Update the app") for `serverUpdateRequired` hosts: the fix there is updating the server. Web hooks: `ChatView.tsx:2590/2615/3033`. |
| Mobile cache bound / sync-stall retry (9ad46d7618, #3) | Port, depends on resync | `loadDecodedCache` (environment-cache-store.ts) still has the same signature, so `maxRawChars` merges; 8 MB is still sane because decode is synchronous. The 5 s timeout goes at `threads.ts:191` and cannot interrupt a synchronous decode (inferred). The pill hook is `ThreadDetailScreen.tsx:428-476`. Retry must call the thread resync, not `onReconnectEnvironment`, which now probes and leaves a healthy session alone. V2 paging likely mitigates #3's trigger (large thread) but I could not confirm. |
| Reload thread (9bc244ab1d) | Port (rewrite) | Extend `ThreadHistoryHandler` in `threadHistoryController.ts` with `resync`, register at `threads.ts:786`, and add a thread command beside `loadEarlier` (`threadCommands.ts` ~L385). Resync = delete cache row (`cache.removeThread`), set state to `empty`, `lastSequence` 0, `EMPTY_THREAD_HISTORY_META`, then trigger the `resubscribe` stream at L929 (merge it with `foregroundResubscriptions`) so the `Option.isNone(current.data)` branch refetches the bounded snapshot. UI hooks: `ChatView.tsx:7627` (shortcut next to `thread.settle`), `CommandPalette.tsx`, `Sidebar.tsx`, `threadActionMenu.logic.ts`, `useThreadActionMenu.ts`; contracts `keybindings.ts:44` and `shared/keybindings.ts:84`. Only web has it today; mobile gets it via the stall pill. |
| Composer drafts (4caaa9217b, #8) | Port | Web: `composerDraftStore.ts:132-137` still the lone `beforeunload`. Mobile: the one conflict is upstream exporting `schedulePersistComposerState` (L1000); keep both edits. |
| Picker dismissal + starred group (ee48c89e4b, #9) | Port | Web merges clean. Mobile `ThreadSettingsSheet.tsx`: one conflict in `useThreadSettingsCatalogItems` (L714); re-add upstream's one-liner `iconUrl: group.models[0]?.providerIconUrl`. Also drop the fork's "thread bound to its harness" filter in `ThreadComposer.tsx`: V2 has `canSwitchProvider`/`lockedProviderInstanceId`. |
| Pricing/cost (031c71c95e, b3ec61b2e9, badf71a3ec) | Port | Four mechanical conflicts: `ModelListRow.tsx` (keep upstream `ProviderInstanceIcon` plus `PricingBadge`), `providerIconUtils.ts` (upstream deleted the icon map; keep only the `ModelPricing` type), `modelOptions.ts`, `mobile-preferences.ts`. Needs `ServerProviderModel.pricing` and server `modelPricing.ts` (server section). |
| Drain hold in mobile outbox (993d7994dc) | Adapt | The `reason: "server-draining"` field was on V1 `OrchestrationDispatchCommandError`. V2's error is `OrchestrationV2DispatchCommandError` (no `reason`). Add the optional field there; `thread-outbox-model.ts:279` still switches on the dead V1 tag (upstream latent bug: V2 errors fall to message sniffing). |
| Papercuts UI/client-runtime | Adapt | Only `papercut/threadContext.ts` breaks: take `OrchestrationV2ThreadProjection`, use `derivePendingThreadRequests` (`threadRequests.ts`) for pending flags, latest run id for `turnId`, `projection.messages` (roles are user/assistant/system; the "reasoning" filter is dead; `createdAt` is a `DateTime`). Both Reporters pass `threadState.data.value`, which is now a projection. Use `orchestrationV2TestFixtures.ts`. `capture.ts`, `eventBuffer.ts`, `environment.ts` unaffected. |
| iPad feed jump (4bc98892fa) | Take upstream, then re-verify | Upstream bumped keyboard-controller 1.22.4 → 1.22.6 with its own patch (`adjustedStartInsetCompensation`, a different mechanism) and renamed the file. Its patched `src/useChatKeyboard/index.ios.ts` still contains `contentOffsetY.value =`, so the fork guard `keyboardControllerPatch.test.ts` fails by design. Replay the 19k px thread; re-add fork hunks only if the jump reproduces, and rewrite the guard to match whichever patch ships. |
| Design-system scaffold | Port | Bridge tokens still exist in upstream `index.css`. Regenerate `routeTree.gen.ts` (auto-merged, but generated), then `design:check`. `components/ui` imports all still resolve. |

### 5. Ordered client port list

1. Take upstream for the keyboard patch and lockfile; regenerate `routeTree.gen.ts`.
2. Rewrite `papercut/threadContext.ts` and its test (unblocks client-runtime typecheck).
3. Thread resync (client-runtime), then web menu, palette, and shortcut.
4. Mobile #3: `maxRawChars`, 5 s timeout, `useStalled`, stall pill wired to resync.
5. #2: `startThreadTurn` timeout, parallel Stop lane, send-body wrapper, expiry.
6. Send-blocked reasons (web, then mobile).
7. Reconnect feedback with summary-atom equality and `serverUpdateRequired`.
8. Composer draft flush (web and mobile).
9. Model picker, then pricing (after server `ServerProviderModel.pricing`).
10. Drain hold, after the server drain port.
11. Design `design:check`; re-measure the iPad jump on a device.

### 6. Fork proposals

- `environment-discovery.md`: D0 changes most. The route catalog and authenticated route learning it says to reconcile have shipped (see section 2). The "pairing carries no expected environment ID" gap in D2 is closed by `expectedEnvironmentId` (before the one-time code is spent). Discovery now supplies `host` and the TXT `id`, and for a saved environment feeds "Add route". What remains uncovered is first-time pairing and recovery when no live session exists to learn addresses. Phases D1 to D3 keep their order; trim D0 and D2 scope.
- `notifications.md`: its V2 re-map note holds. Shell fields already carry `pendingRuntimeRequest`, `lastError`, `lastVisitedAt` (server visit watermark), and `hasActionableProposedPlan`. A new `attention` field must be `Schema.optional`; the ack fits a client command plus service method; the raise fits an `OrchestrationV2InternalCommand`. The doc's "approvals and questions are not timeline rows" must be rechecked: V2 has `approval_request` and `user_input_request` turn items beside `runtimeRequests`. `pendingRequests.ts` (cited for G23) is deleted. The doc's rollback worry is partly addressed for clients, since unknown thread events are skipped (forward-compat), but not for the shell stream.

_The open questions raised in this part are answered under "Decisions recorded as assumptions" above._

---

# Part 4. Data migration, deploy, operations, and risk


Verified = read in code or measured by a read-only command. Inferred = reasoned, not run.

### 1. Blocker found: the live ledger already holds a fork migration at id 55

Verified on a `VACUUM INTO` copy: the live `state.sqlite` has `effect_sql_migrations` max id **55, name `PushDevices`**, applied 2026-10-04 16:57 (the Direct APNs branch `feat/direct-apns-push*`, which is not on `fork/prod`). Upstream V2 assigns id 55 to `OrchestrationV2` (`persistence/Migrations.ts:141`).

The Effect migrator skips every migration at or below the recorded maximum (`.repos/effect-smol/.../sql/Migrator.ts:251`). `reconcileV2PreviewMigration.ts` only repairs ledgers that contain an `OrchestrationV2` row at 53 or 54, so it does nothing here. Result on the copy: **migration 55 never runs, no `orchestration_v2_*` tables are created, and only 56 (drop four indexes) runs.** `runMigrations` just logs a "diverges" warning. `docs/internals/legacy-orchestration-migration.md` states the rule ("no safe id range for a fork"). #36 flags the collision for the APNs code but misses that **the data already carries the id.**

Fix (pre-flight, must precede any V2 start):
1. Create `statev2.sqlite` out of band (same method as the server, see 2), then `DELETE FROM effect_sql_migrations WHERE migration_id=55 AND name='PushDevices'` on the new file only. `initializeV2Database` returns early when the destination exists, so the server then runs 55 and 56 normally. The `push_devices` table stays in the copy (small; import or drop).
2. When APNs is ported, give it no migrator id: a file store or a fork-owned ledger table, per #36 and the doc.
3. Never edit `state.sqlite`; v1 tolerates the extra row.

### 2. How `state.sqlite` becomes `statev2.sqlite`

| Question | Answer (verified, `persistence/initializeV2Database.ts`, `Layers/Sqlite.ts:55`) |
| --- | --- |
| Where | `config.ts:140` `dbPath = <stateDir>/statev2.sqlite`; called from `layerConfig` before migrations and before HTTP binds. |
| Method | `node:sqlite` `DatabaseSync(state.sqlite, {readOnly:true})` then `NodeSqlite.backup()` into `.v2-import-*/snapshot.sqlite` in the same directory, then hard-link to `statev2.sqlite` (publishes only a complete file; `AlreadyExists` is ignored). Includes committed WAL content (test at `initializeV2Database.test.ts:120`). |
| Copied | The whole file: all v1 projection tables, v1 event log, auth sessions and pairing links, receipts. It is a full clone, then V2 migrations 55 and 56 run on the clone. |
| Imported into V2 | Only thread shells at startup (blocking phase `import-shells`: title, project, model, modes, branch, worktree, archive/delete, settle, snooze, pin, linked PR) and, in a background fiber, user and assistant messages (`LegacyV1ThreadImporter.ts`, batches of 100). Streaming messages become interrupted items. **Not** imported: provider session identity, runs, checkpoints and diffs, activities and tool calls, approvals, plans. Per `docs/user/thread-migration.md`. |
| Idempotence | Runs once. If `statev2.sqlite` exists, nothing is read from v1 again, so v1-era changes after the first copy never arrive. Shell import is keyed by "no V2 event yet", so restarts do not duplicate. |
| Failure | Any copy error becomes `V2DatabaseImportError` and the server does not start. No partial destination. A killed process leaves a `.v2-import-*` temp directory (about 1 GB); nothing cleans stale ones (grep found no cleanup). A missing `state.sqlite` silently starts an empty V2 (wrong `T3CODE_HOME` would look like data loss). |
| v1 file written? | No. Opened read-only; the integration test asserts byte equality after V2 runs. |
| Poisoned-copy trap | A failed or rolled-back first V2 boot leaves a `statev2.sqlite` (for example one that got only migration 56 per section 1). Retries reuse it and never recopy, so a retry days later shows stale history. Delete or move it aside before every retry. |

### 3. Measurements (copy in /tmp, now deleted; counts only)

Live `state.sqlite`: 1,088,491,520 bytes, plus 17 MB WAL. Home is `~/.t3` (the prod launchd job `local.t3code.prod`, port 13774, is the one using it).

| Step | Result |
| --- | --- |
| `sqlite3 -readonly ... VACUUM INTO` consistent copy | **26.4 s wall**, 1,070,157,824 bytes (almost no free space) |
| Mirror of the server's method (`readOnly` + `backup()`) on the copy | **5.1 s** (page cache warm; cold read is likely a few seconds longer; inferred) |
| Migration 055 | DDL only, no INSERT or SELECT (grep), so under a second on any size. Shell reconcile query shape on 203 threads: 0.19 s. |

Row counts: projects 14, threads 203 (202 not deleted, 2 archived), messages 14,177 (6,493 user or assistant, the only ones imported), activities 122,326, sessions 201, turns 1,309, pending approvals 56, orchestration_events 222,540, command receipts 221,658, provider_session_runtime 197, auth_sessions 85, pairing links 41. Largest tables: `orchestration_events` 485 MB, `projection_thread_activities` 316 MB. Both are dead weight in V2 but are copied, so `statev2` starts near 1.07 GB (about 2.2 GB total; the data volume is 96% full, 18 GB free).

**Cutover time versus the 90 s budget** (`fork-deploy.ts:162`, 30 probes at 3 s, then a 10 s second probe): copy 5 to 30 s, migrations and shell import a few seconds, Electron and server boot is the rest. The HTTP descriptor probe (`/.well-known/t3/environment`, present in V2) is served before the background transcript hydration, so a first boot should fit, but with thin margin if the disk is cold or busy. Recommend a 240 s first-boot budget and pre-making the copy (section 5). Failure mode if it does not fit: the deploy rolls back while the copy is still running.

### 4. What breaks on a V2 build in fork-deploy

| Item | Behavior | Fix |
| --- | --- | --- |
| `countRunningSessions(stateDb)` (`fork-deploy-lib.ts`, used at `fork-deploy.ts:240,344`) | Reads frozen `projection_thread_sessions` in v1 `state.sqlite`. sqlite3 succeeds, so the `?? probeHealth` fallback never fires. It reports 0 forever (deploys over live turns) or the stale cutover count forever (holds every deploy). Silent. | Count from the server: `t3 drain status --json` `runningTurns`. Fallback SQL on `statev2.sqlite`: `orchestration_v2_projection_runs WHERE status IN ('preparing','queued','starting','running','waiting')`. Point `stateDb` at `statev2.sqlite` when present. |
| Drain (`ServerDrainState`, `cli/drain.ts`, `orchestration/http.ts`) | Built on v1 `OrchestrationEngine`, `ProjectionThreadSessionRepository`, `ws.ts` dispatch. All deleted upstream. A V2 build without the port has no `t3 drain`: `drainCommand` returns null, the log says "no drain mode", and the deploy waits on the broken counter. | Port per #36 (intake choke point, V2 run count, CLI into `binCli.ts`, which upstream split from `bin.ts`). Drain before the first V2 deploy ships. |
| Accidental server launch (`fe417dff4c`) | Verified: bare `t3`/`start` in mode `web` refuses when `server-runtime.json` names a live pid; mode `desktop` is exempt, so the packaged Electron under launchd is unaffected. `t3 drain ...` is a subcommand, not the default path. Without `drain` in the CLI, an unknown word now errors instead of creating a directory and starting a server. | Keep this commit in the sync. No fork change. Order: swap, then kickstart, never run `t3` bare against prod home. |
| `restartJob` (`kickstart -k`) | Inferred: kickstart kills without SIGTERM, which bypasses V2's graceful `prepareForShutdown` and `reconcile("shutdown")` (`serverRuntimeStartup.ts:446-456`). Crash-style recovery still runs at boot, but intent capture for continuation is lost. plist `ExitTimeOut` is 20 s. | Use `launchctl bootout` (SIGTERM, then SIGKILL after `ExitTimeOut`) and raise `ExitTimeOut` to 60 s or more. |
| First-boot probe | See section 3. | 240 s first V2 budget; keep 90 s later. |
| Rollback path | `rollback()` and the auto-rollback only swap `current`; they leave `statev2.sqlite` and never warn about hidden V2 data. | See section 6. |
| `serverCliCommand` | Hardcodes `Contents/Resources/app.asar/apps/server/dist/bin.mjs`. V2 only moves the server to `server.asar` on Windows; macOS path holds. | None. |
| `DesktopLegacyLocalStorage` | V2 desktop uses a new Chromium profile `t3code-v2`, and copies localStorage (drafts, stash, layout, theme) once from `T3 Code (Alpha)` or `t3code`. Prod passes `--user-data-dir=...t3code-prod`, but that directory has no Local Storage and the renderer uses `t3code` (setPath overrides), so the import finds its source. Cookies and website logins do not carry. | None; note in release notes. |

Update and restart: `serviceLauncher`/`selfUpdate`/trial-and-rollback snapshots (`docs/internals/server-updates.md`) serve `t3 service` installs, not fork-deploy's launchd-run Electron, so they give no database rollback here. `continueThreadsAfterServerUpdate` is already `true` in the live `settings.json`; on V2 that resumes interrupted threads that have durable run and native resume identity (`RestartContinuation.ts`). Migrated threads have none, so drain remains the safe path for them.

**First V2 deploy (running server is v1):** `drainCommand` uses `readCurrent`, which is the v1 release, so `t3 drain on` and the v1 `state.sqlite` count both work. Sequence: drain, three quiet polls, stop the job, run the prepare script (backup, ledger fix, link to `statev2.sqlite`), swap, bootstrap, probe with the long budget. **Every later deploy** is V2 to V2: it uses the V2 release's `t3 drain`, the V2 count, and a normal budget.

### 5. Fork-owned data

| Data | Survives V2? |
| --- | --- |
| `userdata/papercuts/*.json` and `.triage.json` | Yes (same `userdata` directory, not in the DB). But `Papercuts.ts` snapshot queries read `projection_thread_sessions` and `projection_thread_activities`; in `statev2` they still exist, frozen, so new reports carry stale server state without error (rewrite per #36). |
| Deploy registry (`releases/`, `.previous`, `current`), `fork-versions.json`, decisions ledger, `releases/<sha>/.fork-version` | Yes (deploy root, outside git and outside T3 home). `pruneReleases` keeps current and previous only. After a second V2 deploy the last v1 release becomes prunable (`keepReleases` 3). Per `versioning.md`, a data migration is a **major**: its label follows the rule in the decisions section. |
| `push_devices` (APNs) | In the DB only; see section 1. |
| Auth sessions, pairing | Copied at cutover; sessions created or revoked later exist only in `statev2`. |
| `settings.json`, keybindings, desktop and client settings, attachments, worktrees | Shared files, unchanged location. |

Analytics and egress (#23): V2 still defaults `T3CODE_TELEMETRY_ENABLED=true` and the upstream PostHog key (`AnalyticsService.ts:69-76`), and adds `provider.turn.completed` emission in `ProviderEventIngestor.ts:88`. The relay publishes only when linked; the fork has no Connect. The #23 fix (set the opt-out in the launchd environment, probe-checked) must ride with the first V2 plist. `launchd` reads a changed plist only on `bootout` then `bootstrap`, so combine it with the stop-and-prepare step above.

### 6. Rollback analysis

After N hours on V2, a rollback to a v1 release reopens untouched `state.sqlite` (state as of cutover). Lost to the v1 view: every thread, message, run, and checkpoint created on V2; renames, archive, pin, and settle changes; project changes; auth sessions minted since (devices must re-pair) and revocations (revoked sessions become valid again; a security regression). `statev2.sqlite` is kept, so nothing is destroyed, but the two histories diverge both ways. Files V2 wrote outside the DB (settings, worktrees for new threads) stay. Clients are lockstep: a v2 client against a v1 server is blocked as "unsupported", and a v1 client against V2 gets HTTP 426 (`compatibility.ts`, `ws.ts:3773`), so **rolling back the server also means reinstalling the previous iPad and iPhone build.**

Safeguards, smallest first:
1. Before cutover: `VACUUM INTO ~/.t3/fork-backups/state-pre-v2.sqlite` (26 s) plus a copy of `userdata/*.json`.
2. Pin the last v1 release (exclude from `pruneReleases`) and keep the prior iOS build installable.
3. `fork-deploy rollback` on a V2 current prints how many V2-era threads and messages will be hidden and requires `--accept-data-loss`. A rollback of a failed first boot moves `statev2.sqlite*` aside so the next attempt recopies.
4. Policy: rollback is a clean option only until the first real V2 turn. After that, fix forward. The soak (below) is what pays for the window.

### 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Ledger id 55 collision skips V2 schema (section 1) | Certain unless handled | V2 will not run | Prepare script removes the `PushDevices` row from the copy; APNs off the migrator |
| `countRunningSessions` stale | Certain | Deploys over live turns, or never deploys | Server-reported count; drain ported first |
| 90 s probe too short on first boot | Medium | False rollback, poisoned copy | 240 s budget; pre-made copy; move aside on rollback |
| Rollback after V2 use | Medium | Data and device-session divergence | Section 6 safeguards; fix-forward policy |
| Client lockstep (iPad, iPhone) | High | Mobile unusable until reinstalled | Ship mobile build the same day; keep the old build |
| 69-file merge drops fork behavior silently | High | Lost feature | `patches.tsv` and `delta-check` (#6) as the acceptance gate |
| Migrated history is messages only | Certain | Old threads lack tools, plans, diffs; the first reply is a fresh provider session | Read `thread-migration.md`; spot-check 5 busy threads before declaring done |
| Telemetry default on (#23) | Certain | Egress to upstream | Opt-out in plist, probe-checked |
| Poisoned `statev2` after a failed boot | Medium | Stale history on retry | Move aside on rollback |
| Graceful shutdown bypassed | Medium | Lost continuation intent | `bootout` plus longer `ExitTimeOut` |
| Disk: 2.2 GB duplicated, volume 96% full | Low | Copy fails | Check free space in pre-flight |

### 8. Ordered sequence (consistent with #36 and #6)

1. **Pre-flight (read-only):** record these measurements on #36; confirm free disk; snapshot `state.sqlite` to `~/.t3/fork-backups`; decide the fate of `push_devices`.
2. **Land the in-flight versioning work** (clean tree for the merge); build guards, `patches.tsv`, and `delta-check` from #6 first.
3. **Merge in a scratch worktree** with `rerere`; take upstream `pnpm-lock.yaml`; keep `fe417dff4c`.
4. **Port order:** drain with the V2 run count and `drain status` (the deploy depends on it), then `fork-deploy` V2 changes (counter, bootout, budget, prepare script, rollback warning), then papercut tables, send-never-settles and reconnect, resync, scoped agents, pricing and picker, APNs (file store), watchdog last. Each port keeps or rewrites its guard test.
5. **Gates:** `delta-check` and guards green; targeted typecheck and tests only; `fork-deploy status` and `drain status` work against a V2 dev stack seeded from a copy.
6. **Deploy (version per the rule in the decisions above):** build and stage while v1 serves; drain through v1; quiet; stop job; prepare `statev2` from the quiet `state.sqlite`; swap; bootstrap with the new plist (telemetry off); probe 240 s; iPad and iPhone builds installed in the same window.
7. **Soak 48 h:** run every deploy through the new gate, watch hydration logs (`Hydrated legacy v1 thread transcripts`), and keep the pinned v1 release until the soak ends. Then re-diagnose #3 and #18-20 on V2.

_The open questions raised in this part are answered under "Decisions recorded as assumptions" above._

---

