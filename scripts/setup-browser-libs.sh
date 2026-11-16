#!/usr/bin/env bash
# ---------------------------------------------------------------
# Playwright Chromium on this image is missing its shared library
# set (libnspr4, libnss3, the atk/atspi/alsa/X11 libs), and there
# is no sudo. A plain `npx playwright install-deps` cannot run, so
# resolve the debs from the distro's own package index, unpack them
# into a private prefix and print the LD_LIBRARY_PATH to use.
#
#   bash scripts/setup-browser-libs.sh          # install
#   eval "$(bash scripts/setup-browser-libs.sh --env)"   # export it
#
# Verified on Ubuntu 24.04 (noble) with Chromium 1234 from
# playwright 1.62.1.
# ---------------------------------------------------------------
set -euo pipefail
PREFIX="${LELU_BROWSER_LIBS:-/tmp/lelu-browser-libs}"
. /etc/os-release
CODENAME="${VERSION_CODENAME:-noble}"

if [ "${1:-}" != "--env" ]; then
  python3 - "$CODENAME" "$PREFIX" <<'PY'
import gzip, os, subprocess, sys, urllib.request

code, prefix = sys.argv[1], sys.argv[2]
want = {
    "libasound2t64", "libatk-bridge2.0-0t64", "libatk1.0-0t64", "libatspi2.0-0t64",
    "libnspr4", "libnss3", "libxcomposite1", "libxdamage1", "libxfixes3",
    "libxkbcommon0", "libxrandr2",
}
found = {}
for comp in ("main", "universe"):
    url = f"http://archive.ubuntu.com/ubuntu/dists/{code}/{comp}/binary-amd64/Packages.gz"
    try:
        raw = gzip.decompress(urllib.request.urlopen(url, timeout=90).read()).decode("utf-8", "replace")
    except Exception as exc:  # a missing component is not fatal
        print(f"  index {comp} unavailable: {exc}")
        continue
    pkg = None
    for line in raw.splitlines():
        if line.startswith("Package: "):
            pkg = line[9:].strip()
        elif line.startswith("Filename: ") and pkg in want and pkg not in found:
            found[pkg] = line[10:].strip()

os.makedirs(prefix, exist_ok=True)
for pkg, path in sorted(found.items()):
    deb = os.path.join(prefix, f"{pkg}.deb")
    if not os.path.exists(deb):
        urllib.request.urlretrieve("http://archive.ubuntu.com/ubuntu/" + path, deb)
    subprocess.run(["dpkg-deb", "-x", deb, os.path.join(prefix, "root")], check=True)
    print(f"  extracted {pkg}")
print(f"missing from the index: {sorted(want - found.keys()) or 'none'}")
PY
fi

LIBDIR="$PREFIX/root/usr/lib/x86_64-linux-gnu"
if [ "${1:-}" = "--env" ]; then
  echo "export LD_LIBRARY_PATH=\"$LIBDIR\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}\""
else
  echo
  echo "Libraries are in $LIBDIR"
  echo "Run with:"
  echo "  eval \"\$(bash scripts/setup-browser-libs.sh --env)\""
fi
