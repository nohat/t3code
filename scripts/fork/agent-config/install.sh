#!/bin/sh
# Installs the fork's user-level agent config from this checkout: the SessionStart
# hook and the /fork-defect-session skill. Safe to run again. Changes only
# ~/.claude/hooks, ~/.claude/skills/fork-defect-session, and one hook entry in
# ~/.claude/settings.json (a backup is written beside it).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
claude="${CLAUDE_HOME:-$HOME/.claude}"

mkdir -p "$claude/hooks" "$claude/skills/fork-defect-session"
cp "$here/t3code-fork-posture.sh" "$claude/hooks/t3code-fork-posture.sh"
chmod +x "$claude/hooks/t3code-fork-posture.sh"
cp "$root/.agents/skills/fork-defect-session/SKILL.md" "$claude/skills/fork-defect-session/SKILL.md"

python3 - "$claude/settings.json" <<'PY'
import json, shutil, sys
path = sys.argv[1]
try:
    settings = json.load(open(path))
except FileNotFoundError:
    settings = {}
else:
    shutil.copyfile(path, path + ".bak")
command = "$HOME/.claude/hooks/t3code-fork-posture.sh"
entries = settings.setdefault("hooks", {}).setdefault("SessionStart", [])
if not any(h.get("command") == command for e in entries for h in e.get("hooks", [])):
    entries.append({"hooks": [{"type": "command", "command": command}]})
json.dump(settings, open(path, "w"), indent=2, ensure_ascii=False)
open(path, "a").write("\n")
PY
echo "Installed the fork posture hook and /fork-defect-session into $claude"
