# Fork design tokens (vendored)

This directory pins the Ledger visual grammar for the fork. It is data, not code.

| File | What it is |
|---|---|
| `tokens.json` | Pinned copy of the Ledger token source: OKLCH colors (light/dark), type, space, radius, border, density, motion |
| `themes/ledger-light.json`, `themes/ledger-dark.json` | T3 Code `ThemeFile` (version 1) exports, importable through Settings, Appearance |

## Provenance

Copied from `~/code/drawerkit-v2/grammar` on 2026-10-02 (Ledger 0.1.0). The
grammar is the upstream of record; this is a subset needed by the fork. Do not
hand-edit these files. When the grammar changes, re-copy and run
`pnpm design:check`.

`design/**` is excluded from the formatter so the pin stays byte-faithful.

## How it is consumed

`scripts/fork/design-system/build.ts` reads `tokens.json` and writes
`apps/web/src/styles/warm-brutalism.generated.css`, the scoped bridge that maps
Ledger tokens onto T3 semantic variables under `[data-design="warm-brutalism"]`.
Parity is the default: with no profile selected the bridge is inert. See
[../docs/fork/design-system.md](../docs/fork/design-system.md).
