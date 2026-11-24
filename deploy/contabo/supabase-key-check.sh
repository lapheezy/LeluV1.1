#!/usr/bin/env bash
# ==========================================================
# LÉLU — find and correct the Supabase key the canonical project rejects.
# Run on the Contabo VPS as root, by the owner. Prints names, shapes,
# 12-character sha256 fingerprints and the PROJECT's verdict — never a value.
#
#   bash supabase-key-check.sh check      read-only: identity, file vs running process vs page vs build
#   bash supabase-key-check.sh fix        identity → backup → disable ONLY rejected entries → restart lelu → verify
#   bash supabase-key-check.sh rollback   restore the newest backup made by `fix`, restart lelu
#
# Designed to be run from the Contabo web console on a phone: no paste,
# three short commands, everything else inside this file.
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
EXPECTED_IP=157.173.116.95
EXPECTED_HOST_FP="SHA256:xtGl0A4EeV4vKuYFpqQXx/MctJWnG/vVEcgfh7yu310"
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
  identity
  echo "== precondition: the canonical key is accepted by the canonical project"
  [ "$(verdict "$CANON_KEY")" = "ACCEPTED(200)" ] && ok "canonical key accepted" || { bad "canonical key not accepted — nothing changed"; exit 1; }
  local stamp backup; stamp=$(date -u +%Y%m%dT%H%M%SZ)
  install -d -m 0700 "$BACKUPS"
  backup="$BACKUPS/lelu.env.$stamp.supabase-key-check"
  cp -p "$ENV_FILE" "$backup"
  if cmp -s "$ENV_FILE" "$backup" && [ "$(stat -c '%U:%G %a' "$backup")" = "$(stat -c '%U:%G %a' "$ENV_FILE")" ]; then
    ok "backup $backup — byte-identical, $(stat -c '%U:%G %a' "$backup"), sha256 $(sha256sum "$backup" | cut -c1-12)"
  else bad "backup not verified — nothing changed"; exit 1; fi

  # Only what is wrong changes: a key the project REJECTS (401/403), or a URL
  # naming another project, is commented out — never deleted. Accepted entries
  # and every other line stay byte-identical. A canonical value is added only
  # for a half (URL / key) that has nothing valid left.
  local tmp; tmp=$(mktemp "$ENV_FILE.XXXX"); chmod 600 "$tmp"
  local n v line wrong disabled=() kept_key="" kept_url=""
  while IFS= read -r line || [ -n "$line" ]; do
    n=$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' <<<"$line")
    wrong=0; v=""
    if [ -n "$n" ] && [[ " ${KEY_NAMES[*]} ${URL_NAMES[*]} " == *" $n "* ]]; then
      v=$( (set -a; eval "$line" >/dev/null 2>&1; printf '%s' "${!n:-}") )
      if [[ " ${KEY_NAMES[*]} " == *" $n "* ]]; then
        case "$(verdict "$v")" in REJECTED*) wrong=1;; ACCEPTED*) kept_key=$n;; esac
      elif [ -n "$v" ] && [ "$v" != "$CANON_URL" ]; then wrong=1
      elif [ -n "$v" ]; then kept_url=$n
      fi
    fi
    if [ $wrong = 1 ]; then
      printf '# disabled by supabase-key-check %s (rejected by the canonical project): %s\n' "$stamp" "$line" >> "$tmp"
      disabled+=("$n")
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$ENV_FILE"
  local added=()
  [ -z "$kept_url" ] && { printf '# Canonical Supabase URL (supabase-key-check %s)\nSUPABASE_URL=%s\n' "$stamp" "$CANON_URL" >> "$tmp"; added+=(SUPABASE_URL); }
  [ -z "$kept_key" ] && { printf '# Canonical Supabase key (supabase-key-check %s)\nSUPABASE_PUBLISHABLE_KEY=%s\n' "$stamp" "$CANON_KEY" >> "$tmp"; added+=(SUPABASE_PUBLISHABLE_KEY); }

  # Proof that nothing else moved: every line of the backup that is not a
  # disabled entry must appear, unchanged and in order, in the new file.
  local names_re; names_re=$(IFS='|'; echo "${disabled[*]:-__none__}")
  if ! cmp -s <(grep -vE "^[[:space:]]*(export[[:space:]]+)?($names_re)=" "$backup") \
               <(grep -vE "^# disabled by supabase-key-check $stamp |^# Canonical Supabase (URL|key) \(supabase-key-check $stamp\)$" "$tmp" | head -n "$(grep -vcE "^[[:space:]]*(export[[:space:]]+)?($names_re)=" "$backup")"); then
    rm -f "$tmp"; bad "the rewrite would change lines it must not touch — nothing changed"; exit 1
  fi
  chown root:root "$tmp"; chmod 600 "$tmp"; mv -f "$tmp" "$ENV_FILE"
  ok "edited $ENV_FILE ($(stat -c '%U:%G %a' "$ENV_FILE")); every other line unchanged"
  info "disabled (rejected): ${disabled[*]:-none} | kept (accepted): ${kept_key:-none} ${kept_url:-} | added: ${added[*]:-none}"

  echo "== restart lelu only"
  systemctl restart lelu
  for _ in $(seq 1 30); do curl -fsS -m 3 "$H/healthz" >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS -m 3 "$H/healthz" >/dev/null 2>&1 && ok "lelu healthy after restart" || { bad "lelu not healthy — rolling back"; restore "$backup"; exit 1; }
  echo "== verify"
  local w pv pk; w=$(winner proc); pv=$(proc_value "$w")
  [ -n "$w" ] && [ "$(verdict "$pv")" = "ACCEPTED(200)" ] && ok "server key ($w, fp $(fp "$pv")) accepted by the project" || bad "server key (${w:-none}) still rejected"
  pk=$(page_key)
  if [ -n "$pk" ]; then [ "$(verdict "$pk")" = "ACCEPTED(200)" ] && ok "page key (fp $(fp "$pk")) accepted by the project" || bad "page key rejected"
  else info "page key not observed (the page may not bridge it, or login failed)"; fi
  [ $FAILED = 0 ] && ok "done; undo with: bash $0 rollback" || { bad "verification failed — rolling back"; restore "$backup"; exit 1; }
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
