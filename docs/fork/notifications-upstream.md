# Upstream strategy for notifications

Status: **research and proposal, 2026-10-05**. No upstream discussion, comment, PR, or other write was made for this research. This page supports [the integration proposal](./notifications.md); it does not activate implementation or authorize an upstream submission. Opening or posting anything upstream needs the owner's explicit instruction, per [posture.md](./posture.md) and `AGENTS.md`.

The evidence below was gathered read-only by an upstream-strategist persona against upstream main `e22c880434` on 2026-10-05. Counts and merge times are the strategist's reading of GitHub and are leads, not measurements. Items marked "unverified" were not confirmed.

## Recommendation

**Notifications is the better first upstream contribution, but only as a short sequence of small, verified corrections, not as the spec.** Lead with a two-line documentation fix, then one reproduced bug fix, then one narrow question in an existing thread. Keep the item, presence, routing, direct push, and per-kind preferences in the fork.

Discovery is the runner-up and has a different shape: a larger first slice that needs maintainer approval before any code. Take it first, or in parallel, only if a maintainer gives an explicit go-ahead on it, if both notification slices are preempted or closed as duplicates, or if maintainers say notifications are internal-only. The earlier discovery strategy is [environment-discovery-upstream.md](./environment-discovery-upstream.md).

## What upstream looks like now

**Eligibility.** Only six logins skip triage (`bmdavis419`, `juliusmarminge`, `maria-rcks`, `markflorkowski`, `t3dotgg`, `Yash-Singh1`). Org membership, vouch labels, and prior merges do not bypass it.

- A feature needs a linked maintainer comment approving direction and scope. A discussion URL alone does not count.
- Three exceptions: a very small obvious-bug fix; a focused option for an existing capability; a substantial bug fix that links a maintainer-triaged issue.
- One underlying problem per PR. UI changes need before/after images, plus a recording when timing matters.
- Closures cite the rule and a remedy, usually written by a maintainer's agent. The policy is new (#14480, 2026-09-30).

**Who decides.** Three maintainers merged about 2,800 of the last 3,000 merged PRs (`juliusmarminge` about 1,527, `maria-rcks` about 654, `t3dotgg` about 608). I found no roadmap file. A statement attributed to Theo that notifications are an "anti-pattern" is second-hand, via a comment linking an X post (unverified).

**Drift that matters.** The orchestrator V2 rewrite (#2829, +380k/-203k, 1,912 files) merged 2026-10-02. Afterward, outside PRs touching legacy files were closed, for example #14073 and #12675. The fork's audit base `54084ae1e6` is 175 commits behind and has no `orchestration-v2`. The decider, projector, and reactor language in [notifications.md](./notifications.md) describes the pre-V2 shape; its P4 and P5 designs must be re-mapped onto V2 before anyone proposes them upstream.

**Outside features that merged.**

| PR     | Author                  | Size             | To merge | Notes                                                      |
| ------ | ----------------------- | ---------------- | -------- | ---------------------------------------------------------- |
| #11481 | maria-rcks (maintainer) | +333             | 2 h      | Opt-in thread notifications and sounds; closed Ideas #7046 |
| #11569 | Bil0000                 | +587             | 8 h      | Built on #11040, which was closed in its favor             |
| #11570 | Bil0000                 | +367             | 7 h      | Opt-in in-app toasts                                       |
| #10416 | ryanrhughes             | +5,761, 58 files | 53 h     | Android FCM; about 25 review comments                      |
| #11502 | Michel-Liao (unvouched) | +176             | 2 d      | Fix for an accepted issue (#10888)                         |
| #14768 | argofowl                | +225             | 42 h     | A maintainer had requested it publicly                     |
| #14924 | jakeleventhal           | +278/-230        | 24 h     | A contributor objected to the new dependencies             |
| #15037 | scratchyone             | +1,266           | 48 h     | About 40 bot review events                                 |
| #15844 | AKolenda                | +9/-5            | 11 h     | Android recording                                          |

Since 2026-09-30, 79 outside PRs merged (median about 14 h). The post-policy feature merges had a visible maintainer demand signal (#14768, #15037), not an Ideas approval.

**Closed or stalled.** Closed for missing UI evidence: #14829, #14775, #14749. Closed for missing approval: #14841, #14806, #14777, #14796. Closed under one-problem-per-PR: #14826. Duplicates lose: #2373 and #3892 after #11481, #11040 after #11569, and bug #13625 drew four outside PRs, all closed, before a maintainer merged #14213 himself. Open and unreviewed for weeks: #11073, #12289, #12567, #11943, #12699. Silence is the norm in Ideas: explicit go-aheads are rare (#12288: "Feel free to open a PR").

**Notification overlap.** Merged: #11481, #11569, #11570, #10416, #12048 (grouping), #12052 (Android suppresses only the on-screen thread's alert), #14213, #14910. A server-owned visit watermark and a `thread.visit` command exist on V2 (inferred, not verified). Open: #15015 (relay push spam), #12567, #12289, #9901, #16062 (plugin notifications, +41k lines), #15093 (unread divider), #11073. In #15728 a maintainer's triage says retiring a Live Activity on view "would be a product change".

**Effect on the spec.** Several gaps in [notifications.md](./notifications.md) are intended upstream behavior or already in flight, so they are not upstream bugs:

| Gap                                      | Upstream status                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| G3 foreground banner for other threads   | Intended (#12052)                                                                                              |
| G5 focus clears every notification       | Intended; #11569 states it. Decision 6 departs from it, so this change is fork-only unless a maintainer agrees |
| G7 read state in localStorage            | Stale: a server visit watermark exists on V2                                                                   |
| G9 desktop notifications in the renderer | #12567 in flight                                                                                               |
| G10 grouped Android alerts open `/`      | Deliberate (a code comment in `FcmDeliveries.ts`)                                                              |
| G15 per-kind preferences hardcoded       | #9901 in flight                                                                                                |
| G20 doc mismatches                       | Still true on 2026-10-05; no PR                                                                                |
| G16 revoked permission                   | Still in source; no PR                                                                                         |
| G8 cold-start tap                        | Source-read only; never reproduced                                                                             |

## Comparison with environment discovery

Scores run 1 to 5, higher is better. They are the strategist's judgment, not measurements.

| Criterion                                | Notifications                                               | Discovery                                              |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| Fit with maintainer priorities           | 4: their hottest area, but they are building it themselves  | 3: routes just shipped (#15467, #15468); demand exists |
| Smallest valuable slice                  | 4: a docs fix or one bug fix                                | 2: advertiser, browser, UI, and a dependency is XL     |
| Risk to the "never compromise" list      | 4 for the slice; presence heartbeats would cost performance | 3: a new LAN-facing surface                            |
| Independence from fork-only infra        | 3: push needs the relay                                     | 5                                                      |
| Architecture buy-in needed               | 3: the slice needs none; seen and anchors need V2 contracts | 3                                                      |
| Craft visibility                         | 3                                                           | 4                                                      |
| A reviewer can reproduce it in 2 minutes | 4: docs, or one simulator step                              | 2: needs two machines on a LAN                         |
| Duplicate or conflict risk               | 2: crowded, and maintainers re-implement                    | 4: no mDNS PR or issue found                           |
| Reversibility                            | 5                                                           | 4                                                      |
| A cheap, uncontroversial first PR exists | 3                                                           | 1: needs an Ideas approval first                       |
| **Total**                                | **35**                                                      | **31**                                                 |

The margin is small, so weigh the shape, not the sum. Notifications wins because it has a cheap first step that a maintainer can verify against the code in minutes, which discovery lacks. It loses on crowding: the area is saturated and maintainers re-implement contributions, so the first step must be small enough to survive being preempted.

## Showing competence and taste, not saying it

Nothing in a PR, a discussion, or a profile describes the contributor. The work is the evidence:

- **Verified before claimed.** Every statement of a defect has a reproduction. G8 is source-read only today, so the first act is a simulator reproduction, not a PR.
- **The smallest diff that works,** in the surrounding code's idiom, with a test that fails without the change. Name what the PR does not do.
- **Existing patterns, never restyling.** Use `components/ui` variants and sizes; no `className` restyling; layout classes on the parent. Match naming and comment density.
- **Evidence in the maintainers' format.** Same device, same OS, same theme, same viewport for before and after; recordings only where timing matters; PR-only evidence uploaded to GitHub, never committed.
- **Honest limits.** A "not checked" line (physical device, Android) is part of the body.
- **Craft goes into the real interaction first.** A mockup gallery and hero art stay in the fork. If a design reference helps a discussion, attach one frame, label it a mockup, and keep the full set behind one optional link.
- **Restraint as a signal.** One PR at a time, one concern each. No volume, no pings, no claims of endorsement, no fork content.

## Sequence (entry and exit conditions)

| Phase      | Entry                                 | Work                                                                                                                                                                                                        | Exit                                                                  |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| P0 refresh | Always                                | Re-read CONTRIBUTING, the exemption list, and AGENTS.md at upstream main. Re-run the overlap searches. Map V2 seams. Refresh the gap table for the drift above.                                             | A dated seam map; each candidate still absent from open PRs           |
| P1 docs    | G20 still inaccurate and no PR exists | Correct `docs/user/mobile-notifications.md` (foreground alerts: only the on-screen thread's alert is silent) and the grouped-alert sentence in `docs/operations/android-notifications.md` to match the code | Merged, or a specific decline                                         |
| P2 fix     | P1 resolved; one candidate verified   | G8 cold-start tap first, then G16 revoked permission. G8 needs a simulator reproduction first. File a bug issue with the repro, and open the PR only after maintainers triage it (my reading of "triaged")  | Merged, or closed with an answer                                      |
| P3 discuss | P2 merged, or no viable P2 candidate  | Find the canonical thread first (#15728, #7046, #12976, #14153) and add evidence there. Open a new Ideas post only if none fits                                                                             | An explicit approval comment or a decline; silence authorizes nothing |
| P4 tranche | An approval comment exists            | One approved slice per PR, rebased on V2                                                                                                                                                                    | Merged or declined                                                    |

Never run two upstream PRs at once. The fork's phases P1 to P5 are not upstream tranches: the only slices that map are the doc fix, G8, and G16. Fork-only, unless a maintainer asks: the attention item, presence routing, the focus-clearing change, direct APNs, and per-kind preferences (#9901 is in flight).

### PR 1: docs only

Two files. Cite `foregroundNotificationBehavior.ts`, `FcmDeliveries.ts` (line 114), and #12052. If a reviewer would rather change behavior than the docs, accept that and close the PR.

### PR 2: the cold-start tap

Move the handled-id write to after a successful navigation, gate the last-response clear on the same condition, and add a unit test that fails without the change. Evidence: before/after recordings on the same device and OS (inject the notification with `xcrun simctl push`; no relay is needed), plus a statement of what was not checked.

**Title:** `fix(mobile): a notification tapped at cold start opens its thread`

> **Problem.** [one or two sentences with the reproduced symptom, OS, and build.]
>
> **Change.** The tap is marked handled only after navigation succeeds, so a failed attempt is retried. [Why no wider change was made.]
>
> **Scope and approval.** Fixes #[triaged issue]; maintainer triage: [comment link].
>
> **Verification.** `vp test run [file]` fails before the change and passes after. [Before/after recording, same device and OS.] Not checked: [list].
>
> Built with [actual model] through [actual harness].

### Draft Ideas text (P3, only if no existing thread fits)

**Title:** Open a notification at the event it announces

> Tapping an approval or question notification opens the thread, but not the request that asked. Could the mobile deep link carry a request id, and the thread open with that request visible? This builds on the existing `/threads/:env/:thread` link and #15093's unread boundary, adds no new notification surface, and leaves current settings alone. [Attach one capture of today's behavior and one labeled mockup of the proposed result.] Is this acceptable scope, and should it wait for #15093?

## Handling review

Answer each finding with a commit or a reasoned dismissal. Verify bot findings against the source; fix real ones and dismiss false ones in writing. Stop when the bots are green on the latest commit. Rebase on V2 drift, then refresh the recordings. Do not recruit reviewers, ping off-channel, or send promotional messages.

## Stop conditions

- Two PRs are closed on policy with no remedy.
- Both P2 candidates are preempted.
- A maintainer asks to stop.
- V2 drift forces a second rebase of an unreviewed PR.

## Risk register

| Risk                                                      | Likelihood | Mitigation                                              |
| --------------------------------------------------------- | ---------- | ------------------------------------------------------- |
| A maintainer re-implements or supersedes (#13625, #15200) | High       | Smallest diff; check the area right before opening      |
| Review never arrives (#11943, #12567)                     | High       | The stop condition above                                |
| V2 drift                                                  | High       | Rebase before opening; touch no legacy files            |
| Missing UI evidence                                       | Medium     | Evidence first, as in the closures of #14829 and #14775 |
| A docs PR is read as noise                                | Low        | Verified against the code; two files                    |

## Open decisions

1. Start with the docs PR? Default: yes, once instructed.
2. Which P2 candidate? Default: G8 if reproduced, else G16.
3. Post to an existing thread, or a new Ideas post? Default: an existing thread.
4. Run discovery in parallel? Default: no.
5. Name the model and harness in the PR body? Default: yes, as `AGENTS.md` requires.
