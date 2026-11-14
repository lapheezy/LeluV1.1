#!/usr/bin/env bash
# ==========================================================
# LÉLU — post-deploy evidence (run on the VPS as root):
#   sudo bash /opt/lelu/app/deploy/contabo/verify.sh | tee /root/lelu-verify.txt
#
# Read-only except for one backup run (which is the backup test).
# Prints names, states and HTTP statuses — never a secret value — so the
# output can be pasted back for review.
# ==========================================================
set -uo pipefail
APP=/opt/lelu/app
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; }; info() { echo "INFO  $*"; }
H=http://127.0.0.1:4173

echo "== code"
info "commit $(sudo -u lelu git -C $APP rev-parse --short HEAD) on $(sudo -u lelu git -C $APP rev-parse --abbrev-ref HEAD)"
[ -f $APP/dist/index.html ] && ok "production build present" || bad "dist/index.html missing"

echo "== services"
for u in lelu caddy lelu-backup.timer lelu-health.timer lelu-moss lelu-voice-agent; do
  s=$(systemctl is-active "$u" 2>/dev/null); e=$(systemctl is-enabled "$u" 2>/dev/null)
  case "$s" in active) ok "$u active ($e)";; *) info "$u $s ($e)";; esac
done
info "restart policy lelu: $(systemctl show lelu -p Restart --value), NRestarts=$(systemctl show lelu -p NRestarts --value)"

echo "== health"
code=$(curl -s -o /tmp/lelu-health.json -w '%{http_code}' $H/api/health); [ "$code" = 200 ] && ok "/api/health 200 $(head -c 200 /tmp/lelu-health.json)" || bad "/api/health $code"
code=$(curl -s -o /dev/null -w '%{http_code}' $H/healthz); [ "$code" = 200 ] && ok "/healthz 200" || bad "/healthz $code"
[ -n "${LELU_DOMAIN:-}" ] && { code=$(curl -s -o /dev/null -w '%{http_code}' "https://$LELU_DOMAIN/healthz"); [ "$code" = 200 ] && ok "https://$LELU_DOMAIN/healthz 200 (TLS)" || bad "https://$LELU_DOMAIN/healthz $code"; }

echo "== providers (real requests through the server broker)"
set -a; . /etc/lelu/lelu.env; set +a
curl -s $H/api/model/status | python3 -c "import json,sys;d=json.load(sys.stdin);print('INFO  provider states', {k:v.get('state') for k,v in d.get('states',{}).items()})"
# Anthropic is only exercised when the operator enabled it (it spends credit).
if grep -qiE '^LELU_ENABLE_ANTHROPIC=(1|true|yes|on)$' /etc/lelu/lelu.env; then
  r=$(curl -s -X POST $H/api/model/anthropic/messages -H 'content-type: application/json' -d '{"model":"claude-haiku-5-5","max_tokens":20,"messages":[{"role":"user","content":"Reply with exactly: ok"}]}')
  echo "$r" | grep -q '"type":"message"' && ok "Anthropic answered" || bad "Anthropic: $(echo "$r" | head -c 220)"
else
  info "Anthropic disabled by policy (LELU_ENABLE_ANTHROPIC not true) — not called"
fi
r=$(curl -s -X POST $H/api/model/groq/chat/completions -H 'content-type: application/json' -d '{"model":"openai/gpt-oss-120b","max_tokens":300,"messages":[{"role":"user","content":"Reply with exactly: ok"}]}')
echo "$r" | grep -q '"choices"' && ok "Groq answered" || bad "Groq: $(echo "$r" | head -c 220)"
curl -s $H/ | grep -o '__LELU_\(DEFAULT_PROVIDER\|LELU_ENABLE_ANTHROPIC\)__"\] = "[^"]*"' | sed 's/^/INFO  page config /'
curl -s $H/ | grep -q '__LELU_ANTHROPIC_BASE_URL__' && bad "ANTHROPIC_BASE_URL is published to the page (unset it)" || ok "no ANTHROPIC_BASE_URL published"

echo "== voice"
code=$(curl -s -o /tmp/lelu-vox.json -w '%{http_code}' $H/api/voice/vox/health); info "vox health $code $(head -c 200 /tmp/lelu-vox.json)"
code=$(curl -s -o /tmp/lelu-speech.out -w '%{http_code}' -X POST $H/api/voice/vox/speech -H 'content-type: application/json' -d '{"input":"Hello, I am Lélu, speaking from the server."}')
[ "$code" = 200 ] && [ "$(head -c 4 /tmp/lelu-speech.out)" = RIFF ] && ok "speech via app: WAV $(stat -c %s /tmp/lelu-speech.out) bytes" || info "speech via app: $code"
info "livekit $(curl -s $H/api/livekit/status | head -c 300)"

echo "== exposure (only 22/80/443 may listen publicly)"
ss -tlnpH | awk '{print $4, $6}' | while read -r addr proc; do
  case "$addr" in 127.0.0.1:*|\[::1\]:*|127.0.0.53*:*) ;; *:22|*:80|*:443) ok "public $addr $proc";; *) bad "public listener $addr $proc";; esac
done
ufw status | head -12 | sed 's/^/INFO  ufw /'
command -v docker >/dev/null && docker ps --format '{{.Names}} {{.Ports}}' | sed 's/^/INFO  container /'

echo "== secrets"
st=$(stat -c '%U:%G %a' /etc/lelu/lelu.env); [ "$st" = "root:lelu 640" ] && ok "lelu.env $st" || bad "lelu.env $st (want root:lelu 640)"
sudo -u lelu git -C $APP status --porcelain | grep -E '\.env|secret|key' && bad "secret-like file in the working tree" || ok "no secret-like files in the working tree"
curl -s $H/ | grep -Eiq 'sk-ant-|gsk_|sk-or-|lk_api|LIVEKIT_API_SECRET' && bad "a credential appears in the served page" || ok "no credential patterns in the served page"

echo "== storage, logs, backup"
df -h /opt/lelu | tail -1 | sed 's/^/INFO  disk /'
journalctl -u lelu --since "-1h" --no-pager | tail -3 | sed 's/^/INFO  log /'
/usr/local/bin/lelu-backup && ok "backup ran: $(ls -1t /opt/lelu/backups/lelu-*.tar.zst | head -1)" || bad "backup failed"
free -m | awk 'NR==2{print "INFO  RAM MiB used/total: "$3"/"$2}'
for u in lelu lelu-moss lelu-voice-agent; do m=$(systemctl show "$u" -p MemoryCurrent --value 2>/dev/null); [ -n "$m" ] && [ "$m" != "[not set]" ] && info "$u memory $((m/1048576)) MiB"; done
