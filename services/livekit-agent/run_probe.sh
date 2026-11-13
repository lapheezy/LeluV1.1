#!/bin/bash
# Mint a test user token, dispatch the agent to that user's room, run probe_user.py.
# Usage: run_probe.sh OUT_DIR [probe_user.py args...]   (reads .livekit/livekit.env)
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . .livekit/livekit.env; set +a
OUT="$1"; shift
mkdir -p "$OUT"
USER_ID="probe-$(date +%s)"
ROOM="lelu-$USER_ID"
TOKEN=$(.venv-livekit-agent/bin/python - "$ROOM" "$USER_ID" <<'PY'
import os, sys
from livekit import api
room, uid = sys.argv[1], sys.argv[2]
print(api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
      .with_identity(f"user-{uid}")
      .with_grants(api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True, can_publish_data=True))
      .to_jwt())
PY
)
curl -sS -X POST http://127.0.0.1:8790/rooms -H "X-Lelu-Agent-Token: $LELU_VOICE_AGENT_TOKEN" -H 'Content-Type: application/json' -d "{\"room\":\"$ROOM\"}" >&2; echo >&2
exec .venv-livekit-agent/bin/python services/livekit-agent/probe_user.py --url "$LIVEKIT_URL" --token "$TOKEN" --out-dir "$OUT" "$@"
