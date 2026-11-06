#!/usr/bin/env bash
# Reproducible headless-Chromium environment for LÉLU browser acceptance.
#
# No sudo, no system-wide changes, no committed OS libraries.
# Downloads the Playwright Chromium dependency closure from the Ubuntu archives
# into a sandboxed apt root and unpacks it into /tmp/sysroot.
set -uo pipefail

ROOT=/tmp/aptroot
SYSROOT=/tmp/sysroot
SUITE=noble
MIRROR=http://archive.ubuntu.com/ubuntu
COMPONENTS="main universe"

LIB_DIRS="usr/lib/x86_64-linux-gnu lib/x86_64-linux-gnu"
CHROME="${CHROME:-$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome}"

fail() { echo "error: $*" >&2; exit 1; }

command -v apt-get >/dev/null || fail "apt-get is required"
command -v dpkg-deb >/dev/null || fail "dpkg-deb is required"

mkdir -p "$ROOT"/{etc/apt/apt.conf.d,etc/apt/preferences.d,etc/apt/sources.list.d,state/lists/partial,cache/archives/partial}
: > "$ROOT/etc/apt/sources.list"
for c in $COMPONENTS; do
  printf 'deb %s %s %s\ndeb %s %s-updates %s\n' \
    "$MIRROR" "$SUITE" "$c" "$MIRROR" "$SUITE" "$c" >> "$ROOT/etc/apt/sources.list"
done
printf 'deb %s %s-security main universe\n' "$MIRROR" "$SUITE" >> "$ROOT/etc/apt/sources.list"

APT=(
  -o "Dir=$ROOT"
  -o "Dir::State=$ROOT/state"
  -o "Dir::State::status=/tmp/aptroot/dpkg.status"
  -o "Dir::Cache=$ROOT/cache"
  -o "Dir::Etc::sourcelist=$ROOT/etc/apt/sources.list"
  -o "Dir::Etc::sourceparts=$ROOT/etc/apt/sources.list.d"
  -o "Dir::Etc::main=$ROOT/etc/apt/apt.conf"
  -o "Dir::Etc::parts=$ROOT/etc/apt/apt.conf.d"
  -o "Debug::NoLocking=1"
  -o "APT::Architecture=amd64"
  -o "APT::Get::Download-Only=true"
)

echo "==> fetching package indices"
apt-get "${APT[@]}" update || fail "index fetch failed"

PKGS=(
  libnspr4 libnss3 libnssutil3 libsmime3 libasound2t64 libatk1.0-0t64
  libatk-bridge2.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libpango-1.0-0
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libgbm1
  libdrm2 libexpat1 libdbus-1-3 libx11-6 libxcb1 libxext6 libglib2.0-0t64
  fonts-dejavu-core
)

echo "==> downloading dependency closure"
apt-get "${APT[@]}" -y install "${PKGS[@]}" || fail "download failed"

mkdir -p "$SYSROOT"
echo "==> unpacking debs into $SYSROOT"
count=0
for deb in "$ROOT"/cache/archives/*.deb; do
  [ -e "$deb" ] || continue
  dpkg-deb -x "$deb" "$SYSROOT" && count=$((count + 1))
done
echo "    unpacked $count packages"

[ -x "$CHROME" ] || fail "chromium not found at $CHROME (set CHROME=...)"

# The unpacked tree is not a chroot: fontconfig's compiled-in /usr/share/fonts
# does not exist on this host, so Chromium found no fonts, laid text out at zero
# width (empty-looking chat bubbles) and eventually aborted in HarfBuzz. Point a
# fontconfig file at the sysroot's own font directory instead.
FONTS_CONF=/tmp/lelu-fonts.conf
mkdir -p /tmp/lelu-fontcache
cat > "$FONTS_CONF" <<FONTCONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$SYSROOT/usr/share/fonts</dir>
  <cachedir>/tmp/lelu-fontcache</cachedir>
</fontconfig>
FONTCONF

LD_PATH=""
for d in $LIB_DIRS; do LD_PATH="$LD_PATH:$SYSROOT/$d"; done
LD_PATH="${LD_PATH#:}"

echo "==> checking shared libraries"
missing=$(LD_LIBRARY_PATH="$LD_PATH" ldd "$CHROME" 2>/dev/null | grep -c "not found")
echo "    missing shared libraries: $missing"
[ "$missing" -eq 0 ] || echo "    warning: $missing libraries still missing"

echo "==> smoke test"
LD_LIBRARY_PATH="$LD_PATH" "$CHROME" --headless=new --no-sandbox --disable-gpu \
  --dump-dom about:blank >/dev/null 2>&1 || fail "chromium did not start"

cat <<EOF

Chromium is ready.

export CHROME="$CHROME"
export LD_LIBRARY_PATH="$LD_PATH"
export FONTCONFIG_FILE="$FONTS_CONF"

Nothing was installed system-wide; $SYSROOT and $ROOT are disposable.
EOF
