# Papercuts: one-tap capture when the app does something unwanted

Status: **decided, stages 1 and 2 built; stage 2 awaiting a device check. Everything after capture is tracked in nohat/t3code#22.** A papercut is any small unwanted behavior: a dead Send button, a stalled turn, a wrong label, a layout glitch. Today I notice it, describe it from memory, and an agent reconstructs the evidence by hand from traces and logs (nohat/t3code#1 and #2 were each reconstructed that way). The goal is that reporting costs one tap and arrives with the evidence already attached. Two tests apply: lazy input, professional output.

## What a papercut contains

Captured automatically, with no typing:

- Where: environment, thread and turn ids, provider, model, runtime mode, route.
- When and what build: timestamp, app build (the fork version, see [versioning.md](./versioning.md); the wire field is still named `buildSha`), platform and client surface (web, desktop, iPad, iPhone).
- Client state: connection state, thread sync phase, the Send button's disabled reason and label, whether a local dispatch or command is pending and for how long, pending question or approval state.
- A bounded ring buffer of the last few minutes of client events: dispatch start and acknowledgment, command lane queue, resync, reconnect, errors. Timestamps and ids only.
- Server snapshot, added by the server on receipt: latest run and provider session status, active run, time of the thread's last event (user events included; the wire field is still named `lastProviderEventAt`), recent failed spans for that thread, running turn count. The turn id fields carry orchestration V2 run ids.
- A screenshot of the client, and the text of the thread's recent messages. Both are on by default and stay on my own server (see "Decisions" for why they never go into an issue).

Optional input: one line of text or a dictated note.

## Entry points (every surface, per AGENTS.md "Hit every surface")

- Desktop and web: a global keybinding, a command palette item ("Report a papercut"), and a menu bar item on desktop.
- iPad and iPhone: the shake gesture (the iOS convention for "something went wrong"), a "Report a papercut" command palette item, and a row under Settings > Diagnostics. The Diagnostics row replaces the thread header action in the first version: it needs no keyboard and no shake, and the header is built from large upstream files. Android has the palette item and the Diagnostics row, without a screenshot.
- Automatic offer: when the client detects a likely stall it shows a toast with one tap to report: Send disabled with no banner for 30 s, a send pending for 30 s, a turn running with no events for several minutes (needs stalled-turn detection, see below).

## Reporting while the app is hung

The iPad hang reports (#3, #16) are exactly when JavaScript cannot run, so a report that starts in JavaScript would fail when it matters most. On iOS a native module (`apps/mobile/modules/t3-papercut`) catches the shake and writes a bundle to the app's own storage at once: a screenshot, the last context JavaScript handed over (thread, state, event buffer, at most about a second old), and the age of JavaScript's last heartbeat. JavaScript ticks a one-second heartbeat, so a heartbeat older than three seconds means it was blocked. The bundle stays on the device until the server has it; JavaScript uploads leftover bundles on launch, on returning to the foreground, and after a failed upload.

- JavaScript responding: a note prompt, then upload. Cancel discards the bundle.
- JavaScript blocked: a haptic and a native alert ("saved on this device"), then the upload happens on recovery or relaunch. The record carries a `client.js-unresponsive` event with the heartbeat age.
- The event buffer also records `client.js-stall` (with how late the tick was) whenever a blocked thread recovers, so a later report shows a stall that already ended.
- The native hook cannot help if the main thread itself is blocked.
- Known gap: `papercut.create` has no idempotency key, so if the connection drops after the server stored a report but before the reply, the retry stores a duplicate.

## Where it goes

- The environment's server stores each record as JSON under its own T3 home, so Mac, iPad, and iPhone all feed the same list and nothing leaves my machines.
- A triage agent reads new records, pulls the matching trace spans, drafts a fork issue with the evidence automatically, and links it back to the record.
- Each record has a status I can see and reverse: new, triaged, issue linked, fixed in build X, dismissed (reopenable). The record file stays as the client sent it; status, signature, and the issue link live in an append-only `<id>.triage.json` beside it, written by the `t3 papercuts` CLI rather than by a second writer into the live server's files.

## Shape of the change

Additive and in new files, to keep merges from upstream cheap:

- `packages/contracts`: one new RPC, `papercut.create`, with an optional-fields schema. No change to existing contracts.
- `packages/client-runtime`: the ring buffer and the capture function, shared by web and mobile.
- `apps/server`: the handler, storage, the server snapshot, and a `t3 papercuts list` CLI.
- Clients: the entry points above, each calling the shared capture.

## Stages

1. Desktop and web: keybinding, palette item, ring buffer, `papercut.create`, JSON storage, CLI list. Built.
2. iPad and iPhone: shake, palette, Diagnostics row, native bundle. Built.
3. The local loop, in waves (nohat/t3code#22): richer capture and a CLI with status history (#24 to #27); the stall watchdog files reports itself (#28); signature and clusters (#29); the triage job (#30); repro kit, `/defect-session papercuts`, and soak and recurrence (#31 to #33).
4. A list view with status and reverse actions on every surface, deferred until the CLI and the issues prove insufficient.

The server has stalled-turn detection (`ThreadTurnWatchdog`, 10 minutes of provider silence, Claude only). The automatic offer toast on the client is not built; the watchdog filing a report itself (#28) covers the stall that matters most without a tap.

## Decisions

- Screenshots are captured by default.
- Message text is captured by default.
- Triage drafts and files issues automatically, without per-issue approval.

The fork repo (nohat/t3code) is public. Issues the triage agent files therefore carry only ids, timestamps, state, and trace-span evidence. Screenshots and message text stay in the local record, and the issue links to the record id. Those two defaults are safe only because of this rule.

### Local loop first, no privacy inside it (2026-10-05)

> "i want a personal feedback loop that enforces privacy and security by keeping everything local to me and my environments implemented first. no need for different parts inside my loop to preserve privacy from other parts--that's just theater. only when we are thinking about possibly upstreaming the feature we can worry about privacy and security."

- Triage, fixer, and reviewer agents read the whole record, including screenshot, message text, note, and full failure causes. Capture is made richer rather than more careful: the snapshot keeps failure causes and a copy of the trace slice, and client events gain readable labels and errors (#26, #27).
- The boundaries that remain are the public issue body (a mechanical leak check, #30), egress from fork servers (#23), and upstreaming ([#34](https://github.com/nohat/t3code/issues/34), parked with the research on sinks and consent).
- The `evidence` and `localOnly` split stays in the schema as the seam for upstreaming. No allowlist, redaction, or sink layer is built for the loop.
- Dispatching fixes stays mine. Triage files and links issues; it never starts a fix ([posture.md](./posture.md)).
