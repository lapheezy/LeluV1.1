#!/usr/bin/env bash
# ==========================================================
# LÉLU — server-state backup (daily via lelu-backup.timer, and before updates).
#
# What lives on the VPS (everything else — conversations, memory,
# personality records — is in Supabase, which has its own backups):
#   /opt/lelu/app/leluverse/assets   Forge ledger, character models, Cosmos world/avatar state
#   /opt/lelu/app/.lelu-workspace*   engineering workspace (if present)
#   /etc/lelu/lelu.env               secrets (kept 0600 inside the archive dir)
#   /etc/caddy/Caddyfile             proxy config
#
# Archives: /opt/lelu/backups/lelu-YYYYmmdd-HHMMSS.tar.zst, newest 14 kept.
# Copy them off the VPS (e.g. `rsync` to another machine) for real safety.
#
# Restore (see DEPLOY_CONTABO.md):
#   sudo systemctl stop lelu
#   sudo tar --zstd -xpf /opt/lelu/backups/<archive> -C /
#   sudo systemctl start lelu
# ==========================================================
set -euo pipefail
DEST=/opt/lelu/backups
KEEP="${LELU_BACKUP_KEEP:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/lelu-$STAMP.tar.zst"
install -d -m 0700 "$DEST"

PATHS=(/opt/lelu/app/leluverse/assets /etc/lelu/lelu.env /etc/caddy/Caddyfile)
for p in /opt/lelu/app/.lelu-workspace /opt/lelu/app/.lelu-workspaces /opt/lelu/app/cosmos; do
  [ -e "$p" ] && PATHS+=("$p")
done
EXISTING=()
for p in "${PATHS[@]}"; do [ -e "$p" ] && EXISTING+=("$p"); done

command -v zstd >/dev/null || apt-get install -y zstd >/dev/null
tar --zstd -cpf "$OUT" "${EXISTING[@]}"
chmod 0600 "$OUT"
echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"

ls -1t "$DEST"/lelu-*.tar.zst 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
