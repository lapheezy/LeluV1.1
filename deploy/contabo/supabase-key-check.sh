#!/usr/bin/env bash
# ==========================================================
# LÉLU — find and correct the Supabase key the canonical project rejects.
# Run on the Contabo VPS as root, by the owner. Prints names, shapes,
# 12-character sha256 fingerprints and the PROJECT's verdict — never a value.
#
#   bash supabase-key-check.sh check      read-only: file vs running process vs page vs build
#   bash supabase-key-check.sh fix        backup → set the canonical pair → restart lelu → verify
#   bash supabase-key-check.sh rollback   restore the newest backup made by `fix`, restart lelu
#
# Evidence that prompted it (Supabase edge logs, 2026-11-24): every request
# from the server (supabase-js node) and every browser was answered
# 401 UNAUTHORIZED_INVALID_API_KEY with "Not a JWT, too short signature",
# while the project's current publishable key answers 200.
#
# Canonical project (the ONLY database LÉLU uses): nrehsldbfxthspikaxvr.
# The publishable key below is public by design (browser key; RLS protects
# the data) and is the project's current, enabled key.
# ==========================================================
set -uo pipefail
ENV_FILE=/etc/lelu/lelu.env
BACKUPS=/etc/lelu/backups
APP=/opt/lelu/app
H=http://127.0.0.1:4173
CANON_URL=https://nrehsldbfxthspikaxvr.supabase.co
CANON_KEY=sb_publishable_hb-9gS-K2ycoSf-Y6EbUdA_3s-XNeLV
# Same names and order as src/core/config/supabaseEnv.ts (first non-empty, non-secret wins).
URL_NAMES=(SUPABASE_URL VITE_SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL)
KEY_NAMES=(SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_ANON_KEY)
FAILED=0
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILED=1; }; info() { echo "INFO  $*"; }

fp() { printf '%s' "$1" | sha256sum | cut -c1-12; }
shape() {  # kind, length, dots, and anything that should not be inside a key
  local v=$1 kind=other
  case "$v" in sb_publishable_*) kind=publishable;; sb_secret_*|sbp_*) kind=ADMIN-SECRET;; eyJ*) kind=jwt;; esac
  local extra=""
  [[ $v =~ [[:space:]] ]] && extra+=" WHITESPACE"
  [[ $v == *\"* || $v == *\'* ]] && extra+=" QUOTES"
  [[ $v == *'$'* ]] && extra+=" DOLLAR"
  if [ "$kind" = jwt ]; then
    local sig=${v##*.}; extra+=" signature-chars=${#sig}"
  fi
  echo "kind=$kind length=${#v} dots=$(tr -cd '.' <<<"$v" | wc -c)$extra"
}
verdict() {  # the project's answer to this key, sent the way supabase-js sends it
  local code
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "apikey: $1" -H "Authorization: Bearer $1" \
         -H "x-client-info: lelu-supabase-key-check" "$CANON_URL/rest/v1/messages?select=id&limit=1")
  case "$code" in 200) echo "ACCEPTED(200)";; 401|403) echo "REJECTED($code)";; *) echo "NO-ANSWER($code)";; esac
}

# Value of NAME as the file states it (last assignment wins, as both systemd and the shell do).
file_value() { ( set -a; . "$ENV_FILE" >/dev/null 2>&1; set +a; printf '%s' "${!1:-}" ); }
# Value of NAME as the RUNNING lelu process received it from systemd.
proc_value() {
  local pid; pid=$(systemctl show lelu -p MainPID --value 2>/dev/null)
  [ -n "$pid" ] && [ "$pid" != 0 ] || return 0
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n "s/^$1=//p" | head -1
}

report_name() {  # $1 name  $2 value  $3 where
  local v=$2
  if [ -z "$v" ]; then info "$3 $1: absent"; return; fi
  info "$3 $1: $(shape "$v") fp=$(fp "$v") project=$(verdict "$v")"
}

winner() {  # first non-empty, non-secret key by the code's precedence
  local where=$1 n v
  for n in "${KEY_NAMES[@]}"; do
    if [ "$where" = file ]; then v=$(file_value "$n"); else v=$(proc_value "$n"); fi
    [ -z "$v" ] && continue
    case "$v" in sb_secret_*|sbp_*) continue;; esac
    echo "$n"; return
  done
}

page_key() {  # the key the page receives through the runtime bridge (__LELU_SUPABASE_PUBLISHABLE_KEY__)
  local jar; jar=$(mktemp); chmod 600 "$jar"
  ( set -a; . "$ENV_FILE"; set +a
    [ -n "${LELU_ACCESS_PASSWORD:-}" ] && python3 -c 'import os,sys,urllib.parse; sys.stdout.write("password="+urllib.parse.quote(os.environ["LELU_ACCESS_PASSWORD"]))' |
      curl -s -o /dev/null -c "$jar" -X POST --data-binary @- -H 'content-type: application/x-www-form-urlencoded' "$H/auth/login" ) >/dev/null 2>&1
  curl -s -b "$jar" "$H/" | grep -oE '__LELU_SUPABASE_PUBLISHABLE_KEY__"\] *= *"[^"]*"' | sed -E 's/.*= *"([^"]*)"/\1/' | head -1
  rm -f "$jar"
}

check() {
  echo "== canonical project"
  info "canonical key: $(shape "$CANON_KEY") fp=$(fp "$CANON_KEY") project=$(verdict "$CANON_KEY")"
  echo "== $ENV_FILE ($(stat -c '%U:%G %a' "$ENV_FILE" 2>/dev/null))"
  for n in "${URL_NAMES[@]}"; do v=$(file_value "$n"); [ -n "$v" ] && info "file $n: $([ "$v" = "$CANON_URL" ] && echo canonical-project || echo "OTHER (host fp=$(fp "$v"))")" || info "file $n: absent"; done
  for n in "${KEY_NAMES[@]}"; do report_name "$n" "$(file_value "$n")" file; done
  info "assignments per key name in the file: $(for n in "${KEY_NAMES[@]}" "${URL_NAMES[@]}"; do c=$(grep -cE "^[[:space:]]*(export[[:space:]]+)?$n=" "$ENV_FILE"); [ "$c" -gt 0 ] && printf '%s×%s ' "$n" "$c"; done)"
  echo "== running lelu process (what systemd actually injected)"
  for n in "${KEY_NAMES[@]}"; do
    pv=$(proc_value "$n"); fv=$(file_value "$n")
    [ -z "$pv" ] && { info "process $n: absent"; continue; }
    [ "$pv" = "$fv" ] && same="same as file" || same="DIFFERS from the file as a shell reads it (systemd parsing)"
    info "process $n: $(shape "$pv") fp=$(fp "$pv") project=$(verdict "$pv") — $same"
  done
  w=$(winner proc); info "the server uses: ${w:-no key} (first by precedence: ${KEY_NAMES[*]})"
  echo "== page (runtime bridge)"
  pk=$(page_key); [ -n "$pk" ] && info "page receives: $(shape "$pk") fp=$(fp "$pk") project=$(verdict "$pk")" || info "page: no bridged key found (or login failed)"
  echo "== build (compiled VITE_ value; the bridge overrides it when set)"
  for k in $(grep -rhoE 'sb_publishable_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*' "$APP/dist/assets" 2>/dev/null | sort -u | head -5); do
    info "dist contains: $(shape "$k") fp=$(fp "$k") project=$(verdict "$k")"
  done
}

fix() {
  echo "== precondition: the canonical key is accepted by the canonical project"
  [ "$(verdict "$CANON_KEY")" = "ACCEPTED(200)" ] && ok "canonical key accepted" || { bad "canonical key not accepted — nothing changed"; exit 1; }
  local stamp; stamp=$(date -u +%Y%m%dT%H%M%SZ)
  install -d -m 0700 "$BACKUPS"
  cp -p "$ENV_FILE" "$BACKUPS/lelu.env.$stamp.supabase-key-check"
  cmp -s "$ENV_FILE" "$BACKUPS/lelu.env.$stamp.supabase-key-check" && ok "backup $BACKUPS/lelu.env.$stamp.supabase-key-check (byte-identical, $(stat -c '%a' "$BACKUPS/lelu.env.$stamp.supabase-key-check"))" || { bad "backup not verified — nothing changed"; exit 1; }
  local tmp; tmp=$(mktemp "$ENV_FILE.XXXX"); chmod 600 "$tmp"
  # Comment out (never delete) every Supabase URL/key assignment the project does not accept,
  # then append the canonical pair once.
  local n v line disabled=()
  while IFS= read -r line || [ -n "$line" ]; do
    n=$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' <<<"$line")
    if [ -n "$n" ] && [[ " ${KEY_NAMES[*]} ${URL_NAMES[*]} " == *" $n "* ]]; then
      printf '# disabled by supabase-key-check %s (replaced by the canonical pair below): %s\n' "$stamp" "$line" >> "$tmp"
      disabled+=("$n")
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$ENV_FILE"
  printf '\n# Canonical Supabase project (supabase-key-check %s)\nSUPABASE_URL=%s\nSUPABASE_PUBLISHABLE_KEY=%s\n' "$stamp" "$CANON_URL" "$CANON_KEY" >> "$tmp"
  chown root:root "$tmp"; chmod 600 "$tmp"; mv -f "$tmp" "$ENV_FILE"
  info "commented out: ${disabled[*]:-none}; set: SUPABASE_URL SUPABASE_PUBLISHABLE_KEY"
  systemctl restart lelu
  for _ in $(seq 1 30); do curl -fsS -m 3 "$H/healthz" >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS -m 3 "$H/healthz" >/dev/null 2>&1 && ok "lelu healthy after restart" || { bad "lelu not healthy — rolling back"; restore "$BACKUPS/lelu.env.$stamp.supabase-key-check"; exit 1; }
  echo "== verify"
  w=$(winner proc); pv=$(proc_value "$w")
  [ "$(verdict "$pv")" = "ACCEPTED(200)" ] && ok "server key ($w) accepted by the project" || bad "server key ($w) still rejected"
  pk=$(page_key); [ -n "$pk" ] && { [ "$(verdict "$pk")" = "ACCEPTED(200)" ] && ok "page key accepted by the project" || bad "page key rejected"; } || info "page key not observed (login?)"
  [ $FAILED = 0 ] && ok "done; rollback with: bash supabase-key-check.sh rollback" || { bad "verification failed — rolling back"; restore "$BACKUPS/lelu.env.$stamp.supabase-key-check"; exit 1; }
}

restore() {
  cp -p "$1" "$ENV_FILE" && chown root:root "$ENV_FILE" && chmod 600 "$ENV_FILE" && ok "restored $ENV_FILE from $1"
  systemctl restart lelu
  for _ in $(seq 1 30); do curl -fsS -m 3 "$H/healthz" >/dev/null 2>&1 && { ok "lelu healthy on the restored file"; return; }; sleep 2; done
  bad "lelu not healthy after restore"
}

case "${1:-}" in
  check) check;;
  fix) fix;;
  rollback) b=$(ls -1t "$BACKUPS"/lelu.env.*.supabase-key-check 2>/dev/null | head -1); [ -n "$b" ] && restore "$b" || bad "no supabase-key-check backup found";;
  *) echo "usage: $0 check | fix | rollback"; exit 2;;
esac
exit $FAILED
