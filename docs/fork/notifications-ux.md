# Notifications: UX specification

Status: **proposed, 2026-10-05**. This is the whole-project design specification for
[notifications.md](./notifications.md), not shipped behavior. That page keeps authority
over decisions, rules, gaps, and phases; this page specifies what I see, tap, and read.
[posture.md](./posture.md), [mobile.md](./mobile.md), and the optional appearance profile
in [design-system.md](./design-system.md) govern scope and presentation. Layout, color,
and assets are in [notifications-visual.md](./notifications-visual.md). Screen IDs are
stable references shared with it. Every phase code (P1 to P5, M1, M2) is the proposal's.

Surfaces: **W** web, **D** desktop, **iPad**, **iPhone**, **And** Android. The fork's
push runs on iOS only (M1); Android rows are specified so the work is not redone later.
All sample data is fabricated.

## Design review and revisions

The principal UX risks of this proposal, and the stance that answers each:

- **"Seen" is invisible.** A viewport report after 750 ms is not something I can watch
  happen, so a notification can vanish for a reason I cannot name. Stance: never teach
  the mechanism. Show outcomes: the row's **New** mark leaves, the item moves to
  **Handled** with a time, and Settings carries one sentence (N21). No dwell progress, no
  read receipts. The word "seen" appears only on the two explicit actions I named.
- **A toast and a notification are the same event twice.** Across devices, the toast on
  my desktop and the banner on my iPad must read as one alert, and closing a toast must
  not silently clear it. Stance: a toast uses the exact title and body of its
  notification. The close control is **Hide** (the item stays); **Dismiss** is a separate
  text action that clears it everywhere. A toast never claims where else an alert went.
- **A guilt inbox.** A list of unseen things invites debt. Stance: **Needs me** is a
  filter, shown only while something needs me, with no age, no overdue state, no red
  escalation, and no timers. Items leave when I see them. A seen approval stays only
  because the agent is still blocked, and its wording says so. **Mark all seen** has Undo.
- **A tap lands somewhere surprising.** Stance: the landing is always the anchor or an
  explicit sentence about why it is not. Approvals and questions never scroll; they open
  the panel. A scroll attempt happens once, never over a draft or a gesture, and a
  persistent control remains after it is skipped (N14). No blank screens (N15 to N18).
- **Trust loss when something disappears.** Stance: every disappearance has a visible
  successor or reason: a replacement with the new title (N19), a quiet "answered" card on
  iOS (N20), a Handled entry (N12), or an unavailable-target sentence. Auto-hiding
  toasts are acceptable only because the item is still listed. Nothing expires.
- **A persistent toast in the way.** Approval and input toasts do not auto-hide. They
  never cover the composer or the focused element, and the limit is 5 for them.
- **Silent permission failure.** Today a revoked permission still reads as on (G16).
  Stance: the setting always shows the system's truth with steps (N23), and one
  notice appears on return after a revocation.
- **"Why did my phone not buzz?"** The server's choice of device has no UI. Stance: one
  plain sentence in Settings says alerts go to the device I am using, else the last one I
  used; the per-item trace is for maintainers (rule 12), not a screen.

Keep what exists: the sidebar status labels, the thread context menu's **Mark unread**,
the five-second Undo pattern (`SidebarThreadUndoNotice`), and the mobile scroll-to-end
control. No new inbox view, no new global navigation, no Approve or Deny on a
notification (deferred, BP-OPEN-7).

## Screens and entry points

| ID  | Screen                                            | Phase                  | Surface                 | Entry point and primary content                                                                                                                                                                                                                                |
| --- | ------------------------------------------------- | ---------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N01 | Approval toast                                    | P1                     | W, D                    | Raised while this window is in front. Title, thread, **Open**, **Dismiss**, Hide. Persists. Alert role. Built on `ui/toast.tsx`, raised by the coordinator (`ThreadNotificationCoordinator.tsx:159`)                                                           |
| N02 | Input toast                                       | P1                     | W, D                    | Same shape as N01, **Input needed**. Persists. Alert role                                                                                                                                                                                                      |
| N03 | Failed toast                                      | P1                     | W, D                    | **Thread failed**, thread, **Open** or **Jump**, **Dismiss**, Hide. Auto-hides, pauses on hover and focus. Status role. No error text                                                                                                                          |
| N04 | Completed toast                                   | P1                     | W, D                    | **Thread completed**, same shape and timing as N03                                                                                                                                                                                                             |
| N05 | Toast actions and Hide versus Dismiss             | P1, P3, P4             | W, D, iPad, iPhone, And | **Open** (P1), **Jump** (P3), **Hide** (P1), **Dismiss** (local in P3, server-wide from P4). Replaces today's single "Open thread" action and the "Dismiss notification" close label (`toast.tsx:666`)                                                         |
| N06 | Catch-up summary toast                            | P4                     | W, D, iPad, iPhone, And | On reconnect or return, when two or more items were raised while away: one toast, **Show** opens Needs me. Never one toast per item                                                                                                                            |
| N07 | Mobile foreground toast                           | P1, P4                 | iPad, iPhone, And       | Top of the screen under the header, never over the composer. From the push payload in P1, from the shell item in P4. Silent, no banner. Replaces `shouldShowBanner: true` (`foregroundNotificationBehavior.ts:31`). A new component: mobile has no toast today |
| N08 | Needs me filter and count, sidebar                | P4                     | W, D                    | Toggle in the header icon group (`SidebarThreadHeader.tsx`) plus a **Needs me** row above the list, visible only while the count is above 0 or the filter is on. Includes the empty state                                                                      |
| N09 | Needs me filter and count, thread list            | P4                     | iPad, iPhone, And       | **Needs me** item at the top of the filter menu (`home-list-filter-menu.ts`, iPad `ThreadNavigationSidebar.tsx:880`) and the same chip above the list                                                                                                          |
| N10 | Per-thread item indicator                         | P3 (local), P4         | W, D, iPad, iPhone, And | Existing status label (`Sidebar.logic.ts:1040`, mobile `thread-list-v2-items.tsx:63`) plus a **New** mark while the item is open. Mobile gains a **Completed** label (none today)                                                                              |
| N11 | Mark seen, Mark all seen, Mark as new             | P4                     | W, D, iPad, iPhone, And | Row context menu (web `Sidebar.tsx:4017` area; mobile row menu), Needs me header, palette. **Mark as new** reopens a cleared item; web's existing **Mark unread** becomes this for threads with an item                                                        |
| N12 | Handled section (reverse of N11 and N05)          | P4                     | W, D, iPad, iPhone, And | Collapsed section at the end of Needs me: the latest 20 cleared or answered items, each opening its anchor. Not a new view                                                                                                                                     |
| N13 | Activation at the wrong spot (decision 5)         | P3                     | W, D, iPad, iPhone      | Window or app activates, the notified thread is open, the anchor is off screen: toast plus one navigation attempt, then dwell, then clear                                                                                                                      |
| N14 | Landing on the anchor                             | P2, P3                 | W, D, iPad, iPhone, And | Thread screen after a tap or **Open**: approval panel focused, or the end of the thread with a persistent **Jump to result** control (mobile `ThreadDetailScreen.tsx:866`)                                                                                     |
| N15 | Target unavailable: thread archived or deleted    | P2                     | W, D, iPad, iPhone, And | Thread route state with one sentence and a way back. No blank or unrelated screen                                                                                                                                                                              |
| N16 | Target unavailable: already answered              | P2                     | W, D, iPad, iPhone, And | Lands in the thread, panel gone; one toast and **Show latest**                                                                                                                                                                                                 |
| N17 | Target unavailable: environment unreachable       | P2                     | W, D, iPad, iPhone, And | Thread route state naming the environment, **Retry**, and a way back; target kept queued                                                                                                                                                                       |
| N18 | Anchor not found: reverted turn or outside window | P2, P3                 | W, D, iPad, iPhone, And | Lands at the end of the thread with one toast saying why. After the 20-page cap, no further search                                                                                                                                                             |
| N19 | Replaced item                                     | P3 (same tag), P4      | W, D, iPad, iPhone, And | The same toast, notification, and row update in place to the new kind and alert again. "Approval needed" becomes "Thread completed"                                                                                                                            |
| N20 | Handled elsewhere: quiet replacement              | P4, M2                 | iPhone, iPad, And       | iOS app killed: a passive replacement with the same collapse id. Everywhere else the notification closes and N12 records it                                                                                                                                    |
| N21 | Notification settings, web and desktop            | P1, P3, P5             | W, D                    | Settings, General, Behavior (`SettingsPanels.tsx:2389`; ids `thread-notifications`, `in-app-notifications` in `settingsSearch.ts:313`). Replaces the four-value select                                                                                         |
| N22 | Notification settings, mobile                     | M1                     | iPad, iPhone, And       | Settings, Notifications (`SettingsNotificationsRouteScreen.tsx`). Per-kind switches and push status                                                                                                                                                            |
| N23 | Permission states and recovery                    | P1 web, M1 mobile      | W, D, iPad, iPhone, And | Inside N21 and N22: unsupported, not asked, denied, revoked, granted, with numbered steps and a re-check                                                                                                                                                       |
| N24 | Delay per kind                                    | P5                     | W, D, iPad, iPhone      | Environment-scoped rows in N21, read and write from N22. Shows the environment it applies to                                                                                                                                                                   |
| N25 | iOS banner and lock screen                        | M1, M2                 | iPhone, iPad            | Title, body, Time Sensitive for approval and input, thread grouping, passive replacements                                                                                                                                                                      |
| N26 | Android notification                              | M1, after Android push | And                     | Same content. Specified now; blocked on Android push (`notifications.md` rule 7)                                                                                                                                                                               |
| N27 | Desktop OS notification                           | P2, P3                 | D                       | Only when the window is not in front. Click raises the window (N29) and lands (N14). Closes when its item is cleared                                                                                                                                           |
| N28 | Browser notification                              | P1                     | W                       | Only when the tab is hidden or unfocused. Not constructed on phone browsers                                                                                                                                                                                    |
| N29 | Desktop window raise and macOS hide-on-close      | P2                     | D                       | Click or dock bounce raises a hidden or minimized window from the main process. Closing the macOS window hides it, so alerts keep flowing                                                                                                                      |
| N30 | Cold-start tap                                    | P2, M2                 | iPad, iPhone, And       | App launches from a notification tap, queues the target, lands once navigation and the connection are ready                                                                                                                                                    |
| N31 | Badge                                             | P3, P4, M2             | W, D, iPad, iPhone      | App icon, dock, taskbar, favicon, PWA. A plain number of threads with an open item; never the only signal                                                                                                                                                      |
| N32 | Multi-environment display                         | P1, P4                 | W, D, iPad, iPhone, And | Environment label on toasts, notifications, rows, and the Needs me footer, only when more than one environment is connected                                                                                                                                    |
| N33 | Keyboard and command palette entry points         | P3, P4                 | W, D, iPad (keyboard)   | Palette actions and registered shortcut commands (`keybindings.ts:59`, `CommandPalette.tsx` "Actions" group). No default keys assigned                                                                                                                         |

Settings entry points: web and desktop at Settings, General, Behavior, found also by the
existing settings search; mobile at Settings, Notifications. The hosted web app and the
local `npx t3` web app use the same N21. Phone browsers show N23 "unsupported" and point to
the mobile app. No tray or menu-bar surface is added; it is not needed by any decision.

## Flows

Each step names the state I see. "Item" means the proposal's attention item.

**(a) Approval needed while I am active on desktop.** P1 for the toast, P4 for the item.

1. The agent asks for approval in a thread I am not viewing. The window is in front.
2. I see N01 at the top right: **Approval needed**, the thread title, **Open**, **Dismiss**.
   Screen readers announce it once as an alert. No OS notification, no push (rule 1 and 2).
3. The sidebar row shows **Pending Approval** with **New**; the **Needs me · 1** row appears.
4. I choose **Open**. The thread opens with the approval panel expanded and focused.
5. After 750 ms of the panel being mounted and expanded, the client reports it. The toast
   is already gone, **New** leaves the row, and the Needs me count drops. The row still
   reads **Pending Approval** and the thread stays in Needs me until I answer (N11 text).
6. I answer. The row status clears. The item moves to Handled as **Answered**.

**(b) Away from all desktops, with the iPad.** P5 and M1.

1. My desktop has had no input for 60 seconds, or is locked or asleep. Nothing alerts.
2. The agent asks for approval. After the delay (1 minute) the server picks the iPad.
3. The iPad shows N25: **Approval needed**, "thread title · project", Time Sensitive.
4. I tap it (flow d). The app opens on the thread with the approval card focused.
5. The card is on screen for 750 ms, the iPad reports it, and the server clears every
   other projection. When I return to the desktop, the row says **Pending Approval** with
   no **New** mark if I already saw it, or with **New** if I did not.
6. If the iPad did not confirm within 15 seconds over the WebSocket, the server tries the
   next device once. I may get one extra alert; I never get silence from this path.

**(c) The same event with two devices active.** P1 and P4.

1. The desktop window is in front and the iPad app is open on another thread.
2. Both show a toast (N01 and N07). The desktop plays one sound; the iPad is silent.
3. I handle it on either device. Seen is idempotent: the other device's toast closes and
   its row loses **New** within 2 seconds. No push was sent.

**(d) Tapping a notification.** P2, P3, M2. The landing is always N14 or N15 to N18.

1. **Cold.** I tap on the lock screen. The app launches and shows the existing launch
   screen. The target is queued until navigation and the environment connection are
   ready, then the thread opens on the anchor. If the connection does not come up, N17
   shows with **Retry**; the tap is not lost.
2. **Backgrounded.** The app comes forward on the thread, on the anchor.
3. **Foreground on another thread.** The toast **Open** or the notification navigates
   away from the current thread. The draft in the thread I leave is kept as it is today.
4. **Foreground or window raised on the same thread, at the wrong spot** (decision 5).
   a. The window activates. A toast names the event (N13).
   b. Approval and input: the panel expands if collapsed; nothing scrolls.
   c. Completed and failed: one instant scroll to the terminal message or the end. A
   scroll gesture, unsent composer text, or an active drag cancels it, and it is not
   retried. The toast keeps **Jump**; **Jump to result** also stays on the thread (N14).
   d. After 750 ms with the anchor on screen, the item clears everywhere and the toast closes.

**(e) Approval answered on one device while a notification is on another.** P4, M2.

1. I answer on the desktop. The item resolves as answered.
2. A web or desktop notification closes through its held reference if the page is live.
3. An open iPad app removes the delivered notification. A killed iPad app gets a passive
   replacement: **Approval answered** (N20). It does not buzz. It may stay in
   Notification Center until I clear it, which is a platform limit.
4. If I tap a stale alert anyway, N16 appears: "Already answered." with **Show latest**.

**(f) Completion while I was disconnected.** P4.

1. The agent finishes while my client is offline. The server still creates the item.
2. On reconnect the shell resumes with the item. If one item was raised, I get its toast
   (N03 or N04). If two or more, I get N06: "3 threads need you." with **Show**.
3. The sidebar and thread list show **New** and the Needs me count. Before P4, nothing
   appears (today's gap G11); this flow is not available until then.

**(g) Permission revoked.** P1 web, M1 mobile.

1. I turn notifications off in the browser or system settings.
2. The next time the window or app returns to the front, it re-checks. One toast: "System
   notifications are blocked. You won't be alerted when T3 Code isn't in front." with
   **Fix** (opens N23) and **Dismiss**. It shows once per revocation, not on every launch.
3. N23 shows the blocked state, the steps, and **Check again**. My saved choice stays.
4. In the meantime toasts, Needs me, and badges still work. A push to a revoked device is
   accepted by the platform and dropped; the server cannot tell (guarantees not given).
5. After I allow it again, **Check again** or the next return clears the state.

**(h) Item replaced by a newer event.** P3 for same-tag replacement, P4 for the item.

1. An approval toast is showing. The turn ends before I answer.
2. The same toast updates in place to **Thread completed** with **Jump** and starts its
   auto-hide timer. The kind changed, so it is announced once as a status.
3. The row label changes from **Pending Approval** to **Completed**, still **New**. The
   Needs me count does not change (one thread).
4. The iPad notification is replaced under its collapse id and alerts once, because this
   is a new item. A web or desktop notification is replaced under its tag.
5. A repeat of the same item (same kind, turn, and request) changes nothing and does not
   re-announce.

**(i) Multiple environments.** P4.

1. My desktop is connected to environments A and B. My iPad is paired to B only.
2. An approval in B while I use the desktop: B sees my desktop's lease, so the desktop
   toasts with the environment label (N32) and the iPad is not pushed.
3. If the desktop is not connected to B, B pushes the iPad after its delay. The desktop
   never sees it, which is correct.
4. The Needs me list merges items across connected environments and shows the label. If
   an environment is unreachable, the list footer says so (see copy) rather than looking
   complete.
5. Badges sum across connected environments. A pushed badge is approximate and the server
   omits it when two environments are registered to one device.

## States and projections

An item is open, cleared (seen or dismissed, not distinguished), resolved, or replaced. The
truthful wording never says "seen" for a clear it cannot attribute and never says "sent".

| State                                           | Toast                             | OS and push                                   | Row and Needs me                                                   | Badge                      | Thread screen                                     |
| ----------------------------------------------- | --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------- |
| Open, new                                       | Shown by kind (N01 to N04)        | Only if no client is active; per kind         | Status label plus **New**; counts in Needs me                      | Counted                    | Panel (approval, input) or end of thread (result) |
| Open, toast hidden or timed out                 | Gone; not re-shown                | Unchanged                                     | Same as open                                                       | Counted                    | Same; N14 control while the anchor is off screen  |
| Cleared, approval or input unanswered           | Closed on every device            | Closed or replaced (N20)                      | Status label only, no **New**; stays in Needs me                   | Not counted                | Panel stays; thread still marked waiting          |
| Cleared, completed or failed                    | Closed on every device            | Closed or replaced (N20)                      | No **New**; leaves Needs me; listed in Handled                     | Not counted                | Result visible; no control                        |
| Resolved: answered                              | Closed                            | Closed or replaced with **Approval answered** | Label clears; leaves Needs me; Handled **Answered**                | Not counted                | Panel gone; transcript shows the answer           |
| Resolved: thread moved on (follow-up, new turn) | Closed                            | Closed                                        | Working label from the thread's own state; Handled                 | Not counted                | Normal                                            |
| Replaced by a newer item                        | Same toast updates in place       | Same tag or collapse id replaced and alerts   | Label and **New** follow the new item                              | Unchanged                  | Anchor follows the new item                       |
| Raised while disconnected                       | N06 or one toast on return        | None from this client                         | **New** and counted after resume                                   | Counted                    | Normal                                            |
| Target unavailable (archived, deleted, offline) | Not shown for deleted or archived | Closed when the thread is removed             | Archived or deleted: removed from Needs me; offline: footer notice | Not counted for removed    | N15 or N17 on a tap                               |
| Kind switched off on this device                | Never                             | Never                                         | Still listed and **New**                                           | Not counted on this device | Normal                                            |
| Presentation blocked (permission revoked)       | Toasts work                       | Fails silently                                | Still listed and **New**                                           | Counted                    | Normal; N23 explains                              |

Actions and wording per state (US English, verbatim):

| State               | What I can do                                         | Truthful wording                                                                       |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Open, new           | Open, Dismiss, Hide (toast); Mark seen (row, palette) | **New** on the row. Toast: the event title and thread                                  |
| Cleared, unanswered | Open and answer; Mark as new                          | Row: "Pending Approval" or "Awaiting Input". Handled: "Cleared 2:14 PM, still waiting" |
| Cleared, result     | Open from Handled; Mark as new                        | Handled: "Cleared 2:14 PM"                                                             |
| Resolved            | Open from Handled                                     | Handled: "Answered 2:16 PM" or "Thread continued 2:16 PM"                              |
| Replaced            | Same as open                                          | Title of the new kind; no mention of the old one                                       |
| Target unavailable  | Back; Retry (offline); Show latest (answered)         | Copy deck, unavailable targets                                                         |

**Reverse states.** AGENTS.md calls a one-way door a bug. Dismiss and Mark seen are reversed
three ways: **Undo** on the toast that follows **Mark all seen**, **Mark as new** on any
cleared item, and the Handled section, which lists the latest 20 cleared, answered, or
continued items so nothing I cleared is unfindable. Handled is bounded by count in the
view; items themselves never expire. **Mark as new** reopens the existing item without
alerting again (no toast, no push, no sound). Archive and delete follow existing Undo and
restore flows; they are not changed here.

## Copy deck

Titles are fixed by the proposal: **Approval needed**, **Input needed**, **Thread failed**,
**Thread completed**. No app name in any title. No error text. Body is "thread title ·
project", with " · environment" appended only when more than one environment is connected
(N32). Fabricated example: "Fix flaky login test · billing-api".

| Context                                        | String                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toast actions                                  | **Open**, **Jump**, **Dismiss**; close control label **Hide notification**; its tooltip "Hide. It stays in Needs me."                                                                                                                                                                                                                                     |
| Toast accessible name                          | "Approval needed. Fix flaky login test. Open, button." (kind, thread, then actions)                                                                                                                                                                                                                                                                       |
| Wrong-spot toast                               | Title as above; body "Fix flaky login test"; action **Jump** (result) or **Open** (approval, input)                                                                                                                                                                                                                                                       |
| Catch-up toast (N06)                           | "3 threads need you." Action **Show**. One thread: the normal toast                                                                                                                                                                                                                                                                                       |
| Needs me filter                                | Label **Needs me**; count beside it "3"; filter aria "Needs me, 3 threads"                                                                                                                                                                                                                                                                                |
| Needs me empty                                 | "Nothing needs you." Body: "Approvals, questions, failures, and results you have not seen appear here."                                                                                                                                                                                                                                                   |
| Needs me footer, offline                       | "Can't reach Studio. Its threads may be missing here."                                                                                                                                                                                                                                                                                                    |
| Needs me, other projects                       | "3 more in other projects." Action **Show all projects**                                                                                                                                                                                                                                                                                                  |
| Row actions                                    | **Mark seen**, **Mark as new**, **Mark unread** (existing, unchanged for threads without an item)                                                                                                                                                                                                                                                         |
| Bulk                                           | Header action **Mark all seen** (acts on the visible list). Toast: "Marked 4 seen. 2 still waiting for you." with **Undo**                                                                                                                                                                                                                                |
| Handled section                                | Header "Handled"; empty "Nothing handled yet."; row "Cleared 2:14 PM", "Answered 2:16 PM", "Thread continued 2:16 PM"                                                                                                                                                                                                                                     |
| Settings, section                              | **Notifications**                                                                                                                                                                                                                                                                                                                                         |
| Settings, toasts                               | **Toasts**: "Show a toast when something needs you and this window is in front."                                                                                                                                                                                                                                                                          |
| Settings, system                               | **System notifications**: "Show a system notification when this window isn't in front."                                                                                                                                                                                                                                                                   |
| Settings, sound                                | **Sound**: "Play one sound with a toast, only in the window you're using."                                                                                                                                                                                                                                                                                |
| Settings, kinds                                | **Notify me when**: Approval needed, Input needed, Thread failed, Thread completed. Helper: "Turned-off kinds still appear in Needs me."                                                                                                                                                                                                                  |
| Settings, duration                             | **Toast duration**: 10 seconds, 30 seconds, Until dismissed. Helper: "Approvals and questions always stay until you hide them." (default 10 seconds is an assumption)                                                                                                                                                                                     |
| Settings, how it works                         | "Alerts go to the device you're using. If you aren't using one, they go to the last one you used. A notification clears when you see what it's about, not when you open the thread."                                                                                                                                                                      |
| Settings, delay (N24)                          | **Wait before alerting my other devices** for "Approvals and questions" (1 minute) and "Failures and results" (5 minutes); choices 1, 5, 15, 30 minutes (assumption). Helper: "Applies to Studio. Time counted from your last activity."                                                                                                                  |
| Time Sensitive helper (iOS)                    | "Approvals and questions can break through Focus."                                                                                                                                                                                                                                                                                                        |
| Permission: unsupported                        | Web: "This browser can't show system notifications. Toasts and sound still work." Phone browser: "Phone browsers can't show system notifications. Use the mobile app for alerts." Insecure origin: "System notifications need HTTPS or the desktop app." Mobile: "This device can't receive push notifications. Toasts still show while the app is open." |
| Permission: not asked                          | "Allow system notifications to hear about threads when this window isn't in front." Button **Allow notifications**; line before the prompt: "Your browser will ask for permission next."                                                                                                                                                                  |
| Permission: denied or revoked (web)            | "System notifications are blocked. Your choice is saved and resumes when you allow them." Steps: "1. Click the lock or settings icon next to the address bar. 2. Set Notifications to Allow. 3. Return here." Button **Check again**                                                                                                                      |
| Permission: denied or revoked (desktop, macOS) | Steps: "1. Open System Settings, then Notifications. 2. Choose T3 Code. 3. Turn on Allow Notifications." Button **Open System Settings** (assumption: the bridge can open it)                                                                                                                                                                             |
| Permission: denied or revoked (iOS)            | "Notifications are off for T3 Code in Settings." Steps: "1. Open Settings, then Notifications. 2. Choose T3 Code. 3. Turn on Allow Notifications." Button **Open Settings**                                                                                                                                                                               |
| Permission: granted                            | "On. System notifications appear when this window isn't in front; toasts show when it is."                                                                                                                                                                                                                                                                |
| Mobile registration                            | "Registering this device…"; "Allowed, but this device isn't registered with Studio yet. Alerts start when it connects."                                                                                                                                                                                                                                   |
| Revocation notice (flow g)                     | "System notifications are blocked. You won't be alerted when T3 Code isn't in front." **Fix**, **Dismiss**                                                                                                                                                                                                                                                |
| Unavailable: archived                          | "This thread is archived." Actions **View archived threads**, **Back to threads**                                                                                                                                                                                                                                                                         |
| Unavailable: deleted                           | "This thread was deleted." Action **Back to threads**                                                                                                                                                                                                                                                                                                     |
| Unavailable: answered (N16)                    | "Already answered." Action **Show latest**                                                                                                                                                                                                                                                                                                                |
| Unavailable: environment (N17)                 | "Can't reach Studio right now. This notification opens when the connection is back." **Retry**, **Back to threads**                                                                                                                                                                                                                                       |
| Anchor: reverted (N18)                         | "That turn was reverted. Showing the latest messages."                                                                                                                                                                                                                                                                                                    |
| Anchor: not found (N18)                        | "Couldn't find that message. Showing the latest."                                                                                                                                                                                                                                                                                                         |
| Thread control                                 | **Jump to result** (completed), **Jump to failure** (failed)                                                                                                                                                                                                                                                                                              |
| Replacements (N20)                             | Titles **Approval answered**, **Input answered**, **Seen on another device**; body unchanged. Passive                                                                                                                                                                                                                                                     |
| Screen reader, landing                         | "Approval needed in Fix flaky login test." then focus on the panel or the result's first line                                                                                                                                                                                                                                                             |
| Screen reader, bulk                            | "4 threads marked seen. 2 still waiting for you."                                                                                                                                                                                                                                                                                                         |
| Screen reader, replacement                     | "Thread completed. Fix flaky login test." (announced once; not the old kind)                                                                                                                                                                                                                                                                              |
| Screen reader, row                             | "Fix flaky login test, Pending Approval, new, billing-api" (extends `Sidebar.logic.ts:55`)                                                                                                                                                                                                                                                                |

## Accessibility

Targets follow the proposal's rule 11: WCAG 2.2 AA for toasts, Needs me, Handled, and
settings. Concrete numbers and behaviors:

- **Roles.** A toast is a status message, never a dialog and never focus-taking. N03 and
  N04 use a polite status role; N01 and N02 use an alert role, once per item id. A
  same-item update does not re-announce; a kind change does (4.1.3). Replace the toast
  root's `dialog` role over a polite region (G17).
- **Contrast and size.** Text 4.5:1 and icons, borders, and focus rings 3:1 in both
  appearance profiles. Web targets at least 24 by 24 CSS pixels (2.5.8), with the toast
  actions at the existing `xs` button size or larger. Mobile targets 44 by 44 points
  (the existing `size-11` header buttons). Color is never the only difference between
  kinds: each has an icon and its own title.
- **Timing (2.2.1).** N01 and N02 never auto-hide. N03 and N04 default to 10 seconds
  (assumption), pause on hover and on keyboard focus, and the item stays in Needs me.
  Settings extends the duration.
- **Focus.** A toast never takes focus and never covers the composer or the focused
  element (2.4.11). Registered command `notifications.focus` moves focus to the newest
  toast's primary action. **Escape** on a focused toast hides it; it never dismisses. After
  Hide, focus returns to the element that had it before. Tab order inside a toast:
  primary action, **Dismiss**, **Hide**.
- **Lists.** Needs me toggle is a button with `aria-pressed`. Row marker **New** is text,
  read in the row's name. Mark seen and Mark as new have their thread in the accessible
  name. The Needs me count updates a polite region at most once per second and only on
  change. Handled is a disclosure.
- **Landing.** A deep-link or toast **Open** announces "Approval needed in <thread>" first,
  then moves focus to the anchor (the panel or the first line of the result). No
  focus is moved by a skipped auto-scroll.
- **Mobile.** VoiceOver and TalkBack read the system banner as title, body, then "double
  tap to open". N07 is one element with custom actions Open, Dismiss, and Hide, and
  announces once through the platform announcement API. Swipe up hides; it never
  dismisses. Dynamic Type and font scale up to the largest accessibility size: the toast
  grows vertically, action buttons wrap below, the body truncates at 3 lines with the
  full text in the accessible name.
- **Reflow and zoom.** At 320 CSS pixels wide and 200% text, nothing is clipped or needs
  two-axis scrolling (1.4.10, 1.4.4); toast actions wrap under the body.
- **Motion and sound.** `prefers-reduced-motion` and iOS and Android Reduce Motion reduce
  the entrance to an opacity change. Sound is never the only signal.
- **Keyboard paths.** Everything a toast or row offers is reachable by keyboard: toast
  actions via `notifications.focus`; Needs me, Mark seen, and Mark all seen via the
  command palette and sidebar focus; Settings controls in normal tab order. iPad hardware
  keyboards use the same registered commands (`docs/user/keybindings.md`, iPad section).

## Performance and motion constraints

From the UX side, restating the proposal's budget as design rules:

- One short entrance per toast, 200 ms or less, no exit animation beyond a fade. Today's
  toast transition is 500 ms for transform and opacity (`toast.tsx:591`); new variants
  must not inherit it.
- No continuously repainting animation. A row's **New** mark, the Needs me count, a
  badge, and a toast are static. No pulsing badge, no count-up, no shimmer, no
  animated border. The existing **Working** pulse is unrelated and is not used for items.
- Scroll to an anchor is instant, never animated, and only one attempt.
- A new item never reorders rows under my pointer or keyboard focus. The Needs me list
  inserts at the top only when it is not focused or hovered, else it shows a static
  "1 new" row at the top that I choose to apply.
- Items arrive as one shell upsert each; the UI does no polling and starts no interval
  for age, relative time, or "still waiting". Timestamps in Handled are static strings
  recalculated on re-render.
- Observing the anchor costs one observer on one node, only while the viewed thread has an
  open item; no state may hold a timer when no item is open.
- What each state must not do: an open item must not repeat an alert; a cleared item must
  not make a sound; a hidden toast must not return; a replaced item must not leave the old
  kind visible; an unavailable target must not leave a blank screen.

## Hit-every-surface walk

- **Entry points.** Chat view (approval panel, N14), toast (N01 to N07), row indicator
  (N10), Needs me and Handled (N08, N09, N12), notification (N25 to N30), Settings (N21
  to N24), command palette and registered commands (N33), badge (N31). Keybindings are
  proposed commands with no default key, so no collision. Each toast action also exists in
  the list and the palette, as rule 11 requires.
- **Clients.** Web and desktop share N01 to N14 and N21 (desktop adds N27, N29, native
  badge). iPad and iPhone share N07, N09, N22, N25, N30; iPad adds a hardware keyboard
  path and sits in the detail pane with the toast under the header. Android is specified
  but waits for push.
- **Providers.** Provider-independent: the item derives from the thread shell, so no
  adapter needs a decision.
- **Agents.** Raise and acknowledge are service methods. There is deliberately no MCP tool:
  an agent must not mark its own approval seen. **Mark as new** follows the same rule.
- **Contracts.** Additive and optional: the shell `attention` field and the acknowledge RPC
  (P4); `idleForMs` on the lease report (P5); new optional client settings for per-kind
  switches and toast duration (client-only, P3); an environment setting for delay (P5);
  an item reopen operation (P4, see conflicts). Old clients ignore unknown fields.
- **Reverse states.** Dismiss and Mark seen: Undo, Mark as new, Handled. Hide: it stays in
  Needs me. Per-kind off: switch back on. Permission blocked: Check again.
- **Connection modes.** Local, remote or relay, and tunnel all use the WebSocket, so the
  same N-screens apply. A linked upstream relay's own push is out of scope and still
  alerts every device. Cold start over a slow tunnel hits N17 rather than a blank screen.
- **Docs to update (not edited here).** `docs/user/mobile-notifications.md` (drop the
  Connect requirement for the fork's push, foreground behavior as in G20, tap behavior,
  Needs me); `docs/user/thread-sidebar.md` (Needs me, the **New** mark, Mark seen, Handled);
  `docs/user/keybindings.md` (new commands); `docs/operations/android-notifications.md`
  (grouped alerts open `/`, G20). A web and desktop notifications section has no home
  today; add it to `thread-sidebar.md` rather than a new page unless it outgrows it.

## Usability validation plan

No analytics. Pass and fail are observable outcomes in a real client, on an isolated
worktree `.t3` seeded by `VACUUM INTO` from a copy of real data, per
[defect-resolution.md](./defect-resolution.md). Mockups prove nothing about interaction.

| Flow | Phase  | Fixture                                                                 | Task steps                                                                         | Observable pass or fail                                                                                                                          |
| ---- | ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| a    | P1, P4 | Thread with a pending approval; two tabs                                | Trigger approval on thread B while on thread A; use **Open**; answer               | One toast, one sound, zero OS notifications; panel expanded; **New** gone and count 0 after 750 ms                                               |
| b    | P5, M1 | Idle desktop, registered iPad simulator, `xcrun simctl push` payload    | Wait the delay; tap the delivery; read the card                                    | Exactly one delivery; lands on the card; second device clears within 2 s. A real push is separate and stays `fixed-unverified` until one arrives |
| c    | P1, P4 | Two clients active                                                      | Raise an item; handle on one                                                       | Both toast; the other clears within 2 s; no push in the trace                                                                                    |
| d    | P2, P3 | A thread over 10 user turns (forces pagination); cold, warm, wrong spot | Terminate then open the deep link; tap while on the same thread, anchor off screen | Lands on the thread on the anchor; the scroll is canceled by a swipe and not retried; skipped with a draft                                       |
| e    | P4, M2 | Open item on desktop and iPad                                           | Answer on one                                                                      | Other closes within 2 s; killed-app iPad shows the quiet replacement                                                                             |
| f    | P4     | Stop and restart the client connection mid-turn                         | Reconnect after the turn completes                                                 | The item exists; one toast or N06; row shows **New**                                                                                             |
| g    | P1     | Block then allow notifications in the browser profile                   | Return to the window                                                               | N23 shows blocked with steps; one notice; allowed state recovers on **Check again**                                                              |
| h    | P3, P4 | Approval then completion in one turn                                    | Leave the toast untouched                                                          | Same toast updates; one announcement; label changes; no stale kind anywhere                                                                      |
| i    | P4     | Second dev environment                                                  | Raise in each; disconnect one                                                      | Label shown only with two environments; footer notice when one is unreachable                                                                    |

Per phase, one integrated pass in a real client (Browser panel for web, the simulator recipe
for iPad: replay a live turn, open by deep link, cold start by terminate then open URL,
read the scroll series, `swipe` not `press`; live-stream cases need a Release build).
P1 and P3: web, with the keyboard and zoom checks above. P2: simulator cold-start tap; the
desktop window raise needs the real Electron app and is not driven from here, so it is
filed as `fixed-unverified` per [posture.md](./posture.md). P4 and P5: web plus iPad
together, with a second client for cross-device clearing. VoiceOver and TalkBack announcement
checks, Time Sensitive delivery, and a real APNs push need a physical device and stay
`fixed-unverified` until done. Reduced motion and 200% text are checked on web in P1.

## Spec conflicts found

1. **Needs me versus the badge.** The proposal counts the badge as threads with an open
   item, and also says a seen approval stays marked as waiting. A filter that drops
   seen-but-unanswered approvals would hide what the agent still needs. Chosen: the filter
   and its count list open items plus threads still waiting on an answer; the badge counts
   open items only. Two numbers, with different jobs: new, and to do.
2. **Reopening.** The proposal has acknowledge but no reverse, while AGENTS.md requires a
   way out of every one-way door and decision 6 says nothing is lost. Chosen: add a
   **Mark as new** operation (same service, no re-alert) in P4. The proposal should add it.
3. **Titles for replacements.** The four titles are fixed, but the "quiet replacement"
   (open decision 5, rule 4) needs words that do not lie. Chosen: **Approval answered**,
   **Input answered**, **Seen on another device**, passive. Needs the owner's sign-off.
4. **"Dismiss" versus the toast close control.** Rule 3 makes toast **Dismiss** a clear, rule
   1 says hiding a toast does not dismiss, and rule 11 says Escape "dismisses". Chosen:
   Hide and Escape hide; only the labeled **Dismiss** clears.
5. **Scope of per-kind switches and delay.** The proposal says "all settings" and "one
   switch per kind on every surface" but not their scope. Chosen: switches and toast
   duration are per device; delay is per environment. An off kind still creates the item
   and lists it, and is not counted in that device's badge.
6. **Mobile Notifications screen requires T3 Connect.** The proposal does not mention the
   existing screen's gate and registration status (`SettingsNotificationsRouteScreen.tsx:60`),
   but the fork has no Connect relay. N22 must work with the direct push registration.
7. **Toast duration.** Rule 11 says a setting extends the default; the proposal gives none
   and today's default is 5 seconds (Base UI). Chosen: 10 seconds, with 30 seconds and
   until dismissed. An assumption.
8. **Toast transition.** The proposal budgets a 200 ms entrance, but the existing toast
   root transitions for 500 ms (`toast.tsx:591`). P1 must change it for the new variants.
9. **Mobile toast sound.** Rule 1's "one sound" and the mobile safety net conflict mildly.
   Chosen: the mobile toast is silent and has no haptic.
