#!/usr/bin/env python3
"""Use stable hooks so checking out upstream main cannot remove its guard."""
from pathlib import Path
import shutil
import subprocess


def install(root):
    root = Path(root)
    common = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=root, text=True).strip()
    hooks = (root / common / "fork-hooks").resolve()
    hooks.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("fork_guard.py"), hooks / "fork_guard.py")
    for event in ("pre-commit", "pre-push"):
        script = hooks / event
        script.write_text(f'''#!/bin/sh
set -eu
python3 "$(dirname "$0")/fork_guard.py" {event}
# Vite's tracked formatter hook remains the source of its staged behavior.
if [ -f .vite-hooks/{event} ]; then
  exec /bin/sh -e .vite-hooks/{event} "$@"
fi
''')
        script.chmod(0o755)
    subprocess.run(["git", "config", "core.hooksPath", str(hooks)], cwd=root, check=True)
    return hooks


if __name__ == "__main__":
    import sys
    print(install(sys.argv[1]))
