#!/usr/bin/env python3
"""Publish RetailMind to a Hugging Face *static* Space - free, no server, no paid hardware.

The browser edition is plain files (the whole backend runs inside the page), so a static Space
can host it. The Space is a copy of frontend/dist plus a short README card (deploy/hf_space_card.md);
re-running this script syncs it with your latest build and removes files that no longer exist.

    cd frontend && npm ci && npm run build     # produces frontend/dist
    python deploy/hf_space.py                  # create or sync <your-username>/retailmind
    python deploy/hf_space.py --repo-id me/other-name
    python deploy/hf_space.py --check          # list what would be uploaded, change nothing

Auth: the token from `hf auth login` (or the HF_TOKEN environment variable).
"""
import argparse
import sys
from pathlib import Path

from huggingface_hub import CommitOperationAdd, CommitOperationDelete, HfApi

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"
CARD = Path(__file__).resolve().parent / "hf_space_card.md"


def collect_files() -> dict[str, bytes]:
    if not (DIST / "index.html").is_file():
        sys.exit("frontend/dist/index.html not found - run `npm ci && npm run build` in frontend/ first.")
    files = {p.relative_to(DIST).as_posix(): p.read_bytes() for p in sorted(DIST.rglob("*")) if p.is_file()}
    files["README.md"] = CARD.read_bytes().replace(b"\r\n", b"\n")  # the Space card (YAML header + description)
    return files


def deploy(api: HfApi, repo_id: str) -> None:
    files = collect_files()
    api.create_repo(repo_id, repo_type="space", space_sdk="static", private=False, exist_ok=True)

    remote = set(api.list_repo_files(repo_id, repo_type="space"))
    operations = [CommitOperationAdd(path_in_repo=path, path_or_fileobj=data) for path, data in files.items()]
    stale = sorted(remote - set(files) - {".gitattributes"})  # earlier builds' hashed files
    operations += [CommitOperationDelete(path_in_repo=path) for path in stale]

    commit = api.create_commit(
        repo_id=repo_id,
        repo_type="space",
        operations=operations,
        commit_message="Publish RetailMind (browser edition)",
    )
    print(f"uploaded {len(files)} files, removed {len(stale)} stale -> {commit.commit_url}")
    owner, name = repo_id.split("/", 1)
    print(f"Space page: https://huggingface.co/spaces/{repo_id}")
    print(f"Direct app: https://{owner.lower()}-{name.lower()}.static.hf.space")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo-id", help="Space id, default <your-hf-username>/retailmind")
    parser.add_argument("--check", action="store_true", help="list the files that would be uploaded and stop")
    args = parser.parse_args()

    if args.check:
        files = collect_files()
        for path in files:
            print(path)
        print(f"{len(files)} files, {sum(len(d) for d in files.values()) / 1024:.0f} kB")
        return

    api = HfApi()
    deploy(api, args.repo_id or f"{api.whoami()['name']}/retailmind")


if __name__ == "__main__":
    main()
