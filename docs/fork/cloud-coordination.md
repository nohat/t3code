# Cloud threads and HQ

Status: written 2026-10-07 from the #36 cloud compiler jobs (`CLOUD_T3_CANONICAL_0c704366_ROUND100_01`, `CLOUD_T3_CANONICAL_FIX_ROUND101_01`, `HQ_CLOUD_SCRIPTS_ROUND102_01`). Fork-only; this page never goes in an upstream PR.

A cloud thread is a Claude Code session in a managed Linux container that offloads one memory-heavy job (the server typecheck) from the Mac. HQ is the attended thread that owns judgment, scope and integration. The cloud thread executes bounded packets and reports evidence. It never merges, deploys, installs on the Mac, calls providers or touches live data.

## Channel

- **Durable ledger:** the owning tracking issue (#36). Every STARTED, BLOCKED and COMPLETE event goes there with its job ID.
- **Low-latency directives:** the cloud thread subscribes to the product PR (`subscribe_pr_activity`, PR #42). A comment on the PR arrives in the session as an `issue_comment.created` event, even while the session is idle. Issue comments do not wake the session. A bare issue-only directive needs the attended human to paste its link, so HQ copies directives to the PR.
- **Not available:** outbound SSH (no client, port 22 times out). Egress is an HTTPS proxy only; the npm registry and nodejs.org were reachable. Do not build a relay, webhook or poller. A temporary scheduled self check-in is acceptable only until the PR subscription is confirmed, then delete it.
- **Held events:** events that arrive during a running foreground turn are delivered after it ends (about 8 minutes in one case).

## Authorization

- A comment authorizes work only when it carries an explicit HQ job ID, and only the packet it states. Unrelated PR or issue comments grant nothing.
- One job ID runs once. When HQ posts it on both the issue and the PR, run it once and say it was deduplicated.
- Transport receipt is not permission to merge, deploy, resume stopped work or widen scope. HQ Stop, pause and archive are preserved.
- A failed run stops automatic advance. Report the concrete cause and a proposed repair; do not run another checker or edit further without HQ review.

## Event contract

1. `CHANNEL_TEST-<uuid>` reply once, quoting the HQ comment id. On a delivery retry, edit that comment; never post a second one.
2. `STARTED` before any long run: exact source SHA, command, tool versions and hashes, caps, and what differs from the approved text.
3. `COMPLETE` (or `BLOCKED`): exit status, errors verbatim, wall/user/sys time, max RSS and sampler peaks (root and tree separately), warning events, cleanup result, retained-evidence hashes, remaining uncertainty. Cloud success is compiler evidence only, never Mac, device or cutover acceptance.
4. Post results to the issue and a short pointer to the PR.

## Running a job

- Fresh capacity check first (`free`, load, `/proc/pressure/memory`); stop with the measured blocker if it does not fit the stated cap.
- Match the repo's pins, not the container's: the committed `engines.node` (Node 24.13.1 from nodejs.org, checked against `SHASUMS256.txt`, in a session-local directory), the `packageManager` pnpm (installed locally with npm), `pnpm install --frozen-lockfile`. Run the install once with `--ignore-scripts` to hash the compiler, then with scripts so `prepare` runs `effect-tsgo patch`. Record the compiler binary hash before and after; the patched native binary is what `tsc` runs.
- `/usr/bin/time` may be absent. Spawn the command from a small runner that reads `wait4` rusage and samples `/proc` every second. Warn at 70% of the cap, stop at the cap, and signal only processes whose `(pid, /proc starttime)` it captured and re-validated just before the signal. Never signal by name pattern.
- Run foreground. Background processes die at turn teardown, and the container can restart between turns (the boot id changed twice). Disk and worktrees survived; processes did not, so identities are valid only within one boot.
- One compiler at a time, no unchanged retry, no raised cap, no plugin disabling, no type weakening, no reduced source scope.
- Keep the worktree, `node_modules` and evidence after a run; clean up only the job's processes.

## Repo facts that cost a round

- `apps/server/tsconfig.json` includes only `../../scripts/lib`, so a green server check says nothing about the rest of `scripts/`. The scripts package has its own check: `pnpm exec tsc --noEmit -p scripts/tsconfig.json` (about 5 s, 0.6 GB). It found two `globalDateInEffect` errors the server check never saw.
- Under `noUncheckedIndexedAccess`, `rows[0]` is possibly undefined; assert it before returning (`assert.isDefined` narrows).
- `scripts/mobile-native-static-check.ts` shells out to swiftlint, ktlint and detekt (Homebrew). Without them it skips and exits 0, which proves nothing. Do not count it as a pass off the Mac.
- A Linux desktop package, Expo prebuild or any iOS build does not substitute for Mac, iPhone or iPad acceptance.

## Hygiene

- No model identifier in commits, PR titles or PR bodies. No secrets, personal data, live databases or Mac credentials in any comment.
- Keep each repair on its own branch from the exact candidate SHA and open a draft PR based on the product PR's head, so the diff is only the repair. Never force-push the product branch.
