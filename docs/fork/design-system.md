# Design system and appearance profile

- Status: accepted (direction); conflict resolutions below need sign-off
- Date: 2026-10-02
- Branch: `feat/design-system`
- Source grammar: `~/code/drawerkit-v2/grammar` ("Ledger"), vendored to `design/`

## Context

The fork exists to make my own surfaces better, and upstream acceptance is not a
goal. Three of my products now share one visual language, "warm brutalism": the
scaffold console, drawerkit, and project-app. The Ledger grammar in
`drawerkit-v2/grammar` already consolidates them into one token source with a
contrast and budget checker, and exports valid T3 Code theme files.

At the same time, upstream moves fast and I merge it often. A fork-wide restyle
would touch `apps/web/src/index.css` and `apps/web/src/components/ui` — the two
files upstream edits most — and would make every visual regression ambiguous
against upstream. So the fork needs the design system to be real but optional,
and upstream appearance to remain the baseline.

## Decision

1. **Parity by default.** The fork renders exactly as upstream unless a profile
   is explicitly selected. No global token or component overrides ship by
   default. Upstream visual intent stays the diffable baseline.
2. **Warm brutalism is an opt-in profile.** It is gated by
   `[data-design="warm-brutalism"]` on the root element, with
   `[data-density="glance|work|focus"]` as a sub-option. With no attribute the
   bridge CSS is inert.
3. **Ledger is the grammar, vendored.** `design/tokens.json` is a pinned copy of
   the Ledger token source; `design/themes/ledger-light.json` and
   `ledger-dark.json` are the T3 theme files. Provenance and the pin live in
   `design/README.md`.
4. **Two layers, shipped separately.**
   - **Palette (no code).** The theme files are valid T3 `ThemeFile`s. Import
     them through Settings, Appearance, or publish them to the server. This
     restyles every surface immediately and is reversible.
   - **Structure (bridge).** `scripts/fork/design-system/build.ts` reads the
     tokens and emits `apps/web/src/styles/warm-brutalism.generated.css`, which
     maps Ledger tokens onto T3 semantic variables under the profile selector.
5. **The generated CSS is committed and checked.** `pnpm design:build` writes
   it; `pnpm design:check` fails when it is stale, when a required contrast pair
   drops below its floor, or when a vendored theme file is malformed.
6. **A gallery, not a Storybook.** A dev-only route at `/stylebook` renders both
   profiles, the type scale, density, and every `components/ui` variant with the
   real components and theme context. This avoids a `*.stories.*` file and a
   second build per component, which would add exactly the merge surface the
   fork avoids.
7. **The sync validates both profiles.** `t3.upstream-sync` diffs key surfaces
   in the upstream default and in warm brutalism against the last good baseline,
   so an upstream change and a profile regression are distinguishable.

## What is bridged, and what is not

Applied today by the generated bridge: color roles, `--radius` (4px),
`--control-radius`, and the font-family hooks. The `--wb-*` tokens for type
scale, spacing, density, and motion are emitted but **not yet consumed** by
upstream components, which use fixed Tailwind sizes and their own motion
tokens. Wiring those is a follow-up; do not claim they are applied.

The status/provenance/assurance primitives are previewed in the gallery only.
They become additive `components/ui` variants in a follow-up (never a restyle of
an existing variant).

## Open conflict resolutions (need sign-off)

The three product stylebooks disagree. The ADR proposes a default and needs a
decision before a citation becomes normative:

| Conflict          | Scaffold      | Drawerkit      | Proposed                                              |
| ----------------- | ------------- | -------------- | ----------------------------------------------------- |
| Radius            | 4/8/12        | 4px            | Ledger 4px everywhere                                 |
| AI violet hue     | 270           | 295            | 295 (Ledger)                                          |
| Icons             | Lucide 24/2   | custom 48/2    | Lucide 16/1.5 for actions + custom status silhouettes |
| Stale data        | disables      | never disables | never disables; action changes idiom                  |
| Accent strips     | grandfathered | not used       | banned (design-kit)                                   |
| Status vocabulary | 5 pills       | evidence axes  | Ledger 5 silhouettes + provenance + assurance         |

## Open decisions

- Apply the profile through Settings (an appearance option) rather than only the
  gallery, and persist it per client.
- Self-host the three Ledger families and load them with `@font-face`; today the
  profile only reorders the font stack and relies on locally installed fonts.
- Exclude the `/stylebook` route from production bundles; today it is registered
  everywhere and renders a placeholder outside development.
- Name: the profile and the `ledger` theme prefix are placeholders.

## Consequences

- Merge seams so far are zero: `index.css`, `components/ui`, and `__root.tsx`
  are untouched. The profile lives in one generated CSS file imported by the
  gallery route.
- When the profile is promoted to a real setting, the CSS must load app-wide and
  a fork-styling guard test is required (a merge that drops fork behavior must
  fail).
- The fork inherits a real gate: contrast, theme validity, and stale-generated
  checks run from `scripts/fork/design-system`.

## Commands

```bash
pnpm design:build     # regenerate apps/web/src/styles/warm-brutalism.generated.css
pnpm design:check     # contrast, theme validity, generated-CSS freshness
vp test run scripts/fork/design-system/lib.test.ts
```
