# Notifications: proposed visual specification

Status: **proposed, 2026-10-05**. Companion to [the notifications proposal](./notifications.md) and [the UX specification](./notifications-ux.md); presentation follows the optional profile in [design-system.md](./design-system.md). These are review artifacts, not implemented product UI or verified screenshots. Screen IDs N01 to N33 and every string in a panel are the UX specification's; this page adds layout, color, assets, and review.

See the [rendered overview](./notifications-assets/overview.png) or [editable overview SVG](./notifications-assets/overview.svg). Open the [self-contained HTML gallery](./notifications-assets/gallery.html) locally: 33 panels (31 screen panels covering N01 to N33, plus two reference panels), a light/dark toggle, and a separate switch (default off) for the optional warm-brutalism preview. It loads no fonts, images, external scripts, or data from the network (inline CSS, SVG, and JavaScript only) and has no animation. Buttons only announce "Illustrative: no real changes occurred." [The manifest](./notifications-assets/manifest.json) lists screens, panel mapping, and assets.

## Visual review and recommendations

**Hierarchy.** A toast reads in this order: kind icon, title (14/20, weight 600), then "thread title · project" (12/18, muted), then actions, then the Hide control in the corner. The title carries the kind; the thread name is the object. Nothing else competes: no app name, no timestamp, no error text. In the sidebar the existing status label stays the primary signal and **New** is one small bordered text tag after it.

**Kinds without color.** Each kind has its own silhouette (approval a shield, input a speech bubble, failed an octagon, completed a circle), its own title, and its own row label. Hue (amber, indigo, red, green, from the sidebar's existing status colors) is applied to the icon and the label text only, never to a surface fill, a border, or a background. Gallery panel A1 renders the four kinds in grayscale to show they stay distinct. Position adds a second cue: persistent kinds keep the top slots of the stack (a recommendation; see conflicts).

**Persistent versus auto-hiding.** Approval and input toasts never leave on their own, so they carry an outlined icon tile and a 3:1 border. Failed and completed toasts get a hairline border and a bare icon. There is no countdown bar, shrinking line, or progress ring: timers are not drawn, and the item stays listed when a toast leaves. Roles differ too (alert versus status).

**Needs me without a guilt inbox.** The toggle is one icon in the existing header group; the **Needs me** row exists only while something needs me; the count is plain muted text beside the label, not a pill and not red; rows show no age, no overdue state, and no "still waiting" timer. **New** is a bordered word, not a dot, so a long list never turns into a field of red dots. A seen approval still waiting keeps its label and loses **New**. Items leave as they are seen, and **Mark all seen** answers with an **Undo** toast.

**Quiet states.** A replaced item updates in place and says nothing about its past. Handled and handled-elsewhere content is secondary-colored text with no icon color: Handled rows are text only; the iOS "Approval answered" replacement is medium weight in secondary color and passive; the "Already answered." toast uses a neutral glyph. Unavailable-target states use a dashed neutral glyph and one sentence. Failure red is limited to the failed icon and its row label; completed is never red.

**Truthful seen, dismissed, resolved.** The page never draws a mechanism: no dwell ring, no read receipt, no "seen at" stamp. The outcome is what changes: **New** leaves the row, the item appears in Handled with a static time ("Cleared 2:14 PM", "Answered 2:16 PM"), and one Settings sentence explains clearing. The seen glyph appears only on the two explicit actions. Nothing is labeled "sent."

**Mobile foreground toast versus OS notification.** The foreground toast (N07) is an in-app card under the header, silent, with 44 pt actions and a visible Hide. The OS notification (N25, N26) is system-drawn and carries only title and body, identical to the toast so the two read as one alert across devices. The gallery draws the OS content area inside a dashed neutral frame; OS chrome (app icon, app name, time, Time Sensitive label, channel) is native and not reproduced.

**Do not.** No pulsing, bouncing, or count-up badges; no radar or ripple; no gradient or glow; no continuously repainting animation (the existing **Working** pulse is unrelated and is not reused for items); no colored surface fills for kinds; no alarm red for completed; no accent strips (banned by the design kit); no per-item toasts after reconnect (N06 summarizes); no reordering rows under the pointer; no loading spinner for a pending cold-start or unreachable target.

## Screen inventory

Panels are in the [gallery](./notifications-assets/gallery.html); fragment `#N##` opens each. Shared panels carry the other ID as an anchor. A1 (kind grammar) and A2 (asset sheet) are reference panels without screen IDs.

| ID  | Panel        | Phase       | State drawn                                                               |
| --- | ------------ | ----------- | ------------------------------------------------------------------------- |
| N01 | N01 (shared) | P1          | Approval toast, persistent, in window with keep-clear composer            |
| N02 | N01 (shared) | P1          | Input toast stacked under N01                                             |
| N03 | N03 (shared) | P1          | Failed toast, auto-hiding, status role                                    |
| N04 | N03 (shared) | P1          | Completed toast with Jump                                                 |
| N05 | N05          | P1, P3, P4  | Open or Jump, Dismiss, Hide, focus ring on Hide, beside today's toast     |
| N06 | N06          | P4          | Catch-up toast "3 threads need you."                                      |
| N07 | N07          | P1, P4      | iPhone toast and reduced-scale iPad detail pane                           |
| N08 | N08          | P4          | Sidebar filter on, count, footer; empty state                             |
| N09 | N09          | P4          | iPhone chip, filter menu, rows with Completed label and New               |
| N10 | N10          | P3, P4      | Web rows: status label, New, seen result (mobile rows are in N09)         |
| N11 | N11          | P4          | Row menu, Mark all seen, Undo toast                                       |
| N12 | N12          | P4          | Handled expanded with three outcomes; empty                               |
| N13 | N13          | P3          | Wrong spot: Jump toast, Jump to result, unsent draft                      |
| N14 | N14          | P2, P3      | Approval panel focused; mobile end of thread with Jump to result          |
| N15 | N15          | P2          | Archived and deleted                                                      |
| N16 | N16          | P2          | Already answered, Show latest                                             |
| N17 | N17          | P2          | Environment unreachable, Retry                                            |
| N18 | N18          | P2, P3      | Reverted turn and message not found                                       |
| N19 | N19          | P3, P4      | Toast before and after, rows before and after                             |
| N20 | N20          | P4, M2      | iOS passive replacement titles (OS content area)                          |
| N21 | N21          | P1, P3, P5  | Web and desktop settings, granted state                                   |
| N22 | N22          | M1          | Mobile settings, registration notice, kinds, delay                        |
| N23 | N23          | P1 web, M1  | Unsupported (4), not asked, denied (web, macOS, iOS), granted, revocation |
| N24 | N24          | P5          | Delay per kind, environment-scoped, choices                               |
| N25 | N25          | M1, M2      | iOS banner and lock screen content area                                   |
| N26 | N26          | M1, Android | Android content area (blocked on Android push)                            |
| N27 | N27          | P2, P3      | macOS and Windows content areas                                           |
| N28 | N28          | P1          | Browser notification content area                                         |
| N29 | N29          | P2          | Hidden, notify, raised: three states                                      |
| N30 | N30          | P2, M2      | Cold start: launch screen, lands, or N17                                  |
| N31 | N31          | P3, P4, M2  | Number only on Dock, taskbar, favicon, iOS icon (badge shape is OS-owned) |
| N32 | N32          | P1, P4      | Environment label on toast, rows, and unreachable footer                  |
| N33 | N33          | P3, P4      | Palette "Actions" group                                                   |

Dialog placement, native headers, and scroll behavior must reuse the real components. Permission prompts, OS notification chrome, badge shapes, and OS settings are native and intentionally not recreated. The 10 second default, 1/5/15/30 minute choices, and the label "Focus newest notification" are assumptions carried from the UX specification or this gallery.

## Layout and typography

**Desktop.** Sidebar width is the existing 16rem (256 px). The toast keeps the existing viewport: at most 360 px wide (`max-w-90`), top right below the workspace topbar (52 px), inset 16 px (32 px from the `sm` breakpoint), 12 px between toasts, the existing large radius and shadow. Inside: icon 20 px, padding 12/14, title 14/20 weight 600, body 12/18, actions in the compact button size (28 px here; never below 24 px), 8 px gaps, Hide in the corner. The stack never reaches the composer: the gallery draws a dashed keep-clear band above it, and the real viewport needs a measured bottom bound (see conflicts). Settings reuse the existing Behavior row layout; the gallery's 12 px row padding is presentation framing. Needs me rows are a new two-line layout (title and time, then label, **New**, project); the thread rows keep the existing single-line anatomy and truncate the title.

**Mobile.** Reference 390 pt phone, 44 pt rows and controls, safe areas respected, system text styles scaled with Dynamic Type (toast grows vertically, actions wrap below, body truncates at 3 lines with the full text in the accessible name). The gallery's 12 to 15 px sizes compare panels and must not be copied into React Native tokens; production uses the app's gutters and type scale. iPad sits in the detail pane with a width-bounded toast under the header, not stretched across the split view. The iPad panel is drawn at reduced scale.

**Spacing and zoom.** Rhythm 4/8/12/16/24/32 px. At 320 CSS px and 200% text the toast width is the viewport minus insets, actions wrap under the body, and nothing needs two-axis scrolling. Large text and 200% zoom are specified here, not verified.

## Colors, profile separation, and icons

The baseline uses existing `background`, `card`, `foreground`, `muted-foreground`, `border`, `primary`, `warning-foreground`, `error-foreground`, and `success-foreground` roles; indigo is the sidebar's existing Awaiting Input hue. The portable gallery approximates them (zinc surfaces, blue-700 primary, amber-700, red-700, emerald-700 text in light and the 400 steps in dark); these are not exact screenshot-parity claims. Hairline borders (`border`, about 1.3:1) stay decorative; boundaries that identify a control or persistent toast use a stronger 3:1 line.

Warm brutalism is an explicit optional gallery profile: hex values derived from the OKLCH page, panel, ink, line, action, and attention tokens in `design/tokens.json`, with 4 px radii. It does not make the unresolved icon grammar, type-family loading, or density wiring in `design-system.md` normative. Do not ship these values as global overrides; default appearance stays upstream.

Contrast, computed with the WCAG relative-luminance formula for the exact gallery values (targets: 4.5 text, 3 non-text). All pass:

| Pair                                    | Target  | Upstream light | Upstream dark | Warm light | Warm dark |
| --------------------------------------- | ------- | -------------- | ------------- | ---------- | --------- |
| Title and body on panel                 | 4.5     | 14.89          | 17.32         | 16.52      | 15.67     |
| Text on page background (sidebar rows)  | 4.5     | 14.52          | 18.16         | 17.25      | 16.60     |
| Secondary text on panel                 | 4.5     | 7.73           | 7.49          | 8.43       | 8.71      |
| Secondary text on tinted fill           | 4.5     | 7.03           | 6.75          | 7.83       | 7.67      |
| New tag text on tag fill                | 4.5     | 13.55          | 15.61         | 15.34      | 13.80     |
| Approval icon and label on panel        | 3 / 4.5 | 5.02           | 11.31         | 7.53       | 9.89      |
| Input icon and label on panel           | 3 / 4.5 | 6.29           | 9.47          | 5.77       | 8.70      |
| Failed icon and label on panel          | 3 / 4.5 | 6.47           | 6.83          | 7.13       | 8.20      |
| Completed icon and label on panel       | 3 / 4.5 | 5.48           | 9.82          | 8.04       | 9.12      |
| Approval label on selected row (lowest) | 4.5     | 4.57           | 10.19         | 6.99       | 8.71      |
| Primary button text                     | 4.5     | 6.71           | 4.65          | 6.02       | 9.22      |
| Focus ring against panel                | 3       | 6.71           | 6.71          | 5.77       | 8.70      |
| Control and persistent-toast border     | 3       | 3.42           | 4.40          | 3.34       | 3.25      |
| White switch thumb against off track    | 3       | 3.42           | 4.29          | 3.65       | 5.75      |

Checking the real roles surfaced four things the gallery already avoids: `muted-foreground` (zinc-500) is 4.83:1 on `card` but 4.40:1 on the zinc-100 accent fill used for hover and selection, so secondary text on selected rows needs the darker gallery value or a different role; the dark `primary` (about 4.06:1 on the dark card) works as a fill with white text (4.65:1) but not as text, so the gallery's dark focus ring and any text action use a lighter value; the existing unchecked switch track (`input`, zinc-300) is 1.48:1 against white, so the gallery draws tracks at 3:1 and the app's switch would need the same change; hairline `border` is 1.27:1 and stays decorative.

Reusable assets use a 24 by 24 viewBox, 1.5 px strokes, round caps and joins, and `currentColor`. Render at 14 to 20 px for rows and controls and 32 to 48 px for empty states. Files in [notifications-assets](./notifications-assets/gallery.html), with the production equivalent to prefer (Lucide on web and desktop, SF Symbols on iOS) where one exists: `approval.svg` (shield-alert; exclamationmark.shield), `input.svg` (message-square-more; questionmark.bubble), `failed.svg` (octagon-x; xmark.octagon), `completed.svg` (circle-check; checkmark.circle), `handled-elsewhere.svg` (monitor-check; compose display and checkmark), `replaced.svg` (replace; arrow.left.arrow.right), `open-items.svg` (inbox; tray), `seen.svg` (eye; eye), `unavailable.svg` (square-dashed; square.dashed), `permission-off.svg` (bell-off; bell.slash), `delay.svg` (clock; clock), `bell.svg` (bell; bell), `jump.svg` (arrow-down-to-line; arrow.down.to.line). These code-native drawings are proposed assets; do not install a second icon system. A glyph never stands alone: each has adjacent text or an accessible name. A clock always has text beside it.

## State treatments and accessibility

- **Open, new:** kind icon and title; **New** on the row; counted in Needs me. **Hidden or timed-out toast:** nothing remains; the item stays listed. **Cleared, unanswered:** label stays, no **New**, listed in Needs me and in Handled in quiet text. **Resolved:** Handled "Answered 2:16 PM". **Replaced:** same toast in place, new title and icon, no trace of the old kind.
- **Raised while disconnected:** one catch-up toast with the open-items glyph. **Unavailable target:** dashed neutral glyph, one sentence, one or two actions, never a blank screen. **Kind switched off:** switch off; still listed with **New**. **Permission blocked:** bell-off glyph, steps, **Check again**; a quiet status toast once per revocation; toasts and Needs me still work.
- **Roles.** N01 and N02 use `role="alert"` (`aria-live="assertive"`, atomic), once per item id. N03, N04, N06, N16, N18, and the revocation notice use `role="status"` (`aria-live="polite"`). The gallery marks mock toasts this way; static alerts present at load may be announced by some screen readers, which real components inserted dynamically would not do, and the real root's `dialog` role (G17) must be replaced. A kind change re-announces; a same-item update does not.
- **Focus and targets.** Visible 3 px focus ring offset 2 px (panel N05 shows it on Hide). A toast never takes focus; tab order is primary action, **Dismiss**, **Hide**; Escape hides. Web targets at least 24 px, mobile 44 pt. Icon-only controls (Hide, search, the Needs me toggle with `aria-pressed`) have accessible names; decorative icons are `aria-hidden` because the title names the kind.
- **Motion and sound.** The gallery has no animation or transition. Production entrances are one opacity change of 200 ms or less and respect reduced motion; the existing 500 ms toast transition must not be inherited. Sound is never the only signal.
- **Color independence.** Verified in the grayscale row of panel A1; every state also has text.

## Source mapping and implementation constraints

| Concern                           | Existing source / seam                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toasts N01 to N06, N16, N18       | `apps/web/src/components/ui/toast.tsx` (Base UI; keep viewport, stack, swipe; new variants, not className restyles), raised by `ThreadNotificationCoordinator.tsx`               |
| Buttons, tags, switch, notices    | `ui/button.tsx` size `compact` or `xs`, `ui/badge.tsx` (outline, `sm`) for **New**, `ui/switch.tsx`, `ui/alert.tsx`, `ui/empty.tsx` size `compact` for N15 to N17                |
| Sidebar rows, labels, Needs me    | `Sidebar.tsx`, `Sidebar.logic.ts` (status labels), `ThreadStatusIndicators.tsx`, `SidebarThreadHeader.tsx` (toggle), `SidebarThreadUndoNotice.tsx`; width `ui/sidebar.tsx`       |
| Settings N21, N24                 | `SettingsPanels.tsx` Behavior section, `settingsSearch.ts`, `ui/select.tsx`                                                                                                      |
| Palette N33                       | `CommandPalette.tsx` "Actions" group, `keybindings.ts` registered commands                                                                                                       |
| Mobile list, filter, landing      | `thread-list-v2-items.tsx` (row labels), `home-list-filter-menu.ts`, `ThreadNavigationSidebar.tsx`, `ThreadDetailScreen.tsx` (scroll-to-end control)                             |
| Mobile settings, foreground toast | `SettingsNotificationsRouteScreen.tsx`, `foregroundNotificationBehavior.ts`; the N07 toast is a new native component, themed from `mobileTheme.ts` and `mobileThemeVariables.ts` |
| Color roles and profile           | `apps/web/src/index.css`; optional `docs/fork/design-system.md`, `design/tokens.json`, generated bridge CSS                                                                      |
| Truth for every state             | The shell `attention` item and server acknowledgement (P4); platform permission result; the UI never infers seen, handled, or delivery from a timer or a mockup                  |

## UX conflicts found

1. **Hide tooltip before P4.** The tooltip "Hide. It stays in Needs me." is in P1 but Needs me does not exist until P4. Until then use "Hide" with no destination.
2. **Dismiss before P3.** N01 (P1) offers **Dismiss**, but N05 says Dismiss is local from P3 and server-wide from P4. What it clears in P1 and P2 is unspecified.
3. **Catch-up toast (N06).** Actions and persistence are unspecified. **Dismiss** would clear several items at once, so the gallery draws **Show** and Hide only, auto-hiding; if the summary includes an approval it should arguably persist.
4. **Row labels on mobile.** The UX uses "Pending Approval" and "Awaiting Input"; mobile rows use "Approval" and "Input" and have one trailing slot shared with the time. Adding a **Completed** label to every settled row would replace the time with noise; show it only while the item is open, with **New**.
5. **Cleared, unanswered items live in two places.** The states table keeps them in Needs me; the actions table lists "Cleared 2:14 PM, still waiting" in Handled. The gallery draws both; confirm that duplication is intended.
6. **"Never cover the composer" needs a rule.** Up to 5 persistent toasts at about 88 to 98 px plus 12 px gaps reach roughly 500 px, which collides with the composer in short or narrow windows. Bound the viewport at the composer's top, collapse extras behind a "+n" row, and keep persistent kinds ahead of auto-hiding ones.
7. **The word "seen."** The stance says it appears only on the two explicit actions, but the copy deck uses it in "Seen on another device" and the Settings sentence "when you see what it's about." Reconsider the replacement title.
8. **Copy gaps.** No strings exist for the palette entries (the gallery labels `notifications.focus` "Focus newest notification"), the badge, or N29. The Hide control is a corner x, which users read as dismiss; keep the accessible name and tooltip and check this in the usability pass.
9. **Role count on arrival.** Several simultaneous alert-role toasts queue assertive announcements; the UX specification's once-per-item rule is necessary but may still need a cap.

## Validation performed

Structurally validated: HTML IDs are unique (68, no duplicates), all 148 fragment links resolve, tags balance under an HTML parser, N01 to N33 each exist as a panel or anchor, there are no remote resource references (`http` appears nowhere in the HTML; the SVGs contain only the XML namespace), no external scripts, fonts, links, or images, and no animation or transition CSS. All 13 asset SVGs and the overview parse with `xmllint --noout`. `manifest.json` parses. Contrast was computed with a script for the exact gallery values. The overview SVG was rendered with `rsvg-convert` and its PNG viewed for legibility and clipping (one clipped toast was fixed). I also took one-shot headless screenshots of the local HTML at 1280 px (light, dark, warm) and in a 390 px frame, only to review layout, which fixed several wrapping and overflow defects; that was not interactive browser verification.

Not validated: interaction (nothing in the gallery works beyond its two controls and the announcement), screen reader behavior, real component fidelity or token parity, device rendering, true 200% zoom or Dynamic Type, OS notification appearance, or any of the sizes in a native client. Each affected surface needs one integrated pass in a real client after implementation, once authorized. Mockups alone prove no interaction works.
