"""Git-version: läs commit och branch vid uppstart."""
import subprocess
from pathlib import Path

# Git-version (commit, branch) för visning på startsidan och i säkerhetskopior
GIT_VERSION: dict = {"commit": None, "branch": None}

# Vid Docker-build sätts commit/branch via build-args och skrivs till dessa filer i /app
BUILD_VERSION_COMMIT_FILE = ".git_commit"
BUILD_VERSION_BRANCH_FILE = ".git_branch"


def _read_git_version() -> None:
    """Sätt GIT_VERSION: först från inbakade filer (Docker), annars från git (lokalt)."""
    app_root = Path(__file__).resolve().parent.parent.parent
    commit_file = app_root / BUILD_VERSION_COMMIT_FILE
    branch_file = app_root / BUILD_VERSION_BRANCH_FILE
    if commit_file.is_file():
        try:
            c = commit_file.read_text(encoding="utf-8").strip()
            if c:
                GIT_VERSION["commit"] = c
        except OSError:
            pass
    if branch_file.is_file():
        try:
            b = branch_file.read_text(encoding="utf-8").strip()
            if b and b != "HEAD":
                GIT_VERSION["branch"] = b
        except OSError:
            pass
    if GIT_VERSION["commit"] is not None and GIT_VERSION["branch"] is not None:
        return
    repo_root = app_root
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=2,
        )
        if r.returncode == 0 and r.stdout:
            GIT_VERSION["commit"] = r.stdout.strip()
        r2 = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=2,
        )
        if r2.returncode == 0 and r2.stdout:
            branch = r2.stdout.strip()
            if branch and branch != "HEAD":
                GIT_VERSION["branch"] = branch
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
