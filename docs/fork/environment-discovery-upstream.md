# Upstream strategy for environment discovery

Status: **research and proposal, 2026-10-05**. No upstream discussion, comment,
PR, or other write was made for this research. This page supports
[the integration proposal](./environment-discovery.md); it does not activate
implementation or authorize an upstream submission.

> **Update 2026-10-05.** The notifications strategist re-read upstream and
> reported drift from this page; verify each at U0 before relying on it: upstream
> main is now `e22c880434`; the triage exemption list has six logins, not three
> (`bmdavis419`, `markflorkowski`, `Yash-Singh1` added); the V2 rewrite (#2829,
> 2026-10-02) is the actual reason legacy-file PRs such as #12675 were closed;
> #15467 made routes multi-valued, so the single-profile statement is stale;
> and #15468 frames LAN use as "pair once through T3 Connect", which an Ideas
> draft should answer directly. The comparison with notifications as a first
> contribution is in [notifications-upstream.md](./notifications-upstream.md).

## Offer a small product improvement

The upstream offer is: **a new device can find an explicitly advertised nearby
environment, then pair through the existing workflow**. Discovery fills in the
address; it does not establish ownership, mint credentials, or change the server's
exposure. Keep CloudKit, Apple same-owner identity, grants, authorizer helpers,
silent pairing, and a persistent device-avatar cluster in the fork proposal.

Show competence through an easy-to-review result: a faithful Connections flow,
precise failure states, a small runtime adapter, measured resource use, and proof
that saved remote connections remain reliable. Show taste through alignment with
the current product: existing typography, spacing, icons, controls, and quiet
interaction. A polished fork-themed hero image can explain the fork vision, but
it should not imply an upstream redesign or be the upstream evidence.

## Research baseline and contribution rules

GitHub research used upstream main
[`1604ccc9d79f5270fb8e14d60664184bf142c4cb`](https://github.com/pingdotgg/t3code/commit/1604ccc9d79f5270fb8e14d60664184bf142c4cb),
resolved on 2026-10-05. Remotes identify this checkout as `nohat/t3code`, with
`pingdotgg/t3code` upstream. The live upstream guide differs slightly from the
checkout; refresh it before any submission.

[CONTRIBUTING.md at that revision](https://github.com/pingdotgg/t3code/blob/1604ccc9d79f5270fb8e14d60664184bf142c4cb/CONTRIBUTING.md)
says review capacity is limited, features require an Ideas discussion with explicit
maintainer approval of direction and scope, each outside PR solves one underlying
problem, and verification must match the changed behavior. Draft status does not
defer these requirements. UI evidence means before/after screenshots and a recording
when interaction or timing matters. Passing triage is not correctness approval or
a promise to merge.

Nearby discovery creates a new workflow; adding an off-by-default setting does not
make it an exception for configuration of an established capability. Obtain
direction-and-scope approval, then link the approval comment itself. A discussion
URL without an affirmative maintainer decision is insufficient. The fork can
continue its own work independently; do not present that as creating an upstream
review obligation.

The [trusted exemption list](https://github.com/pingdotgg/t3code/blob/1604ccc9d79f5270fb8e14d60664184bf142c4cb/.github/TRIAGE_EXEMPTIONS.td)
does not list `nohat`, `scratchyone`, `AKolenda`, `saphid`, or `amanthanvi`.
This establishes only their routing under that policy, not their employment,
personal relationships, or review influence. Public searches for PRs, issues, and
discussions authored by `nohat` in this repository returned none on the research
date. That is a search result, not a claim about David's complete contribution
history, other identities, or private work. Do not lead with unverified reputation
or credentials.

## Six instructive cases

| Case and observed status                                                                                                                                   | Public evidence                                                                                                                                                                                                                                          | Consequence for this proposal                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#15037, shell command highlighting](https://github.com/pingdotgg/t3code/pull/15037), `scratchyone`, merged 2026-10-05                                     | The description supplies screenshots, costs, fallback behavior, and provider/client coverage. Author comments document responding to Discord suggestions and rebasing after the tool-body design changed; the final rendering follows the new layout.    | A community feature can merge. Demonstrate a concrete improvement, follow the evolving product, and update evidence after rebasing. This record does not establish that screenshots caused acceptance or that every feature is welcome.                     |
| [#15844, finished-subagent back navigation](https://github.com/pingdotgg/t3code/pull/15844), `AKolenda`, merged 2026-10-05                                 | A focused follow-up to merged #15068 identifies a second entry point and supplies a Pixel 9/Android 17 before/after recording. Public merged searches also show that author's earlier mobile fixes and performance changes.                              | Repeated useful contributions are observable through specific work. For discovery, test both onboarding and Settings entry points and show the actual platform behavior rather than a checklist. This is a bug-fix example, not feature approval precedent. |
| [#12897, tinted scene backgrounds](https://github.com/pingdotgg/t3code/pull/12897), `saphid`, closed unmerged 2026-10-01                                   | A Julius-authored closing comment explicitly identifies missing product-direction approval while acknowledging useful captures. The author subsequently proposed a smaller scope in [Ideas #6903](https://github.com/pingdotgg/t3code/discussions/6903). | Visual polish and opt-in defaults do not replace product agreement. Reduce the proposal before implementation and offer evidence without claiming permission.                                                                                               |
| [#12675, richer environment icon contracts](https://github.com/pingdotgg/t3code/pull/12675), `amanthanvi`, closed unmerged 2026-10-02                      | Public comments show a reviewed stack, compatibility fixes, repeated rebases, and scoped verification. The closing comment asks for fresh PRs against the V2 rewrite rather than treating the request as resolved.                                       | Even diligent work can lose its integration window. Recheck upstream seams and keep slices small enough to refresh. Closure here is not evidence that maintainers rejected the icon idea or the author's competence.                                        |
| [#8852, Cursor integration/P2P bundle](https://github.com/pingdotgg/t3code/pull/8852), `amaan75`, closed unmerged 2026-09-03                               | The [closing comment](https://github.com/pingdotgg/t3code/pull/8852#issuecomment-5525536520) states P2P remote access is not planned and identifies unrelated transport, rebranding, and installation changes.                                           | Do not wrap discovery in a new transport, Apple trust root, or fork branding. LAN DNS-SD is not the rejected DHT implementation, but keep that distinction concrete and seek approval.                                                                      |
| [#15467](https://github.com/pingdotgg/t3code/pull/15467) and [#15468](https://github.com/pingdotgg/t3code/pull/15468), `juliusmarminge`, merged 2026-10-05 | Upstream now stores multiple routes and learns current LAN/tailnet addresses through an established paired session. The second PR is stacked on the first and completes the same tracked problem.                                                        | The proposal must fit this model. Initial discovery of an unpaired environment remains distinct; maintaining known addresses has already gained a first-party solution. Maintainer-authored scope is not an outside contributor exemption by analogy.       |

These are bounded case studies, not a statistical analysis of acceptance rates.
PR descriptions and author comments are evidence of what was reported; merge
timestamps establish integration, not independent verification of every test claim.
Do not adopt a bot's review instructions as project policy.

## Current overlaps and boundaries

The route work above is the material integration overlap. This checkout's inspected
`connection/catalog.ts` still has the single-profile model, so code pointers in the
fork design are leads rather than a current upstream implementation map. Refresh
against current main before choosing a persistent schema or modifying onboarding.

[Ideas #7030](https://github.com/pingdotgg/t3code/discussions/7030) discusses
environment-managed HTTPS endpoints while retaining Connect discovery and
authorization. Its visible comments include a homelab user distinguishing
new-environment discovery from already-learned VPN routes. No explicit maintainer
approval appeared in the inspected discussion and its first 20 comments. Treat it
as adjacent demand and an opportunity to explain scope, not endorsement of mDNS,
CloudKit, or a no-Connect upstream direction.

Searches for `mDNS`, `Bonjour`, `nearby`, and open `discovery` work found editor-host
configuration and provider/device discovery but no matching LAN environment browser
proposal in the retrieved results. [Ideas #10326](https://github.com/pingdotgg/t3code/discussions/10326)
and [issue #10906](https://github.com/pingdotgg/t3code/issues/10906) concern advertised
editor hostnames; they are reminders not to assume `.local` names work remotely.
GitHub search is indexed, keyword-dependent, and bounded. Repeat before publishing;
absence from these results is not a promise that no work exists.

Replace the main design's broad saved-address prohibition with:

> Untrusted mDNS announcements never directly add, replace, reprioritize, or remove
> saved routes, and never receive an existing credential merely by claiming a saved
> environment ID. This does not prohibit upstream's authenticated learned routes
> obtained through a ready paired session. A discovery candidate enters normal
> explicit onboarding; the approved route-learning and selection machinery then
> owns established connections.

## The upstream-shaped tranche

Offer one coherent end-to-end problem: avoiding address transcription for initial
LAN pairing on desktop. Include explicit server advertising opt-in, listener/interface
eligibility, a minimal bounded TXT format, desktop native browsing, an ephemeral
Nearby section in existing onboarding/Connections, and the normal pairing exchange.
Default off, no auth bypass, no newly exposed listener, no new connection-target
kind, no background browser, no persistent candidate database, and no saved-route
mutation from advertisements. An environment ID check is consistency checking;
it is not a claim of cryptographic server authentication.

Show mobile states and the intended adapter seam in the proposal. Ask maintainers
whether desktop-first delivery is acceptable. A separate mobile PR is appropriate
only if that scope is approved: native discovery, permissions, and physical-device
verification are a real tranche, not a promise that mobile already works. Hosted
web remains without native browsing and retains existing pairing. Preserve
Connect as upstream's supported option; the fork's tailnet-only decision is not
an upstream product premise.

Do not submit isolated contracts or an advertiser-only PR merely to create activity.
If maintainers prefer a stack, agree its review boundaries first, with each layer
focused and testable. Reuse current upstream route/onboarding seams, and leave
future trust broker types out of the discovery contract.

## Evidence and design package

Use four compact artifacts to make judgment easy:

1. **One-page problem and scope.** Show the current address-entry task, the proposed
   select-then-pair task, alternatives already available, and exactly what discovery
   removes. Measure the interaction change in a reproducible setup; do not invent
   savings. Include explicit open decisions and unsupported surfaces.
2. **Product-faithful state sheet.** Existing Connections context, Nearby results,
   empty state, OS-policy failure only when detectable, checking, ID mismatch,
   disappearance, and successful pairing. Include one saved-environment collision
   example showing that existing routes remain intact. Mark mockups as mockups.
3. **Runnable prototype and short recording.** The complete actual pairing flow in
   an isolated environment, including one failure/recovery. Supply equal-size
   before/after captures in dark and light themes with realistic fabricated data.
   Keep animation purposeful; no pulsing radar, rotating scanner, or device-avatar
   theatre. Publish PR-only evidence through GitHub attachments, never commit it.
4. **Engineering note.** Chosen dependencies and measured install/bundle cost,
   bounded browse/resolve state, idle and active CPU/memory/network measurements,
   cleanup behavior, focused checks with dated revision/results, platform matrix,
   and explicit unverified cases. Include listener-family correctness and
   discovery-ID collision tests rather than generic “secure” claims.

The first two support a direction discussion. The prototype and verification note
support implementation review once scope is approved. Current fork illustration
assets are conceptual design material, not proof of native APIs, permission behavior,
or actual performance.

Budget the initial showcase for a 90-second read: a 150–250-word proposal, one
state sheet with at most six frames, and a 20–40-second task recording only when a
prototype exists. These are presentation limits, not performance measurements.
Keep detailed review findings behind one optional link. An approximate HTML/SVG
gallery can explain layout and branching states, but label it “design prototype”
and identify missing native behavior. Pair it later with actual app screenshots
using the same viewport, theme, text scale, and fixture data before and after.
Use readable captions such as “Select address, then enter pairing code,” not
decorative feature slogans. Defer extra hero illustrations and marketing videos
until the direction is accepted; put the craft into the real interaction first.

## Sequence and exit conditions

| Phase            | Work                                                                                                                                                                           | Exit                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| U0 — align       | Refresh upstream SHA, contribution guide, route APIs, and overlap searches; adapt the proposal to the current Connections UI.                                                  | A dated seam map and a clear remaining initial-pairing problem; no duplicate route system.                                        |
| U1 — discuss     | Prepare a concise Ideas draft with the state sheet and existing-workflow comparison. Posting needs David's explicit instruction.                                               | Explicit maintainer direction and scope approval, or a concrete change request/decline recorded. Silence does not authorize a PR. |
| U2 — demonstrate | Build the approved isolated prototype, measure lifecycle/resource behavior, and collect current product-faithful evidence. Fork-only experimentation can happen independently. | Acceptance gates pass on the promised surfaces; unsupported cases are stated.                                                     |
| U3 — review      | Only after explicit instruction to create the PR, submit the approved discovery tranche with the approval permalink and focused verification.                                  | Reviewers can reproduce one complete scenario and inspect a coherent diff without reverse-engineering the fork plan.              |
| U4 — integrate   | Refresh captures after relevant upstream UI changes; verify bot findings, fix real ones, explain false positives, and preserve approved scope.                                 | Maintainers merge or decline. Report actual status without claiming entitlement or readiness from bot approval alone.             |

Do not recruit unrelated reviewers, send personal promotional messages, or make
multiple overlapping PRs to obtain attention. Respond to concrete feedback with
updated artifacts. A concise release/demo clip can become a tasteful public
showcase after approval; it should demonstrate a task and link the implementation,
not advertise the contributor's professionalism or claim upstream endorsement.

## Draft discussion and PR narrative

**Ideas title:** Nearby environment discovery for initial LAN pairing

> A new desktop client currently needs an environment address before it can use
> host/code pairing. Could we add an opt-in DNS-SD advertisement and a Nearby list
> that selects the address, then uses the existing pairing flow? This would cover
> first-time LAN onboarding; #15467 and #15468 already cover routes learned after
> pairing. The proposal preserves Connect and saved route behavior. The attached
> state sheet shows results, empty/error states, and the unchanged pairing step.
> Would desktop-first delivery with a native mobile follow-up be an acceptable
> scope, or should this remain a fork feature?

**PR title, after approval:** `feat(desktop): find nearby environments before pairing`

> A new desktop client can now select an explicitly advertised LAN environment
> before entering its pairing code, avoiding manual address entry. The server
> advertises only when discovery is enabled and its listener is LAN-reachable;
> candidates remain transient and use the existing onboarding and route model.
>
> Direction and scope: [approval permalink]. Verification: [revision, platforms,
> focused commands, observed results, and stated limitations]. Before/after and
> interaction recording: [GitHub evidence].
>
> Built with [actual model] through [actual harness].

Fill every placeholder with real evidence. Keep the body proportionate to the final
change and remove claims that the delivered tranche does not support.
