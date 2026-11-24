#!/usr/bin/env bash
# ==========================================================
# LÉLU — find and correct the Supabase key the canonical project rejects.
# Run on the Contabo VPS as root, by the owner. Prints names, shapes,
# 12-character sha256 fingerprints and the PROJECT's verdict — never a value.
#
#   bash supabase-key-check.sh check      read-only: identity, file, running process, page, build
#   bash supabase-key-check.sh fix        identity → verified backup → disable ONLY rejected
#                                         entries → restart lelu → verify process AND page
#   bash supabase-key-check.sh rollback   restore the newest backup made by `fix`, restart lelu,
#                                         and prove the original key is running again
#
# Designed for the Contabo web console on a phone: no paste, short commands.
#
# WHICH KEY THE APP USES (one order for server and page): server.ts applies
# plugins/runtimeKeyBridge.ts to its own globals at startup, and the page gets
# the same bridge, so both use resolveBridge()'s first non-empty, browser-safe
# value in THIS order:
#   key: VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ANON_KEY,
#        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY
#   url: VITE_SUPABASE_URL, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL
# Within the file, the LAST assignment of a name wins (systemd and the shell).
#
# Evidence that prompted it (Supabase edge logs, 2026-11-24): every request
# from the server (supabase-js node) and every browser was answered
# 401 UNAUTHORIZED_INVALID_API_KEY, "Not a JWT, too short signature".
#
# Canonical project (the ONLY database LÉLU uses): nrehsldbfxthspikaxvr.
# The publishable key below is public by design (browser key; RLS protects
# the data) and is the project's current, enabled key (fingerprint 1abc3454754f).
# ==========================================================
set -uo pipefail
ENV_FILE=/etc/lelu/lelu.env
BACKUPS=/etc/lelu/backups
APP=/opt/lelu/app
H=http://127.0.0.1:4173
CANON_URL=https://nrehsldbfxthspikaxvr.supabase.co
CANON_KEY=sb_publishable_hb-9gS-K2ycoSf-Y6EbUdA_3s-XNeLV
KEY_ORDER=(VITE_SUPABASE_PUBLISHABLE_KEY SUPABASE_PUBLISHABLE_KEY SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY)
URL_ORDER=(VITE_SUPABASE_URL SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL)
EXPECTED_IP=157.173.116.95
EXPECTED_HOST_FP="SHA256:xtGl0A4EeV4vKuYFpqQXx/MctJWnG/vVEcgfh7yu310"
MARK=supabase-key-check
FAILED=0
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILED=1; }; info() { echo "INFO  $*"; }
is_key_name() { [[ " ${KEY_ORDER[*]} " == *" $1 "* ]]; }
is_url_name() { [[ " ${URL_ORDER[*]} " == *" $1 "* ]]; }

fp() { printf '%s' "$1" | sha256sum | cut -c1-12; }
shape() {  # kind, length, dots, and anything that should not be inside a key
  local v=$1 kind=other extra=""
  case "$v" in sb_publishable_*) kind=publishable;; sb_secret_*|sbp_*) kind=ADMIN-SECRET;; eyJ*) kind=jwt;; esac
  [[ $v =~ [[:space:]] ]] && extra+=" WHITESPACE"
  [[ $v == *\"* || $v == *\'* ]] && extra+=" QUOTES"
  [ "$kind" = jwt ] && { local sig=${v##*.}; extra+=" signature-chars=${#sig}"; }
  echo "kind=$kind length=${#v} dots=$(tr -cd '.' <<<"$v" | wc -c)$extra"
}
browser_safe() { case "$1" in ""|sb_secret_*|sbp_*) return 1;; esac; return 0; }
verdict() {  # the project's answer to this key, sent the way supabase-js sends it
  local code
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "apikey: $1" -H "Authorization: Bearer $1" \
         -H "x-client-info: lelu-supabase-key-check" "$CANON_URL/rest/v1/messages?select=id&limit=1")
  case "$code" in 200) echo "ACCEPTED(200)";; 401|403) echo "REJECTED($code)";; *) echo "NO-ANSWER($code)";; esac
}

# Value of NAME in FILE as the shell reads it (last assignment wins).
file_value() { ( set -a; . "$2" >/dev/null 2>&1; set +a; printf '%s' "${!1:-}" ); }
# Value of NAME as the RUNNING lelu process received it from systemd.
main_pid() { systemctl show lelu -p MainPID --value 2>/dev/null; }
proc_value() {
  local pid; pid=$(main_pid)
  [ -n "$pid" ] && [ "$pid" != 0 ] || return 0
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n "s/^$1=//p" | tail -1
}
# The effective key/url the app uses, by the bridge order, from a source (file path or "proc").
effective() {  # $1 key|url  $2 source  → prints "NAME" (empty if none)
  local order n v
  [ "$1" = key ] && order=("${KEY_ORDER[@]}") || order=("${URL_ORDER[@]}")
  for n in "${order[@]}"; do
    if [ "$2" = proc ]; then v=$(proc_value "$n"); else v=$(file_value "$n" "$2"); fi
    v=$(printf '%s' "$v" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
    [ -z "$v" ] && continue
    [ "$1" = key ] && ! browser_safe "$v" && continue
    echo "$n"; return
  done
}
src_value() { if [ "$2" = proc ]; then proc_value "$1"; else file_value "$1" "$2"; fi; }

page_key() {  # the key the page receives through the runtime bridge (__LELU_SUPABASE_PUBLISHABLE_KEY__)
  local jar; jar=$(mktemp); chmod 600 "$jar"
  ( set -a; . "$ENV_FILE"; set +a
    [ -n "${LELU_ACCESS_PASSWORD:-}" ] && python3 -c 'import os,sys,urllib.parse; sys.stdout.write("password="+urllib.parse.quote(os.environ["LELU_ACCESS_PASSWORD"]))' |
      curl -s -o /dev/null -c "$jar" -X POST --data-binary @- -H 'content-type: application/x-www-form-urlencoded' "$H/auth/login" ) >/dev/null 2>&1
  curl -s -b "$jar" "$H/" | grep -oE '__LELU_SUPABASE_PUBLISHABLE_KEY__"\] *= *"[^"]*"' | sed -E 's/.*= *"([^"]*)"/\1/' | tail -1
  rm -f "$jar"
}

identity() {  # this must be the LÉLU production VPS, or nothing runs
  echo "== VPS identity"
  local fpk; fpk=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{print $2}')
  ip -4 -o addr show 2>/dev/null | grep -qw "$EXPECTED_IP" && ok "this machine holds $EXPECTED_IP" || { bad "this machine does not hold $EXPECTED_IP — stopping"; exit 1; }
  [ "$fpk" = "$EXPECTED_HOST_FP" ] && ok "host key $fpk (matches what GitHub runners see)" || { bad "host key ${fpk:-unreadable} is not $EXPECTED_HOST_FP — stopping"; exit 1; }
  [ -f "$ENV_FILE" ] && systemctl cat lelu >/dev/null 2>&1 && ok "$ENV_FILE and the lelu service exist" || { bad "no $ENV_FILE or no lelu service — stopping"; exit 1; }
}

check() {
  identity
  echo "== canonical project"
  info "canonical key: $(shape "$CANON_KEY") fp=$(fp "$CANON_KEY") project=$(verdict "$CANON_KEY")"
  echo "== $ENV_FILE ($(stat -c '%U:%G %a' "$ENV_FILE" 2>/dev/null))"
  local n v c pv
  for n in "${URL_ORDER[@]}"; do
    v=$(file_value "$n" "$ENV_FILE")
    [ -n "$v" ] && info "file $n: $([ "$v" = "$CANON_URL" ] && echo canonical-project || echo "OTHER (fp=$(fp "$v"))")" || info "file $n: absent"
  done
  for n in "${KEY_ORDER[@]}"; do
    c=$(grep -cE "^[[:space:]]*(export[[:space:]]+)?$n=" "$ENV_FILE")
    v=$(file_value "$n" "$ENV_FILE")
    if [ -z "$v" ]; then info "file $n: absent"; continue; fi
    info "file $n (assigned ${c}×, last wins): $(shape "$v") fp=$(fp "$v") project=$(verdict "$v")"
  done
  n=$(effective key "$ENV_FILE"); info "effective key per the file (bridge order): ${n:-none}"
  echo "== running lelu process (what systemd actually injected), pid $(main_pid)"
  for n in "${KEY_ORDER[@]}"; do
    pv=$(proc_value "$n"); [ -z "$pv" ] && continue
    [ "$pv" = "$(file_value "$n" "$ENV_FILE")" ] && c="same as the file" || c="DIFFERS from the file (systemd parsing)"
    info "process $n: $(shape "$pv") fp=$(fp "$pv") project=$(verdict "$pv") — $c"
  done
  n=$(effective key proc); pv=$(proc_value "$n")
  [ -n "$n" ] && info "the server and page use: $n fp=$(fp "$pv") project=$(verdict "$pv")" || info "the server and page use: no key"
  echo "== page (runtime bridge, what browsers receive)"
  pv=$(page_key); [ -n "$pv" ] && info "page receives: $(shape "$pv") fp=$(fp "$pv") project=$(verdict "$pv")" || info "page: no bridged key observed"
  echo "== build (compiled values; the bridge overrides them when it publishes)"
  local k found=0
  for k in $(grep -rhoE 'sb_publishable_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*' "$APP/dist/assets" 2>/dev/null | sort -u | head -5); do
    found=1; info "dist contains: $(shape "$k") fp=$(fp "$k") project=$(verdict "$k")"
  done
  [ $found = 0 ] && info "dist contains no Supabase key"
}

# Restart lelu and require a NEW, active process that answers /healthz.
restart_lelu() {
  local before after
  before=$(main_pid)
  if ! systemctl restart lelu; then bad "systemctl restart lelu returned non-zero"; return 1; fi
  for _ in $(seq 1 30); do curl -fsS -m 3 "$H/healthz" >/dev/null 2>&1 && break; sleep 2; done
  after=$(main_pid)
  systemctl is-active --quiet lelu || { bad "lelu is not active after restart"; return 1; }
  [ -n "$after" ] && [ "$after" != 0 ] && [ "$after" != "$before" ] || { bad "no new lelu process (pid ${before:-?} → ${after:-?})"; return 1; }
  curl -fsS -m 3 "$H/healthz" >/dev/null 2>&1 || { bad "lelu does not answer /healthz"; return 1; }
  ok "lelu restarted (pid $before → $after), active, /healthz answers"
}

fix() {
  identity
  echo "== precondition: the canonical key is accepted by the canonical project"
  [ "$(verdict "$CANON_KEY")" = "ACCEPTED(200)" ] && ok "canonical key accepted" || { bad "canonical key not accepted — nothing changed"; exit 1; }
  local stamp backup; stamp=$(date -u +%Y%m%dT%H%M%SZ)
  install -d -m 0700 "$BACKUPS"
  backup="$BACKUPS/lelu.env.$stamp.$MARK"
  cp -p "$ENV_FILE" "$backup"
  if cmp -s "$ENV_FILE" "$backup" && [ "$(stat -c '%U:%G %a' "$backup")" = "$(stat -c '%U:%G %a' "$ENV_FILE")" ]; then
    ok "backup $backup — byte-identical, $(stat -c '%U:%G %a' "$backup"), sha256 $(sha256sum "$backup" | cut -c1-12)"
  else bad "backup not verified — nothing changed"; exit 1; fi

  # Only what is wrong changes, line by line: a key assignment the project
  # REJECTS (401/403) or a URL assignment naming another project is commented
  # out (never deleted). Accepted assignments, duplicates and every other
  # line stay byte-identical.
  local tmp; tmp=$(mktemp "$ENV_FILE.XXXX"); chmod 600 "$tmp"
  local n v line wrong disabled=()
  while IFS= read -r line || [ -n "$line" ]; do
    n=$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' <<<"$line")
    wrong=0
    if [ -n "$n" ] && { is_key_name "$n" || is_url_name "$n"; }; then
      v=$( (set -a; eval "$line" >/dev/null 2>&1; printf '%s' "${!n:-}") )
      if is_key_name "$n"; then case "$(verdict "$v")" in REJECTED*) wrong=1;; esac
      elif [ -n "$v" ] && [ "$v" != "$CANON_URL" ]; then wrong=1
      fi
    fi
    if [ $wrong = 1 ]; then printf '# disabled by %s %s: %s\n' "$MARK" "$stamp" "$line" >> "$tmp"; disabled+=("$n")
    else printf '%s\n' "$line" >> "$tmp"; fi
  done < "$ENV_FILE"

  # Add a canonical value only where the EFFECTIVE (bridge-order) choice is
  # missing or still not accepted. SUPABASE_PUBLISHABLE_KEY wins unless a
  # VITE_ key remains — and a remaining VITE_ key was accepted, by construction.
  local added=() ek eu
  eu=$(effective url "$tmp")
  if [ -z "$eu" ] || [ "$(file_value "$eu" "$tmp")" != "$CANON_URL" ]; then
    printf '# added by %s %s\nSUPABASE_URL=%s\n' "$MARK" "$stamp" "$CANON_URL" >> "$tmp"; added+=(SUPABASE_URL)
  fi
  ek=$(effective key "$tmp")
  if [ -z "$ek" ] || [ "$(verdict "$(file_value "$ek" "$tmp")")" != "ACCEPTED(200)" ]; then
    printf '# added by %s %s\nSUPABASE_PUBLISHABLE_KEY=%s\n' "$MARK" "$stamp" "$CANON_KEY" >> "$tmp"; added+=(SUPABASE_PUBLISHABLE_KEY)
  fi
  ek=$(effective key "$tmp"); eu=$(effective url "$tmp")
  if [ "$(verdict "$(file_value "$ek" "$tmp")")" != "ACCEPTED(200)" ] || [ "$(file_value "$eu" "$tmp")" != "$CANON_URL" ]; then
    rm -f "$tmp"; bad "the edited file would still not give an accepted key and the canonical URL — nothing changed"; exit 1
  fi

  # Proof that nothing else moved: undoing exactly what this run did (strip
  # its "disabled" prefix, drop its appended lines) must give back the
  # backup byte for byte (a missing final newline is the only allowed change).
  if ! cmp -s <(sed -E "s/^# disabled by $MARK $stamp: //" "$tmp" | awk -v m="# added by $MARK $stamp" '$0==m{skip=1;next} skip{skip=0;next} {print}') \
              <(cat "$backup"; [ -n "$(tail -c1 "$backup")" ] && echo); then
    rm -f "$tmp"; bad "the rewrite would change lines it must not touch — nothing changed"; exit 1
  fi
  chown root:root "$tmp"; chmod 600 "$tmp"; mv -f "$tmp" "$ENV_FILE"
  ok "edited $ENV_FILE ($(stat -c '%U:%G %a' "$ENV_FILE")); reversing this edit gives the backup byte for byte"
  info "disabled (rejected): ${disabled[*]:-none} | added: ${added[*]:-none} | effective now: key=$ek url=$eu"

  echo "== restart lelu only"
  restart_lelu || { bad "rolling back"; restore "$backup"; exit 1; }
  echo "== verify the running process AND the page"
  local pn pv pk
  pn=$(effective key proc); pv=$(proc_value "$pn")
  [ -n "$pn" ] && [ "$(verdict "$pv")" = "ACCEPTED(200)" ] && ok "server uses $pn (fp $(fp "$pv")): accepted by the project" || bad "server key (${pn:-none}) not accepted"
  [ "$(src_value "$(effective url proc)" proc)" = "$CANON_URL" ] && ok "server uses the canonical project URL" || bad "server URL is not the canonical project"
  pk=$(page_key)
  [ -n "$pk" ] && [ "$(verdict "$pk")" = "ACCEPTED(200)" ] && ok "page receives fp $(fp "$pk"): accepted by the project" || bad "page key ${pk:+fp $(fp "$pk") }not accepted or not observed"
  [ $FAILED = 0 ] && ok "done; undo with: bash $0 rollback" || { bad "verification failed — rolling back"; restore "$backup"; exit 1; }
}

# Restore a backup and prove the ORIGINAL configuration is what runs again.
restore() {
  local backup=$1 ek want got
  cp -p "$backup" "$ENV_FILE" && chown root:root "$ENV_FILE" && chmod 600 "$ENV_FILE"
  cmp -s "$ENV_FILE" "$backup" && ok "restored $ENV_FILE from $backup (byte-identical, $(stat -c '%U:%G %a' "$ENV_FILE"))" || { bad "restore did not reproduce the backup"; return 1; }
  restart_lelu || { bad "lelu did not come back on the restored file — inspect with: systemctl status lelu"; return 1; }
  ek=$(effective key "$backup"); want=$(file_value "$ek" "$backup")
  got=$(proc_value "$(effective key proc)")
  [ "$(fp "$got")" = "$(fp "$want")" ] && ok "running key is the original again (fp $(fp "$got"))" || bad "running key fp $(fp "$got") is not the original fp $(fp "$want")"
}

case "${1:-}" in
  check) check;;
  fix) fix;;
  rollback) identity; b=$(ls -1t "$BACKUPS"/lelu.env.*."$MARK" 2>/dev/null | head -1); [ -n "$b" ] && restore "$b" || bad "no $MARK backup found";;
  *) echo "usage: $0 check | fix | rollback"; exit 2;;
esac
exit $FAILED
