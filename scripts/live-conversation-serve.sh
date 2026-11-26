#!/usr/bin/env bash
# LÉLU live conversation — serve the BUILT app for an acceptance run.
#
# The server is started from an allowlist (env -i): it sees Groq and Cerebras
# (the only providers this mission may use), the VoxCPM2 worker, and the
# machine's HTTPS proxy settings — and nothing else. No Anthropic, OpenRouter,
# ElevenLabs or Meshy credential can reach it, so no other voice or model can
# be substituted. Pinned to cores 0-1 with the browser; VoxCPM2 runs alone on cores 2-3.
#
#   bash scripts/live-conversation-serve.sh [log-file]
set -euo pipefail
cd "$(dirname "$0")/.."
LOG="${1:-/dev/stdout}"
keep=(PATH HOME HTTPS_PROXY https_proxy NO_PROXY no_proxy NODE_EXTRA_CA_CERTS SSL_CERT_FILE
      GROQ_API_KEY GROQ_API_KEY_2 GROQ_API_KEY_3 GROQ_API_KEY_4 CEREBRAS_API_KEY)
args=()
for name in "${keep[@]}"; do
  if [ -n "${!name:-}" ]; then args+=("$name=${!name}"); fi
done
exec env -i "${args[@]}" \
  PORT="${PORT:-4173}" \
  VOXCPM_BASE_URL="${VOXCPM_BASE_URL:-http://127.0.0.1:8788}" \
  VOICE_PROVIDER=voxcpm \
  NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" \
  taskset -c "${SERVER_CORES:-0-1}" "$(command -v bun)" run server.ts >"$LOG" 2>&1
