#!/usr/bin/env python3
"""Mirror the repository's source to a Hugging Face repo, so the code can be browsed next to the live Space.

Hugging Face files a code repository under "models"; the running app is the static Space published by
deploy/hf_space.py. This keeps the code repo in step with git: it uploads every tracked file as it is at HEAD,
puts a short card at the top of the README, and removes files that are no longer tracked.

    python deploy/hf_mirror.py                         # sync <your-username>/retailmind
    python deploy/hf_mirror.py --repo-id me/other --space me/space-name
    python deploy/hf_mirror.py --check                 # list what would change, upload nothing

Auth: the token from `hf auth login` (or HF_TOKEN).
"""
import argparse
import subprocess
import sys
from pathlib import Path

from huggingface_hub import CommitOperationAdd, CommitOperationDelete, HfApi

ROOT = Path(__file__).resolve().parent.parent
KEEP = {".gitattributes"}  # Hugging Face's own LFS rules live here; don't overwrite them

CARD = """---
tags:
- retail
- forecasting
- react
- pwa
---

> **Live app:** https://huggingface.co/spaces/{space} - runs entirely in the browser, no server.
> This repository mirrors the source from https://github.com/paulelisha500-ops/retailmind.

"""


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True).stdout
    return sorted(p for p in out.decode("utf-8").split("\0") if p and (ROOT / p).is_file())


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo-id", help="code repo id, default <your-hf-username>/retailmind")
    parser.add_argument("--space", help="the live Space to link to, default the same id")
    parser.add_argument("--check", action="store_true", help="show what would change and stop")
    args = parser.parse_args()

    api = HfApi()
    repo_id = args.repo_id or f"{api.whoami()['name']}/retailmind"
    space = args.space or repo_id

    files = {}
    for path in tracked_files():
        data = (ROOT / path).read_bytes()
        if path in KEEP:
            continue
        if path == "README.md":
            data = CARD.format(space=space).encode("utf-8") + data.replace(b"\r\n", b"\n")
        elif path.endswith((".sh", "Dockerfile")):
            data = data.replace(b"\r\n", b"\n")  # these run on Linux
        files[path] = data

    remote = set(api.list_repo_files(repo_id, repo_type="model"))
    stale = sorted(remote - set(files) - KEEP)
    print(f"{len(files)} files to upload, {len(stale)} stale to remove from {repo_id}")
    if args.check:
        for path in stale:
            print("  remove", path)
        return

    operations = [CommitOperationAdd(path_in_repo=p, path_or_fileobj=d) for p, d in files.items()]
    operations += [CommitOperationDelete(path_in_repo=p) for p in stale]
    commit = api.create_commit(repo_id=repo_id, repo_type="model", operations=operations, commit_message="Mirror the source from GitHub")
    print(f"done -> {commit.commit_url}")


if __name__ == "__main__":
    main()
