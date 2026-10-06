import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("fork_guard.py")
spec = importlib.util.spec_from_file_location("fork_guard", SCRIPT)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class CommandTests(unittest.TestCase):
    def test_dangerous_forms(self):
        for command in [
            "gh repo delete nohat/t3code --yes", "gh repo fork --fork-name=t3code",
            "git push -f origin fork/prod", "git -C /tmp/work push --force-with-lease origin HEAD",
            "git push origin +HEAD:fork/prod", "git merge -X ours upstream/main",
            "git pull --strategy-option=theirs", "git merge -Xtheirs upstream/main",
            "git status; git push --force origin", "git status\ngit push --force origin",
            "bash -c 'git push --force origin'", "bash -lc 'git push --force origin'",
            "git push \\\n--force origin HEAD",
        ]:
            with self.subTest(command=command):
                self.assertIsNotNone(guard.command_denial(command))

    def test_normal_commands(self):
        for command in ["git push origin HEAD", "git fetch upstream --prune", "git merge upstream/main",
                        "gh issue view 6", "gh repo fork", "echo 'git push --force'", "echo git push --force",
                        "git diff -- docs/fork/maintenance.md"]:
            with self.subTest(command=command):
                self.assertIsNone(guard.command_denial(command))


class GitHookTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.run_git("init", "-b", "main")
        self.run_git("config", "user.email", "test@example.com")
        self.run_git("config", "user.name", "test")
        self.run_git("remote", "add", "origin", "https://github.com/nohat/t3code.git")
        self.run_git("commit", "--allow-empty", "-m", "first")
        self.first = self.run_git("rev-parse", "HEAD")
        self.run_git("commit", "--allow-empty", "-m", "second")
        self.second = self.run_git("rev-parse", "HEAD")
        self.run_git("update-ref", "refs/remotes/upstream/main", self.second)

    def tearDown(self):
        self.directory.cleanup()

    def run_git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, text=True, capture_output=True, check=True).stdout.strip()

    def hook(self, mode, body="", **env):
        return subprocess.run(["python3", str(SCRIPT), mode], cwd=self.root, input=body,
                              text=True, capture_output=True, env={**os.environ, **env})

    def push(self, local, remote, target="fork/prod", **env):
        return self.hook("pre-push", f"refs/heads/test {local} refs/heads/{target} {remote}\n", **env)

    def test_main_commits_refused_and_feature_commits_allowed(self):
        self.assertEqual(self.hook("pre-commit").returncode, 1)
        self.run_git("checkout", "-b", "feat/test")
        self.assertEqual(self.hook("pre-commit").returncode, 0)

    def test_prod_fast_forward_only_including_deletion(self):
        self.assertEqual(self.push(self.second, self.first).returncode, 0)
        self.assertEqual(self.push(self.first, self.second).returncode, 1)
        self.assertEqual(self.push("0" * 40, self.second).returncode, 1)
        self.assertEqual(self.push(self.second, "0" * 40).returncode, 0)

    def test_main_mirror_exception_is_exact_and_fast_forward(self):
        self.assertEqual(self.push(self.second, self.first, "main").returncode, 1)
        self.assertEqual(self.push(self.second, self.first, "main", T3CODE_UPSTREAM_MAIN_FF="1").returncode, 0)
        self.assertEqual(self.push(self.first, self.second, "main", T3CODE_UPSTREAM_MAIN_FF="1").returncode, 1)

    def test_pretool_denies_in_fork_and_leaves_other_repos_alone(self):
        body = json.dumps({"cwd": str(self.root), "tool_input": {"command": "git push --force"}})
        self.assertEqual(self.hook("pre-tool", body).returncode, 2)
        self.run_git("remote", "set-url", "origin", "https://github.com/example/other")
        self.assertEqual(self.hook("pre-tool", body).returncode, 0)

    def test_installed_hook_survives_checkout_of_main(self):
        installer = SCRIPT.with_name("install_git_guards.py")
        subprocess.run(["python3", str(installer), str(self.root)], check=True, capture_output=True)
        result = subprocess.run(["git", "commit", "--allow-empty", "-m", "forbidden"], cwd=self.root, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)

    def test_installer_upgrades_legacy_registration_without_duplicates(self):
        source = self.root / "scripts/fork/agent-config"
        source.mkdir(parents=True)
        for name in ("install.sh", "fork_guard.py", "install_git_guards.py", "t3code-fork-posture.sh"):
            source.joinpath(name).write_bytes(SCRIPT.with_name(name).read_bytes())
        skill = self.root / ".agents/skills/defect-session/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("test skill")
        claude = self.root / "custom-claude"
        claude.mkdir()
        settings = claude / "settings.json"
        settings.write_text(json.dumps({"hooks": {"SessionStart": [{"hooks": [
            {"type": "command", "command": "$HOME/.claude/hooks/t3code-fork-posture.sh"},
            {"type": "command", "command": "echo unrelated"}
        ]}]}}))
        for _ in range(2):
            subprocess.run(["sh", str(source / "install.sh")], cwd=self.root,
                           env={**os.environ, "CLAUDE_HOME": str(claude)}, check=True, capture_output=True)
        data = json.loads(settings.read_text())
        commands = [hook["command"] for entry in data["hooks"]["SessionStart"] for hook in entry["hooks"]]
        self.assertEqual(sum("t3code-fork-posture.sh" in command for command in commands), 1)
        self.assertIn("echo unrelated", commands)
        guards = [hook["command"] for entry in data["hooks"]["PreToolUse"] for hook in entry["hooks"]]
        self.assertEqual(len(guards), 1)
        self.assertIn(str(claude), guards[0])
        self.assertIn("upstream mirror", result.stderr)
        self.run_git("checkout", "-b", "feat/test")
        self.run_git("commit", "--allow-empty", "-m", "allowed")
        self.run_git("checkout", "main")
        result = subprocess.run(["git", "commit", "--allow-empty", "-m", "forbidden again"], cwd=self.root, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
