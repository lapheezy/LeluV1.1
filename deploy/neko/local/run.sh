#!/usr/bin/env bash
# Run Neko for LÉLU on THIS machine (development container behind an HTTPS-inspecting proxy).
# Builds the trust store from the environment's CA bundle, builds the image, starts Neko on
# 127.0.0.1:8090 (not 8080: that is where her local-model probe looks for llama.cpp) (WebRTC UDP 52000-52100, DevTools 127.0.0.1:9222 for LÉLU's navigation), and
# writes VITE_NEKO_URL / NEKO_PASSWORD / NEKO_ADMIN_PASSWORD into .env.local (Git-ignored).
# Restart the dev server afterwards. For a real server use deploy/neko/docker-compose.yml.
set -euo pipefail
cd "$(dirname "$0")"
# ./run.sh --refresh-proxy: this machine's proxy port changes on every restart, and the image holds the
# old one (Chromium then shows ERR_PROXY_CONNECTION_FAILED). Rewrite it in the running container.
if [ "${1:-}" = "--refresh-proxy" ]; then
  P="${HTTPS_PROXY:-${https_proxy:-}}"; [ -n "$P" ] || { echo "no HTTPS_PROXY set"; exit 1; }
  docker info >/dev/null 2>&1 || { (setsid nohup dockerd >/tmp/dockerd.log 2>&1 &); for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done; }
  docker start lelu-neko >/dev/null; for i in $(seq 1 40); do docker exec lelu-neko true 2>/dev/null && break; sleep 1; done
  docker exec -u root lelu-neko sed -i "s#--proxy-server=[^ ]*#--proxy-server=${P}#" /etc/neko/supervisord/chromium.conf
  # A machine restart kills Chromium uncleanly; don't let its "Restore pages?" bubble cover every page.
  docker exec -u root lelu-neko sh -c 'grep -q hide-crash-restore-bubble /etc/neko/supervisord/chromium.conf || sed -i "s#--remote-debugging-address#--hide-crash-restore-bubble\\n  --remote-debugging-address#" /etc/neko/supervisord/chromium.conf' 
  docker exec -u root lelu-neko supervisorctl -c /etc/neko/supervisord.conf reread >/dev/null; docker exec -u root lelu-neko supervisorctl -c /etc/neko/supervisord.conf update chromium >/dev/null  # restart alone keeps the old flags
  echo "Neko Chromium now uses the current proxy"; exit 0
fi
ROOT="$(cd ../../.. && pwd)"
CA="${CA_BUNDLE:-/root/.ccr/ca-bundle.crt}"
PROXY="${HTTPS_PROXY:-${https_proxy:-}}"
docker info >/dev/null 2>&1 || { (setsid nohup dockerd >/tmp/dockerd.log 2>&1 &); for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done; }
rm -rf nssdb && mkdir nssdb && certutil -d sql:nssdb -N --empty-password
if [ -f "$CA" ]; then
  tmp=$(mktemp -d); awk -v d="$tmp" 'BEGIN{n=0} /BEGIN CERT/{n++} {print > (d "/ca" n ".pem")}' "$CA"
  for f in "$tmp"/ca*.pem; do certutil -d sql:nssdb -A -t "C,," -n "env-$(basename "$f" .pem)" -i "$f" 2>/dev/null || true; done; rm -rf "$tmp"
fi
docker build --network host ${PROXY:+--build-arg PROXY=$PROXY} -t lelu-neko-chromium:local .
touch "$ROOT/.env.local"
USERPW=$(grep -s '^NEKO_PASSWORD=' "$ROOT/.env.local" | cut -d= -f2 || true); ADMINPW=$(grep -s '^NEKO_ADMIN_PASSWORD=' "$ROOT/.env.local" | cut -d= -f2 || true)
USERPW=${USERPW:-$(openssl rand -hex 12)}; ADMINPW=${ADMINPW:-$(openssl rand -hex 12)}
sed -i '/^VITE_NEKO_URL=/d;/^NEKO_PASSWORD=/d;/^NEKO_ADMIN_PASSWORD=/d' "$ROOT/.env.local"
printf 'VITE_NEKO_URL=http://127.0.0.1:8090\nNEKO_PASSWORD=%s\nNEKO_ADMIN_PASSWORD=%s\n' "$USERPW" "$ADMINPW" >> "$ROOT/.env.local"
docker rm -f lelu-neko >/dev/null 2>&1 || true
docker run -d --name lelu-neko --network host --shm-size=2g \
  -e NEKO_DESKTOP_SCREEN=1280x720@30 -e NEKO_WEBRTC_EPR=52000-52100 -e NEKO_SERVER_BIND=127.0.0.1:8090 \
  -e NEKO_MEMBER_MULTIUSER_USER_PASSWORD="$USERPW" -e NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD="$ADMINPW" \
  lelu-neko-chromium:local >/dev/null
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:8090/ && break; sleep 1; done
curl -sf -o /dev/null http://127.0.0.1:8090/ && echo "Neko is up at http://127.0.0.1:8090 — restart the dev server so the Browser offers 'Neko live'."
