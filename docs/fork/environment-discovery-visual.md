# Environment discovery: proposed visual specification

Status: **proposed, 2026-10-05**. Companion to [the integration proposal](./environment-discovery.md) and [the UX review](./environment-discovery-ux.md). These are review artifacts, not implemented product UI or verified screenshots.

See the [rendered overview](./environment-discovery-assets/overview.png) or [editable overview SVG](./environment-discovery-assets/overview.svg). Open the [self-contained HTML gallery](./environment-discovery-assets/gallery.html) locally. It contains desktop and mobile mockups, light/dark controls, and a separately selectable warm-brutalism preview. It loads no fonts, libraries, images, or data from the network. Screen actions are illustrative; they announce that no real changes occurred. [The manifest](./environment-discovery-assets/manifest.json) lists screens and reusable SVG assets.

## Visual review and recommendations

Use the existing Connections settings as the home of discovery. Append a Nearby section after Saved environments, with manual pairing available even when discovery is denied, unsupported, empty, or failed. Nearby is an address suggestion, so its visual treatment stays neutral. Never give a discovered row a green shield or imply a device name is authenticated. A saved-environment match offers **Open saved connection** and uses its saved route.

Show connection, authorization, and discovery as separate facts. **Connected** describes a live authenticated session; **Allowed** describes an unexpired accepted grant; **Nearby** describes a service advertisement. None implies the others. A disconnected allowed device remains allowed. A CloudKit registry entry remains **Not allowed** until approved. Avoid a combined “trusted online” badge.

For the gated trust track, use a deliberate review panel that names one environment, one installation, its access preset and expiry before **Allow device**. Expand the preset into a plain description of agent operation; do not hide remote code execution behind a generic “Continue.” Native authentication appears through the OS, not a custom simulated biometric dialog. **Not now** dismisses a request; persistent denial policy remains deferred.

Revocation gets a confirmation, a pending state, and a confirmed state. Pending remote enforcement has amber text, a last-confirmed timestamp, and the remaining expiry window. The word **Revoked** appears only after the enforcing environment confirms it. Ending a session is a distinct secondary action; the product-level **Revoke access** action can revoke the grant and terminate its linked sessions while reporting both outcomes.

Trusted-origin or authorizer identity mismatch is a blocking recovery panel with expected/received identities in expandable details. A separate environment signing-key protocol remains deferred. It offers cancel and recovery through a previously trusted enrollment route; it has no generic “Continue anyway.” Errors remain readable beside the affected action and preserve user-entered values.

Do not add a persistent avatar cluster in the initial discovery release. A device count would collapse three meanings—registered, allowed, connected—into an ambiguous number. Begin with Connections settings. Any later title-area indicator counts confirmed active sessions only, has a text label, and opens the same device-management surface.

## Screen inventory

| ID    | Surface and purpose                                      | Phase / state                                  |
| ----- | -------------------------------------------------------- | ---------------------------------------------- |
| D01   | Desktop Connections: saved routes plus Nearby candidates | Discovery; mixed saved and unpaired candidates |
| D02   | Candidate details and setup handoff                      | Discovery; untrusted reported identity         |
| D03-M | Mobile permission recovery                               | Discovery; local network access denied         |
| D04   | Server advertising setting                               | Discovery; explicit opt-in off                 |
| D05   | Desktop existing host/code pairing                       | Discovery; prefilled address                   |
| D01-M | Mobile nearby list and manual methods                    | Discovery; native navigation                   |
| D05-M | Mobile existing pairing form                             | Discovery; expired-code recovery copy          |
| T01   | Mac device approval                                      | Gated trust; registry request not allowed      |
| T02   | Device grant and live sessions                           | Gated trust; allowed + connected               |
| T03   | Remote revoke delivery result                            | Gated trust; pending enforcement               |
| T04   | Environment identity recovery                            | Gated trust; identity mismatch                 |
| T05   | Non-Mac authorizer enrollment                            | Later broker; authenticated SSH bootstrap      |
| T02-M | Mobile grant and session management                      | Gated trust; native management variant         |
| D06   | Browser manual pairing fallback                          | Existing pairing; no native Nearby list        |
| S01   | Empty, unavailable, expired and confirmed states         | State inventory; all phases                    |

The gallery illustrates these screens as review panels, not the entire desktop application shell. Dialog placement, native headers, and scroll behavior must reuse the real components during implementation. Permission prompts, biometric prompts and OS settings remain native and are intentionally not recreated. Seven-day expiry is a mockup placeholder, not a product decision.

## Layout and typography

**Desktop.** Existing Settings page width governs the product. Content sections use 24px separation, rows use 16px vertical padding, and leading icon/text/action groups use 12px gaps. Dialogs target 480–560px wide and cap at the viewport minus 32px; long content scrolls within the dialog. Heading 20/28px at weight 600, row label/body 14/20px, subordinate explanation 12/18px. Pairing host and fingerprint text use a system monospace where useful and wrap without clipping. Keep the existing default 10px base radius and existing button/input variants. The gallery’s 28px panel padding is presentation framing, not a new global settings token.

**Mobile.** Target a 390px phone reference, 20px horizontal content padding, and at least 44px touch targets. Native form cards follow the existing 24px rounded Connections form. Use the OS text system and font scaling; normal body is 16px minimum in implementation, with subordinate text 14px minimum. The gallery uses smaller text to compare compact desktop panels and must not be copied as React Native type tokens. At narrow widths, long names wrap before actions; actions can occupy a full-width row. Tablet uses native form sheets with bounded readable width, not a stretched phone card. Allow safe areas, keyboard avoidance, and multiline localized labels.

**Spacing.** Use existing component layout first; the proposed local rhythm is 4/8/12/16/24/32px. Desktop controls target 36px in this gallery; real controls choose existing size variants. Native controls remain at least 44px. No whole-row hover behavior should be inferred from static mockups. Row actions and menus are separately named controls.

## Colors, profile separation, and icons

The baseline uses existing `background`, `card`, `foreground`, `muted-foreground`, `border`, `primary`, `warning-foreground`, `error-foreground`, and `success-foreground` roles. In the portable gallery, zinc surfaces and a blue primary approximate those roles; these are not exact screenshot-parity claims. Dark mode uses brighter text and state colors while preserving surface hierarchy. Decorative row separators may remain low contrast; interactive boundaries and focus rings need stronger contrast.

Warm brutalism is an explicit optional gallery profile. It previews Ledger page/panel/ink/action tokens from `design/tokens.json` and 4px radii. It does not make the unresolved icon grammar, type-family loading, density wiring, or profile activation in `design-system.md` normative. Do not ship these gallery values as global overrides. Default appearance stays upstream.

Reusable assets use a 24×24 viewBox, 1.5px strokes, round caps and joins, and `currentColor`. Render at 16–20px for controls or rows and 48–56px for empty-state illustration. Files: [nearby](./environment-discovery-assets/nearby.svg), [environment](./environment-discovery-assets/environment.svg), [device](./environment-discovery-assets/device.svg), [grant](./environment-discovery-assets/grant.svg), [pending](./environment-discovery-assets/pending.svg), [mismatch](./environment-discovery-assets/mismatch.svg), [broker](./environment-discovery-assets/broker.svg), [offline](./environment-discovery-assets/offline.svg). These code-native drawings are proposed assets. Production should prefer corresponding existing Lucide/SF Symbols where available to preserve platform grammar, rather than installing a second icon system.

A shield/check belongs only with confirmed grant state. Radio arcs mean discovery, never trust. A clock means waiting or expiry and always has text. Do not use signal bars, pulsing dots, radar sweeps, or location-map graphics: no measured proximity or distance exists.

## State treatments and accessibility

- Initial discovery: static “Looking for environments…” text, cancel or manual setup available. No continuously repainting spinner or radar animation.
- Empty result: neutral text with refresh and manual entry. No assertion that a server is offline.
- Permission denied: native settings route plus manual pairing; do not repeatedly reopen the system permission prompt.
- Unsupported hosted/local browser: omit Nearby from primary navigation; manual pairing remains. Help may explain native discovery availability.
- Candidate vanished or probe failed: retain explanatory context, allow retry/manual host entry, and never silently substitute another endpoint.
- Approval waiting: clock + “Awaiting approval”; no success color and no indefinite claiming of connection progress.
- Revocation pending: amber text + timestamp + bounded expiry explanation; existing credential validity must not be misrepresented.
- Revoked: confirmed text; retain enough device details to explain history and offer the intended re-enrollment path.
- Expired grant or account unavailable: clear cause and approved renewal/manual fallback, without granting access from stale cache.
- Identity mismatch: red text plus warning silhouette, blocked credential submission, explicit trusted recovery.

Use semantic section headings, accessible button names containing the environment/device name, labeled fields, and visible keyboard focus. Actual dialogs trap focus, restore it to the originating row, support Escape where safe, and announce results with a concise polite live region. Do not announce every discovery packet or last-seen update. A disruptive mismatch should announce once when it blocks a user-requested connection. Preserve focus if candidates arrive, disappear, or reorder.

Text contrast targets 4.5:1 for normal text and 3:1 for large text; focus/control boundaries target 3:1. Status uses words and optional shapes alongside color. Fingerprints, URLs, expiry and names remain selectable, wrap, and have screen-reader labels. Scope details are plain language with advanced identifiers secondary. Support 200% web zoom, Dynamic Type, keyboard navigation, VoiceOver/TalkBack, and reduced motion. There are no animations in these artifacts.

## Source mapping and implementation constraints

| Concern                                                | Existing source / proposed seam                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop/web Connections structure and clients          | `apps/web/src/components/settings/ConnectionsSettings.tsx`, `settingsLayout.tsx`, `EnvironmentRow.tsx`                               |
| Standard UI primitives                                 | `apps/web/src/components/ui/{button,input,dialog,alert-dialog,switch,empty}.tsx`; use variants, never feature-specific restyles      |
| Baseline color roles                                   | `apps/web/src/index.css`                                                                                                             |
| Optional profile                                       | `docs/fork/design-system.md`, `design/tokens.json`, generated bridge CSS                                                             |
| Mobile manual pairing / form sheet                     | `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx` and its existing `ConnectionFormField` / `ConnectionSheetButton` |
| Native appearance                                      | `apps/mobile/src/lib/mobileTheme.ts`, `mobileThemeVariables.ts`, `useMobileNavigationTheme.ts`                                       |
| Discovery state, saved-route matching                  | Proposed client-runtime discovery source; existing connection onboarding and catalog                                                 |
| Truth for permission, grant, revoke, identity mismatch | Native platform result and server receipts; UI never infers authorization from mDNS or CloudKit registry membership                  |

The gallery is deliberately dependency-free and cannot exercise these components. Structurally validated: HTML IDs/fragment targets, local asset inventory, SVG XML parsing, and no remote resource references. The six-panel overview SVG was rendered with `rsvg-convert` and its PNG visually inspected for legibility and clipping. HTML browser/device visual verification was not performed; the implementation needs one integrated pass per affected native surface once authorized, checking layout, focus, contrast, large text, and actual state transitions. Mockups alone do not prove an interaction works.
