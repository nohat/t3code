#!/bin/sh
# Installs the fork's user-level agent config from this checkout: the SessionStart
# hook and the /defect-session skill. Safe to run again. Changes only
# ~/.claude/hooks, ~/.claude/skills/defect-session (and removes the retired fork-defect-session), Git hooks/config, and hook entries in
# ~/.claude/settings.json (a backup is written beside it).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
claude="${CLAUDE_HOME:-$HOME/.claude}"

rm -rf "$claude/skills/fork-defect-session"  # retired name, replaced by defect-session
mkdir -p "$claude/hooks" "$claude/skills/defect-session"
cp "$here/t3code-fork-posture.sh" "$claude/hooks/t3code-fork-posture.sh"
cp "$here/fork_guard.py" "$claude/hooks/t3code-fork-guard.py"
chmod +x "$claude/hooks/t3code-fork-posture.sh"
cp "$root/.agents/skills/defect-session/SKILL.md" "$claude/skills/defect-session/SKILL.md"

python3 - "$claude/settings.json" "$claude/hooks" <<'PY'
import json, shlex, shutil, sys
path = sys.argv[1]
try:
    settings = json.load(open(path))
except FileNotFoundError:
    settings = {}
else:
    shutil.copyfile(path, path + ".bak")
command = shlex.quote(sys.argv[2] + "/t3code-fork-posture.sh")
entries = settings.setdefault("hooks", {}).setdefault("SessionStart", [])
if not any(h.get("command") == command for e in entries for h in e.get("hooks", [])):
    entries.append({"hooks": [{"type": "command", "command": command}]})
guard = 'python3 ' + shlex.quote(sys.argv[2] + "/t3code-fork-guard.py") + ' pre-tool'
entries = settings.setdefault("hooks", {}).setdefault("PreToolUse", [])
if not any(h.get("command") == guard for e in entries for h in e.get("hooks", [])):
    entries.append({"matcher": "Bash", "hooks": [{"type": "command", "command": guard}]})
json.dump(settings, open(path, "w"), indent=2, ensure_ascii=False)
open(path, "a").write("\n")
PY
python3 "$here/install_git_guards.py" "$root"
echo "Installed the fork posture, mistake guard, and /defect-session into $claude"
