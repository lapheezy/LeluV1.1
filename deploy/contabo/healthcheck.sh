#!/usr/bin/env bash
# ==========================================================
# LÉLU — health watchdog (every minute via lelu-health.timer).
#
# systemd already restarts the app when the process EXITS. This covers
# the other failure: the process is alive but not answering (a hang).
# Three consecutive failed /healthz probes → restart. It also records
# memory/disk pressure in the journal so slow degradation is visible:
#   journalctl -t lelu-health
# ==========================================================
set -uo pipefail
STATE=/run/lelu-health.fails
fails=$(cat "$STATE" 2>/dev/null || echo 0)

if body=$(curl -fsS -m 10 http://127.0.0.1:4173/healthz) && echo "$body" | jq -e '.ok == true' >/dev/null 2>&1; then
  echo 0 > "$STATE"
  rss=$(echo "$body" | jq -r '.rssMb')
  [ "$rss" -gt 2000 ] && logger -t lelu-health "warning: app RSS ${rss} MB (MemoryHigh 2G, MemoryMax 3G)"
else
  fails=$((fails + 1))
  echo "$fails" > "$STATE"
  logger -t lelu-health "healthz failed ($fails/3)"
  if [ "$fails" -ge 3 ]; then
    logger -t lelu-health "restarting lelu after 3 failed health checks"
    systemctl restart lelu
    echo 0 > "$STATE"
  fi
fi

disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$disk" -gt 85 ] && logger -t lelu-health "warning: root disk ${disk}% full"
mem=$(free -m | awk '/^Mem:/ {print int($7)}')
[ "$mem" -lt 600 ] && logger -t lelu-health "warning: only ${mem} MB memory available"
exit 0
