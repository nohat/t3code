#!/usr/bin/env python3
"""Fork mistake guards, shared by Git hooks and Claude's PreToolUse hook."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)


def is_fork(cwd):
    result = git("remote", "get-url", "origin", cwd=cwd)
    return result.returncode == 0 and result.stdout.strip().removesuffix(".git").endswith("nohat/t3code")


def command_denial(command):
    # This catches ordinary agent shell commands, including wrappers and shell
    # -c strings. It is a mistake guard, not a sandbox for arbitrary programs.
    lexer = shlex.shlex(command.replace("\\\n", ""), posix=True, punctuation_chars=";&|()\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    try:
        tokens = list(lexer)
    except ValueError:
        return "Cannot inspect malformed shell command."
    segments = []
    segment = []
    for token in tokens + [";"]:
        if token and all(char in ";&|()\n" for char in token):
            if segment:
                segments.append(segment)
            segment = []
        else:
            segment.append(token)
    for words in segments:
        if Path(words[0]).name in ("echo", "printf"):
            continue
        for index, word in enumerate(words):
            executable = Path(word).name
            tail = words[index + 1:]
            shell_flag = next((value for value in tail if value.startswith("-") and not value.startswith("--") and "c" in value[1:]), None)
            if executable in ("sh", "bash", "zsh") and shell_flag:
                position = tail.index(shell_flag) + 1
                if position < len(tail):
                    reason = command_denial(tail[position])
                    if reason:
                        return reason
            if executable == "gh" and tail[:2] == ["repo", "delete"]:
                return "Repository deletion is forbidden during fork work."
            if executable == "gh" and tail[:2] == ["repo", "fork"] and any(
                value == "--fork-name" or value.startswith("--fork-name=") for value in tail
            ):
                return "gh repo fork --fork-name can replace the existing fork."
            if executable != "git":
                continue
            # Skip git's global options; -C/-c/--git-dir/--work-tree take values.
            while tail and tail[0].startswith("-"):
                option = tail.pop(0)
                if option in ("-C", "-c", "--git-dir", "--work-tree") and tail:
                    tail.pop(0)
            if not tail:
                continue
            action, *options = tail
            if action == "push" and any(
                value in ("-f", "--force", "--force-with-lease", "--force-if-includes")
                or value.startswith(("--force=", "--force-with-lease="))
                or (value.startswith("-") and not value.startswith("--") and "f" in value[1:])
                or value.startswith("+") for value in options
            ):
                return "Force pushes are forbidden during fork work."
            if action in ("merge", "pull", "rebase"):
                for position, value in enumerate(options):
                    if value in ("-Xours", "-Xtheirs", "--strategy-option=ours", "--strategy-option=theirs") or (
                        value in ("-X", "--strategy-option")
                        and options[position + 1:position + 2] in (["ours"], ["theirs"])
                    ):
                        return "Resolve conflicts individually; -X ours/theirs can drop fork behavior."
    return None


def check_push(lines):
    zero = "0" * 40
    for line in lines:
        local_ref, local_sha, remote_ref, remote_sha = line.split()
        if remote_ref == "refs/heads/main":
            # The sync job may mirror exactly upstream/main, never arbitrary
            # main edits. Git still enforces fast-forward on the remote.
            upstream = git("rev-parse", "refs/remotes/upstream/main")
            if not (os.environ.get("T3CODE_UPSTREAM_MAIN_FF") == "1"
                    and upstream.returncode == 0 and upstream.stdout.strip() == local_sha
                    and local_sha != zero):
                return "main is an upstream mirror; only upstream-sync may push it."
            if remote_sha != zero and git("merge-base", "--is-ancestor", remote_sha, local_sha).returncode:
                return "Refusing a non-fast-forward main update."
        if remote_ref == "refs/heads/fork/prod":
            if local_sha == zero:
                return "Refusing to delete fork/prod."
            if remote_sha != zero and git("merge-base", "--is-ancestor", remote_sha, local_sha).returncode:
                return "Refusing a non-fast-forward fork/prod update."
    return None


def main():
    mode = sys.argv[1]
    if mode == "pre-tool":
        payload = json.load(sys.stdin)
        cwd = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
        if not is_fork(cwd):
            return 0
        reason = command_denial(payload.get("tool_input", {}).get("command", ""))
        if reason:
            print(reason, file=sys.stderr)
            return 2
        return 0
    if not is_fork(os.getcwd()):
        return 0
    if mode == "pre-commit":
        reason = "Do not commit on the upstream mirror main." if git("branch", "--show-current").stdout.strip() == "main" else None
    elif mode == "pre-push":
        reason = check_push(sys.stdin)
    else:
        raise ValueError(f"Unknown guard: {mode}")
    if reason:
        print(reason, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"Fork guard failed: {error}", file=sys.stderr)
        sys.exit(2 if sys.argv[1:2] == ["pre-tool"] else 1)
