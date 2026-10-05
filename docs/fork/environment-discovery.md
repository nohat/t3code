# Environment discovery and trusted pairing

Status: **reviewed phased proposal, 2026-10-05; not implementation authorization**.
This replaces the original draft with a proposal integrating nine expert-persona
reviews. It remains fork strategy, like [mobile.md](./mobile.md). Implementation
starts only when this becomes a priority; [posture.md](./posture.md) and `AGENTS.md`
retain their authority. The requested design deliverables accompany the proposal:
[UX specification](./environment-discovery-ux.md),
[visual specification](./environment-discovery-visual.md), and
[mockup gallery](./environment-discovery-assets/gallery.html), and
[upstream contribution strategy](./environment-discovery-upstream.md).

## Recommendation

Ship opt-in local discovery with existing pairing first. Treat approved-device
pairing as a separate extension with its own native feasibility and trust gates.
The fork's transport remains Tailscale; mDNS finds local candidates and does not
provide tailnet discovery, authorization, or authenticated server identity.

The original goal was selecting a same-owner device with no host step. The reviews
show that CloudKit membership alone cannot safely establish that authority. The
recommended baseline is **one approval per device installation, then reconnect
without another host step**. This is a proposed change to the original product
promise, not a decision attributed to David. Fully automatic enrollment remains an
explicit product decision, deferred from the baseline.

Discovery reduces address entry during initial setup. Approved-device enrollment
replaces transferring a pairing credential with reviewing a registered device on
the Mac; existing saved sessions already reconnect without repeat pairing. Activate
trust only if that substitution removes observed friction worth CloudKit, key
lifecycle and recovery costs. Compare task steps/failures for link/QR, Nearby-assisted
pairing and approved enrollment; no analytics subsystem is needed.

Each discovery phase leaves QR/link/code pairing usable. No phase needs a Connect
stack, a cloud login, or CloudKit to discover a LAN server. The trust extension uses
an authenticated Tailscale HTTPS origin and existing proof-bound sessions. It does
not invent an encrypted transport or make LAN HTTP trusted by signing a descriptor.

## Expert reviewer roster and integrated revisions

These are review personas, not endorsements by named external experts. Agents were
primed separately for each role; worker slots are reused between assignments.

| Persona                                            | Review remit                                                                           | Revision integrated into this proposal                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| DNS-SD/network reliability engineer                | Wire format, interfaces, collisions, lifecycle and resource use                        | Actual-listener advertising, minimal TXT, bounded transient browsing, advertiser/browser spike                   |
| Authentication and trust protocol engineer         | Server authentication, device possession, grant/session revocation                     | Descriptor checks are consistency only; HTTPS trust; approved keys; cascading revoke with remote acknowledgement |
| Apple native identity engineer                     | CloudKit, local keys, entitlements, signing and account lifecycle                      | Account-scoped directory, non-synced keys, distribution-build spike, account-change and recovery semantics       |
| Mobile connectivity engineer                       | iOS/Android permissions, native adapters, lifecycle and VPN coexistence                | Platform-specific status, foreground/view-scoped discovery and physical-device gates                             |
| Repository architecture and compatibility reviewer | Existing seams, persistence, IPC/contracts and client parity                           | Thin adapters, transient discovery store, additive capabilities and onboarding validation                        |
| Product scope and rollout reviewer                 | Value, dependencies, incremental release and reversibility                             | Discovery/trust separation, useful stopping points, deferred broker generalization and avatar cluster            |
| Upstream merge strategist                          | Current maintainer policy/work, contribution history and successful community features | Evidence-based proposal sequence and engineering/design showcase, separated from fork-only trust                 |
| UX designer                                        | Journeys, navigation, copy, permissions, consent, recovery and accessibility           | Whole-project flow/state specification with stable screen IDs and truthful action states                         |
| Visual/product designer                            | Screen hierarchy, responsive layouts, assets and theme integration                     | Reviewable screen gallery and reusable SVG assets; upstream appearance remains the default                       |

## Constraints and corrected assumptions

- Advertising stays **off by default**, including after Network access is enabled.
  Discovery never changes the bind, firewall, Tailscale ACLs, or exposure mode.
- A descriptor's `environmentId` and protocol version can catch accidental mismatch;
  an attacker can copy both. TXT and descriptor labels are presentation metadata.
- A discovered candidate cannot mutate a saved endpoint or receive its credential.
  Choosing a saved environment uses its saved route. Manual address editing stays a separate explicit action; user confirmation alone
  is not cryptographic authentication. Authenticated upstream route learning is a
  different source of endpoint authority and must remain supported.
- Nearby means the current local link. An empty list says nothing about a remote
  environment's availability. There is no multicast relay or tailnet enumeration.
- CloudKit private records are scoped to an account and app container. They do not
  attest a person, physical device, or which device wrote a record. Separate Apple
  Accounts in Family Sharing do not implicitly share a private database.
- CloudKit carries public records and signed grants. Private device and authorizer
  keys remain local and non-synchronizing; synced Keychain credentials and passkeys
  have different possession/revocation semantics and are outside this baseline.
- Native CloudKit is Apple-specific here. Web APIs exist, but cross-platform CloudKit
  login is excluded; Android, web, and non-Apple desktop keep existing pairing.
- CloudKit storage consistency is distinct from asynchronous refresh, stale caches,
  notification delivery, and offline clients. A cached row is not an enforcement receipt.

These corrections follow [Apple's private database model](https://developer.apple.com/documentation/cloudkit/ckcontainer/privateclouddatabase),
[CloudKit design guidance](https://developer.apple.com/icloud/cloudkit/designing/),
and [Secure Enclave key guidance](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave).

## Upstream baseline and contribution boundary

The upstream strategist found new route-catalog/authenticated endpoint-learning work
merged on 2026-10-05: [#15467](https://github.com/pingdotgg/t3code/pull/15467) and
[#15468](https://github.com/pingdotgg/t3code/pull/15468). The local source inspected for
this proposal predates those seams. D0 must reconcile current upstream before
choosing permanent contracts, catalog integration or route policy. An unpaired
mDNS observation cannot claim the authority of an address learned over an
authenticated connection. Do not duplicate the new route catalog.

The proposed upstream tranche is discovery-assisted **initial** pairing, subject
to maintainer interest and explicit contribution approval. Apple trust and broker
work remain fork-only unless separately invited. The
[upstream strategy](./environment-discovery-upstream.md) records dated research,
community case studies, an Ideas-first approach and the evidence package. No
upstream discussion, issue comment or PR has been submitted by this task.

## Track D — discovery with existing pairing

### Wire protocol and reachability

Use `_t3code._tcp.local.`. Let the selected responder probe and own its service/host
names and resolve collisions; do not blindly append `.local` to the OS hostname.
Instance display name is `<label> · <shortId>`, truncated on a UTF-8 boundary to
63 bytes while preserving the suffix. Use the actual bound HTTP port, never an
intended/configured port that may have shifted.

Publish address records only for eligible LAN interfaces on which the actual
listener is reachable. First release is explicitly IPv4-only, matching desktop's
current `0.0.0.0` listener. A specific-address listener publishes only that eligible
address. Loopback-only and tailnet-only listeners publish nothing. Dual-stack/IPv6,
including scoped-address handling, needs its own measured support gate.

Interface enumeration belongs in the adapters. If server and desktop share address
policy, extract a small pure helper; the current private desktop IPv4 helper is
not a reusable server dependency or a complete interface-selection policy. Exclude
internal, link-local IPv4 and tailnet interfaces/addresses; explicitly establish the
policy for VPN, bridge and container interfaces during the spike.

TXT v1 contains only `txtvers=1`, `id`, and `proto`. No secrets, scopes, project names,
sessions, OS/architecture/machine inventory, arbitrary URL, path, or key fingerprint.
Use a fixed root HTTP origin and the existing descriptor path. Unknown keys are
ignored; key matching is case-insensitive and duplicate keys follow first-occurrence
semantics. Reject malformed required values and unsupported TXT versions.

Each TXT constituent fits 255 bytes including `key=`. Proposed operational budget:
target 200 bytes total, hard encoder cap 400 bytes; these are engineering budgets,
not DNS protocol maxima. Names and encoding follow [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763.html).

### Advertiser and browser lifecycle

Select publisher and browser independently. `@homebridge/ciao` is an advertiser
candidate, not proof of a browsing API; `bonjour-service` is another candidate.
Prove system Bonjour interoperability, UDP 5353 coexistence, interface filtering,
collision renaming and cleanup before choosing dependencies. Native feasibility is required only for the platform
being activated; desktop discovery does not depend on paid Apple enrollment.
Build no custom mDNS stack.

Advertising starts after the listener and authenticated environment policy are ready.
Refuse `unsafe-no-auth`. Reconcile changes to bind, port, label, interfaces and
sleep/wake. Withdraw on disable or orderly shutdown; cleanup sockets, subscriptions
and timers idempotently. Advertising failure is a diagnostic with capped retry,
never a server failure or a reason to disconnect saved clients. Abrupt termination
uses library cache expiry, consistent with [RFC 6762](https://www.rfc-editor.org/rfc/rfc6762.html).

Browse only while a discovery view is visible and the client is foregrounded.
Share a client-level browse session through view leases: one window closing does
not stop another; the last lease or renderer failure releases native resources.
Use an atomic subscribe-with-snapshot or revision ordering so initialization cannot
lose updates. Browsing availability is a client capability even when disconnected
or connected to an older server; advertising status is a separate per-server fact.
Keep raw service identity plus interface and alternative addresses; remove on
library removal/expiry. Group claimed environment IDs provisionally for display,
without allowing a spoofed ID to hide a saved row or discard competing endpoints.
Selection revalidates the current candidate; disappearance cannot leave a stale
selection silently sending credentials somewhere else.

Proposed initial bounds: 128 raw candidates, 32 displayed groups and four concurrent
explicit descriptor inspections. No fetch for every announcement. Cancel obsolete
requests, set finite request deadlines, coalesce repeated snapshots, and expose
truncation/failure rather than enqueueing unbounded work. Tune budgets from measured
CPU, sockets and multicast traffic rather than treating these numbers as platform facts.

### Onboarding boundary

Candidates live outside `EnvironmentRegistry` and credential persistence. No
`"discovered"` catalog source or new connection target is needed just to show Nearby.
Only successful existing onboarding creates a saved connection.

Add an optional selected-candidate expected environment ID to pairing preparation.
Fetch the descriptor, compare that ID and check protocol compatibility **before**
exchanging the pairing credential or persisting the registration. The current
`registerPairing` input does not carry this ID; the saved resolver's ID check does
not cover initial onboarding. Re-fetch on selection and reject endpoint-changing
redirects for credential operations.

Discovery only fills the host field for existing QR/link/code pairing. It does not
remove the code requirement. Present the endpoint and ordinary pairing trust
assumptions clearly. Existing manual LAN pairing remains possible with its current
transport limitations; matching an ID must never be labeled “verified” or “trusted.”
No saved token or automatic grant goes to a newly discovered HTTP origin.

Mobile adapters are selected against the pinned Expo/RN native build. Prefer
Network.framework on Apple platforms and Android `NsdManager`; evaluate a wrapper
first, then a small Expo Module matching the existing local module pattern if needed.
Add `_t3code._tcp` to `NSBonjourServices` (without `.local`). Browse state and
permission evidence are separate: an empty scan never proves denial. Open Settings
is shown only when native evidence supports that reason. Android permissions depend
on OS/target SDK and API; do not acquire an app multicast lock automatically for NSD.

Own the native session by route focus, explicit Nearby activation and app active
state, not component mount alone. Stop/cancel on blur, inactive/background and
module destruction. Generation-tag callbacks so old results cannot repopulate a new
session. Network changes refresh candidates independently of saved connections.
Test Wi-Fi changes, cellular-only, guest isolation and Tailscale on/off without
changing the user’s VPN configuration. Native config/module changes require a new
fingerprinted binary, not a JS-only OTA update.

### Platform and surface coverage

| Surface/path                                     | Discovery                                                          | Required behavior                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Desktop Connections and Welcome/add-environment  | Electron main-process adapter, typed bridge snapshots              | Same Nearby picker and existing onboarding; teardown when view closes            |
| iOS/iPadOS Connections/add-environment           | Native Bonjour adapter                                             | Purposeful permission request, denied/unknown/error states, manual fallback      |
| Android Connections/add-environment              | Native NSD preferred during spike                                  | API-specific permission handling; multicast lock only if implementation needs it |
| Hosted and local browser web                     | No browser mDNS adapter                                            | Existing manual/QR/link flow; hide Nearby rather than a broken permission prompt |
| Desktop Network access settings                  | Advertising status/toggle                                          | Off initially; unavailable explanation for loopback/tailnet-only/no-auth bind    |
| Saved environments, command palette, keybindings | Existing connection actions                                        | Use saved route; route add-environment actions to the common flow                |
| Providers and scheduled turns                    | Unchanged                                                          | Discovery is connection setup, not provider orchestration                        |
| Agent/MCP access                                 | Advertising status/config via existing service boundary if exposed | No discovery browser/tool requirement until a real agent use case exists         |

Hosted HTTPS cannot generally connect to LAN HTTP without browser restrictions;
that is separate from the absence of a browser mDNS API. Do not invent a server-side
browser proxy to compensate. Old clients ignore additive discovery capability/status
fields. New clients show unsupported/manual fallback against old servers.

## Track T — approved-device trust (optional)

### Server authentication before authorization

Trusted enrollment uses a directory-provided, certificate-validated Tailscale HTTPS
origin with a full `.ts.net` hostname. Provision that origin through an existing
trusted local/SSH path; directory records cannot overwrite an already enrolled
origin or authorizer. First contact explicitly trusts the owner-controlled account
and directory publication; approval of client keys is a separate authority decision.

The client validates the origin's certificate and descriptor/environment association
before sending proofs or grants. No insecure redirects, LAN HTTP fallback, or TXT
origin substitution. TLS authenticates the host; the descriptor checks the selected
environment at that host. A separate environment identity key is deferred unless
a real deployment needs more identity separation. Direct LAN acceleration requires
a concrete secure-channel proposal first. See [Tailscale HTTPS requirements](https://tailscale.com/docs/how-to/set-up-https-certificates).

### Directory, keys and approved enrollment

Use one authorizing Mac first, with a local authorizer key and a device key per
installation. CloudKit registry rows are enrollment requests, not access grants.
The Mac approves a specific key once through a visible interactive action; signing
under user-presence protection cannot also be promised as silent background work.
Keep key labels mutable and thumbprints stable authorization identities.

Prove the fork's own macOS/iOS signing targets, app identifiers, shared CloudKit
container/environment and distribution entitlements. A native helper is a candidate,
not a predetermined architecture. Sign in with Apple is not required to use the
existing iCloud account. Secure Enclave P-256 feasibility, supported hardware,
locked-state signing, cancellation and key loss are spike outputs.

Partition caches by container, environment and account. Account changes stop new
account-based enrollment and clear registry caches before refresh. Sign-out is not
revocation of grants already issued. Manual pairing continues through offline,
quota and account failures. A new installation/key loss requires new enrollment.

### Grant exchange and reuse of existing auth

A versioned signed grant binds grant ID, environment ID, locally enrolled issuer
key ID/authorization epoch, device key thumbprint, existing auth scopes and validity
interval. Each issuer has a locally configured scope ceiling. Validate issuer,
environment, signature, expiry, revocation and scope subset locally.

Exchange the grant using device proof of possession and a short-lived, single-use
bootstrap challenge bound to environment, grant, key and purpose. Issue an existing
DPoP-bound `AuthSession`; do not introduce a parallel session system. Reuse the
current DPoP checks and replay persistence. DPoP supplements an authenticated channel;
it does not encrypt traffic or authenticate the server ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)).

Store grant lineage on sessions/tickets. Define WebSocket ticket replay rules and
active-socket enforcement explicitly; a proof-bound HTTP token does not automatically
make an established socket proof-bound. Descendant sessions and tickets never outlive
the grant. Decide one lifetime/renewal default before implementation; expose its
remaining validity in device management, not a new online revocation dependency.

### Revocation, rotation and recovery

“Revoke device” is one action at each enforcing environment: persist the revocation,
block future grant exchange, revoke descendant sessions/tickets, disconnect active
sockets, then return an enforcement receipt. An agent action already dispatched is
not retroactively undone. Undoing revocation requires fresh enrollment; merely
reappearing in the registry never restores authority.

Remote revocation is **pending until the target acknowledges it**. An offline target
cannot know a new revoke; expiry bounds the remaining authority. Display last
acknowledgement, maximum remaining validity and per-environment enforcement state.
No claim of immediate offline revocation or of “revoked everywhere” from a CloudKit write.

Authorizer trust is installed/rotated via authenticated local or SSH provisioning,
with fingerprint and scope ceiling recorded at the target. CloudKit record edits
cannot enroll a replacement root. Lost-authorizer recovery uses that same existing
access to replace the root, retire old grants/sessions and publish fresh records.
Unreachable targets remain pending. Include restart and stale-record tests.

### Non-Mac environments and deferred scope

After Mac-only grants work, enroll one Linux/Windows environment through existing
SSH provisioning. It verifies grants against its local issuer trust state and is
usable while the authorizing Mac sleeps. New approval/revocation delivery still
needs an available route; there is no callback to the Mac on every connection and
no data proxy. Direct native CloudKit on the non-Mac server is unnecessary.

Defer generalized brokers, multiple authorizers, cross-account sharing, automatic
future-device enrollment, cross-platform CloudKit login, passkeys and persistent
avatar clusters. Existing Connections/device management is sufficient first.
Connect is a useful architectural reference, not an assertion that its current
credentials already implement this proposed grant format.

## Phased integration and acceptance gates

These are local, focused proofs required by the feature, not new workflow tooling.
Backend changes need behavior tests; UI verification follows the fork's isolated-state
agreement. Physical devices are required to prove multicast behavior; simulators alone
are insufficient. No repo-wide checks or live-data writes.

| Phase                                  | Deliverable and dependency                                                                                                                       | Exit proof and stopping point                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0 — feasibility and design            | Reconcile latest upstream route catalog first; choose publisher/browser independently; map listener/interfaces, native APIs and design artifacts | System Bonjour interoperability; actual bound port; UDP coexistence; IPv4-only truth; collision/removal; documented platform support. Stop if LAN discovery does not reduce observed setup friction                                                         |
| D1 — server opt-in advertising         | Minimal codec/config, status service and scoped publisher; depends D0                                                                            | Off by default; precedence tests; no auth/loopback/tailnet-only refusal; cleanup/reconcile/nonfatal failure; packet inspection on eligible interfaces. Enabling infrastructure; complete benefit requires a supported browsing client                       |
| D2 — desktop discovery                 | Main-process adapter/IPC, transient store, shared picker, expected-ID pairing validation; depends D1                                             | Saved spoofed ID receives no credential; duplicate/collision/expiry/cancellation bounds; Connections and Welcome parity; successful normal pairing only persists. D1+D2 is a complete desktop release; stop here if it solves the friction                  |
| D3 — mobile discovery                  | Native adapters/config, permission/lifecycle UI; depends stable D2 seams and signed native build availability                                    | Physical devices for each claimed platform: grant/deny/recovery, foreground/resume, Wi-Fi/VPN on/off, service loss, no resource leak; manual pairing intact. Ship iOS independently with Android manual fallback if needed; discovery track can finish here |
| T0 — Apple feasibility                 | Fork-signed macOS/iOS component, harmless shared-container records, local key signing; independent of D3                                         | Intended distribution builds exchange records; second account isolated; dev/prod separated; no upstream container; account switch/offline/locked/cancel/key loss behavior observed. No access issuance; a no-go is a complete spike outcome                 |
| T1 — directory and authenticated route | Public environment/device records, trusted HTTPS origin and pinned local issuer setup; depends T0                                                | Registry cannot grant authority or overwrite enrolled trust; wrong cert/host/environment or insecure redirect rejected; manual fallback; no automatic LAN downgrade                                                                                         |
| T2 — Mac approved grants               | One-device approval, grant exchange into current sessions, device inventory, cascading revoke/recovery; depends T1 and chosen lifetime policy    | Wrong key/issuer/environment/scope/expiry/replay rejected; active HTTP/socket/tickets revoked; restart preserves revoke; repeated connects need no host action; lost-root recovery works. Complete Mac/Apple-client trust release; broker not required      |
| T3 — non-Mac authorizer                | Single SSH-enrolled remote environment, acknowledged revoke/rotation and bounded offline expiry; depends T2                                      | Mac sleep does not interrupt existing authority; remote revoke honestly pending then enforced; stale grants fail after expiry/revoke; SSH enrollment authenticates target and issuer                                                                        |
| Later, only by decision                | Automatic enrollment, LAN secure transport, persistent device cluster, generalized brokers                                                       | Each needs a concrete friction exhibit and separately reviewed trust/UX change                                                                                                                                                                              |

Proposed CLI/config shape: `--mdns` / `--no-mdns` and `T3CODE_MDNS`, through
`sharedServerCommandFlags` for root/start/serve. Preserve absent versus explicit
false. Test flag → environment → desktop bootstrap/persisted preference → off,
including explicit disable overriding enabled inputs. Thread through `ServerConfig`,
bootstrap decoding and config fixtures; old bootstrap fields default false. Desktop's `localNetworkDiscoveryEnabled` is
independent of exposure; turning exposure off withdraws publication but does not
silently reset the preference. Show configured intent and current availability. D0 chooses either existing desktop
relaunch semantics or a scoped live advertiser setter. If relaunch is needed, disclose
it before applying; a preference write alone cannot claim publication stopped.
A live setter must acknowledge withdrawal without restarting active sessions.

Advertising belongs to an actual backend/environment ID, not the currently selected
connection. First desktop UI controls the primary local backend only; other managed
backends need explicit per-environment support. WSL/container publication is unavailable
until host address/port mapping to the real listener is demonstrated. A Windows shell
must never publish a WSL NIC merely because it exists.

Discovery acceptance ends the discovery task. Signing readiness enables the T0
spike only when activated; it does not automatically activate T1–T3. T3 starts only
for a concrete non-Mac environment need. Hardware support, libraries and cache
budgets are engineering conclusions from feasibility evidence, not new approval gates.

## Integration seams and data effects

- `packages/contracts`: only payloads crossing server/IPC/native boundaries; optional
  capability/status additions with safe defaults. Do not place runtime enumeration here.
- `packages/shared`: pure TXT codec and address/listener eligibility where actually shared.
- `apps/server`: scoped advertiser service and thin config/transport wiring. Before auth
  implementation read [Effect services](../internals/effect-services.md).
- `packages/client-runtime`: transient discovery snapshot/subscribe seam and selected-ID
  onboarding validation; keep existing catalog/credential model intact for discovery.
- `apps/desktop`: publisher bootstrap, main-process browsing and validated IPC with
  subscription teardown. Methods are optional for old shells; validate payloads and
  close view leases on renderer failure. The cached pull/keepAlive network-access
  atom is not a discovery subscription model. Renderer consumes normalized state.
- `apps/mobile`: native adapters and app config; foreground/view lifetime and truthful
  platform permission results. Native configuration changes require a matching binary.
- `apps/web`: shared add-environment UI and device administration; no browser mDNS source.
- Export codecs/runtime seams via explicit package export maps and contracts schemas
  through supported exports. Browser/mobile bundles cannot import Node networking.
- Trust later extends `EnvironmentAuth`, session/ticket lineage and auth persistence
  via additive registered migrations, service methods and enforcement receipts. It
  does not default to the orchestration event model. Reuse `subscribeAuthAccess`
  snapshot/change semantics; new grant variants require compatible decoding or a
  separately gated stream. Reconnect recovers state; environment switches cancel
  old subscriptions; inventory/revoke require administrative authority. HTTP/IPC/MCP
  handlers call those methods rather than owning grant policy.

Discovery requires no saved-connection or credential migration and does not rewrite
existing data. Trust migrations must preserve existing manual sessions and enroll no
issuer/device implicitly. Rollback disables advertising/browsing without removing
saved connections. Trust rollback first revokes newly issued authority through the
still-running enforcing server; a feature flag alone is not a revocation mechanism. Use nullable grant lineage for
old manual sessions. Test migrations on a copied database and prove the intended
previous binary can open it before downgrade. Preserve revocation history and
outstanding remote enforcement; hiding the new UI cannot restore revoked authority.

## Product decisions still open

1. Is LAN discovery enough observed value to activate, given stable saved Tailscale
   endpoints? Discovery acceptance does not authorize the trust extension.
2. Accept the proposed one-time approval baseline, or explicitly choose account-control
   trust for automatic future-device enrollment? The safer baseline is the recommendation.
3. When to activate fork signing/paid Apple enrollment, consistent with [mobile.md](./mobile.md)?
4. Choose the grant lifetime/renewal policy after the native spike;
   the policy must bound disconnected-target revocation.
5. Is the persistent device cluster useful enough beyond Connections to ship later?
   The UX/visual assets illustrate it as optional, not a release dependency.

This review request does not enroll accounts, buy services, deploy changes, or implement
any runtime feature. The design specs and mockups are proposed behavior, not evidence
that the application already supports it.
