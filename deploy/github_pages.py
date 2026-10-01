#!/usr/bin/env python3
"""Publish the built site to GitHub Pages from your own machine, with no CI involved.

The CI workflow (.github/workflows/ci.yml) already publishes every push to main. This script is the manual route:
it pushes frontend/dist to the `gh-pages` branch, which Pages can serve directly.

    cd frontend && npm ci && npm run build      # produces frontend/dist
    python deploy/github_pages.py               # publish to origin's gh-pages branch
    python deploy/github_pages.py --remote upstream --branch pages

One-time: in the repository's Settings -> Pages, choose "Deploy from a branch" -> gh-pages -> / (root)
(or run `gh api -X POST repos/OWNER/REPO/pages -f "source[branch]=gh-pages" -f "source[path]=/"`).
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"


def git(*args: str, cwd: Path, check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, check=check, capture_output=True, text=True)
    return result.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--remote", default="origin", help="git remote to push to (default: origin)")
    parser.add_argument("--branch", default="gh-pages", help="branch Pages serves (default: gh-pages)")
    args = parser.parse_args()

    if not (DIST / "index.html").is_file():
        sys.exit("frontend/dist/index.html not found - run `npm ci && npm run build` in frontend/ first.")

    remote_url = git("remote", "get-url", args.remote, cwd=ROOT)
    revision = git("rev-parse", "--short", "HEAD", cwd=ROOT)

    with tempfile.TemporaryDirectory() as tmp:
        site = Path(tmp) / "site"
        shutil.copytree(DIST, site)
        (site / ".nojekyll").write_text("")  # serve files as they are; no Jekyll processing

        git("init", "-q", "-b", args.branch, cwd=site)
        git("add", "-A", cwd=site)
        git("-c", "user.name=github-pages", "-c", "user.email=noreply@users.noreply.github.com",
            "commit", "-q", "-m", f"Publish {revision}", cwd=site)
        git("push", "-q", "--force", remote_url, f"{args.branch}:{args.branch}", cwd=site)

    print(f"published frontend/dist ({revision}) to {args.remote}/{args.branch}")


if __name__ == "__main__":
    main()
