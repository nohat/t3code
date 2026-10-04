# Notifications: one alert, on the right surface, until I see it

Status: **draft spec, principles decided 2026-10-04**. Notifications today are decided separately by each client: one agent event can buzz the desktop, the browser, and the phone at once, while an event I never saw can disappear when a window gets focus. This page is the target behavior for every surface, the gaps between that and the code, and an audit of each established practice: adopted, adapted, or rejected, and why. Tracking: nohat/t3code#12 (routing, seen, dismissal) and nohat/t3code#13 (tap to open).

The code audit was done on 2026-10-04 at `main` 54084ae1e6. `fork/prod` f937ab9848 changes nothing notification-related. Practice ids (`BP-*`) refer to the catalog in the last section.

## Decisions (my words)

All dated 2026-10-04.

1. "Notifications should arrive on the surface I'm using, or my watch. If I'm in a T3 Code app surface when a notification arrives, it arrives as a toast, not as a notification."
2. "Notification should also dismiss itself next time that thread is viewed even if not through interacting with the notification."
3. "Make tap to open on notifications reliably take me to the right place."
4. "Notif should not be considered dismissed until server validates I saw the exact destination in the thread."
5. "If activating a window with the thread focused but in the wrong spot, should show a toast and scroll to the right spot before dismissing the notification."
6. A notification "stays undismissed until I dismiss it or see the result." Nothing disappears on its own and leaves me guessing whether it mattered.
7. Use established practice; do not derive notification design from first principles. Where this spec departs from practice, it says so and why.

## The model

**One durable record, many disposable projections.** For each thread, the server keeps an _attention item_: the latest event that warrants my attention, with an anchor in the thread. Toasts, OS notifications, pushes, badges, and the in-app list are all projections of that item. A projection can be lost, swiped away, or never delivered. The item stays until it is resolved (BP-PERSIST-1, BP-READ-1).

- **Kinds:** `approval`, `input`, `failed`, `completed`. A stalled turn (`stalledSince` on `fork/prod`) is a candidate fifth kind once the watchdog is trusted; not included yet.
- **Anchor:** the turn id plus, for approvals and questions, the activity id. The anchor is what a tap scrolls to, and what has to be on screen to count as seen.
- **One per thread.** A newer event on the same thread replaces the item and its notification, rather than stacking (BP-GROUP-1). Example: "Approval needed" becomes "Thread completed" when the turn ends.
- **States:** `open`, then `seen` (the server recorded that the anchor was on screen), or `dismissed` (I cleared it explicitly). `approval` and `input` also need an _answer_ to stop being actionable: seeing an approval clears the notification, but the thread stays marked as waiting in the sidebar until I answer it (BP-READ-2).
- **Server-owned and event-sourced.** "Seen" and "dismissed" are commands that produce events and a projection field on the thread shell. They are not client local storage. This replaces web's `threadLastVisitedAtById` in localStorage as the source for unread state, and the same record drives the badge on every surface.

## Delivery rules

### 1. The surface I'm using gets a toast

A client is _active_ when it is visible and focused (web, desktop) or foregrounded (mobile). An active client presents a new item as an in-app toast and never as an OS notification (BP-FG-1).

- No toast for the thread I am already looking at **if its anchor is on screen**. Then it is simply seen.
- **Activation at the wrong spot (decision 5).** When a window or app becomes active, the notified thread is open, and the anchor is off screen: show a toast naming the event and scroll the timeline to the anchor. The item becomes seen once the anchor is visible.
  - Assumption (mine, open to reversal): if the composer has focus with unsent text, or I am scrolling at that moment, skip the auto-scroll. The toast gets a "Jump" action instead, and the item stays open until I jump. Practice is a "jump to new" pill with no auto-scroll (Slack, Discord). Auto-scroll is my addition.
- A toast is a projection, so hiding it does not dismiss the item. It auto-hides on the normal timer only because the item stays in the in-app list (rule 6). An `approval` or `input` toast is announced assertively (`priority: "high"`) and does not auto-hide (BP-A11Y-1, BP-A11Y-2).
- One sound per event, from the surface that presents it, and only if sound is on (BP-PRIO-6). Today web plays a sound in every tab, even for the thread on screen.

### 2. When I'm not active anywhere, one device gets it

The server tracks which client was last active, from heartbeats the clients send over the WebSocket they already hold. An item goes out as an OS or push notification only to:

1. the active client, as a toast (rule 1); otherwise
2. the most recently active device, once I've been inactive for the _delay_; otherwise
3. the phone, which iOS forwards to the watch when the phone is locked (BP-ROUTE-5). There is no watch code.

The delay follows Slack's documented default (BP-ROUTE-1, BP-ROUTE-2): 1 minute after the screen locks, or 10 minutes with no input. It is a setting: immediately, or after N minutes. "Inactive" is real input, not an open window.

- **Not adopted: urgent types skipping the delay** (BP-ROUTE-3, as Teams does for calls). Decision 1 says alerts go where I am, and an approval reaches me as a toast if I'm active. If I'm not active, the delay is short after a screen lock. Revisit if a blocked agent waits too long in practice.
- The decision is made **on the server before sending**. Web push cannot be sent and then hidden: Chrome requires every push to show, and Safari cancels a subscription after three silent pushes (BP-ROUTE-4).

### 3. Seen means the server confirmed I saw the anchor

Opening the thread, focusing the window, or tapping the notification does not count. A client reports `seen(threadId, anchor)` when the anchor has been in the viewport of an active client. The server records it, and only then is the item seen (decision 4).

- This is stricter than practice. Most apps mark read on open (GitHub, Gmail, iMessage). Slack and Discord follow scroll position but decide on the device. I found no primary source defining "read" by viewport (BP-READ-3). I adopted the stricter rule because it is what makes decision 6 true.
- Explicit dismiss is the other way out: swiping a notification away, "Dismiss" on a toast, or "Mark seen" in the in-app list. Swiping away an OS notification counts as dismissing it. Without that, an item I deliberately cleared would keep reappearing everywhere.

### 4. Seen or dismissed anywhere clears it everywhere

When the server records seen or dismissed, it tells every client to remove that thread's notification (BP-READ-4):

- **Web:** close the `Notification` tagged `environmentId:threadId`.
- **iOS:** `removeDeliveredNotifications` by identifier.
- **Android:** cancel by notification id.

On a device whose app is not running, this needs a background push. Background pushes are best effort: iOS delivers about two or three an hour and none to a force-quit app (BP-READ-5). So every client also reconciles against the server whenever it opens or reconnects: it removes notifications for items that are no longer open. It never clears local notifications that are still open on the server. Focusing a window no longer clears everything. That is today's web behavior, and it breaks decision 6.

### 5. Tap to open lands on the anchor

A notification carries the environment, thread, and anchor (BP-OPEN-2). A tap:

- **Mobile cold start:** queues the target until navigation and the environment connection are ready. It marks the tap handled only after navigation succeeds, so a failed attempt is retried (BP-OPEN-4).
- **Desktop:** raises the window from the main process (restore, show, focus) before navigating. A renderer `window.focus()` may not restore a minimized or hidden window. The main process should own notifications so they survive a reload and work with the window closed (see the gaps table).
- **Then:** opens the thread and scrolls to the anchor. Rule 3 decides whether that counts as seen.
- **Unavailable target:** if the thread is archived or deleted, or the environment is unreachable, says so on that screen and offers a way back. No blank or unrelated screen (BP-OPEN-5).

Notification actions such as Approve or Deny are **deferred** (BP-OPEN-7). When added, the first action is the safe one, because a watch double tap runs it (BP-WATCH-3).

### 6. Nothing is lost

- Every client shows the open items in an in-app list (Slack Activity, Discord Inbox, GitHub inbox; BP-PERSIST-1), with the unread count from the server. On web and desktop this extends the sidebar's existing unread state; on mobile, the thread list.
- An event that happens while a client is disconnected still produces an item, because the item is created on the server. Today web loses these: reconnecting resets the baseline, and the first snapshot never alerts.
- Push is lossy (BP-PERSIST-2). Clients refetch open items on launch and reconnect, rather than trusting what was delivered.
- An `approval` or `input` item older than its turn is stale. Pushes carry an expiration, and a stale item resolves itself when the turn ends (BP-PERSIST-5).
- No repeat alerts for the same open item (BP-PERSIST-4). **Escalation** (BP-PERSIST-3, PagerDuty) is **adapted**: if an `approval` or `input` item stays unseen past the delay on the device that got it, it moves once to the next device in rule 2, then stops.

### 7. Content, urgency, and preferences

- **Titles:** "Approval needed", "Input needed", "Thread failed", "Thread completed". The body is the thread title and project. No app name in the title, and no error text (BP-GROUP-5).
- **Urgency:**
  - On iOS, `approval` and `input` are Time Sensitive; `failed` and `completed` are Active (BP-PRIO-1, BP-PRIO-2).
  - On Android, one channel per kind replaces today's single `agent-alerts` channel (BP-PRIO-3).
- **Preferences:** one switch per kind, on every surface (BP-PRIO-5), plus the delay. Today mobile hardcodes every per-kind flag to true, and web and desktop have only a global mode.
- **Bursts:** several items inside a minute coalesce into one notification ("3 threads need you"). Tapping it opens the in-app list, not the root route (BP-GROUP-4). Today a grouped Android alert opens `/`.
- **Quiet hours:** the OS's Focus and Do Not Disturb are respected. **Rejected: an in-app schedule** (BP-PRIO-4). One user, with OS Focus already configured; add it only if Focus proves insufficient.

### 8. Badge

The badge is the number of open items, computed by the server and the same on every surface (BP-BADGE-1, BP-BADGE-2). Today the web badge counts OS notifications currently shown and resets on focus. The badge is never the only signal (BP-BADGE-3).

### 9. Permissions

- Ask in context, the first time I start a turn and leave the thread (BP-PERM-1), with a one-line explanation first (BP-PERM-2).
- Re-check permission on launch. If it was revoked, show the setting as off, with steps to turn it back on (BP-PERM-3). Today a revoked browser permission still reads "Notifications", and every send silently fails.
- **Not adopted: iOS provisional authorization** (BP-PERM-4). It delivers quietly to Notification Center, which is the opposite of what an approval needs.

### 10. Privacy

Payloads carry ids, kind, thread title, and project title. Failure detail stays redacted, as it is today. On lock screens and the watch, the OS's own "hide previews" setting is relied on; on Android, visibility stays `PRIVATE` (BP-PRIV-1, BP-PRIV-2). **Assumption:** titles going through APNs or FCM to my own devices is a reason that satisfies [posture.md](./posture.md)'s rule on private data. **Deferred: fetching content on the device after authentication** (BP-PRIV-3), because it needs a Notification Service Extension that can reach the server.

### 11. Accessibility

- Toasts use the live region already on the page. `approval` and `input` toasts are announced assertively, and a toast with an action never takes focus (BP-A11Y-1).
- Coalescing keeps interruptions down (BP-A11Y-3).
- The toast limit of 3 stays, because the in-app list is where older items live.

### 12. Operations

- Log one line per item per device: routed, presented as toast, OS notification, or push, then seen or dismissed, with timestamps (BP-OPS-1). This makes "it buzzed everywhere" and "it went to the wrong place" checkable from traces.
- Rate-limit pushes per thread, since only Live Activity updates are throttled today.
- Invalid tokens are already dropped by the relay.

## Fork constraints

- **No Connect.** The fork has no relay, so mobile gets no push today ([mobile.md](./mobile.md)). The spec doesn't depend on the transport: one server service decides the destination, and transports present it. The transports are the WebSocket (toast), the desktop main process (OS notification), the browser (OS notification), APNs and FCM (upstream relay, or direct APNs from my server per mobile.md option 2), and `agent_inbox`/Telegram (mobile.md option 1). Each transport implements rules 4 and 5 as best it can. The `agent_inbox` transport can't remove a delivered message or anchor, so it carries a link and counts as a fallback only.
- **Upstream.** Rules 1, 5, and 8 and most gaps are upstream bugs too, and can become upstream PRs on request ([upstream-issues.md](./upstream-issues.md)). The server-side seen state and presence are larger contract changes: build them in the fork first, and offer them upstream later.

## Gaps: today's code against this spec

From the 2026-10-04 audit. "R" means read in code; "I" means inferred, not reproduced.

| #   | Gap                                                                                                                                                         | Evidence                                                                                                                                                                              | Rule  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| G1  | Every device is targeted; no presence anywhere (R)                                                                                                          | `infra/relay/src/agentActivity/AgentActivityPublisher.ts:57-109`; `packages/contracts/src/relay.ts`                                                                                   | 2     |
| G2  | Web toast is opt-in (`inAppNotificationsEnabled` defaults false) and the global mode defaults `off`, so a focused window gets nothing for other threads (R) | `packages/contracts/src/settings.ts:299-302`; `apps/web/src/components/ThreadNotificationCoordinator.tsx:153-191`                                                                     | 1     |
| G3  | Mobile foreground shows an OS banner with sound for other threads (iOS and Android) (R)                                                                     | `apps/mobile/src/features/agent-awareness/foregroundNotificationBehavior.ts:31-34`                                                                                                    | 1     |
| G4  | Web sound plays before any focus or active-thread check, and once per tab (R/I)                                                                             | `apps/web/src/components/ThreadNotificationCoordinator.tsx:148-152`                                                                                                                   | 1     |
| G5  | Focus clears every web notification and the badge, seen or not (R)                                                                                          | `apps/web/src/components/ThreadNotificationCoordinator.tsx:52-67`                                                                                                                     | 4, 6  |
| G6  | Nothing dismisses delivered mobile notifications on view, and the relay has no removal push (R)                                                             | `apps/mobile/src/features/showcase/stageShowcaseAgentActivity.ts:30` is the only call; `infra/relay/src/agentActivity/ApnsClient.ts:177-200`                                          | 4     |
| G7  | Read state is web localStorage only, and never-visited threads count as read (R)                                                                            | `apps/web/src/uiStateStore.ts:224`; `apps/web/src/components/Sidebar.logic.ts:673-682`                                                                                                | 3, 8  |
| G8  | Mobile cold-start tap can be dropped: marked handled before navigating (R)                                                                                  | `apps/mobile/src/features/agent-awareness/notificationPayload.ts:103-119`                                                                                                             | 5     |
| G9  | Desktop notifications live in the renderer: click relies on `window.focus()`; a closed macOS window means no notifications at all; no dock bounce (R/I)     | `apps/desktop/src/app/DesktopLifecycle.ts:244-253`; `apps/web/src/components/ThreadNotificationCoordinator.tsx:203-210`                                                               | 5     |
| G10 | No anchor beyond the thread; grouped Android alerts open `/` (R)                                                                                            | `packages/shared/src/agentAwareness.ts:53-75`; `infra/relay/src/agentActivity/FcmDeliveries.ts:112-114`                                                                               | 5, 7  |
| G11 | Events during a web disconnect never alert (I)                                                                                                              | `apps/web/src/components/ThreadNotificationCoordinator.tsx:111-113, 132`                                                                                                              | 6     |
| G12 | A second approval in the same turn does not re-alert (I)                                                                                                    | `ThreadNotificationCoordinator.tsx:122`; `apps/server/src/relay/AgentAwarenessRelay.ts:103-109`                                                                                       | 6     |
| G13 | Web badge counts shown notifications, ignores OS dismissal, and resets on focus (R)                                                                         | `apps/web/src/components/ThreadNotificationCoordinator.tsx:38`                                                                                                                        | 8     |
| G14 | No iOS interruption level, collapse id, or category; Android alerts get a new id per phase, so they stack (R)                                               | `infra/relay/src/agentActivity/ApnsClient.ts:184-198`; `apps/mobile/modules/t3-agent-notifications/android/src/main/java/expo/modules/t3agentnotifications/AgentNotifications.kt:173` | 7     |
| G15 | Per-kind preferences hardcoded true; environment `notificationsEnabled` always true (R)                                                                     | `apps/mobile/src/features/agent-awareness/registrationPayload.ts:46-49`                                                                                                               | 7     |
| G16 | Revoked browser permission goes unnoticed (R)                                                                                                               | `apps/web/src/components/settings/NotificationSettings.tsx:50-61`                                                                                                                     | 9     |
| G17 | Toasts: 5 s auto-dismiss, polite `dialog`, limit 3 with extras made invisible and inert (R)                                                                 | `apps/web/src/components/ui/toast.tsx:532-538, 622`                                                                                                                                   | 1, 11 |
| G18 | Live Activity alert updates may skip the `notificationsEnabled` check (I, upstream relay only)                                                              | `infra/relay/src/agentActivity/ApnsDeliveries.ts:292-303`                                                                                                                             | 7     |
| G19 | No rate limit on alert pushes (R/I)                                                                                                                         | `infra/relay/src/agentActivity/AgentActivityPublisher.ts:72-101`                                                                                                                      | 12    |
| G20 | User doc says foreground alerts stay quiet; the code shows banners. The ops doc says grouped alerts open the priority thread; they open `/` (R)             | `docs/user/mobile-notifications.md:7`; `docs/operations/android-notifications.md:73`                                                                                                  | doc   |

## Practice audit

Each established practice, and what this spec does with it.

| Practice                                          | Source                       | Verdict                    | Where, or why not                                                                  |
| ------------------------------------------------- | ---------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| BP-ROUTE-1 delay mobile while active on desktop   | Slack, Teams, Discord        | Adopted                    | Rule 2, with Slack's defaults                                                      |
| BP-ROUTE-2 active means input; lock means away    | Slack, Teams                 | Adopted                    | Rule 2                                                                             |
| BP-ROUTE-3 urgent types skip the delay            | Teams (calls)                | Rejected for now           | Decision 1; escalation in rule 6 covers it                                         |
| BP-ROUTE-4 decide on the server before sending    | Chrome, WebKit               | Adopted                    | Rule 2                                                                             |
| BP-ROUTE-5 OS chooses phone or watch              | Apple                        | Adopted                    | Rule 2; no watch code                                                              |
| BP-ROUTE-6 send to all devices, dedupe on clients | Apple (watch-direct)         | Rejected                   | Breaks decision 1; the server picks one device                                     |
| BP-ROUTE-7 slow channels only as a fallback       | Linear, GitHub               | Adapted                    | `agent_inbox` is a fallback transport                                              |
| BP-FG-1 focused app updates in place, no OS alert | Apple HIG, web.dev           | Adopted                    | Rule 1                                                                             |
| BP-FG-2 never notify for the visible conversation | Apple (Mail)                 | Adopted, stricter          | Rule 1: only when the anchor is on screen                                          |
| BP-FG-3 non-modal notice for other threads        | Apple `willPresent`          | Adopted                    | Rule 1 toast                                                                       |
| BP-FG-4 close web notification when page visible  | MDN                          | Adapted                    | Closes on server-confirmed seen, not visibility (decision 4)                       |
| BP-READ-1 server owns read state                  | GitHub, Linear               | Adopted                    | The model                                                                          |
| BP-READ-2 seen differs from handled               | GitHub, PagerDuty            | Adopted                    | The model: approvals stay waiting until answered                                   |
| BP-READ-3 read means opened in a focused window   | (no primary source)          | Adapted, stricter          | Rule 3: anchor in viewport, server-confirmed                                       |
| BP-READ-4 remove stale or handled notifications   | Android, Apple, MDN          | Adopted                    | Rule 4                                                                             |
| BP-READ-5 remote dismissal is best effort         | Apple                        | Adopted                    | Rule 4: reconcile on open                                                          |
| BP-READ-6 badge 0 clears Notification Center      | Apple                        | Rejected                   | Would clear items not yet seen                                                     |
| BP-PERSIST-1 durable in-app inbox                 | Slack, Discord, GitHub       | Adopted                    | Rule 6                                                                             |
| BP-PERSIST-2 push is lossy; refetch               | APNs, FCM                    | Adopted                    | Rule 6                                                                             |
| BP-PERSIST-3 escalate unacknowledged items        | PagerDuty                    | Adapted                    | Rule 6: once, then stop                                                            |
| BP-PERSIST-4 no repeats for the same item         | Apple HIG                    | Adopted                    | Rule 6                                                                             |
| BP-PERSIST-5 expire stale pushes                  | APNs, FCM                    | Adopted                    | Rule 6                                                                             |
| BP-PERSIST-6 important toasts don't auto-hide     | WAI-ARIA, Material           | Adopted for approval/input | Rule 1; others rely on the in-app list                                             |
| BP-OPEN-1 open the exact item                     | Android, Apple               | Adopted                    | Rule 5                                                                             |
| BP-OPEN-2 routable id in payload                  | all platforms                | Adopted                    | Rule 5, plus the anchor                                                            |
| BP-OPEN-3 focus existing window first             | MDN, Electron                | Adopted                    | Rule 5: main process raises the window                                             |
| BP-OPEN-4 queue link across cold start            | Android, Apple               | Adopted                    | Rule 5; fixes G8                                                                   |
| BP-OPEN-5 handle missing targets                  | (derived)                    | Adopted                    | Rule 5                                                                             |
| BP-OPEN-6 opening counts as read                  | Android auto-cancel          | Adapted                    | Only if the anchor reaches the screen (decision 4)                                 |
| BP-OPEN-7 actions do real work                    | Apple, Android               | Deferred                   | Rule 5: Approve/Deny later, safe action first                                      |
| BP-GROUP-1 replace, don't stack, per item         | tag, collapse-id, Android id | Adopted                    | The model: one item per thread; fixes G14                                          |
| BP-GROUP-2 updates don't re-alert                 | Android, web `renotify`      | Adopted                    | Rule 7: only a new kind alerts                                                     |
| BP-GROUP-3 group by thread or project             | Apple, Android               | Adopted                    | Rule 7 (iOS already sets `thread-id`)                                              |
| BP-GROUP-4 batch bursts                           | NN/g, web.dev                | Adopted                    | Rule 7                                                                             |
| BP-GROUP-5 short, specific content                | Apple HIG                    | Adopted                    | Rule 7                                                                             |
| BP-GROUP-6 dedupe across own channels             | (derived)                    | Adopted                    | One server decision; fixes G4                                                      |
| BP-PRIO-1 honest urgency levels                   | Apple, Android               | Adopted                    | Rule 7                                                                             |
| BP-PRIO-2 Time Sensitive only for now-events      | Apple                        | Adopted                    | Approval and input only                                                            |
| BP-PRIO-3 one Android channel per type            | Android                      | Adopted                    | Rule 7                                                                             |
| BP-PRIO-4 Focus/DND plus in-app quiet hours       | Slack, Linear, Teams         | Adapted                    | OS Focus only; in-app schedule rejected (YAGNI)                                    |
| BP-PRIO-5 per-type preferences in app             | Apple, NN/g, Linear          | Adopted                    | Rule 7; fixes G15                                                                  |
| BP-PRIO-6 sound never carries meaning alone       | Apple                        | Adopted                    | Rule 1: one sound, from the presenting surface                                     |
| BP-PRIO-7 no marketing at elevated urgency        | Apple, Play                  | N/A                        | No marketing                                                                       |
| BP-BADGE-1 badge counts actionable unread         | Apple                        | Adopted                    | Rule 8                                                                             |
| BP-BADGE-2 server count, same everywhere          | Apple, Slack                 | Adopted                    | Rule 8; fixes G13                                                                  |
| BP-BADGE-3 badge never the only signal            | Apple                        | Adopted                    | Rule 6 list                                                                        |
| BP-PERM-1 ask in context                          | MDN, web.dev, Apple, Android | Adopted                    | Rule 9                                                                             |
| BP-PERM-2 pre-prompt with value                   | web.dev, Android             | Adopted                    | Rule 9                                                                             |
| BP-PERM-3 recoverable denial, re-check            | Android, Apple               | Adopted                    | Rule 9; fixes G16                                                                  |
| BP-PERM-4 iOS provisional authorization           | Apple                        | Rejected                   | Quiet delivery defeats approvals                                                   |
| BP-PERM-5 platform prerequisites                  | WebKit, Electron             | Adopted                    | Signing and `setAppUserModelId` already in place; iOS web push is Home Screen only |
| BP-WATCH-1 rely on mirroring                      | Apple                        | Adopted                    | Rule 2                                                                             |
| BP-WATCH-2 write for the short look               | Apple HIG                    | Adopted                    | Rule 7 titles                                                                      |
| BP-WATCH-3 safe action first for double tap       | Apple                        | Adopted, when actions land | Rule 5                                                                             |
| BP-WATCH-4 Live Activities for bounded work       | Apple                        | Kept                       | Existing behavior; no push beside a Live Activity alert for the same update        |
| BP-PRIV-1 lock screen is public                   | Apple                        | Adapted                    | Rule 10: one user; rely on OS hidden previews                                      |
| BP-PRIV-2 redacted variant                        | Apple, Android               | Adapted                    | Android `PRIVATE` kept; iOS uses the OS setting                                    |
| BP-PRIV-3 ids only, fetch content on device       | (common practice)            | Deferred                   | Needs a service extension that can reach the server                                |
| BP-A11Y-1 live regions, no focus steal            | WCAG 4.1.3, APG              | Adopted                    | Rule 11; fixes G17                                                                 |
| BP-A11Y-2 action toasts persist or retrievable    | WCAG 2.2.1                   | Adopted                    | Rules 1 and 6                                                                      |
| BP-A11Y-3 limit interruptions                     | APG, WCAG 2.2.4              | Adopted                    | Rules 2 and 7                                                                      |
| BP-OPS-1 delivery observability, rate limits      | APNs metrics, FCM            | Adopted                    | Rule 12; fixes G19                                                                 |

## Order of work

Each stage is usable on its own.

1. **Client-only.**
   - Rule 1 on web and mobile: toast by default, no OS alert when active, one sound.
   - Rule 5's cold-start fix (G8) and desktop window raise.
   - Stop clearing everything on focus (G5).
   - Fix the two doc mismatches (G20).
2. **Anchor.** Put the turn and activity id in the item and the payload, and scroll to it on tap and on activation (#13, decision 5).
3. **Server attention items and seen state.**
   - New commands, events, and a projection field.
   - Rules 3, 4, and 6, and the server badge (rule 8).
   - The in-app list.
4. **Presence and routing.** Rule 2, escalation, and per-kind preferences.
5. **Phone delivery for the fork.** Whichever transport [mobile.md](./mobile.md) activates: `agent_inbox` first, or direct APNs.

## Still open

- Whether the stalled-turn watchdog's `stalledSince` should become a fifth kind. Default: not until the watchdog has a soak window with no false positives.
- The assumptions above (auto-scroll exception, titles in payloads, no urgent bypass) stand until I reverse them.

## Practice catalog

Researched 2026-10-04 from primary sources where reachable. The ids match the audit table.

- **Routing:** Slack "Configure your notifications" (slack.com/help/articles/201355156); Microsoft Teams mobile notifications (3-minute inactivity); Discord inactive timeout (community posts only; official page unreachable); Apple "Taking advantage of notification forwarding"; Chrome `userVisibleOnly` and the WebKit silent-push quota commit.
- **Foreground and read:** Apple HIG Notifications and Managing notifications; web.dev "Common notification patterns"; MDN Notifications API; GitHub "Managing notifications from your inbox"; Linear Notifications.
- **Dismissal and persistence:** Apple `removeDeliveredNotifications(withIdentifiers:)` and "Pushing background updates" (2 to 3 per hour, not guaranteed); Android "Create a notification" (cancel, `setTimeoutAfter`); FCM collapsible messages; PagerDuty escalation policies.
- **Tap to open:** Android notification design guide; MDN `notificationclick`; Electron Notification API.
- **Content, urgency, and grouping:** Apple interruption levels, `threadIdentifier`, `relevanceScore`; Android channels and groups; NN/g "Push notifications".
- **Permissions:** web.dev "Permission UX"; Android notification permission; Apple "Asking permission to use notifications"; WebKit "Web Push for web apps on iOS and iPadOS".
- **Watch:** Apple watchOS notification docs; Apple HIG Live Activities.
- **Accessibility:** WCAG 2.2 Understanding 4.1.3 and 2.2.1; WAI-ARIA APG Alert pattern; Adrian Roselli "Defining toast messages".
- **Operations:** Apple "Viewing the status of push notifications using metrics".

Not verified: Discord's official defaults, FCM time-to-live documentation (page returned 404), and any written Slack or Discord policy for suppressing notifications for the visible conversation.
