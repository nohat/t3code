# Mobile strategy (parked until it is the top friction)

Status: **dormant**. This page is written so the work can start the day it becomes the top priority, with no re-research. It does not compete with `README.md` priorities until an activation trigger below fires.

## Goal and bar

The native T3 Code app is a first-class surface on iPad and iPhone, built from this fork, and updated about as easily as the Mac. On the iPad it stays a separate iPadOS app (own icon, quit and relaunch, windows and multitasking, its own notifications). The bar I set: **no regression from the app I use today.** One refinement from the decisions below: notifications are the single place where that bar is renegotiated.

## Decisions made (2026-10-02)

- **I will enroll in the paid Apple Developer Program** when this activates. It is the one hard requirement (see "What a fork-signed build needs").
- **I will not run my own T3 Connect stack.** All devices reach the server over Tailscale. Reasons: it is not needed for my purposes, and a "sovereign" Connect stack would still depend on two SaaS products, Clerk for identity and Cloudflare for tunnels, so it is not actually home-hosted.
- **The target is the native app**, not Safari. The web client served by the production server stays a free fallback that follows every server deploy.

## Activation triggers

Start this work when any of these is true:

- A fix or feature I need on the iPad is blocked on the official app's release cadence (for example the thread-state fixes in `README.md`, pain 8).
- I notice I am avoiding the iPad for agent work because of friction the fork already fixed on the Mac.
- A native-only capability I want (a gesture, a share target, a widget) cannot be built into the official app.

Lead-time item to do before activation: **enroll in the Apple Developer Program early.** Enrollment is not instant and I do not want it on the critical path. This costs about $99 a year and carries no other commitment.

## What I give up by not using Connect

Found in `docs/user/remote-access.md`, `docs/internals/t3-connect.md`, and `docs/user/mobile-notifications.md`. This is the full list of what Connect provides over Tailscale plus direct pairing:

| Connect provides                                                                                                                                   | Without it                                                                                                                         | Cost to me                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Push notifications and Live Activities.** Background delivery "requires T3 Connect; a direct or Tailscale connection alone does not enable push" | No alerts when an agent finishes, fails, needs approval, or asks for input while the app is closed                                 | **The one real loss.** Addressed below |
| Reach the server with no VPN client on the device                                                                                                  | The iPad needs the Tailscale app connected. iOS runs one VPN at a time, so another VPN on the iPad displaces it (verify on device) | Small; I control my devices            |
| Sign in and see every environment, no per-device pairing                                                                                           | Pair each device once with a QR code or link (`t3 pair`)                                                                           | Small; once per device                 |
| Credentials renewed by a relay broker with DPoP-bound sessions                                                                                     | Pairing sessions authenticated by the server directly, on a private network                                                        | Acceptable on a tailnet                |
| Managed tunnel that survives address changes                                                                                                       | The tailnet address is stable                                                                                                      | None                                   |
| Hosted app at `app.t3.codes` reaching the environment from any browser                                                                             | Use the server's own web client over Tailscale                                                                                     | None for me                            |

Also note what ending Connect changes on the Mac side: the `cloudflared` process running from `~/.t3/tools` and the `clerk-tokens.json` in my data home indicate that I am signed in to Connect today. Moving fully to Tailscale means unlinking the environment and replacing that tunnel with `tailscale serve` for the production server. This is a change to the `t3.tunnel` job in `README.md`, which assumed a tunnel I run myself.

## Replacing push without Connect

Push is the one thing Tailscale cannot provide, so it needs a decision. Options, cheapest first:

1. **Telegram through `agent_inbox`.** Scaffold already delivers to my phone with a handoff queue and a receipt. A small fork-side hook sends "finished, failed, needs approval, needs input" to it. Zero Apple code and works on the iPad today. Cost: the notification opens Telegram, not the thread, and it is a second app. Adding a deep link to the thread (a `t3code://` URL, or an HTTPS link on my own domain) removes most of that friction.
2. **Direct APNs from my own server.** The paid account provides an APNs key. The fork's server gets a small sender and a device-token registration endpoint, and the mobile app registers its token with my server over Tailscale instead of the relay. Live Activities need their own tokens and are a second step. No Clerk, no relay. This is real code in `apps/server` and `apps/mobile`, and I have not sized it; the first task is a spike that reads how the app registers with the relay today (`apps/mobile/src/features/settings` and the server's `agent activity publishing`) and finds the one seam to replace.
3. **Self-hosted Connect (relay, Clerk, APNs).** The path upstream intends (`infra/relay` supports personal stages). Rejected for now: it is the most work, and it depends on Clerk and Cloudflare.

Recommendation: start with option 1 to stop the bleeding, and spike option 2 only if the Telegram detour proves annoying in practice. Whether notifications opening Telegram counts as acceptable regression is my call, and I will make it when this activates.

## What a fork-signed build needs

| Capability                                           | Requirement                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Own icon, windows, multitasking, quit                | Nothing; `supportsTablet` is on and full-screen is not forced                                                                                                                                                                                      |
| Install and TestFlight distribution                  | Paid Apple Developer Program (TestFlight builds last 90 days; a free Personal Team build expires in 7)                                                                                                                                             |
| Widgets and share extension                          | Paid team with app groups. The Personal Team path omits them (`apps/mobile/app.config.ts`)                                                                                                                                                         |
| Sign in with Apple, passkeys, universal links        | Bound to T3's team and domain. I do not need them without Connect; the app must tolerate their absence                                                                                                                                             |
| Own bundle id so it installs beside the official app | Supported upstream (issue #3994, closed). The checked-in config pins `appleTeamId: ARK85ZXQ4Z` and T3's Expo updates URL, so I supply my own through a gitignored env file and a `fork` build profile, never by editing upstream's config in place |

## Build and ship, with no ritual

- **Update channel.** JS changes ship over the air. The config already uses `fingerprint` runtime versions, so an update reaches a binary only when its native project matches. Two ways to host updates: an EAS project of my own (free tier limits unchecked), or a custom updates server on the tailnet using the Expo updates protocol (sovereign, more work). Decide at activation.
- **Native builds.** Build locally on this Mac with Xcode (`vp run ios:release` is the README's self-contained Release path) rather than paying for EAS builds, then upload to TestFlight. EAS builds remain a fallback.
- **One command.** `fork-deploy --mobile` computes the fingerprint against the installed binary. Unchanged: publish an update. Changed: build, upload, and tell me through `agent_inbox` that a new native build is waiting to install. I never choose.
- **Server deploys never need a mobile release.** The mobile client connects to any server and the contracts stay additive.

## Stages (each usable on its own)

1. **Identity.** Paid account enrolled; own bundle id, team, and update channel via env and the `fork` profile. Exit: a fork build installs on the iPad beside the official app.
2. **Direct connection.** The fork app connects over Tailscale with no Connect sign-in. Exit: threads load, send, and stream on the iPad over the tailnet; no regression other than notifications.
3. **Notifications.** Option 1 first. Exit: I am told about finished, failed, and waiting threads on the iPad without opening the app.
4. **Pull to reload.** The resync gesture from `README.md` pain 8, prototyped on a real device first (overscroll past the newest message, fall back to dragging the header).
5. **`fork-deploy --mobile`.** Updates and rebuilds chosen automatically. Exit: a JS fix reaches the iPad within minutes of landing on `fork/prod` with no reinstall.
6. **Retire the official app** once nothing is missing.

Stage 4 does not depend on the others and can be prototyped sooner in the existing dev client.

## Risks to watch

- **Upstream mobile direction.** A separate SwiftUI client is in TestFlight beside the React Native app (upstream issue #13994). If upstream moves, my mobile footprint should be small and additive so a merge does not break it.
- **Dual-app reconnect bugs.** Upstream reports a second T3 app on the same device leaving a client stuck syncing (#13994). Expect it while the official app and the fork app coexist, and retire the official one promptly.
- **Unverified assumptions.** Whether Tailscale on iPad is comfortable all day, whether the app works fully without Connect sign-in, and what the paid-account enrollment lead time is. Check each on a device during stage 2.
