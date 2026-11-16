#!/usr/bin/env bash
# ==========================================================
# LÉLU V1.1 — first install on a fresh Contabo VPS (Ubuntu 24.04 LTS)
#
#   sudo LELU_DOMAIN=lelu.example.com LELU_ACME_EMAIL=you@example.com \
#        [LELU_VOICE=1] bash install.sh
#
# On the provisioned VPS it VERIFIES what already exists (user lelu,
# /opt/lelu, Docker, the lelu-internal network and the Postgres/Redis
# volumes) and never recreates or deletes it. LÉLU itself uses neither
# Postgres nor Redis (persistence is Supabase + files under /opt/lelu/app),
# so those volumes are reported and left untouched.
#
# Idempotent: safe to re-run. It does NOT write secrets: it creates
# /etc/lelu/lelu.env from the template once and stops so you can fill
# it in, then re-run to finish.
# ==========================================================
set -euo pipefail

: "${LELU_DOMAIN:?set LELU_DOMAIN (DNS A record must point at this VPS)}"
: "${LELU_ACME_EMAIL:?set LELU_ACME_EMAIL (ACME / Let-s-Encrypt contact address)}"
LELU_REPO="${LELU_REPO:-https://github.com/lapheezy/LeluV1.1.git}"
LELU_BRANCH="${LELU_BRANCH:-integration/lelu-four-workforce-consolidation}"
APP=/opt/lelu/app
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== 0. preflight: what already exists (read-only)"
id lelu 2>/dev/null && echo "   user lelu: present (home $(getent passwd lelu | cut -d: -f6))" || echo "   user lelu: absent (will be created)"
[ -d /opt/lelu ] && echo "   /opt/lelu: present" || echo "   /opt/lelu: absent (will be created)"
if command -v docker >/dev/null; then
  docker network inspect lelu-internal >/dev/null 2>&1 && echo "   docker network lelu-internal: present (not used by LÉLU; left as is)"
  docker volume ls --format '{{.Name}}' | grep -Ei 'postgres|redis|pg' | sed 's/^/   docker volume (left untouched, not used by LÉLU): /' || true
  # Nothing Docker-managed may be published on a public interface.
  docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0:|:::' && echo "!! a container publishes a port publicly — review before continuing" || true
fi
free -g | awk 'NR==2{print "   RAM GiB total/available: "$2"/"$7}'

echo "== 0b. back up existing state before changing anything"
# Everything this script may touch, as it is now. Docker volumes are not
# touched by this script and are not copied (use `docker run --rm -v ...`
# for those if you want a copy).
STAMP=$(date +%Y%m%d-%H%M%S)
PRE=()
for p in /opt/lelu /etc/lelu /etc/caddy/Caddyfile /etc/systemd/system/lelu.service; do [ -e "$p" ] && PRE+=("$p"); done
if [ "${#PRE[@]}" -gt 0 ]; then
  # Runs before any package install, so use whatever compressor exists.
  if command -v zstd >/dev/null; then ZFLAG=--zstd; EXT=tar.zst; else ZFLAG=--gzip; EXT=tar.gz; fi
  OUT="/root/lelu-preinstall/lelu-preinstall-$STAMP.$EXT"
  install -d -m 0700 /root/lelu-preinstall
  tar "$ZFLAG" -cpf "$OUT" \
    --exclude='/opt/lelu/app/node_modules' --exclude='/opt/lelu/app/.venv-*' \
    --exclude='/opt/lelu/app/.mossnano/models' --exclude='/opt/lelu/backups' "${PRE[@]}"
  chmod 0600 "$OUT"
  echo "   saved $OUT ($(du -h "$OUT" | cut -f1)); restore: tar -xpf $OUT -C /"
else
  echo "   nothing to back up (fresh host)"
fi

echo "== 1. system packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git curl unzip ca-certificates ufw fail2ban rsync jq \
  debian-keyring debian-archive-keyring apt-transport-https gnupg

echo "== 2. firewall: ssh + http + https only"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban

echo "== 3. service user"
id lelu >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/lelu --shell /bin/bash lelu
# Create only what is missing: an existing (provisioned) /opt/lelu keeps its
# owner and mode. The app needs to write /opt/lelu/app and /opt/lelu/.bun,
# which are created below as lelu-owned.
[ -d /opt/lelu ] || install -d -o lelu -g lelu -m 0750 /opt/lelu
[ -d /opt/lelu/backups ] || install -d -o lelu -g lelu -m 0750 /opt/lelu/backups
[ -d /opt/lelu/.bun ] || install -d -o lelu -g lelu -m 0755 /opt/lelu/.bun
[ -e "$APP" ] || install -d -o lelu -g lelu -m 0750 "$APP"
# git clone needs the parent writable or the target empty and lelu-owned.
[ -d "$APP/.git" ] || [ -z "$(ls -A "$APP" 2>/dev/null)" ] || { echo "!! $APP exists, is not a git checkout and is not empty — inspect it; nothing was changed."; exit 1; }

echo "== 4. Bun (for the lelu user)"
# BUN_INSTALL pins the location: the provisioned lelu user's home may not be /opt/lelu.
if [ ! -x /opt/lelu/.bun/bin/bun ]; then
  sudo -u lelu -H env BUN_INSTALL=/opt/lelu/.bun bash -c 'curl -fsSL https://bun.sh/install | bash'
fi
sudo -u lelu /opt/lelu/.bun/bin/bun --version

echo "== 5. Node 22 (tsc/vite build tooling runs under Node)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== 6. repository"
if [ ! -d "$APP/.git" ]; then
  sudo -u lelu git clone --branch "$LELU_BRANCH" "$LELU_REPO" "$APP"
else
  sudo -u lelu git -C "$APP" fetch origin "$LELU_BRANCH"
  sudo -u lelu git -C "$APP" checkout "$LELU_BRANCH"
  sudo -u lelu git -C "$APP" pull --ff-only origin "$LELU_BRANCH"
fi

echo "== 7. environment (/etc/lelu/lelu.env, root:lelu 0640)"
install -d -o root -g lelu -m 0750 /etc/lelu
if [ ! -f /etc/lelu/lelu.env ]; then
  install -o root -g lelu -m 0640 "$HERE/lelu.env.example" /etc/lelu/lelu.env
  sed -i "s|^LELU_SESSION_SECRET=.*|LELU_SESSION_SECRET=$(openssl rand -hex 32)|" /etc/lelu/lelu.env
  echo
  echo "!! Created /etc/lelu/lelu.env. Fill in LELU_ACCESS_PASSWORD and the provider keys:"
  echo "!!   sudo nano /etc/lelu/lelu.env"
  echo "!! then re-run this script."
  exit 0
fi
grep -q '^LELU_ACCESS_PASSWORD=.\+' /etc/lelu/lelu.env || { echo "!! LELU_ACCESS_PASSWORD is empty in /etc/lelu/lelu.env — refusing to expose LÉLU publicly."; exit 1; }

echo "== 8. dependencies + production build"
cd "$APP"
sudo -u lelu /opt/lelu/.bun/bin/bun install --frozen-lockfile
# The build reads public (VITE_/NEXT_PUBLIC_) values only; secrets stay in the env file.
sudo -u lelu bash -c "set -a; . /etc/lelu/lelu.env; set +a; cd $APP && npx tsc -b && npx vite build"
test -f "$APP/dist/index.html"

echo "== 9. systemd services"
install -m 0644 "$HERE/lelu.service" /etc/systemd/system/lelu.service
install -m 0644 "$HERE/lelu-backup.service" /etc/systemd/system/lelu-backup.service
install -m 0644 "$HERE/lelu-backup.timer" /etc/systemd/system/lelu-backup.timer
install -m 0644 "$HERE/lelu-health.service" /etc/systemd/system/lelu-health.service
install -m 0644 "$HERE/lelu-health.timer" /etc/systemd/system/lelu-health.timer
install -m 0755 "$HERE/backup.sh" /usr/local/bin/lelu-backup
install -m 0755 "$HERE/healthcheck.sh" /usr/local/bin/lelu-healthcheck
install -m 0755 "$HERE/update.sh" /usr/local/bin/lelu-update
install -m 0755 "$HERE/verify.sh" /usr/local/bin/lelu-verify
systemctl daemon-reload
systemctl enable --now lelu.service lelu-backup.timer lelu-health.timer
# journald keeps logs across reboots, bounded.
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=1G\n' > /etc/systemd/journald.conf.d/lelu.conf
systemctl restart systemd-journald

echo "== 9b. voice (optional: LELU_VOICE=1) — MOSS-TTS-Nano worker + LiveKit agent"
if [ "${LELU_VOICE:-0}" = "1" ]; then
  # Ubuntu 24.04 refuses `pip install --user` (PEP 668), which the voice
  # install scripts fall back to: install uv system-wide first.
  command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
  apt-get install -y python3.12-venv >/dev/null
  # System Python only: a uv-managed interpreter would live in the lelu
  # user's home, which the voice units cannot read (ProtectHome).
  sudo -u lelu -H env UV_PYTHON_PREFERENCE=only-system bash -c "cd $APP && bash services/mossnano/install.sh"
  sudo -u lelu -H env UV_PYTHON_PREFERENCE=only-system bash -c "cd $APP && uv venv -q .venv-livekit-agent --python 3.12 && uv pip install -q --python .venv-livekit-agent/bin/python -r services/livekit-agent/requirements.txt"
  install -m 0644 "$APP/deploy/voice/lelu-moss.service" /etc/systemd/system/lelu-moss.service
  install -m 0644 "$APP/deploy/voice/lelu-voice-agent.service" /etc/systemd/system/lelu-voice-agent.service
  systemctl daemon-reload
  systemctl enable --now lelu-moss.service
  if grep -q '^LIVEKIT_URL=.\+' /etc/lelu/lelu.env && grep -q '^LELU_VOICE_AGENT_TOKEN=.\+' /etc/lelu/lelu.env; then
    systemctl enable --now lelu-voice-agent.service
  else
    echo "!! LIVEKIT_* / LELU_VOICE_AGENT_TOKEN not set in /etc/lelu/lelu.env — the voice agent was installed but not started."
  fi
  systemctl restart lelu   # picks up VOXCPM_BASE_URL / LIVEKIT_*
fi

echo "== 10. Caddy (HTTPS reverse proxy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
install -d -o caddy -g caddy /var/log/caddy
install -m 0644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
install -d /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=LELU_DOMAIN=%s\nEnvironment=LELU_ACME_EMAIL=%s\n' "$LELU_DOMAIN" "$LELU_ACME_EMAIL" \
  > /etc/systemd/system/caddy.service.d/lelu.conf
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

echo "== 11. verify"
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4173/healthz >/dev/null && break; sleep 2; done
curl -fsS http://127.0.0.1:4173/healthz && echo
echo "LÉLU is running. Open https://$LELU_DOMAIN on the iPhone and sign in with LELU_ACCESS_PASSWORD."
