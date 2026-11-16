#!/usr/bin/env bash
# LÉLU — local browser libraries for this VM
#
# The cloud worktree has no root, so Playwright's browser binaries are present
# while their shared libraries are not. This fetches the packages into a local
# prefix and points LD_LIBRARY_PATH at it, which is enough to run the real
# reproduction scripts in Chromium and WebKit without sudo.
#
#   bash scripts/local-browser-libs.sh            # install (idempotent)
#   LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu node scripts/verify-...
set -euo pipefail

PREFIX=${PREFIX:-/tmp/libs}
LISTS=${LISTS:-/tmp/apt/lists}
CACHE=${CACHE:-/tmp/apt/cache}
DEBS=${DEBS:-/tmp/debs}

mkdir -p "$PREFIX" "$LISTS/partial" "$CACHE/archives/partial" "$DEBS"

apt-get -o Dir::State::lists="$LISTS" -o Dir::Cache="$CACHE" -o Debug::NoLocking=1 update >/dev/null

# Chromium needs the first group; WebKit adds the rest (GTK4, GStreamer,
# flite speech, image codecs, Wayland, GLES).
PACKAGES=(
  libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libasound2t64
  libxi6 libxrender1 libxtst6 libxext6 libx11-6
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libflite1
  libwebpdemux2 libavif16 libharfbuzz-icu0 libepoxy0 libjpeg-turbo8
  libpng16-16t64 libfreetype6 libfontconfig1 libwebpmux3 libwebp7
  libwayland-server0 libwayland-egl1 libwayland-client0 libmanette-0.2-0
  libenchant-2-2 libhyphen0 libsecret-1-0 libgles2 libx264-164
  libgtk-4-1 libgraphene-1.0-0 libxcursor1 libxinerama1 libcairo2
  libpango-1.0-0 libpangocairo-1.0-0 libcairo-gobject2 libthai0
  libdatrie1 libgraphite2-3 libpixman-1-0 libxcb-render0 libxcb-shm0
  liborc-0.4-0 libunwind8 libdw1 libelf1 libbz2-1.0 liblzma5 libzstd1
  libbrotli1 libgdk-pixbuf-2.0-0 libjbig0 libdeflate0 libsharpyuv0
  libgmodule-2.0-0 libglib2.0-0 libmount1 libselinux1 libpcre2-8-0
  libmpg123-0 libtwolame0 libwavpack1 libclutter-1.0-0 libcogl20
  libharfbuzz0b libxslt1.1 liblcms2-2 libevent-2.1-7t64 libopus0
  libgstreamer-plugins-bad1.0-0 libdw1 libpangoft2-1.0-0 libtiff6
  libdav1d7 libgav1-1 librav1e0 libsvtav1enc1d1 libaom3 libyuv0
  libevdev2 libgudev-1.0-0
)

cd "$DEBS"
for pkg in "${PACKAGES[@]}"; do
  apt-get -o Dir::State::lists="$LISTS" -o Dir::Cache="$CACHE" -o Debug::NoLocking=1 download "$pkg" >/dev/null 2>&1 || true
done

for deb in ./*.deb; do
  [ -e "$deb" ] || continue
  dpkg-deb -x "$deb" "$PREFIX"
done

# Some sonames are versioned in the package but not in the binary's NEEDED
# entry (libx264). Symlink the unversioned name alongside.
for lib in "$PREFIX"/usr/lib/x86_64-linux-gnu/libx264.so.*; do
  [ -e "$lib" ] && ln -sf "$(basename "$lib")" "$PREFIX/usr/lib/x86_64-linux-gnu/libx264.so"
done

# FONTS. The image also ships without a single font, and headless Chromium then
# paints every glyph as nothing at all — screenshots look like empty skeleton
# blocks even though the DOM text is correct. Fontconfig config + DejaVu fix it.
FONTDEBS=${FONTDEBS:-/tmp/fonts}
mkdir -p "$FONTDEBS"
for pkg in fontconfig-config fonts-dejavu-core; do
  (cd "$FONTDEBS" && apt-get -o Dir::State::lists="$LISTS" -o Dir::Cache="$CACHE" -o Debug::NoLocking=1 download "$pkg" >/dev/null 2>&1) || true
done
for deb in "$FONTDEBS"/*.deb; do
  [ -e "$deb" ] || continue
  dpkg-deb -x "$deb" "$PREFIX"
done
mkdir -p /tmp/fontcache
cat > "$PREFIX/etc/fonts/lelu.conf" <<'CONF'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>/tmp/libs/usr/share/fonts</dir>
  <cachedir>/tmp/fontcache</cachedir>
</fontconfig>
CONF

echo "libraries installed under $PREFIX"
echo "run browsers with: LD_LIBRARY_PATH=$PREFIX/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=$PREFIX/etc/fonts/lelu.conf"
