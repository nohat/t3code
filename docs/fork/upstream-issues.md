# Upstreaming: contributing fork work to pingdotgg/t3code

Status: **decided 2026-10-14** ("let's develop an upstream strategy similar to what i'm doing in smooth dimming"). Replaces the passive tracker this page used to hold. Modeled on the Smooth dimming campaign: know each venue's rules, put every contribution in the existing conversation it belongs to, offer only what the project accepts, and measure results rather than activity.

## Why upstream at all

Every fork change that lands upstream is a conflict the sync never sees again. The 2026-10-14 sync conflicted on 15 files, 9 of them from one upstream feature colliding with fork picker work. Upstreaming is maintenance reduction first and goodwill second. A fork feature that upstream will not take stays in the fork, and that is fine. The fork does not trim scope to please upstream.

## The venue as practiced (checked 2026-10-14 at `bf8ffe81a6`)

Read [CONTRIBUTING.md](https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md) live before each PR. Its model rules changed the day this page was written.

- **Two routes skip approval:** a very small, focused fix for an obvious bug (the PR explains why it qualifies), and a focused configuration option for an existing capability. Everything else needs a maintainer-triaged issue (substantial bug) or explicit approval in an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas) (feature or behavior change), linked from the PR. Calling a behavior change a bug fix does not exempt it.
- **Enforced in practice.** Of 60 outside PRs closed Oct 12 to 14, 22 merged. Closures were mostly a disallowed model in the attribution (7) and missing approval for presentation changes (5, e.g. #19001). Claude attribution is accepted.
- **Small and fast or never.** Merged outside PRs have a median of 47 changed lines and merge in about 0.3 days. 1,613 PRs are open, and some Macroscope-approved PRs sit for a week. A PR that does not land quickly effectively dies.
- **Maintainers answer through agents** and finish or supersede contributor work with credit (#19430 combined #18106 and #19303). Approved ideas are sometimes built by someone else first.
- **No standing.** nohat has no upstream history, so every PR is `vouch:unvouched` and goes through triage and Macroscope.

## Rules for this fork

1. **One problem, rebuilt clean.** Cut each PR from `upstream/main`, never from a fork commit as is. Several fork commits bundle problems (`679239af06` has four) or carry fork-only edits. Follow upstream's PR template and attribution line.
2. **Join the existing conversation.** Search issues, PRs, and Ideas for the symptom first. If a PR already exists, add evidence there instead of competing (#16419, #17922, maintainer-owned #15637). Search again right before opening, since duplicates appear within hours.
3. **Route by eligibility.** Obvious-bug fixes go straight to a PR. Behavior and presentation changes start with evidence on an existing issue or a new Ideas discussion, and a PR follows only after explicit approval.
4. **Evidence, not advocacy.** A reproduction, a focused test, and before/after screenshots for UI. Distinguish what was observed on the fork from what was checked on upstream.
5. **I review the exact text.** Agents prepare drafts; I approve the exact wording before anything is posted, and the approved text and link are recorded in the ledger below. Unchanged approved text does not need a second approval. I supply the substance of answers to maintainer questions.
6. **Restraint.** At most two open upstream PRs at a time. No review requests, pings, or bumps. A follow-up is posted when it adds new evidence. Silence is not a reason to post again.
7. **Close the loop.** When upstream lands an equivalent, drop the fork copy at the next sync and remove its `patches.tsv` row. When upstream declines, mark the item fork-only and stop.

## Ledger

| Fork item                                               | Upstream conversation                                                      | Route                             | Next action                                                                             | State     |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| macOS `UsageService` Pi test (`/private/var` vs `/var`) | #19532 (accepted; triage welcomed a small PR); #19541 saw the same failure | Obvious-bug fix, test only        | Check #19540 and #19541 have not absorbed it; draft PR citing #19532                    | Draft     |
| Mobile composer drafts lost on OS kill                  | none found                                                                 | Bug issue, then focused PR        | File a bug with a kill-during-typing reproduction; PR the max-wait and background flush | Draft     |
| Send-blocked reason (mobile visible text)               | #17422, #7390; precedent #19331                                            | Small fix on the #19331 precedent | Draft the mobile-only PR (about 9 lines) with screenshots                               | Draft     |
| Send-blocked reason (web visible notice)                | #17422                                                                     | Ideas first                       | Open an Ideas discussion with screenshots                                               | Later     |
| Send never settles: guard not released on a throw       | none                                                                       | Obvious-bug fix                   | File an issue with a focused test, then a PR                                            | Draft     |
| Send never settles: 30 s and 120 s deadlines            | Ideas #15932, PR #16790                                                    | Needs approval                    | Comment on #15932 with fork evidence                                                    | Later     |
| Thread resync ("Reload thread")                         | #18188 (stale cache survives reload)                                       | Evidence, then Ideas              | Comment on #18188 with the resync evidence; propose the action in Ideas                 | Later     |
| Claude interrupt bound                                  | PR #16419 (approved, open)                                                 | Covered                           | Drop the fork copy when #16419 lands                                                    | Watch     |
| Claude permission-mode restore bound                    | none                                                                       | Needs a reproduction              | Keep fork-only until a hang trace exists                                                | Fork-only |
| OpenCode start retry                                    | #17806, PR #17922 (approved, open)                                         | Covered                           | Drop the fork copy when #17922 lands (see nohat/t3code#52)                              | Watch     |
| OpenCode scoped agents                                  | #11871, maintainer PR #15637                                               | Maintainer-owned                  | Optionally note the V2 re-port on #15637                                                | Watch     |
| Truncated-text reveal and wider picker                  | none; precedent #11002                                                     | Ideas first                       | Ideas discussion with screenshots                                                       | Later     |
| Model prices in the picker                              | Ideas #13073                                                               | Ideas                             | Keep fork-only unless a maintainer engages on #13073                                    | Fork-only |
| Reconnect failure kinds and retry                       | Ideas #6907, #18009; partly #19331                                         | Ideas                             | Drop the part #19331 covers; keep the rest fork-only for now                            | Fork-only |
| Picker commits on dismiss (mobile)                      | none                                                                       | Ideas                             | Keep fork-only                                                                          | Fork-only |
| Papercuts                                               | upstream has `npx t3 triage`; Ideas #17918                                 | Different mechanism               | Keep fork-only; nohat/t3code#34 decides any offer                                       | Fork-only |

"Draft" means an agent may prepare the text for my review. Nothing in this table authorizes posting.

## Cadence and measures

Start with the two obvious-bug items, so the first contact is something maintainers can accept on its merits. Add one item when an open one resolves. Review the ledger at each upstream sync, since a sync is when an upstream landing shows up as a conflict that disappeared.

Measure what matters to the fork: fork lines retired because upstream landed an equivalent, sync conflicts avoided, PRs merged, and conversations where a maintainer engaged. Posts made and PRs opened are not progress on their own.
