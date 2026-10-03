# Upstream issues the fork fixes

The fork is not upstream-driven: a feature does not need to be PR-ready, and I do
not trim scope to please upstream. But some fork work also fixes a bug upstream
has, and I want to keep the option to give just that fix back. This page tracks
the mapping so the option stays exercisable instead of becoming a rewrite.

## Policy

- **Detect.** When a fork fix matches an open upstream issue, record the issue
  URL beside the fix here. Search upstream issues for the symptom before writing
  a new fix; a fix that already has a home is cheaper to isolate later.
- **Keep it isolatable.** A fix destined for a possible PR lives on its own
  branch off `main`, one concern only, in new files where practical. No settings,
  contracts, command-palette, or root-route edits unless the fix requires them.
- **Guard it.** Add a test that fails if a future upstream merge drops the fix.
  This is the same rule the fork uses to survive syncs.
- **PR only on request.** Opening an upstream PR is an opt-in side effect, never
  automatic. When asked, carve the isolated commit out of the branch, write a
  conventional title and a body that states the problem and the fix, and add the
  fork/model attribution.

## Tracker

| Fork item                                                      | Upstream issue                                       | Fork branch / commit              | Upstreamable?                                             |
| -------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| Disabled Send shows no reason                                  | to find                                              | `fix/send-blocked-reason`         | likely; wording and the reason matrix are product-tunable |
| Thread resync / reload                                         | to find (compare #13994, "stuck on Syncing threads") | `feat/thread-resync`              | likely; `requestThreadResync` is additive                 |
| Configuration plan in a gitignored dir is lost between threads | to find                                              | plan for a cross-thread plans dir | unknown; may be policy, not code                          |
| Per-model cost display in the picker                           | to find                                              | `wip/triage-model-cost-picker`    | likely; the server-projected pricing is additive          |

"to find" means no issue has been matched yet. Do not guess a number; search
upstream before filling it in.

## How to search

Use the upstream repo (`pingdotgg/t3code`) issue search for the exact symptom
and for the file the fix touches, since issue titles rarely name the component.
Record both the issue number and the symptom text that matched, so the mapping
can be re-verified later.
