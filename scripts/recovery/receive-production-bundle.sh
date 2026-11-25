#!/usr/bin/env bash
# ==========================================================
# LÉLU — receive production's sealed source export (integration side).
#
#   keygen  [keydir]                         new RSA-4096 recipient key; private
#                                            half 0600 in keydir, never printed
#   open    <file.sealed> <plain-sha256> <outdir> [keydir]
#                                            unseal; the bundle is accepted ONLY
#                                            if its SHA-256 equals the one the
#                                            owner read on the Contabo console
#   import  <file.bundle> <repo> [branch-prefix]
#                                            fetch the production history into
#                                            NEW local branches <prefix>/<sha12>
#                                            (+ -drift); never overwrites a ref,
#                                            never checks out, never pushes,
#                                            runs no hook
#   inventory <repo> <branch> <base-ref>    production-only commits vs base
#
# Why sealed: the VPS cannot reach this session and this session cannot reach
# the VPS (no SSH by design), so the owner carries the file. Sealing makes the
# carrier irrelevant to confidentiality; the out-of-band SHA-256 makes it
# irrelevant to authenticity (anyone can seal to a PUBLIC key, nobody can make
# a different bundle with the owner's hash).
# ==========================================================
set -euo pipefail
die() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "PASS  $*"; }
info() { echo "INFO  $*"; }
KEYDIR_DEFAULT="${HOME}/.lelu-recovery"
G=(git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c protocol.file.allow=always)

case "${1:-}" in
  keygen)
    kd=${2:-$KEYDIR_DEFAULT}
    [ -e "$kd/private.pem" ] && die "$kd/private.pem exists — refusing to replace a key an export may be sealed to"
    install -d -m 0700 "$kd"
    ( umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$kd/private.pem" 2>/dev/null )
    openssl pkey -in "$kd/private.pem" -pubout -out "$kd/public.pem"
    ok "recipient key $(openssl pkey -pubin -in "$kd/public.pem" -outform DER | sha256sum | cut -c1-16)… (public: $kd/public.pem)"
    ;;

  open)
    sealed=${2:?sealed file}; want=${3:?plain sha256 from the console}; out=${4:?output dir}; kd=${5:-$KEYDIR_DEFAULT}
    want=$(printf '%s' "$want" | tr 'A-F' 'a-f' | tr -d ' \n')
    [[ $want =~ ^[0-9a-f]{64}$ ]] || die "the expected SHA-256 must be the full 64 hex characters shown on the console"
    [ -f "$sealed" ] || die "$sealed not found"
    [ -r "$kd/private.pem" ] || die "no private key in $kd — this session cannot open the export"
    [ -e "$out" ] && die "$out exists — use a new, empty directory"
    info "sealed file sha256 $(sha256sum "$sealed" | cut -c1-64)"
    members=$(tar -tf "$sealed" 2>/dev/null | sort | tr '\n' ' ') || die "not a sealed export (unreadable archive)"
    [ "$members" = "bundle.enc key.oaep manifest.txt " ] || die "unexpected archive members: $members"
    install -d -m 0700 "$out"; work=$(mktemp -d); chmod 0700 "$work"
    trap 'rm -rf "$work"' EXIT
    tar -C "$work" --no-same-owner --no-same-permissions -xf "$sealed" manifest.txt key.oaep bundle.enc
    for f in manifest.txt key.oaep bundle.enc; do [ -f "$work/$f" ] && [ ! -L "$work/$f" ] || die "$f is not a regular file"; done
    grep -qx 'format=lelu-sealed-bundle-1' "$work/manifest.txt" || die "unknown export format"
    mine=$(openssl pkey -in "$kd/private.pem" -pubout -outform DER 2>/dev/null | sha256sum | cut -c1-64)
    grep -qx "recipient_sha256=$mine" "$work/manifest.txt" || die "sealed for a different recipient key than this session's"
    ( umask 077
      openssl pkeyutl -decrypt -inkey "$kd/private.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 \
        -in "$work/key.oaep" -out "$work/k" 2>/dev/null ) || die "the key does not open this export"
    ( umask 077; openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass "file:$work/k" -in "$work/bundle.enc" -out "$work/p.bundle" 2>/dev/null ) \
      || die "decryption failed (tampered or truncated file)"
    got=$(sha256sum "$work/p.bundle" | cut -c1-64)
    [ "$got" = "$want" ] || die "bundle SHA-256 $got does not match the console's $want — rejected, nothing kept"
    grep -qx "plain_sha256=$got" "$work/manifest.txt" || die "manifest disagrees with the bundle"
    head=$(sed -n 's/^production_head=//p' "$work/manifest.txt")
    [[ $head =~ ^[0-9a-f]{40}$ ]] || die "manifest has no production head"
    install -m 0600 "$work/p.bundle" "$out/production-${head:0:12}.bundle"
    install -m 0600 "$work/manifest.txt" "$out/manifest.txt"
    ok "bundle SHA-256 $got matches the console"
    ok "opened: $out/production-${head:0:12}.bundle (production HEAD $head)"
    ;;

  import)
    bundle=${2:?bundle}; repo=${3:?repo}; prefix=${4:-production-recovered}
    [ -f "$bundle" ] || die "$bundle not found"
    "${G[@]}" -C "$repo" rev-parse --git-dir >/dev/null || die "$repo is not a git repository"
    heads=$("${G[@]}" bundle list-heads "$bundle") || die "not a git bundle"
    head=$(awk '$2=="HEAD"{print $1}' <<<"$heads"); drift=$(awk '$2=="refs/lelu-export/drift"{print $1}' <<<"$heads")
    [[ $head =~ ^[0-9a-f]{40}$ ]] || die "the bundle has no HEAD"
    # prerequisites are GitHub commits; fetch any this clone lacks (by id, from origin)
    if ! "${G[@]}" -C "$repo" bundle verify -q "$bundle" >/dev/null 2>&1; then
      missing=$("${G[@]}" -C "$repo" bundle verify "$bundle" 2>&1 | sed -n '/lacks these prerequisite/,$p' | grep -oE '[0-9a-f]{40}' | sort -u || true)
      [ -n "$missing" ] || die "bundle does not verify: $("${G[@]}" -C "$repo" bundle verify "$bundle" 2>&1 | tail -2)"
      info "fetching $(wc -l <<<"$missing") prerequisite commit(s) from origin"
      # shellcheck disable=SC2086
      "${G[@]}" -C "$repo" fetch -q --no-tags origin $missing || die "prerequisites are not on origin — production's base is not on GitHub"
      "${G[@]}" -C "$repo" bundle verify -q "$bundle" >/dev/null 2>&1 || die "bundle still does not verify"
    fi
    ok "bundle verifies (all prerequisites present)"
    branch="$prefix/${head:0:12}"
    specs=("HEAD:refs/heads/$branch"); [ -n "$drift" ] && specs+=("refs/lelu-export/drift:refs/heads/$branch-drift")
    want_of() { case "$1" in HEAD:*) echo "$head";; *) echo "$drift";; esac; }
    for spec in "${specs[@]}"; do
      ref=${spec#*:}; cur=$("${G[@]}" -C "$repo" rev-parse -q --verify "$ref" 2>/dev/null || true)
      [ -z "$cur" ] || [ "$cur" = "$(want_of "$spec")" ] || die "$ref already exists at a different commit — refusing to overwrite"
    done
    # no '+': git refuses any non-fast-forward; the check above refuses any change at all
    "${G[@]}" -C "$repo" fetch -q --no-tags --no-write-fetch-head "$bundle" "${specs[@]}" || die "import failed"
    ok "imported production HEAD as local branch $branch$([ -n "$drift" ] && echo " (+ $branch-drift: uncommitted production changes)")"
    info "local only: nothing was pushed"
    ;;

  inventory)
    repo=${2:?repo}; branch=${3:?branch}; base=${4:?base ref}
    echo "== production-only commits ($branch not in $base)"
    "${G[@]}" -C "$repo" log --format='%H %ad %an | %s' --date=iso-strict "$branch" --not "$base" --not --remotes=origin | cat
    echo "== files they change"
    "${G[@]}" -C "$repo" diff --stat=160 "$("${G[@]}" -C "$repo" merge-base "$branch" "$base")" "$branch" | tail -40
    ;;

  *) echo "usage: $0 keygen [keydir] | open <sealed> <plain-sha256> <outdir> [keydir] | import <bundle> <repo> [prefix] | inventory <repo> <branch> <base>"; exit 2;;
esac
