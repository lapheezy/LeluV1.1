#!/usr/bin/env bash
# ==========================================================
# LÉLU — controlled update with automatic rollback.
#
#   sudo lelu-update                  # latest commit of the deployed branch
#   sudo lelu-update <commit-or-tag>  # a specific revision
#
# The running site keeps serving the old build while the new one is
# built into dist.next; only a successful build is swapped in. If the
# restarted service does not report healthy within 60 s, the previous
# commit and build are restored and restarted.
#
# Conversation state is not lost: conversations and memory live in
# Supabase and the browser; the server holds the Forge/Cosmos store
# under leluverse/assets, which an update never touches (and which is
# backed up first). A restart takes ~3 s; the iPhone app reconnects.
# ==========================================================
set -euo pipefail
APP=/opt/lelu/app
BUN=/opt/lelu/.bun/bin/bun
TARGET="${1:-}"
as_lelu() { sudo -u lelu bash -c "set -a; . /etc/lelu/lelu.env; set +a; cd $APP && $*"; }

/usr/local/bin/lelu-backup || echo "!! backup failed — continuing (previous backups remain)"

PREV=$(sudo -u lelu git -C "$APP" rev-parse HEAD)
BRANCH=$(sudo -u lelu git -C "$APP" rev-parse --abbrev-ref HEAD)
sudo -u lelu git -C "$APP" fetch origin "$BRANCH" --tags
if [ -n "$TARGET" ]; then
  sudo -u lelu git -C "$APP" checkout --detach "$TARGET"
else
  sudo -u lelu git -C "$APP" merge --ff-only "origin/$BRANCH"
fi
NEW=$(sudo -u lelu git -C "$APP" rev-parse HEAD)
echo "== update $PREV -> $NEW"
[ "$PREV" = "$NEW" ] && { echo "Already at $NEW."; exit 0; }

rollback() {
  echo "!! rolling back to $PREV"
  sudo -u lelu git -C "$APP" checkout --detach "$PREV"
  as_lelu "$BUN install --frozen-lockfile"
  if [ -d "$APP/dist.prev" ]; then rm -rf "$APP/dist"; mv "$APP/dist.prev" "$APP/dist"; fi
  systemctl restart lelu
  exit 1
}

if ! as_lelu "$BUN install --frozen-lockfile && npx tsc -b && npx vite build --outDir dist.next --emptyOutDir"; then
  echo "!! build failed — the running site was not touched"
  sudo -u lelu git -C "$APP" checkout --detach "$PREV"
  as_lelu "$BUN install --frozen-lockfile"
  exit 1
fi

rm -rf "$APP/dist.prev"
[ -d "$APP/dist" ] && mv "$APP/dist" "$APP/dist.prev"
mv "$APP/dist.next" "$APP/dist"
systemctl restart lelu

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4173/healthz | jq -e '.ok == true' >/dev/null 2>&1; then
    echo "== healthy on $NEW"; exit 0
  fi
  sleep 2
done
rollback
