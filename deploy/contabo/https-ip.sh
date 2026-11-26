#!/usr/bin/env bash
# ==========================================================
# LÉLU — trusted HTTPS on the bare production IP (no domain), additive.
# Run on the Contabo VPS as root. Output: names/states/codes only.
#
#   bash https-ip.sh check      read-only: what exists, what is missing
#   bash https-ip.sh stage      serve ACME challenges on :80, then a Let's Encrypt DRY RUN (no cert saved)
#   bash https-ip.sh issue      obtain the real certificate (6-day "shortlived" IP cert, auto-renewed)
#   bash https-ip.sh enable     add :443 to the EXISTING server block; verify a real TLS connection
#   bash https-ip.sh redirect   (after enable) send plain-http visitors to https — ACME stays on http
#   bash https-ip.sh rollback   undo the latest run (repeat to step further back)
#   bash https-ip.sh rollback all   every edited nginx file and the firewall rule back to the original
#
# Why this shape:
#   • Let's Encrypt has issued IP-address certificates to everyone since
#     2026-01-15; they exist only as the ~6-day `shortlived` profile, and
#     Certbot requests them with --ip-address (5.3+; webroot needs 5.4+).
#     Free, no account (registered without email), no domain.
#   • `enable` does NOT write a new site. It adds ONE include line to the
#     server block that already serves the app on :80, so :443 gets the very
#     same locations, proxy headers and limits — no routing can drift.
#   • HTTP keeps working: no redirect, and no HSTS (a 6-day certificate whose
#     renewal ever failed would otherwise lock browsers out of the site).
#     Add both later, once renewals have been observed.
#   • Every nginx edit is backed up, checked with `nginx -t`, and reverted
#     automatically if the check or the external TLS test fails.
# ==========================================================
set -uo pipefail
IP=${LELU_PUBLIC_IP:-157.173.116.95}
NAME=lelu-ip
WEBROOT=/var/www/lelu-acme
SNIP_DIR=${LELU_NGINX_SNIPPETS:-/etc/nginx/snippets}
SNIP_ACME=$SNIP_DIR/lelu-acme.conf
SNIP_TLS=$SNIP_DIR/lelu-tls.conf
SNIP_REDIRECT=$SNIP_DIR/lelu-https-redirect.conf
LIVE=${LELU_TLS_LIVE:-/etc/letsencrypt/live/$NAME}
STATE=/opt/lelu/rollback/https
CURL_CA=${LELU_TLS_TEST_CACERT:+--cacert $LELU_TLS_TEST_CACERT}   # only for an offline rehearsal
FAILED=0
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILED=1; }; info() { echo "INFO  $*"; }
detail() { sed 's/^/DETAIL  /'; }

certbot_bin() {
  for c in /snap/bin/certbot "$(command -v certbot 2>/dev/null)"; do [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return; }; done
}
certbot_ok() {  # >= 5.4 (IP certificates with webroot)
  local c v; c=$(certbot_bin); [ -n "$c" ] || return 1
  v=$("$c" --version 2>&1 | awk '{print $2}')
  python3 -c "import sys; a=[int(x) for x in sys.argv[1].split('.')[:2]]; sys.exit(0 if a>=[5,4] else 1)" "$v" 2>/dev/null
}

# The one nginx file whose :80 server block proxies the app. Exactly one, or we stop.
server_file() {
  nginx -T 2>/dev/null | awk '
    /^# configuration file / { f=$4; sub(/:$/,"",f); next }
    f && /^[[:space:]]*listen[[:space:]]+([0-9.]+:)?80([[:space:];]|$)/ { l[f]++ }
    f && /^[[:space:]]*proxy_pass[[:space:]]+http:\/\/(127\.0\.0\.1:4173|[A-Za-z_]+)/ { p[f]=1 }
    END { for (k in l) if (p[k] && l[k]==1) print k }'
}

backup_file() {  # $1 file → copy under this run's stamp (once)
  local f=$1; install -d -m 0700 "$RUN"
  [ -f "$RUN/files$f" ] || install -D -m 0600 "$f" "$RUN/files$f"
  echo "$f" >> "$RUN/edited"
}

# Insert `include <snippet>;` right after the (single) IPv4 `listen 80` line of $1.
add_include() {
  local f=$1 snip=$2
  grep -qF "include $snip;" "$f" && { info "$(basename "$snip") already included"; return 0; }
  backup_file "$f"
  awk -v inc="    include $snip;  # added by LÉLU https-ip.sh — remove this line to undo" '
    { print } !done && /^[[:space:]]*listen[[:space:]]+([0-9.]+:)?80([[:space:];]|$)/ { print inc; done=1 }' "$f" > "$f.lelu-new" \
    && cat "$f.lelu-new" > "$f" && rm -f "$f.lelu-new"
  grep -qF "include $snip;" "$f"
}

nginx_apply() {  # test, then reload; on failure restore this run's backups
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx && ok "nginx -t ok, reloaded"; return 0; fi
  bad "nginx -t failed — restoring"; nginx -t 2>&1 | tail -3 | detail
  restore_run "$RUN"; return 1
}

restore_run() {
  local run=$1
  [ -f "$run/edited" ] && sort -u "$run/edited" | while read -r f; do cat "$run/files$f" > "$f" && info "restored $(basename "$f")"; done
  [ -f "$run/ufw-added" ] && ufw delete allow 443/tcp >/dev/null 2>&1 && info "removed the ufw 443/tcp rule this run added"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "nginx back to its previous configuration" || bad "nginx -t fails after restore — inspect $run"
}

http_code() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$@"; }
# A reload is asynchronous: old workers keep answering for a moment. Retry a
# probe for up to ~10 s before judging it.
settle() { local i; for i in $(seq 1 10); do "$@" && return 0; sleep 1; done; return 1; }
serves() { [ "$(curl -s -m 5 "$@")" = "$TOK" ]; }
tls_ok() { local t; t=$(curl -s -m 10 $CURL_CA -o /dev/null -w '%{http_code} %{ssl_verify_result}' "https://$IP/healthz"); [ "$t" = "200 0" ]; }

# ===========================================================================
check() {
  echo "== https prerequisites for $IP"
  command -v nginx >/dev/null && ok "nginx $(nginx -v 2>&1 | sed 's/.*\///')" || { bad "nginx missing"; return; }
  local f; f=$(server_file)
  [ "$(echo "$f" | grep -c .)" = 1 ] && ok "app server block found (one file, one IPv4 :80 listen)" && echo "$f" | detail \
    || bad "could not identify exactly one nginx file serving the app on :80 — edit by hand (see DETAIL)"
  local c; c=$(certbot_bin)
  if certbot_ok; then ok "certbot $("$c" --version 2>&1 | awk '{print $2}') (IP certificates supported)"
  else info "certbot ${c:+$("$c" --version 2>&1 | awk '{print $2}') too old}${c:-absent}: stage installs the snap ($(command -v snap >/dev/null && echo snap available || echo 'snap NOT available — install certbot>=5.4 another way'))"; fi
  [ -f "$LIVE/fullchain.pem" ] && info "certificate present, expires $(openssl x509 -enddate -noout -in "$LIVE/fullchain.pem" | cut -d= -f2)" || info "no certificate yet"
  [ -n "$f" ] && { grep -qF "include $SNIP_ACME;" "$f" && info "ACME include present" || info "ACME include absent"; grep -qF "include $SNIP_TLS;" "$f" && info "TLS include present" || info "TLS include absent"; }
  command -v ufw >/dev/null && info "ufw $(ufw status | head -1 | awk '{print $2}')"
  if [ -n "$f" ]; then
    grep -qE 'proxy_set_header[[:space:]]+X-Forwarded-Proto' "$f" && ok "app location sends X-Forwarded-Proto (Secure cookie over HTTPS)" \
      || bad "app location does not send X-Forwarded-Proto — over HTTPS the session cookie would not be Secure"
    grep -qE 'proxy_set_header[[:space:]]+Upgrade' "$f" && info "app location passes WebSocket upgrades" || info "app location does not pass WebSocket upgrades (the app itself serves none; LiveKit connects to its own URL)"
  fi
  echo "== live voice transport (names and schemes only)"
  local lk lkp; lk=$( ( set -a; . /etc/lelu/lelu.env 2>/dev/null; set +a; printf '%s' "${LIVEKIT_URL:-}" ) ); lkp=$( ( set -a; . /etc/lelu/lelu.env 2>/dev/null; set +a; printf '%s' "${LIVEKIT_PUBLIC_URL:-${LIVEKIT_URL:-}}" ) )
  if [ -z "$lk" ]; then info "LiveKit not configured — voice uses the browser session (recognition + Groq Whisper, server speech route)"
  else
    info "LiveKit server URL scheme: ${lk%%://*}; browser URL scheme: ${lkp%%://*}"
    case "$lkp" in wss://*) ok "browser LiveKit URL is wss:// (works from an HTTPS page)";; *) bad "browser LiveKit URL is not wss:// — an HTTPS page cannot open it (mixed content)";; esac
  fi
  ss -ltn 2>/dev/null | grep -qE ':7880\b' && info "a LiveKit server listens locally on :7880" || info "no local LiveKit server on :7880"
  info "http://$IP/healthz → $(http_code "http://$IP/healthz")"
  local t; t=$(curl -s -m 10 $CURL_CA -o /dev/null -w '%{http_code} verify=%{ssl_verify_result}' "https://$IP/healthz" 2>&1)
  info "https://$IP/healthz → $t"
}

stage() {
  RUN=$STATE/$(date -u +%Y%m%dT%H%M%SZ)-stage
  echo "== stage: ACME challenge path + Let's Encrypt dry run"
  local f; f=$(server_file); [ "$(echo "$f" | grep -c .)" = 1 ] || { bad "app server block not identified — run check"; exit 1; }
  if ! certbot_ok; then
    command -v snap >/dev/null || { bad "certbot>=5.4 needed and snap is unavailable"; exit 1; }
    snap install --classic certbot >/dev/null 2>&1 && ok "certbot $(/snap/bin/certbot --version 2>&1 | awk '{print $2}') installed (snap; free, no account)" || { bad "snap install certbot failed"; exit 1; }
  fi
  # Each level 0755 explicitly: nginx's worker user must traverse all of them.
  install -d -m 0755 "$WEBROOT" "$WEBROOT/.well-known" "$WEBROOT/.well-known/acme-challenge" "$SNIP_DIR"
  cat > "$SNIP_ACME" <<EOF
# LÉLU — Let's Encrypt http-01 challenges for the IP certificate (https-ip.sh).
location ^~ /.well-known/acme-challenge/ {
    root $WEBROOT;
    default_type text/plain;
    try_files \$uri =404;
}
EOF
  add_include "$f" "$SNIP_ACME" || { bad "could not add the ACME include"; restore_run "$RUN"; exit 1; }
  nginx_apply || exit 1
  TOK=lelu-selftest-$RANDOM; ( umask 022; echo "$TOK" > "$WEBROOT/.well-known/acme-challenge/$TOK" )
  settle serves -H "Host: $IP" "http://127.0.0.1/.well-known/acme-challenge/$TOK" && ok "challenge path served locally" || bad "challenge path not served locally"
  settle serves "http://$IP/.well-known/acme-challenge/$TOK" && ok "challenge path served on http://$IP (public route)" || bad "challenge path not reachable on http://$IP"
  rm -f "$WEBROOT/.well-known/acme-challenge/$TOK"
  info "app still answers: http://$IP/healthz → $(http_code "http://$IP/healthz")"
  if [ "${LELU_SKIP_ACME:-0}" = 1 ]; then info "LELU_SKIP_ACME=1: dry run skipped (rehearsal)"; return; fi
  if "$(certbot_bin)" certonly --dry-run --webroot -w "$WEBROOT" --ip-address "$IP" --preferred-profile shortlived \
       --cert-name "$NAME" --register-unsafely-without-email --agree-tos -n >"$RUN.certbot.txt" 2>&1; then
    ok "Let's Encrypt staging dry run for $IP succeeded"
  else bad "Let's Encrypt dry run failed"; grep -E 'Detail|Error|Type:' "$RUN.certbot.txt" | head -5 | sed 's/^/INFO  /'; fi
}

issue() {
  echo "== issue: real certificate for $IP"
  certbot_ok || { bad "run stage first (certbot>=5.4)"; exit 1; }
  if "$(certbot_bin)" certonly --webroot -w "$WEBROOT" --ip-address "$IP" --preferred-profile shortlived \
       --cert-name "$NAME" --register-unsafely-without-email --agree-tos -n --keep-until-expiring \
       --deploy-hook "systemctl reload nginx" >/tmp/lelu-certbot.txt 2>&1; then
    ok "certificate issued: $(openssl x509 -noout -subject -ext subjectAltName -enddate -in "$LIVE/fullchain.pem" 2>/dev/null | tr '\n' ' ')"
  else bad "issuance failed"; grep -E 'Detail|Error|Type:' /tmp/lelu-certbot.txt | head -5 | sed 's/^/INFO  /'; exit 1; fi
  # 6-day certificates live or die by renewal.
  systemctl list-timers --all 2>/dev/null | grep -E 'certbot' | awk '{print $NF, "next:", $1, $2, $3}' | sed 's/^/INFO  renew timer /'
  "$(certbot_bin)" renew --dry-run --cert-name "$NAME" >/tmp/lelu-renew.txt 2>&1 && ok "renewal dry run succeeded" || bad "renewal dry run failed"
}

enable() {
  RUN=$STATE/$(date -u +%Y%m%dT%H%M%SZ)-enable
  echo "== enable: :443 on the existing app server block"
  [ -f "$LIVE/fullchain.pem" ] && [ -f "$LIVE/privkey.pem" ] || { bad "no certificate at $LIVE — run issue first"; exit 1; }
  local f; f=$(server_file); [ "$(echo "$f" | grep -c .)" = 1 ] || { bad "app server block not identified — run check"; exit 1; }
  local v6=""; grep -qE '^\s*listen\s+\[::\]:80' "$f" && v6="listen [::]:443 ssl;"
  cat > "$SNIP_TLS" <<EOF
# LÉLU — TLS for the bare IP (https-ip.sh). Included from the :80 app block,
# so :443 serves the same locations. No HSTS on purpose (6-day certificate).
listen 443 ssl;
$v6
ssl_certificate     $LIVE/fullchain.pem;
ssl_certificate_key $LIVE/privkey.pem;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:lelu_tls:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
EOF
  add_include "$f" "$SNIP_TLS" || { bad "could not add the TLS include"; restore_run "$RUN"; exit 1; }
  if command -v ufw >/dev/null && ufw status | grep -q '^Status: active' && ! ufw status | grep -qE '^(443|443/tcp|Nginx Full|Nginx HTTPS)\b.*ALLOW'; then
    install -d -m 0700 "$RUN"; ufw allow 443/tcp >/dev/null && touch "$RUN/ufw-added" && ok "ufw: 443/tcp allowed (HTTPS only; nothing else opened)"
  fi
  nginx_apply || exit 1

  echo "== verify (real TLS, public route)"
  if settle tls_ok; then ok "https://$IP/healthz 200, certificate verified by the system trust store"
  else
    local t; t=$(curl -s -m 10 $CURL_CA -o /dev/null -w 'code=%{http_code} verify=%{ssl_verify_result}' "https://$IP/healthz")
    bad "https://$IP/healthz $t — reverting"; restore_run "$RUN"; touch "$RUN/rolled-back"; exit 1
  fi
  openssl s_client -connect "$IP:443" -servername "$IP" </dev/null 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | sed 's/^/INFO  /'
  [ "$(http_code "http://$IP/healthz")" = 200 ] && ok "http://$IP/healthz still 200 (HTTP preserved)" || bad "HTTP broke"
  # Session over HTTPS: the app marks its cookie Secure when nginx says the scheme is https.
  # Read-only: this never signs in, and changes nothing about sign-in.
  grep -qE 'proxy_set_header[[:space:]]+X-Forwarded-Proto' "$f" && ok "app location sends X-Forwarded-Proto: the session cookie is Secure over HTTPS" \
    || bad "app location does not send X-Forwarded-Proto — add 'proxy_set_header X-Forwarded-Proto \$scheme;' to it"
  [ "$(curl -s -m 10 $CURL_CA -o /dev/null -w '%{http_code}' "https://$IP/auth/login")" = 200 ] && ok "sign-in page over HTTPS 200" || bad "sign-in page over HTTPS failed"
  [ "$(curl -s -m 10 $CURL_CA -o /dev/null -w '%{http_code}' "https://$IP/api/voice/status")" = 401 ] && ok "APIs over HTTPS still require a session (401)" || info "https://$IP/api/voice/status did not answer 401"
}

redirect() {
  RUN=$STATE/$(date -u +%Y%m%dT%H%M%SZ)-redirect
  echo "== redirect: plain http → https (certificate renewal stays on http)"
  tls_ok || { bad "https://$IP is not serving a verified certificate — run enable first"; exit 1; }
  local f; f=$(server_file); [ "$(echo "$f" | grep -c .)" = 1 ] || { bad "app server block not identified — run check"; exit 1; }
  cat > "$SNIP_REDIRECT" <<'EOF'
# LÉLU — plain http goes to https (https-ip.sh redirect). ACME challenges stay
# on http so renewals never depend on the certificate they renew. No HSTS.
set $lelu_to_https "";
if ($scheme = http) { set $lelu_to_https "y"; }
if ($request_uri ~ "^/\.well-known/acme-challenge/") { set $lelu_to_https ""; }
if ($lelu_to_https = y) { return 301 https://$host$request_uri; }
EOF
  add_include "$f" "$SNIP_REDIRECT" || { bad "could not add the redirect include"; restore_run "$RUN"; exit 1; }
  nginx_apply || exit 1
  redirected() { [ "$(curl -s -m 10 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$IP/healthz")" = "301 https://$IP/healthz" ]; }
  settle redirected  # a reload takes effect when the new workers take over
  local loc; loc=$(curl -s -m 10 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$IP/healthz")
  if [ "$loc" = "301 https://$IP/healthz" ] && tls_ok; then ok "http://$IP → 301 https://$IP; https 200 with a verified certificate"
  else bad "redirect check failed ($loc) — reverting"; restore_run "$RUN"; touch "$RUN/rolled-back"; exit 1; fi
  local tok; tok=lelu-selftest-$RANDOM; ( umask 022; echo "$tok" > "$WEBROOT/.well-known/acme-challenge/$tok" )
  [ "$(http_code "http://$IP/.well-known/acme-challenge/$tok")" = 200 ] && ok "ACME challenges still served on http (renewals unaffected)" || bad "ACME path is redirected — renewal would break; run: bash https-ip.sh rollback"
  rm -f "$WEBROOT/.well-known/acme-challenge/$tok"
}

# Runs are directories named <UTC stamp>-<stage|enable|redirect>; a restored run is
# marked, never deleted, so repeated `rollback` steps back one layer at a time.
runs() { ls -1d "$STATE"/2*-stage "$STATE"/2*-enable "$STATE"/2*-redirect 2>/dev/null | sort; }
rollback() {
  local arg=${1:-} run
  if [ "$arg" = all ]; then
    echo "== rollback all: every edited file back to its state before the first run"
    local seen="" r f
    for r in $(runs); do
      [ -f "$r/edited" ] || continue
      for f in $(sort -u "$r/edited"); do
        case " $seen " in *" $f "*) continue;; esac
        seen="$seen $f"; cat "$r/files$f" > "$f" && info "restored $(basename "$f") from $(basename "$r")"
      done
      [ -f "$r/ufw-added" ] && [ ! -f "$r/rolled-back" ] && ufw delete allow 443/tcp >/dev/null 2>&1 && info "removed the ufw 443/tcp rule"
      touch "$r/rolled-back"
    done
    nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "nginx back to its original configuration" || bad "nginx -t fails after restore"
  else
    if [ -n "$arg" ]; then run=$arg; else run=$(for r in $(runs); do [ -f "$r/rolled-back" ] || echo "$r"; done | tail -1); fi
    [ -n "$run" ] && [ -d "$run" ] || { bad "nothing to roll back under $STATE"; exit 1; }
    echo "== rollback $(basename "$run")"
    restore_run "$run"; touch "$run/rolled-back"
  fi
  settle bash -c "[ \"\$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://$IP/healthz)\" = 200 ]" && ok "http://$IP/healthz 200" || bad "http://$IP/healthz not 200"
}

install -d -m 0700 "$STATE"
case "${1:-}" in
  check) check;; stage) stage;; issue) issue;; enable) enable;; redirect) redirect;; rollback) rollback "${2:-}";;
  *) echo "usage: $0 check | stage | issue | enable | redirect | rollback [all|<run-dir>]"; exit 2;;
esac
exit $FAILED
