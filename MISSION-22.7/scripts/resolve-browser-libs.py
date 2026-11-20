#!/usr/bin/env python3
"""Fetch Chromium's missing Ubuntu Noble libraries into a local prefix.

No root, no apt install: the Noble package indexes are read, the 14 root
libraries and their dependencies are resolved, each .deb is downloaded and
unpacked with dpkg-deb -x. Point LD_LIBRARY_PATH at extract/usr/lib/x86_64-linux-gnu.

Run from the repository root.
"""
import gzip
import os
import re
import subprocess
import sys
import urllib.parse

WORK = os.path.join(os.getcwd(), ".browser-libs")
DEBS = os.path.join(WORK, "debs")
EXTRACT = os.path.join(WORK, "extract")
BASE = "https://archive.ubuntu.com/ubuntu/"
ROOTS = [
    "libxcomposite1", "libxdamage1", "libxfixes3", "libxrandr2", "libasound2t64",
    "libatk1.0-0t64", "libatk-bridge2.0-0t64", "libatspi2.0-0t64", "libcairo2",
    "libcups2t64", "libnspr4", "libnss3", "libpango-1.0-0", "libxkbcommon0",
]
SKIP = {"libc6", "libgcc-s1", "libstdc++6", "zlib1g", "libc6-dev", "libselinux1",
        "libpcre2-8-0", "libselinux1-dev", "base-files", "dpkg"}


def parse(path):
    db, cur = {}, {}
    with gzip.open(path, "rt", errors="replace") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if not line:
                if cur.get("Package"):
                    db[cur["Package"]] = cur
                cur = {}
            elif line[:1] not in " \t" and ":" in line:
                key, value = line.split(":", 1)
                cur[key] = value.strip()
    if cur.get("Package"):
        db[cur["Package"]] = cur
    return db


def main():
    os.makedirs(DEBS, exist_ok=True)
    os.makedirs(EXTRACT, exist_ok=True)
    db = {}
    for suite in ("noble", "noble-updates"):
        path = os.path.join(WORK, f"P-{suite}.gz")
        url = f"{BASE}dists/{suite}/main/binary-amd64/Packages.gz"
        subprocess.run(["curl", "-fsSL", "-A", "Mozilla/5.0", "-o", path, url], check=True)
        db.update(parse(path))

    done, order = set(), []

    def visit(pkg, depth=0):
        if pkg in done or pkg in SKIP or depth > 12:
            return
        entry = db.get(pkg)
        if not entry:
            print(f"missing index entry: {pkg}", file=sys.stderr)
            return
        done.add(pkg)
        order.append(entry)
        for field in ("Pre-Depends", "Depends"):
            for part in entry.get(field, "").split(","):
                alt = part.strip().split("|")[0].strip()
                if alt:
                    visit(re.split(r"[ (:]", alt)[0], depth + 1)

    for root in ROOTS:
        visit(root)

    for entry in order:
        filename = entry["Filename"]
        out = os.path.join(DEBS, os.path.basename(filename))
        if not os.path.exists(out):
            subprocess.run(["curl", "-fsSL", "-A", "Mozilla/5.0", "-o", out, BASE + filename], check=True)
        subprocess.run(["dpkg-deb", "-x", out, EXTRACT], check=True)
    print(f"ready: {len(order)} packages → {EXTRACT}")
    print("export LD_LIBRARY_PATH=$PWD/.browser-libs/extract/usr/lib/x86_64-linux-gnu")


if __name__ == "__main__":
    main()
