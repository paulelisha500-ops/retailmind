#!/usr/bin/env python3
"""Check that a deployed site serves exactly the files that were built and tested.

    python deploy/verify_live.py https://elisha622-retailmind.static.hf.space/
    python deploy/verify_live.py https://paulelisha500-ops.github.io/retailmind/ --retries 12 --wait 10
    python deploy/verify_live.py URL --dist path/to/dist

Every file of the build is downloaded from the live URL and compared by SHA-256, so "the tests passed on this build"
and "this is what is live" are the same statement. index.html is compared after removing the one inline script
Hugging Face adds to every static Space; a mismatch anywhere else fails the check. Hosts take a little while to
publish a new version, so a failing check is retried (--retries, --wait seconds apart) before giving up.
"""
import argparse
import hashlib
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "retailmind-verify/1.0", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def normalize_html(data: bytes) -> bytes:
    text = data.decode("utf-8", "replace")
    text = re.sub(r"<script>\s*window\.huggingface\s*=.*?</script>", "", text, flags=re.S)  # added by Hugging Face
    return re.sub(r"\s+", " ", text).strip().encode()


def digest(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def compare(base: str, dist: Path) -> tuple[int, list[str]]:
    files = sorted(p for p in dist.rglob("*") if p.is_file())
    bad = []
    for path in files:
        rel = path.relative_to(dist).as_posix()
        local = path.read_bytes()
        try:
            live = fetch(base + rel)
        except urllib.error.URLError as error:
            bad.append(f"{rel}: {getattr(error, 'code', error)}")
            continue
        if rel == "index.html":
            same = digest(live) == digest(local) or normalize_html(live) == normalize_html(local)
        else:
            same = digest(live) == digest(local)
        if not same:
            bad.append(f"{rel}: differs ({len(live)} bytes live, {len(local)} local)")
    return len(files), bad


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="the live site, e.g. https://user.github.io/project/")
    parser.add_argument("--dist", type=Path, default=DEFAULT_DIST, help="the build to compare against (default frontend/dist)")
    parser.add_argument("--retries", type=int, default=1, help="attempts before giving up (default 1)")
    parser.add_argument("--wait", type=int, default=10, help="seconds between attempts (default 10)")
    args = parser.parse_args()

    if not (args.dist / "index.html").is_file():
        print(f"{args.dist}/index.html not found - build the site first")
        return 2
    base = args.url.rstrip("/") + "/"
    for attempt in range(1, args.retries + 1):
        total, bad = compare(base, args.dist)
        print(f"[{attempt}/{args.retries}] {total - len(bad)}/{total} files identical to {args.dist.name} at {base}")
        if not bad:
            return 0
        for line in bad[:10]:
            print("  x", line)
        if attempt < args.retries:
            time.sleep(args.wait)
    return 1


if __name__ == "__main__":
    sys.exit(main())
