#!/usr/bin/env bash
# ==========================================================
# LÉLU — put a reviewed front-end fix into production, in place, with rollback.
# Run on the Contabo VPS as root (from the console). Prints names, states,
# hashes and HTTP codes only — never a secret value.
#
#   bash ui-fix.sh recon    <patch>   read-only: identity, HEAD, patch scope, does it apply
#   bash ui-fix.sh apply    <patch>   backup → git apply → typecheck → build into dist.next
#                                     → checks → swap dist (no restart) → verify
#                                     (automatic rollback if any step after the patch fails)
#   bash ui-fix.sh rollback [<stamp>] put back the previous dist/ and reverse the patch
#
# Why a patch: production runs a commit GitHub does not have (a7503839), so
# moving HEAD to a pushed commit could drop what that commit carries. The
# patch may touch ONLY the front-end files listed in FILES; one outside them
# rejects the whole patch. server.ts reads dist/ from disk on every request,
# so the new build is live the moment dist/ is swapped. The lelu service is
# restarted ONLY when the patch changes server code (plugins/), and the old
# dist/ is kept whole for rollback.
#
#   bash ui-fix.sh allow <email>    email + password sign-in for <email> (Supabase);
#                                   the passphrase is retired. Backs up lelu.env,
#                                   sets LELU_ACCESS_EMAILS only, restarts, verifies,
#                                   and puts everything back if the check fails.
#   bash ui-fix.sh allow --off      back to the passphrase (removes that one line)
# ==========================================================
set -uo pipefail
APP=/opt/lelu/app
BK=/var/backups/lelu-ui
H=http://127.0.0.1:4173
EXPECTED_IP=157.173.116.95
ENV_FILE=/etc/lelu/lelu.env
ENV_BK=/etc/lelu/backups
restart_app() { systemctl restart lelu; }
FILES=(
  plugins/accessGate.ts
  src/app/scene/genesis/LeluSignInGate.tsx
  src/app/scene/genesis/GenesisSettingsPanel.tsx
  src/og/components/core/panels/SettingsPanel.tsx
  src/core/persistence/emailAuth.ts
  src/core/persistence/SupabasePersistence.ts
  src/core/voice/VoiceEngine.ts
  src/app/scene/genesis/home/homeComposition.css
  src/app/scene/genesis/avatar/presencePlacement.ts
  src/app/scene/genesis/GenesisCommandPalette.tsx
  src/app/scene/genesis/GenesisInterface.tsx
  src/app/scene/genesis/home/HomeModules.tsx
  src/app/scene/genesis/home/useHomeLive.ts
  src/app/scene/genesis/home/homeWeather.ts
  src/app/scene/genesis/home/spatialNav.css
)
FAILED=0
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILED=1; }; info() { echo "INFO  $*"; }
git_lelu() { runuser -u lelu -- git -C "$APP" "$@"; }
as_lelu() { runuser -u lelu -- bash -c "cd '$APP' && $1"; }

identity() {
  ip -4 -o addr show 2>/dev/null | grep -qw "$EXPECTED_IP" && ok "this machine holds $EXPECTED_IP" || { bad "this is not the LÉLU VPS ($EXPECTED_IP)"; return 1; }
  [ -d "$APP/.git" ] && git_lelu rev-parse -q --verify HEAD >/dev/null || { bad "$APP is not a readable git checkout"; return 1; }
}

scope() {  # $1 = patch → every path it touches must be in FILES
  local patch=$1 f bad_paths=""
  [ -f "$patch" ] || { bad "patch $patch not found"; return 1; }
  local touched; touched=$(git_lelu apply --numstat "$patch" 2>/dev/null | cut -f3) || true
  [ -n "$touched" ] || { bad "the patch touches no file (or is not a patch)"; return 1; }
  while IFS= read -r f; do
    printf '%s\n' "${FILES[@]}" | grep -qxF "$f" || bad_paths+="$f "
  done <<<"$touched"
  [ -z "$bad_paths" ] && ok "patch touches only allowed front-end files ($(wc -l <<<"$touched"))" || { bad "patch touches files outside the allow-list: $bad_paths— rejected"; return 1; }
}

served_ok() {  # the running app is up and serves the build that is on disk
  # 1. the app answers and has a build
  curl -fsS -m 5 "$H/healthz" 2>/dev/null | grep -Eq '"ok": *true' || return 1
  curl -fsS -m 5 "$H/healthz" 2>/dev/null | grep -Eq '"dist": *true' || return 1
  # 2. the page: 200 with the app, or — behind LÉLU's sign-in gate, as in
  #    production — 303 to /auth/login, whose page must load
  local code; code=$(curl -s -m 5 -o /dev/null -w '%{http_code} %{redirect_url}' "$H/" 2>/dev/null)
  case "$code" in
    200*) ;;
    30[1237]*/auth/login) curl -fsS -m 5 -o /dev/null "$H/auth/login" 2>/dev/null || return 1 ;;
    *) return 1 ;;
  esac
  # 3. the build on disk (server.ts reads it per request) is complete: its
  #    index names a script that exists. Gated assets cannot be fetched here.
  local js; js=$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' "$APP/dist/index.html" 2>/dev/null | head -1)
  [ -n "$js" ] && [ -s "$APP/dist$js" ]
}

# The patch usually sits in root's home (0700); git runs as lelu, so it gets a copy
# it can read by name but not list: 0644 in a 0711 directory, removed on exit.
STAGE=$(mktemp -d); chmod 0711 "$STAGE"; trap 'rm -rf "$STAGE"' EXIT
stage() {
  [ -f "${1:-}" ] || { bad "patch ${1:-?} not found" >&2; return 1; }
  install -m 0644 "$1" "$STAGE/ui.patch" && echo "$STAGE/ui.patch"
}

# Credential scan of a build. Prints KIND, FILE and a 12-hex fingerprint per hit,
# never any character of a value. Exit 1 on any hit not on the public list.
#
# Mission 3.7.2: the first production run was refused on false positives only:
#   - `sb_secret_` alone matched supabase-js and LÉLU's own key classifiers,
#     which test startsWith("sb_secret_") to REFUSE secret keys; a real key
#     has a body after the prefix, so the body is now required;
#   - one Google-shaped key: Excalidraw's public Firebase web key, shipped in
#     the @excalidraw/excalidraw npm package (excalidraw-room-persistence).
#     Exactly that key (SHA-256 below) is allowed; any other Google key is not.
PUBLIC_KEY_SHA256="831eae7f580f7721f62d7f654e8c071879bcafd6452d5613f8db051f15082b85"  # Excalidraw's Firebase web key (public by design)
scan_build() {  # $1 = build dir, $2 = label
  python3 -I - "$1" "$2" "$PUBLIC_KEY_SHA256" <<'PY'
import hashlib, os, re, sys
root, label, allowed = sys.argv[1], sys.argv[2], set(sys.argv[3].split())
pat = re.compile(rb"sk-ant-[A-Za-z0-9]|gsk_[A-Za-z0-9]{20}|sk-or-v1-[a-f0-9]{20}|AIza[0-9A-Za-z_-]{30}|sb_secret_[A-Za-z0-9_-]{20,}")
kinds = ((b"sk-ant-", "Anthropic key"), (b"gsk_", "Groq key"), (b"sk-or-v1-", "OpenRouter key"), (b"AIza", "Google API key"), (b"sb_secret_", "Supabase secret key"))
bad = 0
for d, _, files in os.walk(root):
    for f in sorted(files):
        p = os.path.join(d, f)
        try:
            data = open(p, "rb").read()
        except OSError:
            continue
        for m in pat.finditer(data):
            end = m.end()
            while end < len(data) and (chr(data[end]).isalnum() or data[end:end + 1] in b"_-"):
                end += 1
            full = hashlib.sha256(data[m.start():end]).hexdigest()
            kind = next(k for pre, k in kinds if m.group(0).startswith(pre))
            where = os.path.relpath(p, root)
            if full in allowed:
                print(f"INFO  {label}: {kind} {full[:12]} in {where} — on the public list (Excalidraw's Firebase web key)")
            else:
                bad += 1
                print(f"FAIL  {label}: {kind} {full[:12]} in {where} — value not shown")
sys.exit(1 if bad else 0)
PY
}

recon() {  # $1 = the operator's patch file
  local patch; patch=$(stage "${1:?usage: recon <patch>}") || { bad "patch could not be staged — nothing changed"; return; }
  checks "$patch"
}

checks() {  # $1 = STAGED patch; every check apply relies on
  local patch=$1
  echo "== identity"; identity || return
  info "production HEAD $(git_lelu rev-parse HEAD) — $(git_lelu log -1 --format=%s | cut -c1-80)"
  info "modified tracked files: $(git_lelu diff --name-only | wc -l)"
  echo "== patch"; info "patch sha256 $(sha256sum "$patch" | cut -c1-64)"
  scope "$patch" || return
  for f in "${FILES[@]}"; do git_lelu diff --quiet -- "$f" 2>/dev/null || info "has uncommitted production changes: $f"; done
  git_lelu apply --check "$patch" 2>/dev/null && ok "the patch applies cleanly to production's files" \
    || bad "the patch does NOT apply to production's files — production differs from the integration branch here; nothing changed"
  echo "== tooling"
  as_lelu "command -v npx >/dev/null && test -x node_modules/.bin/vite && test -x node_modules/.bin/tsc" && ok "node, vite and tsc present" || bad "build tooling missing in $APP"
  local free; free=$(df -Pm "$APP" | awk 'NR==2{print $4}'); [ "${free:-0}" -gt 1024 ] && ok "disk free ${free} MB" || bad "less than 1 GB free (${free} MB)"
  served_ok && ok "the app serves its current build" || bad "the app is not serving correctly right now"
}

server_code() { git_lelu apply --numstat "$1" 2>/dev/null | cut -f3 | grep -q '^plugins/'; }  # $1 = patch
restart_and_wait() {
  restart_app || { bad "restart failed"; return 1; }
  local i; for i in $(seq 1 30); do served_ok && return 0; sleep 2; done
  return 1
}

restore() {  # $1 = backup dir
  local dir=$1
  echo "== rollback from $dir"
  if [ -d "$dir/dist" ]; then
    [ -d "$APP/dist" ] && mv "$APP/dist" "$dir/dist.failed-$(date -u +%H%M%S)"
    mv "$dir/dist" "$APP/dist" && ok "previous dist/ is back"
  fi
  rm -rf "$APP/dist.next"
  if [ -f "$dir/ui.patch" ] && git_lelu apply -R --check "$dir/ui.patch" 2>/dev/null; then
    git_lelu apply -R "$dir/ui.patch" && ok "patch reversed"
    if [ -f "$dir/restarted" ]; then restart_and_wait && ok "lelu restarted on the previous server code" || bad "lelu not healthy after the rollback restart"; fi
  elif [ -d "$dir/files" ]; then
    local f; for f in "${FILES[@]}"; do [ -f "$dir/files/$f" ] && install -m 0644 -o lelu -g lelu "$dir/files/$f" "$APP/$f"; done
    info "front-end files restored from copies"
  fi
  git_lelu diff > "$dir/drift-after-rollback.patch"
  cmp -s "$dir/drift-after-rollback.patch" "$dir/prev-drift.patch" && ok "working tree identical to before apply" || bad "working tree differs from the pre-apply state — compare $dir/prev-drift.patch"
  served_ok && ok "the app serves the previous build" || bad "the app is not serving after rollback"
}

apply_fix() {
  local patch; patch=$(stage "${1:?usage: apply <patch>}") || { bad "patch could not be staged — nothing changed"; return; }
  checks "$patch"; [ $FAILED = 0 ] || { bad "apply refused: the checks did not pass — nothing changed"; return; }
  local stamp; stamp=$(date -u +%Y%m%dT%H%M%SZ); local dir="$BK/$stamp"
  echo "== backup → $dir"
  install -d -m 0711 "$BK" && install -d -m 0711 "$dir" "$dir/files"
  install -m 0644 "$patch" "$dir/ui.patch"
  git_lelu diff > "$dir/prev-drift.patch"; git_lelu rev-parse HEAD > "$dir/head"
  local f; for f in "${FILES[@]}"; do [ -f "$APP/$f" ] && install -D -m 0644 "$APP/$f" "$dir/files/$f"; done
  ok "backup written (patch, pre-apply drift, ${#FILES[@]} file copies)"
  echo "== apply"
  git_lelu apply "$dir/ui.patch" && ok "patch applied (HEAD unchanged: $(git_lelu rev-parse --short HEAD))" || { bad "git apply failed"; restore "$dir"; return; }
  echo "== typecheck and build (into dist.next; the live dist/ is untouched)"
  as_lelu "npx tsc -p tsconfig.app.json --noEmit" >"$dir/typecheck.log" 2>&1 && ok "typecheck clean" || { bad "typecheck failed (see $dir/typecheck.log)"; restore "$dir"; return; }
  # The build reads public VITE_* values only, as install.sh does; nothing is printed.
  ( set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a; as_lelu "npx vite build --outDir dist.next --emptyOutDir" ) >"$dir/build.log" 2>&1 \
    && [ -f "$APP/dist.next/index.html" ] && ok "build complete ($(find "$APP/dist.next" -type f | wc -l) files)" || { bad "build failed (see $dir/build.log)"; restore "$dir"; return; }
  echo "== credential scan"
  [ -d "$APP/dist" ] && { scan_build "$APP/dist" "live build (information only)" || true; }
  scan_build "$APP/dist.next" "new build" || { bad "a credential pattern appears in the new build — not swapped"; restore "$dir"; return; }
  ok "no credential patterns in the new build"
  echo "== swap"
  mv "$APP/dist" "$dir/dist" && mv "$APP/dist.next" "$APP/dist" && ok "dist/ swapped; previous build kept in $dir/dist" || { bad "swap failed"; restore "$dir"; return; }
  if server_code "$dir/ui.patch"; then
    touch "$dir/restarted"
    restart_and_wait && ok "lelu restarted on the new server code" || { bad "lelu not healthy after restart"; restore "$dir"; return; }
  fi
  local i; for i in $(seq 1 10); do served_ok && break; sleep 1; done
  served_ok && ok "the app serves the new build" || { bad "the new build is not served"; restore "$dir"; return; }
  info "rollback: bash ui-fix.sh rollback $stamp"
}

allow() {  # $1 = email | --off
  local arg=${1:-}
  [ -f "$ENV_FILE" ] || { bad "$ENV_FILE not found"; return; }
  if [ "$arg" != --off ] && ! [[ $arg =~ ^[^[:space:]@,]+@[^[:space:]@,]+\.[^[:space:]@,]+$ ]]; then
    bad "usage: allow <email> | allow --off"; return
  fi
  local stamp; stamp=$(date -u +%Y%m%dT%H%M%SZ)
  install -d -m 0700 "$ENV_BK"
  local backup="$ENV_BK/lelu.env.$stamp.access-emails"
  install -m 0600 "$ENV_FILE" "$backup" && ok "lelu.env backed up (values not shown)"
  local tmp; tmp=$(mktemp); chmod 0600 "$tmp"
  grep -v '^[[:space:]]*LELU_ACCESS_EMAILS=' "$ENV_FILE" > "$tmp" || true
  [ "$arg" = --off ] || printf 'LELU_ACCESS_EMAILS=%s\n' "$(tr 'A-Z' 'a-z' <<<"$arg")" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"   # in place: owner, mode and inode unchanged
  ok "only LELU_ACCESS_EMAILS changed ($(diff <(grep -v '^[[:space:]]*LELU_ACCESS_EMAILS=' "$backup") <(grep -v '^[[:space:]]*LELU_ACCESS_EMAILS=' "$ENV_FILE") >/dev/null && echo 'every other line identical' || echo 'OTHER LINES DIFFER'))"
  local want='name="email"'; [ "$arg" = --off ] && want='Passphrase'
  if restart_and_wait && curl -fsS -m 5 "$H/auth/login" 2>/dev/null | grep -q "$want"; then
    ok "$([ "$arg" = --off ] && echo "passphrase sign-in is back" || echo "the sign-in page is Email + Password for the allowed address")"
    info "undo: bash ui-fix.sh allow --off   (or restore $backup)"
  else
    bad "the sign-in page did not switch — restoring lelu.env"
    cat "$backup" > "$ENV_FILE"
    restart_and_wait && ok "previous sign-in restored" || bad "lelu not healthy after restoring lelu.env"
  fi
}

rollback() {
  local stamp=${1:-$(ls -1 "$BK" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -1)}
  [ -n "$stamp" ] && [ -d "$BK/$stamp" ] || { bad "no backup ${stamp:-found} in $BK"; return; }
  restore "$BK/$stamp"
}

case "${1:-}" in
  recon) recon "${2:-}";;
  apply) apply_fix "${2:-}";;
  rollback) rollback "${2:-}";;
  allow) allow "${2:-}";;
  *) echo "usage: $0 recon <patch> | apply <patch> | rollback [<stamp>] | allow <email>|--off"; exit 2;;
esac
exit $FAILED
