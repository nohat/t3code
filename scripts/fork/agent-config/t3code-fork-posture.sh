#!/bin/sh
# SessionStart hook for agents working in nohat/t3code. Puts docs/fork/posture.md in
# front of the agent without editing upstream's AGENTS.md. Installed to
# ~/.claude/hooks by install.sh; see docs/fork/maintenance.md.
cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
case "$(git remote get-url origin 2>/dev/null)" in
  *nohat/t3code*) ;;
  *) exit 0 ;;
esac
# fork/prod once docs/fork has landed there; docs/fork until then. Most worktrees
# are cut from main and do not contain docs/fork, so read it from git. Local refs
# win; the origin/* copies cover a fresh clone or a machine that never had them.
refs="fork/prod local/t3-work docs/fork origin/fork/prod origin/local/t3-work origin/docs/fork"
for ref in $refs; do
  body=$(git show "$ref:docs/fork/posture.md" 2>/dev/null) && [ -n "$body" ] && break
  body=""
done
if [ -z "$body" ]; then
  printf 'WARNING: the fork posture (docs/fork/posture.md) was not found on any of: %s. Run `git fetch origin`; if it is still missing, the docs branch was deleted or never pushed (see docs/fork/maintenance.md). Work as if the posture is unread and say so.\n' "$refs"
  exit 0
fi
printf 'Fork posture for nohat/t3code, read from git ref %s. It overrides AGENTS.md wherever they conflict. Other fork docs: git show %s:docs/fork/<page>.md. Defects: /defect-session.\n\n%s\n' "$ref" "$ref" "$body"
