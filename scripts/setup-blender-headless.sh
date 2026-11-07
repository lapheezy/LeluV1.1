#!/usr/bin/env bash
# ==========================================================
# LÉLU 3D FORGE — headless Blender, without root
#
# The Forge stages (postprocess, headswap, faceshapes, export)
# shell out to Blender. On a host where it is not installed and
# root is unavailable, the official portable tarball works — but
# its binary still needs a few system shared libraries
# (libSM, libICE, libXrender …) that a bare container lacks.
#
# This installs both into one prefix and prints the two
# environment variables the server needs.
#
#   scripts/setup-blender-headless.sh [prefix] [version]
#   scripts/setup-blender-headless.sh /opt/lelu/blender 5.2.3
#
# Then, for the server process:
#   LELU_BLENDER_BIN=<prefix>/blender-<version>-linux-x64/blender
#   LD_LIBRARY_PATH=<prefix>/libs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
#
# Verified on Ubuntu 24.04 x86_64 (glibc 2.39) with Blender
# 5.2.3 LTS: `blender --background --version`, a Cycles CPU
# render, and GLB/OBJ/STL/FBX/.blend exports all succeed.
# ==========================================================
set -euo pipefail

PREFIX="${1:-$HOME/.local/share/lelu-blender}"
VERSION="${2:-5.2.3}"
BASE="https://download.blender.org/release/Blender${VERSION%.*}"
TARBALL="blender-${VERSION}-linux-x64.tar.xz"
BLENDER_DIR="${PREFIX}/blender-${VERSION}-linux-x64"

mkdir -p "$PREFIX/lists/partial" "$PREFIX/etc" "$PREFIX/cache/archives/partial" "$PREFIX/libs"

echo "==> Blender ${VERSION} → ${BLENDER_DIR}"
if [ ! -x "${BLENDER_DIR}/blender" ]; then
  curl -fL --retry 3 --max-time 1800 -o "${PREFIX}/${TARBALL}" "${BASE}/${TARBALL}"
  tar -xJf "${PREFIX}/${TARBALL}" -C "$PREFIX"
  rm -f "${PREFIX}/${TARBALL}"
fi

echo "==> shared libraries the tarball does not bundle"
if [ ! -f "$PREFIX/etc/sources.list" ]; then
  cat > "$PREFIX/etc/sources.list" <<'SOURCES'
deb http://archive.ubuntu.com/ubuntu noble main universe
deb http://archive.ubuntu.com/ubuntu noble-updates main universe
SOURCES
fi

APT="apt-get -o Dir::State::lists=${PREFIX}/lists -o Dir::Etc::sourcelist=${PREFIX}/etc/sources.list -o Dir::Etc::sourceparts=/dev/null -o Dir::Cache=${PREFIX}/cache -o Debug::NoLocking=1"
if [ -z "$(ls "${PREFIX}"/lists/*Packages* 2>/dev/null || true)" ]; then
  $APT update
fi
( cd "${PREFIX}/cache" && $APT download libsm6 libice6 libxrender1 libxfixes3 libxi6 libxxf86vm1 \
    libxkbcommon0 libegl1 libgl1 libglx0 libglvnd0 libopengl0 libgomp1 libxau6 libxdmcp6 libbsd0 libmd0 ) || true
for deb in "${PREFIX}"/cache/*.deb; do dpkg-deb -x "$deb" "${PREFIX}/libs"; done

echo "==> verifying"
LIBDIR="${PREFIX}/libs/usr/lib/x86_64-linux-gnu"
LD_LIBRARY_PATH="${LIBDIR}:${LD_LIBRARY_PATH:-}" "${BLENDER_DIR}/blender" --background --version | head -1

cat <<EOF

Blender is executable. Give the server these:

  LELU_BLENDER_BIN=${BLENDER_DIR}/blender
  LD_LIBRARY_PATH=${LIBDIR}:\$LD_LIBRARY_PATH

Then check it end to end (no credits are spent):

  curl -s -X POST -H 'Content-Type: application/json' \\
    -d '{"formats":["blend","glb","obj","stl","fbx"],"targetTris":30000}' \\
    http://localhost:3000/api/forge/jobs/<succeeded-job-id>/export

A 503 "Blender is not available on this server" means the binary or its
libraries are not visible to the server process, not that the stage is missing.
EOF
