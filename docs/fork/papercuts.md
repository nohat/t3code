# Papercuts: one-tap capture when the app does something unwanted

Status: **decided, stage 1 in progress**. A papercut is any small unwanted behavior: a dead Send button, a stalled turn, a wrong label, a layout glitch. Today I notice it, describe it from memory, and an agent reconstructs the evidence by hand from traces and logs (nohat/t3code#1 and #2 were each reconstructed that way). The goal is that reporting costs one tap and arrives with the evidence already attached. Two tests apply: lazy input, professional output.

## What a papercut contains

Captured automatically, with no typing:

- Where: environment, thread and turn ids, provider, model, runtime mode, route.
- When and what build: timestamp, app build SHA, platform and client surface (web, desktop, iPad, iPhone).
- Client state: connection state, thread sync phase, the Send button's disabled reason and label, whether a local dispatch or command is pending and for how long, pending question or approval state.
- A bounded ring buffer of the last few minutes of client events: dispatch start and acknowledgment, command lane queue, resync, reconnect, errors. Timestamps and ids only.
- Server snapshot, added by the server on receipt: session status, active turn, time of the last provider event, recent failed spans for that thread, running turn count.
- A screenshot of the client, and the text of the thread's recent messages. Both are on by default and stay on my own server (see "Decisions" for why they never go into an issue).

Optional input: one line of text or a dictated note.

## Entry points (every surface, per AGENTS.md "Hit every surface")

- Desktop and web: a global keybinding, a command palette item ("Report a papercut"), and a menu bar item on desktop.
- iPad and iPhone: shake gesture (the iOS convention for "something went wrong"), a thread header menu action, and the command palette equivalent.
- Automatic offer: when the client detects a likely stall it shows a toast with one tap to report: Send disabled with no banner for 30 s, a send pending for 30 s, a turn running with no events for several minutes (needs stalled-turn detection, see below).

## Where it goes

- The environment's server stores each record as JSON under its own T3 home, so Mac, iPad, and iPhone all feed the same list and nothing leaves my machines.
- A triage agent reads new records, pulls the matching trace spans, drafts a fork issue with the evidence automatically, and links it back to the record.
- Each record has a status I can see and reverse: new, triaged, issue linked, fixed in build X, dismissed (reopenable).

## Shape of the change

Additive and in new files, to keep merges from upstream cheap:

- `packages/contracts`: one new RPC, `papercut.create`, with an optional-fields schema. No change to existing contracts.
- `packages/client-runtime`: the ring buffer and the capture function, shared by web and mobile.
- `apps/server`: the handler, storage, the server snapshot, and a `t3 papercuts list` CLI.
- Clients: the entry points above, each calling the shared capture.

## Stages

1. Desktop and web: keybinding, palette item, ring buffer, `papercut.create`, JSON storage, CLI list.
2. iPad and iPhone: shake and header action.
3. The triage agent that drafts an issue with the evidence.
4. A list view with status and reverse actions.

The automatic offer needs stalled-turn detection (a running turn with no provider events for N minutes), which the server does not have today and which also serves the attention work in the priorities list.

## Decisions

- Screenshots are captured by default.
- Message text is captured by default.
- Triage drafts and files issues automatically, without per-issue approval.

The fork repo (nohat/t3code) is public. Issues the triage agent files therefore carry only ids, timestamps, state, and trace-span evidence. Screenshots and message text stay in the local record, and the issue links to the record id. Those two defaults are safe only because of this rule.
