# Notifications: one alert, on the right surface, until I see it

Status: **reviewed phased proposal, 2026-10-05; not implementation authorization**. This replaces the 2026-10-04 draft with a proposal that integrates eight expert-persona reviews. It remains fork strategy, like [mobile.md](./mobile.md): implementation starts when this becomes a priority, and [posture.md](./posture.md) and `AGENTS.md` keep their authority. The design deliverables accompany it: the [UX specification](./notifications-ux.md), the [visual specification](./notifications-visual.md), the [mockup gallery](./notifications-assets/gallery.html), and the [upstream contribution strategy](./notifications-upstream.md). Tracking: nohat/t3code#12 (routing, seen, dismissal) and #13 (tap to open).

Notifications today are decided separately by each client: one agent event can buzz the desktop, the browser, and the phone at once, while an event I never saw can disappear when a window gets focus. This page is the target behavior for every surface, the gaps between that and the code, the phases that close them, and an audit of each established practice: adopted, adapted, or rejected, and why.

The code audit was first done on 2026-10-04 at `main` 54084ae1e6 and was re-verified by the reviews on 2026-10-05 at `fork/prod`. Rows that the reviews corrected are marked. Practice ids (`BP-*`) refer to the catalog in the last section.

## Recommendation

Ship in five phases, each usable alone, plus a separate mobile push track. The first three are client-only and need no contract change: a quiet foreground, taps that land, and a local "seen" that stops clearing everything on focus. Server-confirmed seen (P4) and presence routing (P5) come after, because they are the expensive part and the first three deliver most of what the decisions ask for.

The reviews cut or deferred the machinery that no decision requires: escalation, burst coalescing, per-kind Android channels, silent-push dismissal, a push rate limiter, an in-app schedule, and a new inbox view. Each can return when an exhibit (an issue or a trace) shows the pain.

## Decisions (my words)

All dated 2026-10-04. They are unchanged by the review.

1. "Notifications should arrive on the surface I'm using, or my watch. If I'm in a T3 Code app surface when a notification arrives, it arrives as a toast, not as a notification."
2. "Notification should also dismiss itself next time that thread is viewed even if not through interacting with the notification."
3. "Make tap to open on notifications reliably take me to the right place."
4. "Notif should not be considered dismissed until server validates I saw the exact destination in the thread."
5. "If activating a window with the thread focused but in the wrong spot, should show a toast and scroll to the right spot before dismissing the notification."
6. A notification "stays undismissed until I dismiss it or see the result." Nothing disappears on its own and leaves me guessing whether it mattered.
7. Use established practice; do not derive notification design from first principles. Where this spec departs from practice, it says so and why.

Decision 4 cannot be literally true: the server cannot observe a viewport. It validates the item id and the session, and trusts the client's report that the destination was on screen.

## Expert reviewer roster and integrated revisions

These are review personas, not endorsements by named external experts. Each agent was primed separately for its role, read the code at `fork/prod`, and returned findings and paste-ready revisions.

| Persona                                          | Review remit                                                                     | Revision integrated into this proposal                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile push and OS notification engineer         | APNs and FCM delivery, interruption levels, foreground handling, cold-start taps | Collapse-id hash, Time Sensitive is a signing task, bursts cut, passive replacement push, iPad has no watch path, G8 fix gates two stores                                                       |
| Event-sourcing and server architect              | Item model, commands, events, projection, contracts, receipts, rollback          | One nullable `attention` shell field, identity is the raise sequence, ack is idempotent and writes nothing on a no-op, raise is a reactor                                                       |
| Web and Electron notification engineer           | Notification API, service workers, main-process ownership, badge, window raise   | Hide-on-close on macOS, main process also clears on focus, no service worker or Web Push, sound gate is visible and focused                                                                     |
| Distributed-state and presence engineer          | Heartbeats, last-active routing, seen protocol, restarts, multi-environment      | Extend the existing activity leases, level-triggered seen with a revision guard, ack-or-fall-through, startup grace, guarantees not given                                                       |
| Timeline and scroll-anchoring engineer           | Anchor identity, scroll-to-anchor, seen tracking, #17 traps                      | Approvals anchor to the composer panel, not a row; three pure primitives; gesture cancels; edge-case table                                                                                      |
| Attention-design and accessibility researcher    | Alert fatigue, delays, toast semantics, WCAG 2.2                                 | Per-kind delay and persistence, status-message toast roles, bulk "Mark all seen", copy strings, conformance targets                                                                             |
| Product scope, performance, and rollout reviewer | Smallest mechanism per decision, phases, budgets, reversibility                  | Must/should/could/cut table, five revertible phases, numeric budgets, effect on existing data per phase                                                                                         |
| Upstream merge strategist                        | Maintainer policy and work, contributor history, first-contribution choice       | Notifications beats discovery as a first contribution only as small verified fixes; several gaps are intended upstream; V2 landed. See [notifications-upstream.md](./notifications-upstream.md) |
| UX designer                                      | Journeys, states, copy, entry points, recovery, accessibility                    | Whole-project flow and state specification with stable screen ids: [notifications-ux.md](./notifications-ux.md)                                                                                 |
| Visual and product designer                      | Screen hierarchy, layouts, assets, theme integration                             | Reviewable gallery and reusable SVG assets: [notifications-visual.md](./notifications-visual.md)                                                                                                |

## Corrected assumptions

The reviews overturned these claims in the 2026-10-04 draft:

- **"No presence anywhere" (G1) is wrong at the server.** Web, desktop, and mobile already send client activity leases every 25 seconds to every connected environment, with a 45 second TTL (`BackgroundPolicy.ts`). G1 holds only for the upstream relay, which the fork does not run. What is missing is a last-input time and a lock signal, and nothing survives lease expiry.
- **Approvals and questions are not timeline rows.** They render in the composer panel on web and in an overlay card on mobile, keyed by `requestId`. An anchor of "activity id" points at something that is folded away once the turn settles. Only `completed` and `failed` anchor to the timeline.
- **A closed macOS window destroys the renderer**, and the renderer owns the server subscription. Moving notification construction to the main process would not make a closed window alert.
- **The desktop main process also clears everything on focus** (`notificationBadge.ts`), so fixing only the renderer's focus listener leaves G5 and G13 open.
- **A new aggregate is more than needed.** The thread shell already says whether an approval, a question, a failure, or a completion exists. The missing durable facts are the identity of the current item and whether it was acknowledged.
- **"Bursts coalesce into one notification" cannot be built on iOS** without delaying every push. The OS already stacks by `thread-id`.
- **Time Sensitive is an entitlement and a provisioning change**, not a payload key. Without it, the level is silently treated as active.
- **Sending to "exactly one device" holds only for server-originated pushes.** Web and desktop alerts are created by each client, so routing has to ride on the item the clients already receive.
- **The 5 second auto-hide, the limit of 3, and `priority: "high"` live in Base UI defaults**, not in `toast.tsx`, and a persistent toast counts toward the limit.
- **Upstream moved.** The orchestrator V2 rewrite (#2829) merged 2026-10-02, after this proposal's audit base, and the fork is 175 commits behind. The decider, projector, and reactor shapes below describe the pre-V2 code; P4 and P5 must be re-mapped onto V2 before they are built or offered upstream. Upstream also already ships opt-in notifications, toasts, FCM, grouping, and a server visit watermark, and treats some listed gaps as intended behavior (see the note under the gaps table).

## The model

**One durable record, many disposable projections.** For each thread, the server keeps at most one _attention item_: the latest event that warrants my attention, with an anchor. Toasts, OS notifications, pushes, badges, and the in-app list are projections of it. A projection can be lost, swiped away, or never delivered. The item stays until it is resolved (BP-PERSIST-1, BP-READ-1).

- **Shape.** `thread.attention` is a nullable struct on the thread shell, not a separate aggregate: `{ id, kind, turnId | null, requestId | null, messageId | null, raisedAt, ackedAt | null }`. It is added as an optional, nullable schema field, as `stalledSince` is, so installed clients that lag the server ignore it.
- **Identity.** `id` is the sequence of the event that raised the item. It is unique and replay-stable. The anchor fields say where a tap goes and are never used for identity: a completion with no checkpoint has a null turn id, and a late "seen" for one completion must not acknowledge the next.
- **Kinds:** `approval`, `input`, `failed`, `completed`. A stalled turn (`stalledSince`) is a candidate fifth kind once the watchdog has a soak window with no false positives.
- **Anchor.**
  - `approval` and `input` anchor to the pending request, whose surface is the composer panel. There is nothing to scroll to.
  - `completed` and `failed` anchor to the turn's terminal assistant message, and fall back to the end of the thread when the turn has none.
  - The anchor is resolved per surface at presentation time, because row ids differ between web and mobile and change as a turn settles and folds.
- **One per thread, and replacement is not silent.** A new raise replaces the item: "Approval needed" becomes "Thread completed" when the turn ends, and the replacement is visible in every projection (BP-GROUP-1). A raise whose kind, turn, and request match the open item is a no-op, so a restated item does not alert again. A second approval is a new request and does alert.
- **States.** An item is _open_ (`ackedAt` is null) until it is acknowledged or resolved.
  - **Acknowledged** is one operation with `via` of `seen` (the server accepted a viewport report) or `dismissed` (I cleared it). `via` appears in the event payload and in logs only, because both stop alerting and clear everywhere.
  - **Resolved without my action** when the thread moves on: I answer the approval or question, I send a follow-up, or a new turn starts. The newer item or the thread's own result replaces it, so I can still see what happened (decision 6).
  - `approval` and `input` also need an _answer_ to stop being actionable: seeing one clears the notification, and the thread stays marked as waiting in the sidebar until I answer it (BP-READ-2). That marker stays driven by the existing `hasPendingApprovals` and `hasPendingUserInput` flags.
- **Server-owned.** Raise and acknowledge are commands that produce thread events, projected into columns on the thread. They replace web's `threadLastVisitedAtById` in localStorage as the source of unread state (G7). Both event types stay off the thread-detail stream, and a test pins that.
- **Raising is a reactor.** After a commit, a reactor dispatches an internal raise command with a snapshot guard, the way thread auto-settle does, and emits a receipt for tests. This replaces the in-memory phase baselines, the replay flag, and the confirm timers that the direct-push branch uses to avoid false alerts.
- **Acknowledging is a service method** (`ThreadAttention.acknowledge`). It reads the shell first and returns a successful no-op without dispatching when the item is absent, already acknowledged, or the id does not match. The `ws.ts` handler decodes, calls it once, and maps errors. It is deliberately not an MCP tool: an agent must not be able to mark its own approval seen. Reachability is not authorization.

## Delivery rules

### 1. The surface I'm using gets a toast

A client is _active_ when it is visible and focused (web, desktop) or foregrounded (`AppState` of `active`; mobile). An active client presents a new item as an in-app toast and never as an OS notification (BP-FG-1).

- **The thread on screen.** No toast when the anchor is already on screen. It is simply seen.
- **Activation at the wrong spot (decision 5).** When a window or app becomes active, the notified thread is open, and the anchor is off screen, show a toast naming the event and run one navigation attempt.
  - `approval` and `input` never auto-scroll. Their anchor is the composer panel, so the toast action is "Open", which expands the panel if it is collapsed.
  - `completed` and `failed` scroll to the end of the thread, or to the terminal message. One attempt, canceled by any user gesture, never retried after a cancellation, and skipped when the composer has unsent text or I am scrolling. The toast then carries "Jump", which on mobile is the existing scroll-to-end control, not a new overlay.
  - The skip rule is my assumption, open to reversal. Practice is a "jump to new" pill with no auto-scroll (Slack, Discord). The auto-scroll is my addition.
- **A toast is a projection**, so hiding it does not dismiss the item. `approval` and `input` toasts are announced as alerts and do not auto-hide; `completed` and `failed` toasts auto-hide and pause on hover and keyboard focus, because the item stays in the in-app list (rule 6).
- **One sound per event**, from the surface that presents it, only when the tab is visible and focused and sound is on (BP-PRIO-6). No tab coordination is needed, because the server picks the device and at most one tab per window is visible and focused. Today web plays a sound in every unlocked tab, even for the thread on screen, and `failed` plays the `input` sound.
- **Mobile safety net.** The server's presence check is the primary gate, but a push can be in flight when the app activates. The foreground handler therefore returns no banner, no list entry, and no sound whenever `AppState` is `active`, and the payload is shown as a toast. `inactive` (Control Center, a notification pull-down) does not count as active.

### 2. When I'm not active anywhere, one device gets it

Presence is the existing client activity lease, extended, not a second heartbeat. The lease report gains `idleForMs` (time since real input, measured on the client so clock skew does not matter). Desktop takes system idle and lock from the main process (`powerMonitor`); mobile reports `AppState`; plain web reports visibility and DOM input only, with no lock signal. A client is _inactive_ when it is not visible, or has had no input for 60 seconds, even if its window is still focused. The server keeps the last input time per client in memory, so "most recently active device" survives a lease expiring after a laptop sleeps.

When an item is created:

1. If any lease in this environment is active, no push is sent. Active clients toast.
2. Otherwise the item is due at the last input time plus the delay for its kind. At that moment the server recomputes (activity may have resumed) and routes to, in order: the last-active device if it has a live lease or is push-registered; else the push-registered device with the latest input; else nothing, and the item waits in the list.
3. A target reached over the WebSocket acknowledges within 15 seconds. Without the acknowledgement, the server falls through to the next candidate once. An APNs 200 means Apple accepted the push, not that it arrived.

**Delay by kind (convention, not research)**, all settings: `approval` and `input` 1 minute; `failed` and `completed` 5 minutes. The defaults borrow Slack's structure (BP-ROUTE-1, BP-ROUTE-2). The 10-minute Slack default is not used, because input-only presence cannot tell a lock from reading.

- **After a restart,** leases are gone. The server holds routing for a 60 second startup grace (the TTL plus one heartbeat), unless a lease arrives first, then routes the open items that have no recorded delivery. Dedupe is the durable `(thread, item id, target)` record, not an in-memory phase, so an approval that arrives during a deploy is late at worst, never lost.
- **Two active devices** both toast and no push is sent. Seen is idempotent.
- **Multiple environments.** Each server knows only its own clients. A phone paired only to server B is pushed by B even if I am active on server A; that is correct. A device paired to B but momentarily disconnected costs one extra buzz, not a loss.
- **Not adopted: urgent types skipping the delay** (BP-ROUTE-3). Decision 1 says alerts go where I am, and the approval delay is already one minute.
- **Deferred: escalation** (BP-PERSIST-3). The ack fall-through above covers an unreachable device; a timed second hop needs durable timers and a state machine. Add it when a blocked agent is observed waiting too long.
- The decision is made **on the server before sending**. Web push cannot be sent and then hidden: Chrome requires every push to show, and Safari cancels a subscription after three silent pushes (BP-ROUTE-4).
- **Watch.** iOS forwards a phone's notification to a paired watch when the phone is locked (BP-ROUTE-5). An Apple Watch pairs only with an iPhone, so an iPad is its own device with no watch path.

### 3. Seen means the server confirmed I saw the anchor

Opening the thread, focusing the window, or tapping the notification does not count. A client reports `thread.attention.ack { threadId, attentionId, via: "seen" }` once per item, level-triggered, when the resolved target has been visible for **750 ms** in an active client with no scroll gesture in progress. The server accepts it only if the id is the thread's current open item; a stale or repeated report is a successful no-op that writes nothing.

- **Message target** (`completed`, `failed`): the row's trailing edge is in the viewport and at least the smaller of the row height or half the viewport is visible. For a row taller than the viewport, the trailing edge counts, because the end of the message is what the notification is about. A timeline at its end satisfies it on the first pass.
- **Request target** (`approval`, `input`): the composer panel for that `requestId` is mounted and expanded. A collapsed questionnaire (mobile) or a collapsed composer (small web) is not visible.
- **Computed from viewport state alone.** A user scrolling to the anchor counts; an automatic scroll the user interrupted does not count until the user's scroll brings it into view.
- **Level-triggered, no offline outbox.** The client re-evaluates and resends on every item change and every reconnect. A report that races ahead of item creation is a no-op, which is fine because the item is created in the same projector step as the event that creates the anchor.
- This is stricter than practice. Most apps mark read on open (GitHub, Gmail, iMessage). Slack and Discord follow scroll position but decide on the device. I found no primary source defining "read" by viewport (BP-READ-3). I adopted the stricter rule because it is what makes decision 6 true. The 750 ms and half-viewport thresholds are design choices with no precedent in the repo.
- **Explicit dismiss** is the other way out: "Dismiss" on a toast, or "Mark seen" and "Mark all seen" in the in-app list. Swiping an OS notification counts as dismissal only where the platform reports it reliably (Android `deleteIntent`, Windows `userCanceled`). On iOS, macOS, and Linux the item stays open, because a banner timing out and a swipe look the same and a wrong dismissal would break decision 6.
- **Answering an approval or a question** resolves its item regardless of seen.

### 4. Seen or dismissed anywhere clears it everywhere

When the item is acknowledged or resolved, every client reconciles its local notifications against the item on the shell stream, by `(environment, thread, item id)`:

- **Web and desktop renderer:** close the `Notification` object held by the live page, tagged `environmentId:threadId`. Page-created notifications are closable only through a held reference and do not survive a reload; the spec makes no promise that they do.
- **iOS:** match delivered notifications by `data.threadId` (`getPresentedNotificationsAsync`, `dismissNotificationAsync`). The server also replaces a stale alert in place with a passive push that reuses the same collapse id. That works with the app killed and is not throttled like a silent push. Silent background pushes are not relied on: iOS delivers about two or three an hour and none to a force-quit app (BP-READ-5).
- **Android:** cancel by notification id. The fork has no Android push today.
- **Late events.** A swipe or close event always carries the item id, so a `close` fired by replacing a notification under the same tag for an older item is ignored.

On open and on reconnect every client also reconciles: it removes notifications for items that are no longer open, and never clears notifications that are still open on the server. Focusing a window no longer clears everything (today's web and desktop behavior breaks decision 6).

### 5. Tap to open lands on the anchor

A notification carries the environment, thread, item id, and anchor (BP-OPEN-2). A tap:

- **Mobile cold start:** queues the target until navigation and the environment connection are ready. A tap is marked handled only after navigation succeeds. Today the handled set and the last-response store both lose the tap when navigation is not ready. Dedupe on the notification identifier plus its date, because a stable collapse id makes identifiers repeat and would drop later taps on the same thread.
- **Desktop:** raises the window from the main process (`restore`, `show`, `focus`, plus `app.dock.bounce("critical")` on macOS or `flashFrame` on Windows and Linux) before navigating. A renderer `window.focus()` may not restore a minimized or hidden window. On macOS, closing the window hides it instead of destroying it, so the renderer, the server subscription, and the alerts keep running. A click with no window queues its target in the main process until the renderer is ready.
- **Then:** resolves the anchor and navigates once. If the message is outside the loaded window (an old item that survived many turns, or a revert), request earlier pages with the cap the citation navigator uses (20) and stop. If still missing, go to the end of the thread and say so in the toast.
- **Unavailable target:** if the thread is archived or deleted, the approval was already answered, or the environment is unreachable, say so on that screen and offer a way back. No blank or unrelated screen (BP-OPEN-5). Edge cases are in the [UX specification](./notifications-ux.md).

Notification actions such as Approve or Deny are **deferred** (BP-OPEN-7). They need a registered iOS category and a payload `category`. When added, the first action is the safe one, because a watch double tap runs it (BP-WATCH-3).

### 6. Nothing is lost, and the list stays bounded

- **The in-app list is a filter, not a new view.** On web and desktop, a "Needs me" filter and count on the sidebar's existing thread list; on mobile, the same on the thread list (BP-PERSIST-1). The counts come from the shell, so reconnect and resume already reconcile open items.
- An event that happens while a client is disconnected still produces an item, because the item is created on the server. Today web loses these.
- **Bounds.** Items resolve when I act on the thread another way (rule 3), and when a newer item replaces them. The list offers "Mark all seen" and a per-project filter. Items do not expire on a timer, because decision 6 says nothing disappears on its own; an expiry would break it. If the list proves to grow into a second inbox, revisit with data.
- Push is lossy (BP-PERSIST-2). Clients refetch open items on launch and reconnect, rather than trusting what was delivered.
- Pushes carry an expiration that depends on the kind: several hours for `approval` and `input`, about 10 minutes for `completed` and `failed`. Never expiration 0 (attempt once, do not store). An approval that arrives while the phone is offline for 90 minutes must not be dropped.
- No repeat alerts for the same open item (BP-PERSIST-4).

### 7. Content, urgency, and preferences

- **Titles:** "Approval needed", "Input needed", "Thread failed", "Thread completed". The body is the thread title and project. No app name in the title, no error text (BP-GROUP-5). Whether the body may carry a short action hint is open (see the decisions below); the default is no.
- **Urgency on iOS.** `approval` and `input` send `interruption-level: time-sensitive`. This needs the Time Sensitive entitlement and the capability on the App ID, with a regenerated provisioning profile; it is a signing task for the fork build with its own exit check, and it cannot be added to personal-team builds. It also breaks through Focus by default, a deliberate exception to "OS Focus is respected". `failed` and `completed` are active. A "resolved" replacement is passive.
- **Collapse id.** A hash of `environmentId/threadId`, at most 64 bytes (APNs rejects longer ids with `BadCollapseId`). `thread-id` keeps the readable key.
- **Android.** One channel per kind replaces `agent-alerts`. Importance cannot be changed after creation, so this is a migration (new ids, delete the old channel). It is deferred until the fork has Android push.
- **Preferences:** one switch per kind on every surface, plus the delay (BP-PRIO-5). Defaults preserve what I get today: all four kinds on. `completed` is the candidate for a quieter default (list and digest, no interrupt); that is my product call, not an engineering one, and it is recorded in the open decisions.
- **Bursts.** Not coalesced in the server, because that would delay approvals. iOS stacks by `thread-id` and can say "N more" through `summary-arg`; Android keeps the upstream group summary. A summary tap opening an in-app list is not implementable for an iOS stack, since a tap targets one notification.
- **Quiet hours:** the OS's Focus and Do Not Disturb are respected. **Rejected: an in-app schedule** (BP-PRIO-4). One user, with OS Focus already configured.

### 8. Badge

The badge is the number of threads with an open item, summed by the client across the environments it is connected to (BP-BADGE-1, BP-BADGE-2). A server computes the count only for the APNs `badge` field, and omits it when more than one environment is registered for the device, because an APNs badge is an absolute number that two servers would overwrite. A running client sets its own badge on foreground and reconnect. Web uses `navigator.setAppBadge` in an installed PWA, with the favicon fallback in a plain tab. Desktop main stops zeroing the badge on focus. The badge is never the only signal (BP-BADGE-3), and a pushed badge is approximate.

### 9. Permissions

- Re-check permission on launch. If it was revoked, show the setting as off with steps to turn it back on, and a link to the system settings (BP-PERM-3). Today a revoked browser permission still reads "Notifications", and every send silently fails.
- Ask in context with a one-line explanation first (BP-PERM-1, BP-PERM-2). This is a could, not a must: it ships after the recovery path.
- **Not adopted: iOS provisional authorization** (BP-PERM-4). It delivers quietly to Notification Center, the opposite of what an approval needs.
- **Web.** Phone browsers and Home Screen web apps get no OS notifications. `new Notification()` throws there and today the failure is swallowed. The phone path is the transport in [mobile.md](./mobile.md), not the browser. No service worker and no Web Push: they would need a new transport (VAPID keys, subscriptions, a send path) and hosted `app.t3.codes` has no secure context for a plain-HTTP LAN origin.

### 10. Privacy

Payloads carry ids, kind, thread title, and project title. Failure detail stays redacted. On lock screens and the watch, the OS's own "hide previews" setting is relied on; on Android, visibility stays `PRIVATE` (BP-PRIV-1, BP-PRIV-2). **Assumption:** titles going through APNs to my own devices satisfy [posture.md](./posture.md)'s rule on private data. **Deferred: fetching content on the device after authentication** (BP-PRIV-3), because it needs a Notification Service Extension that can reach the server.

### 11. Accessibility

Conformance target: WCAG 2.2 AA for the in-app list and toasts.

- **A toast is a status message, not a dialog.** It never takes focus. `completed` and `failed` use a polite status role; `approval` and `input` use an alert role, announced once per item, and a replacement of the same item does not re-announce unless the kind changes. Today the toast root is a `dialog` inside a polite live region, which does not fit.
- **Keyboard.** A registered shortcut moves focus to the newest toast's action; Escape dismisses the focused toast. The same actions exist in the in-app list and the command palette.
- **Timing.** `approval` and `input` toasts never auto-hide. Others pause on hover and on keyboard focus (they do not today) and a setting extends the default.
- **Layout.** A toast never covers the composer or the focused element.
- **Limit.** The limit of 3 stays for ordinary toasts. A persistent toast counts toward the limit today and can hide the rest, so approval and input toasts get a limit of 5 and the in-app list is the overflow.
- **Motion and sound.** Transitions respect `prefers-reduced-motion`; sound is never the only signal. Color is never the only difference between kinds (an icon and the title carry it).
- **Mobile.** VoiceOver and TalkBack read title and body then "double tap to open". The destination announces itself first ("Approval needed in <thread>") and focus lands on the anchor.
- Coalescing and per-kind switches keep interruptions down (BP-A11Y-3).

### 12. Operations

- Log one line per item per device: routed, presented as toast, OS notification, or push, then acknowledged or resolved, with timestamps (BP-OPS-1). This makes "it buzzed everywhere" and "it went to the wrong place" checkable from traces.
- Cut: a separate per-thread push rate limiter. One item per thread and the raise dedupe already bound it; add a per-minute ceiling only if a burst is observed.
- Invalid tokens are already dropped by the relay and by the direct-push branch.

## Guarantees not given

- Exactly-once or exactly-one delivery.
- Immediate cross-device clearing for a force-quit iOS app.
- An identical badge when two or more environments are registered.
- Lock detection in a plain browser.
- Delivery to a sleeping device without the acknowledgement fall-through.
- Detecting an iOS or macOS notification swipe.

## Fork constraints

- **Transports.** The fork has no Connect relay. Mobile push is direct APNs from the server (`apps/server/src/push/`, nohat/t3code#15), implemented on `feat/direct-apns-push-prod` and not yet merged to `fork/prod`. Today it sends to every registered iOS device with no interruption level, collapse id, or anchor, and it keeps its "already alerted" baseline in memory. The routing service in rule 2 is the only thing that chooses recipients, and the push subscribes to the raise event after commit (at-most-once, no outbox) instead of re-deriving from awareness snapshots. That also removes its hook in `AgentAwarenessRelay.ts`, an upstream-owned file. FCM is not built. `agent_inbox`/Telegram is a fallback only, since it cannot remove a delivered message or anchor.
- **Linked relay.** A linked upstream relay still targets every device (G1 in `infra/relay`) and is out of scope. Rule 2 applies to the WebSocket toast, the desktop, and direct push.
- **Upstream.** Only three slices map to upstream: the two documentation mismatches (G20), the cold-start tap (G8), and the revoked-permission state (G16). The rest of P1 to P3 changes behavior upstream maintainers made deliberately (G3, G5), and the server-side item and presence are larger contract changes. Build those in the fork first. See [notifications-upstream.md](./notifications-upstream.md) and [upstream-issues.md](./upstream-issues.md).
- **Agents.** Acknowledge is a service method and deliberately has no MCP tool.

## Gaps: today's code against this spec

From the 2026-10-04 audit, corrected by the 2026-10-05 reviews. "R" means read in code; "I" means inferred, not reproduced.

| #   | Gap                                                                                                                                                                                           | Evidence                                                                                                                                                                                   | Rule  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| G1  | The upstream relay targets every device. (Corrected: the server does have presence leases; see G21.) (R)                                                                                      | `infra/relay/src/agentActivity/AgentActivityPublisher.ts:57-109`; `packages/contracts/src/relay.ts`                                                                                        | 2     |
| G2  | Web toast is opt-in (`inAppNotificationsEnabled` defaults false) and the global mode defaults `off`, so a focused window gets nothing for other threads (R)                                   | `packages/contracts/src/settings.ts:299-306`; `apps/web/src/components/ThreadNotificationCoordinator.tsx:79, 154`                                                                          | 1     |
| G3  | Mobile foreground shows an OS banner with sound for other threads, iOS and Android (R)                                                                                                        | `apps/mobile/src/features/agent-awareness/foregroundNotificationBehavior.ts:31-34`                                                                                                         | 1     |
| G4  | Web sound plays before any focus or active-thread check, in every unlocked tab; `failed` plays the `input` sound (R)                                                                          | `apps/web/src/components/ThreadNotificationCoordinator.tsx:133-152`                                                                                                                        | 1     |
| G5  | Focus clears every web notification and the badge, seen or not, in the renderer and again in the Electron main process (R)                                                                    | `ThreadNotificationCoordinator.tsx:52-67`; `apps/desktop/src/ipc/methods/notificationBadge.ts:28, 59-70`                                                                                   | 4, 6  |
| G6  | Nothing dismisses delivered mobile notifications on view, and the relay has no removal push (R)                                                                                               | `apps/mobile/src/features/showcase/stageShowcaseAgentActivity.ts:30` is the only call; `infra/relay/src/agentActivity/ApnsClient.ts:177-200`                                               | 4     |
| G7  | Read state is web localStorage only, per origin, and never-visited threads count as read (R)                                                                                                  | `apps/web/src/uiStateStore.ts:224`; `apps/web/src/components/Sidebar.logic.ts:673-682`                                                                                                     | 3, 8  |
| G8  | Mobile cold-start tap can be dropped: marked handled before navigating, and the last response is cleared even when nothing navigated (R)                                                      | `apps/mobile/src/features/agent-awareness/notificationPayload.ts:103-119`; `notificationNavigation.ts:34-38`                                                                               | 5     |
| G9  | Desktop notifications live in the renderer, and closing the macOS window destroys it, so there are no alerts, no click target, and no dock bounce (R)                                         | `apps/desktop/src/app/DesktopLifecycle.ts:244-253`; `DesktopWindow.ts:677`; `ThreadNotificationCoordinator.tsx:203-210`                                                                    | 5     |
| G10 | No anchor beyond the thread; grouped Android alerts open `/` (R)                                                                                                                              | `packages/shared/src/agentAwareness.ts:44-75`; `infra/relay/src/agentActivity/FcmDeliveries.ts:112-114`                                                                                    | 5, 7  |
| G11 | Events during a web disconnect never alert (R)                                                                                                                                                | `ThreadNotificationCoordinator.tsx:111-113, 132`                                                                                                                                           | 6     |
| G12 | A second approval alerts again only if an intermediate non-approval snapshot lands between them; two in one interval do not (R, narrowed)                                                     | `ThreadNotificationCoordinator.tsx:120-134`; `apps/server/src/relay/AgentAwarenessRelay.ts:103-109`                                                                                        | 6     |
| G13 | Web badge counts shown notifications, ignores OS dismissal, and resets on focus; no `setAppBadge`, no dock bounce or frame flash (R)                                                          | `ThreadNotificationCoordinator.tsx:38, 56`; `notificationBadge.ts`                                                                                                                         | 8     |
| G14 | No iOS interruption level, collapse id, or category; the thread id is 73 bytes so it cannot be a collapse id as is; Android alerts still get a new id per phase (R)                           | `infra/relay/src/agentActivity/ApnsClient.ts:184-198`; `AgentNotifications.kt:173`. Upstream `438af295fe` added iOS `thread-id` and Android grouping, so stacking is partly done           | 7     |
| G15 | Per-kind preferences hardcoded true; environment `notificationsEnabled` always true (R)                                                                                                       | `apps/mobile/src/features/agent-awareness/registrationPayload.ts:46-49`                                                                                                                    | 7     |
| G16 | Revoked browser permission goes unnoticed; phone browsers throw on `new Notification()` and the failure is swallowed (R)                                                                      | `apps/web/src/components/settings/NotificationSettings.tsx:42-61`; `ThreadNotificationCoordinator.tsx:193, 211`                                                                            | 9     |
| G17 | Toasts: 5 s auto-hide and limit 3 are Base UI defaults, the root is a `dialog` in a polite live region, a persistent toast counts toward the limit, timers do not pause on hover or focus (R) | `apps/web/src/components/ui/toast.tsx:467-520, 622`; Base UI `ToastProvider`                                                                                                               | 1, 11 |
| G18 | Live Activity alert updates may skip the `notificationsEnabled` check (I, upstream relay only)                                                                                                | `infra/relay/src/agentActivity/ApnsDeliveries.ts:292-303`                                                                                                                                  | 7     |
| G19 | No rate limit on alert pushes (R/I)                                                                                                                                                           | `infra/relay/src/agentActivity/AgentActivityPublisher.ts:72-101`                                                                                                                           | 12    |
| G20 | User doc says foreground alerts stay quiet; the code shows banners. The ops doc says grouped alerts open the priority thread; they open `/` (R)                                               | `docs/user/mobile-notifications.md:7`; `docs/operations/android-notifications.md:73`                                                                                                       | doc   |
| G21 | Presence leases exist but carry no last-input time, no lock signal, vanish on disconnect, and ignore touch and wheel input; mobile hardcodes `recentlyInteracted` (R)                         | `apps/web/src/lib/backgroundActivityReporter.ts:25-27, 162-163, 185-196`; `apps/server/src/background/BackgroundPolicy.ts:80-82, 100`; `apps/mobile/src/connection/background-activity.ts` | 2     |
| G22 | The direct-push branch alerts every registered device, keeps its baseline in memory, uses a fixed one-hour expiration and priority 10 for every kind (R, branch)                              | `feat/direct-apns-push-prod`: `apps/server/src/push/PushNotifications.ts`, `ApnsClient.ts`                                                                                                 | 2, 6  |
| G23 | Approvals and questions are not timeline rows, so an activity-id anchor points at something folded away after the turn settles (R)                                                            | `apps/web/src/components/chat/ChatComposer.tsx:6267-6318`; `apps/mobile/src/features/threads/ThreadDetailScreen.tsx:1043-1083`; `packages/client-runtime/src/pendingRequests.ts:124-190`   | 3, 5  |
| G24 | Mobile has no scroll-to-row code at all; web has a citation navigator to generalize (R)                                                                                                       | `apps/mobile/src/features/threads/ThreadFeed.tsx` (no `scrollToIndex`); `apps/web/src/components/chat/useAssistantCitationTarget.ts:40-120`                                                | 5     |

**Upstream status of the gaps (2026-10-05, from the upstream review).** G3 (foreground banner for other threads) and G5 (focus clears everything) are intended upstream (#12052, #11569), so P1 and P3 change deliberate behavior in the fork and are not upstream bug fixes. G7 is stale there: a server visit watermark exists on V2. G9 (#12567) and G15 (#9901) are in flight. G10's `/` is a deliberate fallback. G8, G16, and G20 are still open upstream with no PR. G8 has been read in source and not reproduced.

## Phases

Each phase is usable alone, leaves the app strictly better, and states its rollback and its effect on existing data. P1 to P3 need no contract change. A separate mobile track hardens the direct push. "Hit every surface" is walked in the notes below the table.

| Phase                         | Scope                                                                                                                                                                                                                                                       | Surfaces                                           | Data effect                                                                          | Rollback                   | Exit criterion (by effect)                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 Quiet foreground**       | Toast on by default; no OS notification while focused; sound only when visible and focused; per-kind sound; mobile foreground handler returns nothing while `active`; fix the two doc mismatches (G20); toast semantics, hover pause, limit 5 for approvals | Web, desktop, mobile foreground                    | One default changes; stored settings preserved                                       | Revert the default         | In a trace over 20 replayed events with two windows open: exactly one sound and zero OS notifications while focused                                                        |
| **P2 Taps land**              | G8 (gate both stores, dedupe on identifier plus date); desktop main-process raise, hide-on-close on macOS, queued target; unavailable-target state                                                                                                          | Mobile, desktop                                    | None                                                                                 | Revert commits             | Unit tests for retry and pending-until-ready; a cold-start tap lands on the thread in a measured simulator run; a minimized desktop window is raised                       |
| **P3 Local seen**             | Pure primitives in `packages/client-runtime`; stop clearing on focus in renderer and main (G5, G13); close a thread's notification when its anchor is seen; activation toast with scroll; badge from local open items; `setAppBadge`                        | Web, desktop (mobile reuses the primitives)        | None; localStorage unread untouched                                                  | Revert                     | Focusing a window leaves unseen notifications; viewing the anchor closes only that one; badge equals open items                                                            |
| **P4 Server item and ack**    | `attention` shell field, raise reactor, `acknowledge` service and RPC, shell resume, "Needs me" filter and count, server badge for APNs, trace line                                                                                                         | All clients through `client-runtime` and contracts | Additive columns; no backfill; every existing thread is `null`, meaning nothing open | See below                  | An ack on one client clears every other client's notification within 2 s; after an offline gap an item exists on reconnect; the old binary opens a post-migration database |
| **P5 Presence and routing**   | Extend leases with `idleForMs`; in-memory last input; routing service with the per-kind delay, ack fall-through, and startup grace; the direct push subscribes to the raise event                                                                           | Server, web, desktop, direct push                  | None (in memory)                                                                     | A server flag, then revert | With a desktop and a browser tab open and idle, exactly one OS notification per event; a restart mid-delay still delivers once                                             |
| **M1 Push hardening** (track) | Collapse-id hash, interruption level and the Time Sensitive entitlement, per-kind expiration, G8, foreground handler. Independent of P1 to P5; starts after #15 merges to `fork/prod`                                                                       | Mobile, direct-push server                         | None                                                                                 | Revert                     | A real push replaces in place and a Time Sensitive approval is delivered as such on a device                                                                               |
| **M2 Push anchor** (track)    | Anchor and item id in the payload, passive replacement push, set own badge on open. After P4                                                                                                                                                                | Mobile, direct-push server                         | None                                                                                 | Revert                     | A tap lands on the anchor; a seen item's stale alert is replaced quietly                                                                                                   |

**Phase notes.**

- **P3's primitives** are three small units with no UI: `resolveAnchorTarget(anchor, state)`, a pure function returning a composer, row, end, or "none" with a reason; `createSeenTracker({ dwellMs, minVisibleFraction, isActive, onSeen })`, a state machine that emits once and never schedules scrolls; and `createAnchorNavigation(...)`, whose states are locating, scrolling, settled, canceled, and failed. Web adapts its citation navigator. Mobile adds a scroll-to-key adapter that reads scroll-end and layout state, not `onViewableItemsChanged`. The unattended case, scroll-to-end, ships first and index scrolling for stale anchors comes later.
- **P4 rollback.** An older binary may fail to decode the new event types, and a fork-deploy rollback swaps the binary, not the database. Before P4 ships, the gate runs a test that opens a post-migration database with the previous binary. If it fails, the fallback is a side table `(thread_id, kind, request_id, state, updated_at)` plus one RPC and no new event types, at the cost of identity by a row id instead of the event sequence. Both shapes keep at most three shell upserts per item.
- **Entry points.** Every behavior reachable from the chat view is also reachable from the notification itself, the toast, the sidebar filter, the command palette, and Settings. The UX specification lists them.
- **Providers.** The item is derived from the thread shell, so it is provider-independent. No adapter changes, and no provider needs a decision.
- **Connection modes.** Local, remote, and tunnel all use the WebSocket. Relay-linked pushing is out of scope (see the fork constraints).

### Must, should, could, cut

| Item                                                                                                                                                                      | Rating                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Rules 1, 3, 4, 5; G2 to G5, G8, G9, G13                                                                                                                                   | must                                         |
| Rule 6 core (item persists, filter, refetch); item identity                                                                                                               | must                                         |
| Rule 2 routing                                                                                                                                                            | should; must once there are two push devices |
| G7, G12, G16, G17, G20, rule 8 server badge, rule 12 trace line                                                                                                           | should                                       |
| Per-kind switches (G15), permission pre-prompt                                                                                                                            | could                                        |
| Escalation, burst coalescing, per-kind Android channels, silent-push dismissal, rate limiter, in-app schedule, a new inbox view, stalled-turn kind, payload content fetch | cut or deferred; each needs an exhibit       |

### Performance budget

| Item               | Budget                                                                                                                          | How to measure                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Shell bytes        | 0 B on threads without an item; at most 120 B with one; at most 3 extra shell upserts per item                                  | Replay a seeded stream (copy via `VACUUM INTO` into a worktree `.t3`) and count frames and bytes |
| Presence           | At most 100 B per transition; one keepalive per 30 s per active client; none while hidden; no DB write                          | WebSocket frame log over a 10-minute idle run                                                    |
| Ack                | At most one per item per client, about 150 B, resent only on reconnect                                                          | Counter in the trace                                                                             |
| DB writes          | One write on raise, one on acknowledge; none per scroll; none for a no-op ack                                                   | SQLite write count per turn                                                                      |
| List               | A filter over the existing sidebar rows; no extra React commits on threads without an item                                      | React Profiler commit count per shell upsert                                                     |
| Anchor observation | One observer on one node only while the viewed thread has an open item; zero at idle                                            | Observer count at idle                                                                           |
| Toast and scroll   | No continuous animation, no `requestAnimationFrame` loop; one entrance of 200 ms or less; instant scroll; honors reduced motion | Performance trace; GPU raster idle after the toast                                               |
| Coordinator CPU    | The full-snapshot loop disappears after P4                                                                                      | CPU profile before and after on a large shell                                                    |

### Verification

Smallest proof per phase, per [posture.md](./posture.md): `vp test run` on the touched files, with the three primitives and the routing decision as pure tables covering the edge cases in the UX specification. Web behavior is checked once in the Browser panel against an isolated worktree `.t3` with a copy of real data and a thread with more than 10 user turns, to force pagination. iPad behavior uses the simulator recipe in [defect-resolution.md](./defect-resolution.md) (replay a live turn, open by deep link, cold start by terminate then open URL, read the scroll series, use `swipe` not `press`), and the deep link needs to carry the anchor first. Live stream plus swipe cases need a Release simulator build. A push is unverified on a device until one real push arrives.

## Practice audit

Each established practice, and what this spec does with it.

| Practice                                          | Source                       | Verdict                    | Where, or why not                                                                            |
| ------------------------------------------------- | ---------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| BP-ROUTE-1 delay mobile while active on desktop   | Slack, Teams, Discord        | Adopted                    | Rule 2, per-kind delay                                                                       |
| BP-ROUTE-2 active means input; lock means away    | Slack, Teams                 | Adapted                    | Rule 2: 60 s of no input; lock only where observable                                         |
| BP-ROUTE-3 urgent types skip the delay            | Teams (calls)                | Rejected for now           | Decision 1; the approval delay is one minute                                                 |
| BP-ROUTE-4 decide on the server before sending    | Chrome, WebKit               | Adopted                    | Rule 2                                                                                       |
| BP-ROUTE-5 OS chooses phone or watch              | Apple                        | Adapted                    | Rule 2; iPhone only, no watch code                                                           |
| BP-ROUTE-6 send to all devices, dedupe on clients | Apple (watch-direct)         | Rejected                   | Breaks decision 1; the server picks one device                                               |
| BP-ROUTE-7 slow channels only as a fallback       | Linear, GitHub               | Adapted                    | `agent_inbox` is a fallback transport                                                        |
| BP-FG-1 focused app updates in place, no OS alert | Apple HIG, web.dev           | Adopted                    | Rule 1                                                                                       |
| BP-FG-2 never notify for the visible conversation | Apple (Mail)                 | Adopted, stricter          | Rule 1: only when the anchor is on screen                                                    |
| BP-FG-3 non-modal notice for other threads        | Apple `willPresent`          | Adopted                    | Rule 1 toast                                                                                 |
| BP-FG-4 close web notification when page visible  | MDN                          | Adapted                    | Closes on server-confirmed seen, not visibility (decision 4)                                 |
| BP-READ-1 server owns read state                  | GitHub, Linear               | Adopted                    | The model                                                                                    |
| BP-READ-2 seen differs from handled               | GitHub, PagerDuty            | Adopted                    | The model: approvals stay waiting until answered                                             |
| BP-READ-3 read means opened in a focused window   | (no primary source)          | Adapted, stricter          | Rule 3: anchor visible 750 ms, server-confirmed                                              |
| BP-READ-4 remove stale or handled notifications   | Android, Apple, MDN          | Adopted                    | Rule 4                                                                                       |
| BP-READ-5 remote dismissal is best effort         | Apple                        | Adapted                    | Rule 4: reconcile on open plus a passive replacement push, no silent push                    |
| BP-READ-6 badge 0 clears Notification Center      | Apple                        | Rejected                   | Would clear items not yet seen                                                               |
| BP-PERSIST-1 durable in-app inbox                 | Slack, Discord, GitHub       | Adapted                    | Rule 6: a filter over existing lists, not a new view                                         |
| BP-PERSIST-2 push is lossy; refetch               | APNs, FCM                    | Adopted                    | Rule 6                                                                                       |
| BP-PERSIST-3 escalate unacknowledged items        | PagerDuty                    | Deferred                   | Rule 2: the ack fall-through covers an unreachable device; add on an exhibit                 |
| BP-PERSIST-4 no repeats for the same item         | Apple HIG                    | Adopted                    | Rule 6; raise dedupe                                                                         |
| BP-PERSIST-5 expire stale pushes                  | APNs, FCM                    | Adopted                    | Rule 6: expiration by kind                                                                   |
| BP-PERSIST-6 important toasts don't auto-hide     | WAI-ARIA, Material           | Adopted for approval/input | Rule 1; others rely on the list                                                              |
| BP-OPEN-1 open the exact item                     | Android, Apple               | Adopted                    | Rule 5                                                                                       |
| BP-OPEN-2 routable id in payload                  | all platforms                | Adopted                    | Rule 5, plus the item id and anchor                                                          |
| BP-OPEN-3 focus existing window first             | MDN, Electron                | Adopted                    | Rule 5: main process raises the window                                                       |
| BP-OPEN-4 queue link across cold start            | Android, Apple               | Adopted                    | Rule 5; fixes G8                                                                             |
| BP-OPEN-5 handle missing targets                  | (derived)                    | Adopted                    | Rule 5                                                                                       |
| BP-OPEN-6 opening counts as read                  | Android auto-cancel          | Adapted                    | Only if the anchor reaches the screen (decision 4)                                           |
| BP-OPEN-7 actions do real work                    | Apple, Android               | Deferred                   | Rule 5: Approve/Deny later, safe action first                                                |
| BP-GROUP-1 replace, don't stack, per item         | tag, collapse-id, Android id | Adopted                    | The model: one item per thread; the collapse id is a hash                                    |
| BP-GROUP-2 updates don't re-alert                 | Android, web `renotify`      | Adopted                    | Rule 6: only a new item alerts                                                               |
| BP-GROUP-3 group by thread or project             | Apple, Android               | Adopted                    | Rule 7 (iOS already sets `thread-id`)                                                        |
| BP-GROUP-4 batch bursts                           | NN/g, web.dev                | Adapted                    | Rule 7: OS stacking and `summary-arg` only; server batching would delay approvals            |
| BP-GROUP-5 short, specific content                | Apple HIG                    | Adopted                    | Rule 7                                                                                       |
| BP-GROUP-6 dedupe across own channels             | (derived)                    | Adopted                    | One server decision; fixes G4                                                                |
| BP-PRIO-1 honest urgency levels                   | Apple, Android               | Adopted                    | Rule 7; needs the entitlement                                                                |
| BP-PRIO-2 Time Sensitive only for now-events      | Apple                        | Adopted                    | Approval and input only                                                                      |
| BP-PRIO-3 one Android channel per type            | Android                      | Deferred                   | Rule 7: until Android push exists                                                            |
| BP-PRIO-4 Focus/DND plus in-app quiet hours       | Slack, Linear, Teams         | Adapted                    | OS Focus only; in-app schedule rejected (YAGNI)                                              |
| BP-PRIO-5 per-type preferences in app             | Apple, NN/g, Linear          | Adopted                    | Rule 7; fixes G15                                                                            |
| BP-PRIO-6 sound never carries meaning alone       | Apple                        | Adopted                    | Rule 1: one sound, from the presenting surface                                               |
| BP-PRIO-7 no marketing at elevated urgency        | Apple, Play                  | N/A                        | No marketing                                                                                 |
| BP-BADGE-1 badge counts actionable unread         | Apple                        | Adopted                    | Rule 8                                                                                       |
| BP-BADGE-2 server count, same everywhere          | Apple, Slack                 | Adapted                    | Rule 8: client sum; a pushed badge is approximate                                            |
| BP-BADGE-3 badge never the only signal            | Apple                        | Adopted                    | Rule 6 filter                                                                                |
| BP-PERM-1 ask in context                          | MDN, web.dev, Apple, Android | Adopted, later             | Rule 9: a could                                                                              |
| BP-PERM-2 pre-prompt with value                   | web.dev, Android             | Adopted, later             | Rule 9                                                                                       |
| BP-PERM-3 recoverable denial, re-check            | Android, Apple               | Adopted                    | Rule 9; fixes G16                                                                            |
| BP-PERM-4 iOS provisional authorization           | Apple                        | Rejected                   | Quiet delivery defeats approvals                                                             |
| BP-PERM-5 platform prerequisites                  | WebKit, Electron             | Adopted                    | Signing and `setAppUserModelId` in place; iOS web push is Home Screen only, and out of scope |
| BP-WATCH-1 rely on mirroring                      | Apple                        | Adapted                    | Rule 2: iPhone only                                                                          |
| BP-WATCH-2 write for the short look               | Apple HIG                    | Adopted                    | Rule 7 titles                                                                                |
| BP-WATCH-3 safe action first for double tap       | Apple                        | Adopted, when actions land | Rule 5                                                                                       |
| BP-WATCH-4 Live Activities for bounded work       | Apple                        | Kept                       | Existing behavior; no push beside a Live Activity alert for the same update                  |
| BP-PRIV-1 lock screen is public                   | Apple                        | Adapted                    | Rule 10: one user; rely on OS hidden previews                                                |
| BP-PRIV-2 redacted variant                        | Apple, Android               | Adapted                    | Android `PRIVATE` kept; iOS uses the OS setting                                              |
| BP-PRIV-3 ids only, fetch content on device       | (common practice)            | Deferred                   | Needs a service extension that can reach the server                                          |
| BP-A11Y-1 live regions, no focus steal            | WCAG 4.1.3, APG              | Adopted                    | Rule 11; fixes G17                                                                           |
| BP-A11Y-2 action toasts persist or retrievable    | WCAG 2.2.1                   | Adopted                    | Rules 1 and 11                                                                               |
| BP-A11Y-3 limit interruptions                     | APG, WCAG 2.2.4              | Adopted                    | Rules 2 and 7: per-kind switches and the delay let me postpone or suppress                   |
| BP-OPS-1 delivery observability, rate limits      | APNs metrics, FCM            | Adopted, without limiter   | Rule 12: the trace line; the limiter is cut                                                  |

## Resolved by the UX review

The UX specification found nine conflicts. These resolutions apply to this proposal:

- **Two numbers.** The "Needs me" filter lists open items plus threads still waiting on an answer; the badge counts open items only.
- **A way back.** Acknowledge gets a reverse, **Mark as new** (same service, no re-alert), in P4.
- **Honest replacement titles.** A quiet replacement reads "Approval answered", "Input answered", or "Seen on another device", delivered passively. The four fixed titles apply to alerts only. Needs the owner's sign-off (open decision 5).
- **Hide is not dismiss.** Hide and Escape hide a toast. Only the labeled **Dismiss** clears the item.
- **Scope of settings.** Per-kind switches and toast duration are per device; the delay is per environment. A kind switched off still creates the item and lists it, and is not counted in that device's badge.
- **Mobile settings without Connect.** The existing mobile Notifications screen requires T3 Connect (`SettingsNotificationsRouteScreen.tsx:60`). M1 must make that screen work with direct push registration.
- **Toast duration.** 10 seconds by default, with 30 seconds and until-dismissed options (an assumption). The existing toast transition is 500 ms (`toast.tsx:591`), over the 200 ms budget, so P1 changes it for the new variants.
- **Mobile toast is silent,** with no haptic.

## Open decisions

Product intent only. Each default stands until I reverse it. Engineering questions the reviews raised were decided in the text above.

1. **Does `completed` interrupt when I am away?** Default: yes, at the longer delay, because that preserves what I get today and a finished turn I never saw is the case decision 6 is about. The alternative is list and digest only, with no push, which fits "quiet by default" better. It is a per-kind switch either way.
2. **Time Sensitive for approvals breaks through Focus.** Default: yes, for `approval` and `input` only.
3. **Which device carries the push?** Default: the iPad is the only push device, so the watch path stays out until an iPhone registers.
4. **Closing the macOS window.** Default: hide it, so alerts keep flowing, like a chat app.
5. **When an approval is resolved elsewhere, leave a quiet "handled" card or nothing?** Default: a quiet replacement notification, since clearing silently cannot be relied on.
6. **Approval toasts and the limit.** Default: they persist, and the limit is 5 for them.
7. **A short action hint ("Run command") in the push body.** Default: no, titles only.
8. **If the old-binary rollback test fails,** use the side table instead of new event types. Default: yes.
9. **Whether the stalled-turn watchdog's `stalledSince` becomes a fifth kind.** Default: not until the watchdog has a soak window with no false positives.
10. **Stale approval whose turn ended unanswered.** Default: the turn's result replaces the item and the thread shows it, rather than the item expiring silently.

The assumptions in rules 1, 2, and 10 (the auto-scroll skip, no urgent bypass, titles in payloads) stand until I reverse them.

## Practice catalog

Researched 2026-10-04 from primary sources where reachable. The ids match the audit table. The 2026-10-05 reviews added: Apple "Sending notification requests to APNs" (collapse-id length); Apple interruption levels and the Time Sensitive entitlement; WCAG 2.2 Understanding 2.2.1, 2.4.11, 2.5.8; Mehrotra et al., "My Phone and Me", CHI 2016, and Mark et al., "The Cost of Interrupted Work", CHI 2008 (background only, summaries read, not full text).

- **Routing:** Slack "Configure your notifications" (slack.com/help/articles/201355156); Microsoft Teams mobile notifications (3-minute inactivity); Discord inactive timeout (community posts only; official page unreachable); Apple "Taking advantage of notification forwarding"; Chrome `userVisibleOnly` and the WebKit silent-push quota commit.
- **Foreground and read:** Apple HIG Notifications and Managing notifications; web.dev "Common notification patterns"; MDN Notifications API; GitHub "Managing notifications from your inbox"; Linear Notifications.
- **Dismissal and persistence:** Apple `removeDeliveredNotifications(withIdentifiers:)` and "Pushing background updates" (2 to 3 per hour, not guaranteed); Android "Create a notification" (cancel, `setTimeoutAfter`); FCM collapsible messages; PagerDuty escalation policies.
- **Tap to open:** Android notification design guide; MDN `notificationclick`; Electron Notification API.
- **Content, urgency, and grouping:** Apple interruption levels, `threadIdentifier`, `relevanceScore`; Android channels and groups; NN/g "Push notifications".
- **Permissions:** web.dev "Permission UX"; Android notification permission; Apple "Asking permission to use notifications"; WebKit "Web Push for web apps on iOS and iPadOS".
- **Watch:** Apple watchOS notification docs; Apple HIG Live Activities.
- **Accessibility:** WCAG 2.2 Understanding 4.1.3 and 2.2.1; WAI-ARIA APG Alert pattern; Adrian Roselli "Defining toast messages".
- **Operations:** Apple "Viewing the status of push notifications using metrics".

Not verified: Discord's official defaults, FCM time-to-live documentation (page returned 404), any written Slack or Discord policy for suppressing notifications for the visible conversation, the iOS swipe-dismiss reporting behavior, the Electron `close` reason values, and whether an older binary fails to decode unknown event types (the P4 gate tests it).
