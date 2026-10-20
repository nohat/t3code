# Maintaining the fork

Status: **decided 2026-10-03**, from a research pass on long-lived forks, Claude Code and Codex configuration, and git behavior, checked against the installed tools (Claude Code 2.1.287, codex-cli 0.159.3). Where a claim is only read, not tested, this page says so.

## Upstream's agent files are never edited

`AGENTS.md` and `CLAUDE.md` (which is `@AGENTS.md`) belong to upstream. 14 upstream commits touched `AGENTS.md` since August, so any local edit conflicts on a sync, and a dirty, never-committed edit is lost the day someone resets a worktree. The rejected alternatives, all tested or checked against git's docs:

- `merge=ours` keeps the fork's side whenever both sides changed, which silently drops upstream's guidance. The driver config is also per clone.
- `skip-worktree` and `assume-unchanged` are not meant for ignoring tracked changes; a merge touching the file fails or overwrites it.
- A one-line pointer in tracked `CLAUDE.md` dangles on every branch cut from `main`.

## How the posture reaches agents

**Primary (Claude, in place):** a user-level `SessionStart` hook, `~/.claude/hooks/t3code-fork-posture.sh`, registered in `~/.claude/settings.json`. In any checkout whose `origin` is `nohat/t3code` it prints `docs/fork/posture.md` from one git ref, so every worktree sees it, including `feat/*` branches cut from `main` that lack `docs/fork/`. T3 starts Claude with the user, project, and local settings sources and the thread's worktree as the working directory (`ClaudeAdapter.ts`), so the user hook applies there. Tested: `claude -p` in this repo quoted the posture, and a T3 session resumed on 2026-10-03 showed the hook's output. The source of the hook and of the `/defect-session` skill is `scripts/fork/agent-config/` and `.agents/skills/defect-session/`; run `scripts/fork/agent-config/install.sh` on a new machine, or after editing either.

The script reads `docs/fork/posture.md` from `fork/prod`, then `origin/fork/prod`, so a fresh clone or another machine finds the docs after `git fetch`. It prints which ref it used so an agent can read the other pages with `git show <ref>:docs/fork/<page>.md`. If neither has the page it prints a one-line warning instead of nothing, because silence looks the same as "no posture". The standalone `docs/fork` branch was retired on 2026-10-03 once `fork/prod` contained the pages.

**Fallback and Codex (not built):** if the hook proves unreliable, generate `CLAUDE.local.md` and `AGENTS.override.md` (posture plus upstream's `AGENTS.md`, since an override replaces the file at that level) from a `post-checkout` hook, and list both in `$(git rev-parse --git-common-dir)/info/exclude`. Gitignored files are not copied to new worktrees, so they need regenerating. Codex support for a start-of-session hook is unchecked. After installing the guards, `core.hooksPath` points at `fork-hooks` in the common Git directory. This protects every worktree, including upstream `main`, which lacks fork scripts. The stable dispatcher delegates formatting to the tracked `.vite-hooks/pre-commit`; Vite leaves a custom hooks path intact.

## Syncing with upstream

- Merge, never rebase, on `fork/prod`. Sync daily and small. `git-imerge` only for a catch-up like the 396-file merge in the README survey.
- `rerere` is on globally (`rerere.enabled`, `rerere.autoUpdate`; `merge.conflictStyle=zdiff3` was already set). The `rr-cache` lives in the common git dir, so every worktree shares it.
- Lockfiles and generated files are never hand-merged: take upstream's `pnpm-lock.yaml` and regenerate; regenerate `routeTree.gen.ts`.
- Patch-queue and stacking tools (git-machete, branchless, Graphite) add machinery without cutting conflicts at 100+ upstream commits a week. Hosted sync bots (`wei/pull`) hard-reset and cannot run my gates. Neither is used.

## Catching a clean merge that dropped fork behavior

Two checks, both local, run by the sync job before it reports "clean":

1. Every accepted branch's guard test, plus `git merge-base --is-ancestor <tip> HEAD`, from a short list of fork patches (name, branch, guard command).
2. A fork-delta check: record `git diff --numstat main fork/prod` before and after the trial merge and flag any fork file whose added lines dropped or vanished. `git range-diff` is weak here because it skips merge commits.

Design reasoning, not a tested tool.

## Guards against agent mistakes

Done: `git remote set-url --push upstream no_push` (a push to upstream now fails; tested), so no agent can publish to upstream by accident.

Installed with `scripts/fork/agent-config/install.sh`: a Claude `PreToolUse` mistake guard denies `gh repo delete`, `gh repo fork --fork-name`, force pushes, and `-X ours` or `-X theirs` merges during fork work. Git hooks refuse commits on `main`, pushes to `main`, and non-fast-forward updates or deletion of `fork/prod`. The sync job has one narrow exception: `T3CODE_UPSTREAM_MAIN_FF=1` permits a fast-forward push of exactly `upstream/main` to `main`. The tracked `.vite-hooks` checks remain; a stable common-directory dispatcher additionally covers upstream branches where those files are absent. These are guards against ordinary shell mistakes, not a sandbox for arbitrary code. Codex gets the Git guards; its provider hook mirror remains pending. These are the "mechanism, not convention" follow-up in [posture.md](./posture.md). Real incidents motivated them: an agent deleted a user's fork with `gh repo fork --fork-name` (2026-05-24), and another emptied `main` branches, where a pre-push hook was the guard that held (2026-08-28).

## Fork builds

Versions follow [versioning.md](./versioning.md): the fork ships its own semver line from 1.0.0, one number for macOS, server, and iOS together. `fork-deploy` resolves the version from the `fork-versions.json` registry in the deploy root (minting the next bump with a recorded `--summary`/`--why`), passes it as `--build-version` plus `T3CODE_FORK_VERSION` into `build-desktop-artifact.ts`, which feeds the artifact, the bundled server, the web client, and the mobile build. The desktop app id is a constant in `scripts/build-desktop-artifact.ts`; the update feed stays unset so there is no feed; the bundle id is patched on a scratch copy at build time; `package.json` versions are never edited. Tag `fork/prod` as `fork/<date>-<sha>`.

## Installing and running the desktop build

Production is a normal macOS app: `node scripts/fork/fork-deploy.ts --config <config> install <ref> --summary ... --why ...` builds a release, quits the running app, copies it to `/Applications/T3 Code (Beta).app`, bakes `T3CODE_PORT`, `T3CODE_HOME`, and `T3CODE_TELEMETRY_ENABLED=false` into `LSEnvironment`, and re-signs it ad hoc. There is no launch agent and no second launcher. `deploy`, `rollback`, and `plist` are disabled and exit 64. Launch it from Finder; quitting it stops the backend. The build tree is `~/code/t3code-deploy/build`; releases are kept three deep.

Facts about the packaged app that cost time to find (2026-10-20):

- On macOS the userData directory is always `~/Library/Application Support/t3code-v2`. `--user-data-dir` is ignored, and `t3code-prod` is empty. A second copy collides with the first one's single-instance lock, so exits with code 130 and no output.
- To run a throwaway copy, give it a fake `HOME` (its own `Library/Application Support/t3code-v2`), plus `T3CODE_HOME` and `T3CODE_PORT` pointing elsewhere, started with `env -i`. A leaked `NODE_OPTIONS=--no-warnings` kills a packaged Electron app. A fake `HOME` triggers a "Keychain Not Found" dialog (Reset To Defaults is safe there) and has no provider logins, so sends fail with "Provider turn failed". That is the test copy, not the fix.
- The Electron fuses on this build leave asar integrity validation off, so a bundle can be patched in place and re-signed ad hoc. The main process holds the old file, so a patched copy needs a full restart.
- Never screenshot the full screen to debug a window. Capture one window.

## Defects found in the 2026-10-20 sync

**React #301 ("Too many re-renders" in `ChatView`) on every draft route.** React Compiler (`react({ compiler: true })` in `apps/web/vite.config.ts`) skips a whole component that contains `try`/`finally`, with no build error. Fork commit `a3cb18ecd9` put one in `ChatView`'s `onSend`, so `ChatView` ran uncompiled. Then `routeThreadRef = scopeThreadRef(...)` was a new object every render, and upstream's `useWorktreeSetup` (#20316, new in this sync) compares it by identity and calls `setHeldFor` during render, which loops. 1.2.2 predates that hook. Fix: `runGuardedSend`, a module-level helper that owns the `finally`. Confirm a compiled component with `const $ = (0, import_compiler_runtime.c)(N)` in the Vite output; the Babel harness gives misleading errors, so trust the real build. Still open: nothing fails when a component silently loses compilation. A build check for the memo cache would catch this class.

**iOS launch crash (SIGABRT on both devices).** The device console shows ``Invariant Violation: `new NativeEventEmitter()` requires a non-null argument`` from `get PushNotificationIOS`. Metro's `import("react-native")` interop reads every export, and that lazy getter throws. The fork-only `startComposerDraftCrashSafety` (`4caaa9217b`) hit it first, then upstream's `app-updates.ts` (four sites) hit it. Both now read `AppState` with `require("react-native")`. Do not write `import("react-native")` for a value in `apps/mobile/src`; type-only `typeof import("react-native")` is fine. Crash logs from the USB device are in `.ips` files: `idevicecrashreport -u <udid> -e <dir>`, and the faulting frames only say "TurboModule void method threw". The real message comes from `xcrun devicectl device process launch --device <udid> --console --terminate-existing <bundle id>`.

**Backend readiness timeouts after a restart (cause not confirmed).** The database is about 4.3 GB with about 289k `orchestration_events` rows. Upstream's background event-store compaction (`ProjectionMaintenance.compactEventStore`, #19435) deletes in pages of 50 and is the best guess for the slow startup and the 60 second readiness failures. The backend was healthy once it settled. Not yet filed upstream; if filed, label it `via-triage` and show the full text first.

**Launch agent leftovers.** The retired agent had a stray `ProgramArguments[1]` (a stale Alpha path). Its backup is `~/code/t3code-deploy/launchagent-backup/`. `com.cognitivescaffold.agent.t3code-notify` is a Scaffold notifier (runs `t3code_attention.py notify` every 5 minutes), not a launcher, and stays. Unloaded plists remain in the deploy root (`local.t3code.deploy`, `local.t3code.cutover`, `local.t3code.upstream-sync`), and `fork-deploy-lib.ts` still has unused launchd helpers.

## Building the iOS app for the devices

Bundle id `com.nohat.t3code` and team come from `.env` (`T3CODE_IOS_BUNDLE_ID`, `T3CODE_IOS_TEAM_ID`). Run from `apps/mobile` in the `fork/prod` checkout, after `pnpm install --frozen-lockfile` there (a missing `react-native-pdf-jsi` fails prebuild):

1. `APP_VARIANT=production EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform ios`
2. In `ios/`: `NODE_ENV=production APP_VARIANT=production xcodebuild -workspace T3Code.xcworkspace -scheme T3Code -configuration Release -destination 'generic/platform=iOS' -derivedDataPath <dir> -allowProvisioningUpdates DEVELOPMENT_TEAM=<team> build`. The team override is needed because the generated `expo-sharing-extension` target has none.
3. `xcrun devicectl device install app --device <udid> <dir>/Build/Products/Release-iphoneos/T3Code.app`, once per device. A locked device fails with error 10003; unlock it and keep the screen on. `devicectl list devices` shows the UDIDs.
4. Launch with `--console` and check for `Terminating app`.

Native builds use a free-tier-style local sign; expect the 7 day expiry unless the paid account is in use.

## Keeping fixes upstreamable

One concern per branch, cut from `main`. To prove isolation, apply the branch's commits to a scratch worktree from `upstream/main` with `git cherry-pick`. If they apply and the guard test passes, it can become an upstream PR whenever I ask. `git cherry upstream/main <branch>` shows whether upstream already landed an equivalent.
