#!/usr/bin/env bash
# ==========================================================
# LÉLU — BROWSER SYSTEM LIBRARIES (rootless)
#
# The real-browser verifications (scripts/verify-*-layering.mjs and friends)
# need Chromium, which needs shared libraries the base container does not
# ship. On GitHub Actions a runner has root, so `playwright install
# --with-deps` is the answer — and that is what CI uses.
#
# In a rootless sandbox (this project's cloud runner, `sudo` blocked by
# no-new-privileges) that command cannot install anything. This script does
# the same job without root: it resolves the dependency closure with apt into
# a private state/cache dir, then unpacks the .deb files under
# $HOME/syslibs. Nothing is written outside $HOME and no package is
# registered with the system package manager.
#
# Usage:
#   bash scripts/browser-libs.sh            # chromium (default)
#   bash scripts/browser-libs.sh webkit     # chromium + webkit
#   source "$(bash scripts/browser-libs.sh --env)"   # print env exports
#
# Afterwards either source the printed env file, or use
# artifacts/logs/browser-env.sh which the verification scripts also accept.
# ==========================================================

set -euo pipefail

WITH_WEBKIT=0
PRINT_ENV=0
for arg in "$@"; do
  case "$arg" in
    --env) PRINT_ENV=1 ;;
    webkit) WITH_WEBKIT=1 ;;
  esac
done

if [ -z "${HOME:-}" ]; then
  echo "HOME is not set" >&2
  exit 1
fi

SYSROOT="$HOME/syslibs"
WORK="$HOME/.cache/lelu-apt"
ENVFILE="$SYSROOT/browser-env.sh"

# Chromium (headless shell) closure. t64 suffixes are Ubuntu 24.04's
# time_t migration; the plain names are tried too so this also works on
# older bases.
CHROMIUM_PKGS=(
  libnspr4 libnss3 libnssutil3
  libasound2t64 libasound2
  libatk1.0-0t64 libatk1.0-0
  libatk-bridge2.0-0t64 libatk-bridge2.0-0
  libatspi2.0-0t64 libatspi2.0-0
  libcairo2 libcups2t64 libcups2 libdbus-1-3 libdrm2 libgbm1
  libglib2.0-0t64 libglib2.0-0
  libpango-1.0-0 libpangocairo-1.0-0
  libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3
  libxkbcommon0 libxrandr2 libxi6 libxtst6
  libgl1 libegl1 libgles2 libvulkan1
  libexpat1 libuuid1 libzstd1 liblz4-1 libgcrypt20 libgpg-error0
  libsystemd0 libselinux1 libpcre2-8-0 libffi8
  libfreetype6 libfontconfig1 libpng16-16 libpixman-1-0 libxrender1
  fonts-liberation libx264-164 libx264
)

WEBKIT_PKGS=(
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0
  libgtk-4-1 libgraphene-1.0-0
  libenchant-2-2 libsecret-1-0 libhyphen0 libmanette-0.2-0
  libwoff1 libharfbuzz-icu0 libwebpdemux2 libwebpmux3
  libepoxy0 libopus0 liborc-0.4-0
  libsoup-3.0-0 libjavascriptcoregtk-4.1-0 libwebkit2gtk-4.1-0
  libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libflite1
  libavif16 gstreamer1.0-libav
)

PKGS=("${CHROMIUM_PKGS[@]}")
if [ "$WITH_WEBKIT" = "1" ]; then
  PKGS+=("${WEBKIT_PKGS[@]}")
fi

mkdir -p "$SYSROOT" "$WORK/lists/partial" "$WORK/cache/archives/partial"

APT_OPTS=(
  -o "Dir::State::lists=$WORK/lists"
  -o "Dir::Cache=$WORK/cache"
  -o "Dir::Etc::sourcelist=/etc/apt/sources.list.d/ubuntu.sources"
  -o "Dir::Etc::sourceparts=-"
  -o "APT::Get::List-Cleanup=0"
  -o "Debug::NoLocking=1"
  -o "Dpkg::Use-Pty=0"
)

echo "[browser-libs] refreshing package lists into $WORK/lists"
apt-get "${APT_OPTS[@]}" update >/dev/null 2>&1 || {
  # Older bases keep the single-file sources list.
  APT_OPTS[5]="Dir::Etc::sourcelist=/etc/apt/sources.list"
  apt-get "${APT_OPTS[@]}" update >/dev/null
}

: > "$WORK/names.txt"
for pkg in "${PKGS[@]}"; do
  printf '%s\n' "$pkg" >> "$WORK/names.txt"
done

echo "[browser-libs] resolving and downloading ${#PKGS[@]} requested packages"
# --download-only never invokes dpkg: nothing is installed, nothing is
# registered, and an unknown package name only drops that one name.
while read -r pkg; do
  apt-get "${APT_OPTS[@]}" --download-only --yes --no-install-recommends install "$pkg" >/dev/null 2>&1 || true
done < "$WORK/names.txt"

COUNT=0
for deb in "$WORK"/cache/archives/*.deb; do
  [ -e "$deb" ] || continue
  dpkg-deb -x "$deb" "$SYSROOT"
  COUNT=$((COUNT + 1))
done
echo "[browser-libs] unpacked $COUNT packages into $SYSROOT"

cat > "$ENVFILE" <<EOF
# Written by scripts/browser-libs.sh — rootless browser system libraries.
export LD_LIBRARY_PATH="$SYSROOT/usr/lib/x86_64-linux-gnu:$SYSROOT/lib/x86_64-linux-gnu:$SYSROOT/usr/lib:\${LD_LIBRARY_PATH:-}"
export FONTCONFIG_PATH="$SYSROOT/etc/fonts"
export FONTCONFIG_FILE="$SYSROOT/etc/fonts/fonts.conf"
export XDG_DATA_DIRS="$SYSROOT/usr/share:\${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
EOF

if [ "$PRINT_ENV" = "1" ]; then
  printf '%s\n' "$ENVFILE"
  exit 0
fi

echo "[browser-libs] environment written to $ENVFILE"
echo "[browser-libs] run:  source $ENVFILE"
