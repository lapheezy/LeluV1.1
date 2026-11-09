#!/usr/bin/env bash
# ==========================================================
# LÉLU V1.1 — first install on a fresh Contabo VPS (Ubuntu 24.04 LTS)
#
#   sudo LELU_DOMAIN=lelu.example.com LELU_ACME_EMAIL=you@example.com \
#        LELU_BRANCH=claude/avatar-3d-world bash install.sh
#
# Idempotent: safe to re-run. It does NOT write secrets: it creates
# /etc/lelu/lelu.env from the template once and stops so you can fill
# it in, then re-run to finish.
# ==========================================================
set -euo pipefail

: "${LELU_DOMAIN:?set LELU_DOMAIN (DNS A record must point at this VPS)}"
: "${LELU_ACME_EMAIL:?set LELU_ACME_EMAIL (ACME / Let-s-Encrypt contact address)}"
LELU_REPO="${LELU_REPO:-https://github.com/lapheezy/LeluV1.1.git}"
LELU_BRANCH="${LELU_BRANCH:-claude/avatar-3d-world}"
APP=/opt/lelu/app
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
install -d -o lelu -g lelu -m 0750 /opt/lelu /opt/lelu/backups

echo "== 4. Bun (for the lelu user)"
if [ ! -x /opt/lelu/.bun/bin/bun ]; then
  sudo -u lelu -H bash -c 'curl -fsSL https://bun.sh/install | bash'
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
systemctl daemon-reload
systemctl enable --now lelu.service lelu-backup.timer lelu-health.timer
# journald keeps logs across reboots, bounded.
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=1G\n' > /etc/systemd/journald.conf.d/lelu.conf
systemctl restart systemd-journald

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
