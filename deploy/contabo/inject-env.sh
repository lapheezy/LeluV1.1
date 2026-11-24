#!/usr/bin/env bash
# ==========================================================
# LÉLU — merge provider keys into /etc/lelu/lelu.env, then
# diagnose, restart and verify the service. Runs ON THE VPS as root.
#
# Normally started by scripts/push-provider-env.sh, which streams
# KEY=VALUE lines over ssh stdin. By hand:
#   sudo bash inject-env.sh [--replace] [--no-restart] < incoming.env
#
# Guarantees
#   • values only ever travel on stdin and in root-only files; this
#     script prints variable NAMES, states and HTTP codes, never a value
#     (journal lines are passed through a redactor that knows every value);
#   • the current file is backed up to /etc/lelu/backups/ (0600) first;
#   • existing entries win unless --replace is given; comments, order and
#     unrelated variables are kept; duplicate definitions are collapsed to
#     the last one (the one systemd and bash actually used);
#   • VITE_*, *ANTHROPIC* and CLAUDE_* names are refused here as well as
#     by the sender;
#   • the new file is written next to the old one and renamed over it
#     (atomic), root:root 0600. systemd reads EnvironmentFile= as root
#     before it drops to User=lelu, so the service still gets every key.
# ==========================================================
set -euo pipefail
umask 077
DIR=${LELU_ENV_DIR:-/etc/lelu}   # override only for tests
ENV=$DIR/lelu.env
H=http://127.0.0.1:4173
REPLACE=0; RESTART=1
for a in "$@"; do
  case "$a" in
    --replace) REPLACE=1 ;;
    --no-restart) RESTART=0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "FAIL  run as root" >&2; exit 1; }
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILED=1; }; info() { echo "INFO  $*"; }
FAILED=0

[ -d "$DIR" ] || install -d -o root -g root -m 0700 "$DIR"
WORK=$(mktemp -d "$DIR/.inject.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
cat > "$WORK/incoming"
[ -f "$ENV" ] || : > "$ENV"

# Prints every value in $ENV as [redacted] wherever it appears on stdin.
redact() {
  awk -v envf="$ENV" '
    BEGIN { while ((getline l < envf) > 0) { if (l ~ /^[ \t]*#/ || l !~ /=/) continue
              v = substr(l, index(l, "=") + 1); gsub(/^'\''|'\''$/, "", v); gsub(/^"|"$/, "", v)
              if (length(v) >= 8) vals[++n] = v } }
    { for (i = 1; i <= n; i++) { while ((p = index($0, vals[i])) > 0)
          $0 = substr($0, 1, p - 1) "[redacted]" substr($0, p + length(vals[i])) } print }'
}

echo "== 1. backup"
install -d -o root -g root -m 0700 "$DIR/backups"
BK="$DIR/backups/lelu.env.$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$ENV" "$BK"; chown root:root "$BK"; chmod 0600 "$BK"
ok "backup $BK ($(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$BK" || true) variables)"

echo "== 2. merge"
# awk receives file paths only, never values on its command line.
awk -v replace="$REPLACE" -v report="$WORK/report" '
  function eligible(k) { return k ~ /^[A-Za-z_][A-Za-z0-9_]*$/ && k !~ /^VITE_/ && toupper(k) !~ /ANTHROPIC/ && k !~ /^CLAUDE_/ }
  function quote(v) { return (v ~ /^[A-Za-z0-9_.:\/+=@,-]*$/) ? v : "'\''" v "'\''" }
  FNR == 1 { f++ }
  f == 1 {                                      # pass 1: incoming
    if ($0 == "" ) next
    k = substr($0, 1, index($0, "=") - 1); v = substr($0, index($0, "=") + 1)
    if (index($0, "=") == 0 || !eligible(k)) { print "REFUSED " (index($0, "=") ? k : "(malformed line)") > report; next }
    if (v == "")                              { print "EMPTY " k > report; next }
    if (index(v, "'\''") || v ~ /[\r\n]/)     { print "UNSAFE " k > report; next }
    inc[k] = v; next
  }
  f == 2 {                                      # pass 2: find the last definition of each existing key
    if ($0 ~ /^[ \t]*(export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*=/) { l = $0; sub(/^[ \t]*(export[ \t]+)?/, "", l)
      k = substr(l, 1, index(l, "=") - 1); last[k] = FNR; cnt[k]++ }
    next
  }
  {                                             # pass 3: rewrite existing file
    if ($0 ~ /^[ \t]*(export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*=/) { l = $0; sub(/^[ \t]*(export[ \t]+)?/, "", l)
      k = substr(l, 1, index(l, "=") - 1)
      if (FNR != last[k]) { if (!dup[k]++) print "DEDUPED " k > report; next }
      if (k in inc) {
        cur = substr(l, index(l, "=") + 1); gsub(/^'\''|'\''$/, "", cur); gsub(/^"|"$/, "", cur)
        if (cur == "")                 { print k "=" quote(inc[k]); print "FILLED " k > report }
        else if (cur == inc[k])        { print $0; print "UNCHANGED " k > report }
        else if (replace == 1)         { print k "=" quote(inc[k]); print "REPLACED " k > report }
        else                           { print $0; print "KEPT " k > report }
        done[k] = 1; next
      }
    }
    print
  }
  END {
    hdr = 0
    for (k in inc) if (!(k in done)) {
      if (!hdr++) { print ""; print "# --- provider keys merged by deploy/contabo/inject-env.sh ---" }
      print k "=" quote(inc[k]); print "ADDED " k > report
    }
  }' "$WORK/incoming" "$ENV" "$ENV" > "$WORK/lelu.env.new"
: >> "$WORK/report"
sort "$WORK/report" | awk '{ print "INFO  " $1 " " $2 }'
for s in ADDED FILLED REPLACED KEPT UNCHANGED DEDUPED REFUSED EMPTY UNSAFE; do
  info "$s: $(grep -c "^$s " "$WORK/report" || true)"
done

echo "== 3. atomic replace, root:root 0600"
NEW="$DIR/.lelu.env.$$"
install -o root -g root -m 0600 "$WORK/lelu.env.new" "$NEW"
mv -f "$NEW" "$ENV"
st=$(stat -c '%U:%G %a' "$ENV"); [ "$st" = "root:root 600" ] && ok "lelu.env $st" || bad "lelu.env $st"
dups=$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV" | sort | uniq -d | tr '\n' ' ' || true)
[ -z "$dups" ] && ok "no duplicate definitions" || bad "duplicate definitions: $dups"
rm -f "$WORK/incoming"
EXPECT=$(grep -E '^(ADDED|FILLED|REPLACED|KEPT|UNCHANGED) ' "$WORK/report" | awk '{print $2}' | sort -u || true)

[ "$RESTART" = 1 ] || { info "--no-restart: service left as it was"; exit $FAILED; }

echo "== 4. why was nginx answering 502? (state before restart)"
info "lelu: $(systemctl is-active lelu 2>&1) / $(systemctl is-enabled lelu 2>&1), Result=$(systemctl show lelu -p Result --value), NRestarts=$(systemctl show lelu -p NRestarts --value)"
info "unit: $(systemctl show lelu -p FragmentPath --value) EnvironmentFile=$(systemctl show lelu -p EnvironmentFiles --value | cut -d' ' -f1)"
info "ExecStart: $(systemctl show lelu -p ExecStart --value | grep -oE 'path=[^ ;]+ ; argv\[\]=[^;]+' | head -1)"
for f in /opt/lelu/.bun/bin/bun /opt/lelu/app/server.ts /opt/lelu/app/dist/index.html /opt/lelu/app/node_modules; do
  [ -e "$f" ] && ok "present $f" || bad "missing $f"
done
info "listening on 4173: $(ss -tlnpH 'sport = :4173' | awk '{print $4, $6}' | head -1)"
command -v nginx >/dev/null && nginx -T 2>/dev/null | grep -E '^\s*(proxy_pass|server [0-9]|listen)' | sort -u | sed 's/^ */INFO  nginx /' || true
for u in nginx caddy; do info "$u: $(systemctl is-active $u 2>&1)"; done
info "nginx /healthz before: $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1/healthz)"
journalctl -u lelu -n 40 --no-pager 2>&1 | redact | sed 's/^/LOG   /' || true

echo "== 5. restart #1"
systemctl daemon-reload
systemctl reset-failed lelu 2>/dev/null || true
systemctl enable lelu >/dev/null 2>&1 || true
systemctl restart lelu
wait_healthy() {
  for _ in $(seq 1 45); do [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' $H/healthz)" = 200 ] && return 0; sleep 1; done; return 1
}
check_running() {
  local tag=$1 pid miss=""
  if wait_healthy; then ok "$tag backend /healthz 200"; else bad "$tag backend /healthz not 200 after 45 s"
    journalctl -u lelu -n 40 --no-pager | redact | sed 's/^/LOG   /'; return 1; fi
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1/healthz)
  [ "$code" = 200 ] && ok "$tag nginx → backend /healthz 200" || bad "$tag nginx /healthz $code"
  pid=$(systemctl show lelu -p MainPID --value); info "$tag MainPID $pid"
  # Variable NAMES the running process inherited (values are dropped by cut).
  tr '\0' '\n' < /proc/"$pid"/environ | cut -d= -f1 | sort -u > "$WORK/proc-names"
  for k in $EXPECT; do grep -qx "$k" "$WORK/proc-names" || miss="$miss $k"; done
  [ -z "$miss" ] && ok "$tag process inherits all $(echo "$EXPECT" | grep -c . || true) merged names" || bad "$tag process lacks:$miss"
  grep -qi anthropic "$WORK/proc-names" && info "$tag an *ANTHROPIC* name exists in the env file (pre-existing; not touched)" || ok "$tag no Anthropic credential in the process"
  curl -s -m 10 $H/api/provider-health | redact | head -c 1500 | sed 's/^/INFO  provider-health /'; echo
}
check_running "restart#1" || true
r=$(curl -s -m 30 -X POST $H/api/model/groq/chat/completions -H 'content-type: application/json' \
  -d '{"model":"openai/gpt-oss-120b","max_tokens":20,"messages":[{"role":"user","content":"Reply with exactly: ok"}]}' | redact)
echo "$r" | grep -q '"choices"' && ok "Groq answered through the broker" || bad "Groq: $(echo "$r" | head -c 200)"

echo "== 6. restart #2 (persistence)"
P1=$(systemctl show lelu -p MainPID --value)
systemctl restart lelu
check_running "restart#2" || true
P2=$(systemctl show lelu -p MainPID --value)
[ "$P1" != "$P2" ] && ok "new process after restart ($P1 → $P2)" || bad "MainPID unchanged ($P1)"

echo "== result"
[ "$FAILED" = 0 ] && ok "injection and recovery verified" || bad "see FAIL lines above (backup: $BK)"
exit $FAILED
