#!/usr/bin/env python3
"""Deploy the SERVER edition of RetailMind to a Hugging Face Docker Space.

This is the optional route: PostgreSQL, the FastAPI API and the built console share one container
(see the Dockerfile next to this file). Hugging Face only hosts Docker Spaces on paid hardware, so
the account that owns the Space needs a PRO subscription. The free route is the static Space
published by deploy/hf_space.py, which runs the same app entirely in the browser.

The Space is a full copy of this repo plus its own Dockerfile; re-running this script syncs it with
your checkout and Hugging Face rebuilds automatically.

    python deploy/docker-space/deploy.py              # create/sync the Space from this checkout
    python deploy/docker-space/deploy.py --wait       # ...then wait until it is RUNNING (or fails)
    python deploy/docker-space/deploy.py --wait-only  # just watch a build that's already started
    python deploy/docker-space/deploy.py --logs build # print the build (or --logs run) logs

Auth: the token from `hf auth login` (or HF_TOKEN). No secret is uploaded or needed -
the Space generates its own JWT signing key at boot.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

from huggingface_hub import CommitOperationAdd, CommitOperationDelete, HfApi, get_token

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

SKIP_DIRS = {".git", ".github", ".claude", "node_modules", "__pycache__", "dist", ".venv", "venv", ".idea", ".vscode", "test-results", "playwright-report"}
# The repo-root Dockerfile + compose file are the local multi-container setup (the Space
# brings its own Dockerfile); .gitattributes must stay HF's own (it carries the LFS rules).
SKIP_PATHS = {"Dockerfile", "docker-compose.yml", "deploy/docker-space/Dockerfile", ".gitattributes"}

CARD = """---
title: RetailMind Server
emoji: 🛒
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: RetailMind server edition - FastAPI, PostgreSQL and the console in one container
---

"""

FATAL_STAGES = {"BUILD_ERROR", "CONFIG_ERROR", "RUNTIME_ERROR", "DELETING", "STOPPED", "PAUSED"}


def lf(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n")


def collect_files() -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for d, dirs, names in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for n in names:
            path = Path(d) / n
            rel = path.relative_to(ROOT).as_posix()
            if rel in SKIP_PATHS:
                continue
            if n == ".env" or (n.startswith(".env.") and not n.endswith(".example")):
                continue  # real secrets never leave the machine
            if n.endswith((".log", ".pyc")) or n == ".DS_Store":
                continue
            files[rel] = path.read_bytes()

    assert ".env" not in {Path(p).name for p in files}, "refusing to upload a .env file"

    # The Space's own files. Shell scripts / Dockerfiles must be LF (they run on Linux).
    files["Dockerfile"] = lf((HERE / "Dockerfile").read_bytes())
    files["deploy/docker-space/entrypoint.sh"] = lf(files["deploy/docker-space/entrypoint.sh"])
    files["README.md"] = CARD.encode("utf-8") + lf(files["README.md"])
    return files


def deploy(api: HfApi, repo_id: str) -> None:
    files = collect_files()
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", private=False, exist_ok=True)

    remote = set(api.list_repo_files(repo_id, repo_type="space"))
    ops = [CommitOperationAdd(path_in_repo=p, path_or_fileobj=data) for p, data in sorted(files.items())]
    stale = sorted(remote - set(files) - {".gitattributes"})
    ops += [CommitOperationDelete(path_in_repo=p) for p in stale]

    info = api.create_commit(
        repo_id=repo_id,
        repo_type="space",
        operations=ops,
        commit_message="Deploy RetailMind server edition (API + PostgreSQL + UI in one container)",
    )
    print(f"uploaded {len(files)} files, removed {len(stale)} stale -> {info.commit_url}")
    time.sleep(15)  # let the build start before anyone polls the stage


def print_logs(repo_id: str, kind: str, seconds: int = 25, tail: int = 120) -> None:
    """Tail a Space's build/run log (server-sent events; stays open while a build is live)."""
    req = urllib.request.Request(
        f"https://huggingface.co/api/spaces/{repo_id}/logs/{kind}",
        headers={"Authorization": f"Bearer {get_token()}", "Accept": "text/event-stream"},
    )
    lines: list[str] = []
    deadline = time.time() + seconds
    try:
        with urllib.request.urlopen(req, timeout=seconds) as resp:
            for raw in resp:
                text = raw.decode("utf-8", "replace").strip()
                if text.startswith("data:"):
                    try:
                        lines.append(json.loads(text[5:])["data"].rstrip())
                    except (ValueError, KeyError):
                        lines.append(text[5:].strip())
                if time.time() > deadline:
                    break
    except Exception as exc:  # timeout / stream closed
        lines.append(f"[log stream ended: {exc}]")
    print(f"--- {kind} log (last {tail} lines) ---")
    print("\n".join(lines[-tail:]))


def wait_until_running(api: HfApi, repo_id: str, timeout: int) -> int:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        runtime = api.get_space_runtime(repo_id)
        stage = getattr(runtime.stage, "value", str(runtime.stage))
        if stage != last:
            print(f"[{time.strftime('%H:%M:%S')}] stage: {stage}", flush=True)
            last = stage
        if stage == "RUNNING":
            host = api.space_info(repo_id).host
            print(f"RUNNING on {runtime.hardware} -> {host}\nPage: https://huggingface.co/spaces/{repo_id}")
            return 0
        if stage in FATAL_STAGES:
            print_logs(repo_id, "run" if stage == "RUNTIME_ERROR" else "build")
            return 1
        time.sleep(20)
    print(f"timed out after {timeout}s; last stage: {last}")
    return 2


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo-id", help="Space id, default <your-hf-username>/retailmind")
    parser.add_argument("--wait", action="store_true", help="after deploying, wait until the Space is RUNNING")
    parser.add_argument("--wait-only", action="store_true", help="skip the upload, just wait")
    parser.add_argument("--timeout", type=int, default=540, help="seconds to wait (default 540)")
    parser.add_argument("--logs", choices=["build", "run"], help="print that log and exit")
    args = parser.parse_args()

    api = HfApi()
    repo_id = args.repo_id or f"{api.whoami()['name']}/retailmind"

    if args.logs:
        print_logs(repo_id, args.logs)
        return
    if not args.wait_only:
        deploy(api, repo_id)
    if args.wait or args.wait_only:
        sys.exit(wait_until_running(api, repo_id, args.timeout))
    print(f"Space: https://huggingface.co/spaces/{repo_id}  (building - re-run with --wait-only to watch)")


if __name__ == "__main__":
    main()
