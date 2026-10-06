# Fork versions

Status: **decided 2026-10-05**. The fork ships its own short semver line, starting at **1.0.0** for the first packaged fork build. One version covers macOS, server, and iOS together: every surface reports the same number for a given release, so a version string alone says what is running.

## The model

- **One line, from 1.0.0.** The first `fork-deploy build` mints `1.0.0`. Every deploy after that bumps what the change warrants. Upstream's `0.0.44` never appears in a fork build.
- **One version per release, all surfaces.** `fork-deploy` resolves the version once, passes it to `build-desktop-artifact.ts` as `--build-version` plus `T3CODE_FORK_VERSION`, and that one number lands in the Electron artifact, the bundled server (`serverVersion` on `/.well-known/t3/environment`), the web client (`APP_VERSION`), and the mobile config. The version-skew check keeps working because client and server move together.
- **Rebuilds reuse.** A sha that already shipped keeps its version; rebuilding it does not mint a new one.

## Bump rules (the agent decides, then records)

Pick the smallest level that describes what ships:

- **patch** — a fix with no new user-visible behavior (a crash gone, a stuck state unblocked, a wrong label corrected).
- **minor** — new user-visible behavior that stays backward compatible (a new action, a new surface, a new setting).
- **major** — a breaking change: data migration, a wire or contract break, removing something users rely on.

`--bump` defaults to `patch`; `--version x.y.z` overrides the math when the agent judges the line needs a jump. Either way, minting a version requires `--summary` (one line: what ships) and `--why` (why this level and not the neighbors). No rationale, no build.

## Where versions live

All three files sit in the deploy root (machine-local, beside `releases/`), never in git:

| File                           | Holds                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `fork-versions.json`           | The registry: full commit sha to shipped semver                              |
| `fork-version-decisions.md`    | The decision ledger: version, level, date, sha, what shipped, why this level |
| `releases/<sha>/.fork-version` | The marker stamped into each complete release                                |

The registry is the source of truth for "what did this sha ship as". The ledger is the source of truth for "why did we bump this way". Read the ledger's recent entries before picking a level; add to it with every mint. That is how the versioning decisions stay consistent and the learnings compound.

## Commands

```bash
node scripts/fork/fork-deploy.ts build fork/prod --summary "resync action" --why "new user-visible action; patch would understate it"
node scripts/fork/fork-deploy.ts build fork/prod --bump minor --summary "..." --why "..."
node scripts/fork/fork-deploy.ts build fork/prod --version 2.0.0 --summary "..." --why "explicit: ..."
node scripts/fork/fork-deploy.ts version fork/prod   # dry run: what would this ref ship as
node scripts/fork/fork-deploy.ts status              # shows fork versions beside shas
```

A corrupt registry fails the build instead of minting over it. A version already mapped to another sha is refused. A sha already mapped to another version is refused.

## Mobile note

The mobile `version` in `app.config.ts` follows the same fork number at build time when `T3CODE_FORK_VERSION` is set; otherwise it keeps its checked-in value. Fork mobile builds disable upstream OTA updates. The upstream version literal stays in the file for Expo's fingerprint reader; the fork override is applied afterward. The native build number (`buildNumber` / `versionCode`) still comes from the store pipeline. The papercut build label (`version (build)`) names the installed iPad build — see [defect-resolution.md](./defect-resolution.md).
