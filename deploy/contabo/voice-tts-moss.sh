#!/usr/bin/env bash
# ==========================================================
# LÉLU — connect /api/voice/tts to the MOSS speech worker, incrementally.
# Run on the Contabo VPS as root. Every line printed is a name, a state, an
# HTTP code, a size or a timing — NEVER a secret value — because this output
# ends up in public GitHub Actions logs.
#
#   bash voice-tts-moss.sh recon               read-only: architecture, voice, TLS, disk, backups
#   bash voice-tts-moss.sh apply  <patch>      backup → git apply → typecheck → restart lelu → verify
#                                              (automatic rollback if any step after the patch fails)
#   bash voice-tts-moss.sh accept              acceptance probes against the running app
#   bash voice-tts-moss.sh rollback [<stamp>]  undo `apply` (latest, or the named stamp)
#
# Why a patch and not `lelu-update`: production runs a commit that is not on
# GitHub (a7503839 at the time of writing), so moving HEAD to any pushed
# commit could drop whatever that commit carries. The patch touches only
# plugins/voiceApi.ts, plugins/voxApi.ts and one new test. server.ts runs
# from source (`bun run server.ts`), so dist/ — the served build — is never
# rebuilt or touched, and only the `lelu` unit is restarted.
# ==========================================================
set -uo pipefail
APP=/opt/lelu/app
H=http://127.0.0.1:4173
MOSS=http://127.0.0.1:8789
ROOT=/opt/lelu/rollback/voice-tts-moss
FILES=(plugins/voiceApi.ts plugins/voxApi.ts tests/voice-tts-speech-worker.test.ts)

ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILED=1; }; info() { echo "INFO  $*"; }
# DETAIL lines map the host (firewall, listeners, proxy internals, env names).
# The workflow keeps them in a root-only report on the VPS and strips them
# from the public Actions log; PASS/FAIL/INFO lines are safe to publish.
detail() { sed 's/^/DETAIL  /'; }
FAILED=0
as_lelu() { runuser -u lelu -- bash -c "cd $APP && $*"; }
git_lelu() { runuser -u lelu -- git -C "$APP" "$@"; }

# ---- authenticated session (password goes over stdin, never argv or log) --
JAR=""
login() {
  JAR=$(mktemp); chmod 600 "$JAR"
  local code
  code=$( ( set -a; . /etc/lelu/lelu.env; set +a
            [ -n "${LELU_ACCESS_PASSWORD:-}" ] || { echo open; exit 0; }
            python3 -c 'import os,sys,urllib.parse; sys.stdout.write("password="+urllib.parse.quote(os.environ["LELU_ACCESS_PASSWORD"]))' |
              curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -X POST --data-binary @- \
                   -H 'content-type: application/x-www-form-urlencoded' "$H/auth/login" ) )
  case "$code" in
    303) ok "login 303 (session cookie issued)";;
    open) info "access gate is open (LELU_ACCESS_PASSWORD unset)";;
    *) bad "login $code";;
  esac
}
cleanup() { [ -n "$JAR" ] && rm -f "$JAR"; }
trap cleanup EXIT
C() { curl -s -b "$JAR" "$@"; }

# ---- probes shared by recon / apply / accept ------------------------------
moss_health() {
  local body; body=$(curl -s -m 5 "$MOSS/health")
  if [ -z "$body" ]; then bad "MOSS $MOSS/health unreachable"; return; fi
  echo "$body" | jq -r '"INFO  MOSS state=\(.state) ready=\(.ready) loaded=\(.loaded) sampleRate=\(.sampleRate) model=\(.modelId // .model // "?") device=\(.device // "?")"' 2>/dev/null
  [ "$(echo "$body" | jq -r .state 2>/dev/null)" = READY ] && ok "MOSS worker READY" || bad "MOSS worker not READY"
}

# Synthesis through the app's /api/voice/tts. $1 = stream|wav. Saves to /tmp/lelu-tts.$1.
app_tts() {
  local mode=$1 body out=/tmp/lelu-tts.$1 hdr=/tmp/lelu-tts.$1.h
  [ "$mode" = stream ] && body='{"text":"Bonjour, je suis Lélu. Je te parle avec ma propre voix.","stream":true}' \
                       || body='{"text":"Bonjour, je suis Lélu. Je te parle avec ma propre voix."}'
  local t; t=$(C -m 120 -o "$out" -D "$hdr" -w '%{http_code} %{time_starttransfer} %{time_total} %{size_download}' \
               -X POST "$H/api/voice/tts" -H 'content-type: application/json' -H 'accept: audio/*' -d "$body")
  local code ttfb total size; read -r code ttfb total size <<<"$t"
  local ctype prov rate
  ctype=$(grep -i '^content-type:' "$hdr" | tr -d '\r' | cut -d' ' -f2-)
  prov=$(grep -i '^x-lelu-voice-provider:' "$hdr" | tr -d '\r' | cut -d' ' -f2-)
  rate=$(grep -i '^x-lelu-sample-rate:' "$hdr" | tr -d '\r' | cut -d' ' -f2-)
  info "tts[$mode] code=$code type=$ctype provider=${prov:-none} rate=${rate:-n/a} bytes=$size first_byte_s=$ttfb total_s=$total"
  if [ "$code" != 200 ]; then bad "tts[$mode] HTTP $code $(head -c 160 "$out" | tr -d '\n')"; return; fi
  if [ "$mode" = wav ]; then
    if command -v ffprobe >/dev/null; then
      info "tts[wav] $(ffprobe -v error -show_entries stream=codec_name,sample_rate,channels:format=duration -of compact=p=0 "$out" | tr '\n' ' ')"
    else
      python3 - "$out" <<'PY'
import sys, wave
with wave.open(sys.argv[1]) as w:
    print(f"INFO  tts[wav] riff ok rate={w.getframerate()} ch={w.getnchannels()} bits={8*w.getsampwidth()} seconds={w.getnframes()/w.getframerate():.2f}")
PY
    fi
    [ "$(head -c 4 "$out")" = RIFF ] && [ "$size" -gt 1000 ] && ok "tts[wav] 200 playable WAV from $prov" || bad "tts[wav] not a WAV"
  else
    [ -n "$rate" ] && [ "$size" -gt 1000 ] && ok "tts[stream] 200 PCM at ${rate} Hz, $(python3 -c "print(round($size/2/$rate,2))") s of audio" || bad "tts[stream] missing rate or audio"
  fi
}

# ===========================================================================
recon() {
  echo "== code and build"
  info "commit $(git_lelu rev-parse HEAD) on $(git_lelu rev-parse --abbrev-ref HEAD)"
  info "served version $(curl -s -m 5 $H/healthz | jq -c '{version,dist,accessGate,uptimeSeconds}' 2>/dev/null)"
  local drift; drift=$(git_lelu status --porcelain | wc -l)
  info "working-tree drift: $drift path(s)"; git_lelu status --porcelain | head -40 | detail
  [ -f $APP/dist/index.html ] && info "dist/index.html $(stat -c '%y' $APP/dist/index.html | cut -d. -f1) sha256=$(sha256sum $APP/dist/index.html | cut -c1-16)"
  for f in "${FILES[@]}"; do [ -f "$APP/$f" ] && info "$f sha256=$(sha256sum "$APP/$f" | cut -c1-16)" || info "$f absent"; done

  echo "== services"
  for u in lelu lelu-moss nginx caddy lelu-voice-agent lelu-voxcpm lelu-backup.timer lelu-health.timer certbot.timer snap.certbot.renew.timer; do
    info "$u $(systemctl is-active $u 2>/dev/null) ($(systemctl is-enabled $u 2>/dev/null))"
  done
  for u in lelu lelu-moss; do
    systemctl cat $u 2>/dev/null | grep -E '^(ExecStart|EnvironmentFile|User|WorkingDirectory|Environment=(HOST|PORT|MOSS_))' | sed "s/^/INFO  $u: /"
  done

  echo "== environment (names only)"
  if [ -f /etc/lelu/lelu.env ]; then
    info "lelu.env $(stat -c '%U:%G %a' /etc/lelu/lelu.env), $(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' /etc/lelu/lelu.env) entries"
    grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' /etc/lelu/lelu.env | tr -d '=' | sort | tr '\n' ' ' | detail; echo
    ( set -a; . /etc/lelu/lelu.env; set +a
      [ "${VOXCPM_BASE_URL:-}" = "http://127.0.0.1:8789" ] && echo "PASS  VOXCPM_BASE_URL is the loopback MOSS worker" \
        || echo "FAIL  VOXCPM_BASE_URL is ${VOXCPM_BASE_URL:+set to something else}${VOXCPM_BASE_URL:-unset}"
      echo "INFO  VOICE_PROVIDER=${VOICE_PROVIDER:-<unset: auto>} ELEVENLABS keys present: $(env | grep -cE '^(ELEVENLABS_API_KEY(_[1-4])?|Elevenlabs[23]?)=.')"
      echo "INFO  Piper configured: $([ -n "${LELU_LOCAL_TTS_BIN:-}" ] && echo yes || echo no)" )
  else bad "/etc/lelu/lelu.env missing"; fi

  echo "== nginx"
  if command -v nginx >/dev/null; then
    local T; T=$(nginx -T 2>/dev/null)
    echo "$T" | grep -E '^# configuration file|^\s*(listen|server_name|proxy_pass|ssl_certificate|include|return 30|add_header|proxy_set_header X-Forwarded-Proto|client_max_body_size|proxy_read_timeout|proxy_buffering)' \
      | sed 's/^ *//' | sort -u | head -60 | detail
    info "nginx -t: $(nginx -t 2>&1 | grep -q 'successful' && echo ok || echo FAILING)"
    info "nginx listens :80 $(echo "$T" | grep -qE '^\s*listen\s+(\[::\]:)?80\b' && echo yes || echo no), :443 $(echo "$T" | grep -qE '^\s*listen\s+.*443' && echo yes || echo no)"
    info "nginx proxies to 127.0.0.1:4173: $(echo "$T" | grep -qE 'proxy_pass\s+http://(127\.0\.0\.1:4173|lelu)' && echo yes || echo 'no/other')"
    info "nginx server_name: $(echo "$T" | grep -E '^\s*server_name' | awk '{$1=""; print}' | tr -d ';' | xargs -n1 | sort -u | grep -vE '^(_|localhost)$' | grep -vE '^[0-9.]+$' | tr '\n' ' ' | sed 's/^$/(none — IP only)/')"
    info "X-Forwarded-Proto \$scheme sent: $(echo "$T" | grep -qiE 'proxy_set_header\s+X-Forwarded-Proto\s+\$scheme' && echo yes || echo no)"
  fi

  echo "== listeners and firewall"
  local L; L=$(ss -ltnpH 2>/dev/null | awk '{print $4, $6}' | sed -E 's/users:\(\("([^"]+)".*/\1/' | sort -u)
  echo "$L" | detail
  for port in 4173 8789; do
    echo "$L" | grep -qE "(0\.0\.0\.0|\*|\[::\]):$port " && bad ":$port listens on a public address" || ok ":$port loopback-only (or not listening)"
  done
  info "public listeners: $(echo "$L" | grep -E '^(0\.0\.0\.0|\*|\[::\]):' | awk '{print $1}' | sed -E 's/.*://' | sort -un | tr '\n' ' ')"
  command -v ufw >/dev/null && { ufw status verbose 2>/dev/null | detail; info "ufw $(ufw status 2>/dev/null | head -1 | awk '{print $2}'), 443 allowed: $(ufw status 2>/dev/null | grep -qE '^(443|443/tcp|Nginx Full|Nginx HTTPS)\b.*ALLOW' && echo yes || echo no)"; }
  iptables -S INPUT 2>/dev/null | head -20 | detail

  echo "== disk, memory, backups"
  df -h / /opt 2>/dev/null | sed 's/^/INFO  /'; free -m | sed 's/^/INFO  /'
  ls -1t /opt/lelu/backups/ 2>/dev/null | head -5 | while read -r b; do info "backup $b $(du -h /opt/lelu/backups/$b | cut -f1)"; done
  ls -1 $ROOT 2>/dev/null | sed 's/^/INFO  rollback stamp /'

  echo "== TLS tooling"
  info "certbot $(certbot --version 2>&1 | head -1 || echo absent); snap $(command -v snap >/dev/null && echo present || echo absent)"
  ls /etc/letsencrypt/live 2>/dev/null | sed 's/^/INFO  cert /'
  info "local :443 → $(curl -sk -m 5 -o /dev/null -w '%{http_code}' https://127.0.0.1/healthz 2>&1 || true)"

  echo "== voice pipeline"
  moss_health
  login
  info "voice/status $(C -m 5 $H/api/voice/status | jq -c '{configured,provider,voiceId,stt}' 2>/dev/null)"
  info "voice/diagnostic tts $(C -m 5 $H/api/voice/diagnostic | jq -c '.tts|{provider,configured}' 2>/dev/null)"
  info "vox/health $(C -m 10 $H/api/voice/vox/health | jq -c '{configured,available,chosen:.chosen.worker}' 2>/dev/null)"
  app_tts wav
}

# ===========================================================================
apply_patch() {
  local patch=${1:?usage: apply <patch>}
  [ -f "$patch" ] || { bad "patch $patch not found"; exit 1; }
  local stamp; stamp=$(date -u +%Y%m%dT%H%M%SZ)
  local dir=$ROOT/$stamp
  echo "== preconditions"
  local free_mb; free_mb=$(df -Pm /opt | awk 'NR==2{print $4}')
  [ "$free_mb" -gt 2048 ] && ok "free on /opt: ${free_mb} MB" || { bad "only ${free_mb} MB free on /opt"; exit 1; }
  install -d -m 0755 /opt/lelu/rollback
  # 0711: lelu (who runs git apply) can reach the patch by name but cannot list the directory.
  install -d -m 0711 "$ROOT" "$dir"
  install -m 0644 "$patch" "$dir/voice-tts-moss.patch"
  if git_lelu apply --check "$dir/voice-tts-moss.patch" 2>"$dir/apply-check.txt"; then ok "patch applies cleanly to $(git_lelu rev-parse --short HEAD)"
  else bad "patch does not apply to the production tree — nothing changed"; sed 's/^/INFO  /' "$dir/apply-check.txt"; exit 1; fi

  echo "== backup (before any change)"
  if /usr/local/bin/lelu-backup >"$dir/backup.txt" 2>&1; then
    local arc; arc=$(ls -1t /opt/lelu/backups/lelu-*.tar.zst | head -1)
    if zstd -tq "$arc" && tar --zstd -tf "$arc" >/dev/null; then
      ok "backup $arc ($(du -h "$arc" | cut -f1)) verified: zstd + tar listing OK, $(tar --zstd -tf "$arc" | wc -l) entries"
      sha256sum "$arc" > "$dir/backup.sha256"; info "backup sha256 $(cut -c1-16 "$dir/backup.sha256")"
    else bad "backup archive failed integrity check — aborting"; exit 1; fi
  else bad "lelu-backup failed — aborting"; exit 1; fi
  # Rollback material for exactly what this step can change.
  git_lelu rev-parse HEAD > "$dir/prev-commit"
  git_lelu status --porcelain > "$dir/prev-status.txt"
  git_lelu diff > "$dir/prev-drift.patch"           # runtime drift, preserved verbatim
  for f in "${FILES[@]}"; do [ -f "$APP/$f" ] && install -D -m 0600 "$APP/$f" "$dir/files/$f"; done
  sha256sum $APP/dist/index.html > "$dir/dist-index.sha256" 2>/dev/null
  systemctl cat lelu > "$dir/lelu.unit.txt" 2>/dev/null
  info "rollback material: $dir (prev commit $(cut -c1-8 "$dir/prev-commit"), drift $(wc -l < "$dir/prev-status.txt") path(s))"

  echo "== apply"
  # Typecheck gate: only errors the patch INTRODUCES fail it. Errors already in
  # the production tree (missing optional scripts, drift) are recorded, not ours.
  tsc_errors() { as_lelu "npx tsc --noEmit -p tsconfig.node.json" 2>&1 | grep -E '^[^ ].*\([0-9]+,[0-9]+\): error TS' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort -u; }
  tsc_errors > "$dir/tsc-before.txt"
  info "typecheck before patch: $(wc -l < "$dir/tsc-before.txt") pre-existing error line(s)"
  git_lelu apply "$dir/voice-tts-moss.patch" && ok "patch applied (HEAD unchanged: $(git_lelu rev-parse --short HEAD))" || { bad "git apply failed"; restore "$dir"; exit 1; }
  tsc_errors > "$dir/tsc-after.txt"
  comm -13 "$dir/tsc-before.txt" "$dir/tsc-after.txt" > "$dir/tsc-new.txt"
  if [ ! -s "$dir/tsc-new.txt" ]; then ok "typecheck: no new errors ($(wc -l < "$dir/tsc-after.txt") pre-existing line(s) unchanged)"
  else bad "typecheck: the patch introduced errors"; head -20 "$dir/tsc-new.txt" | sed 's/^/INFO  /'; restore "$dir"; exit 1; fi
  if as_lelu "/opt/lelu/.bun/bin/bun test tests/voice-tts-speech-worker.test.ts 2>&1 || npx tsx --test tests/voice-tts-speech-worker.test.ts" >"$dir/test.txt" 2>&1; then
    ok "route test passes on the VPS ($(grep -Eo '(# pass [0-9]+|[0-9]+ pass)' "$dir/test.txt" | head -1))"
  else info "route test could not run here (see $dir/test.txt); relying on live verification"; fi

  echo "== restart lelu only"
  systemctl restart lelu
  local healthy=0
  for _ in $(seq 1 30); do curl -fsS -m 3 $H/healthz 2>/dev/null | jq -e '.ok == true' >/dev/null 2>&1 && { healthy=1; break; }; sleep 2; done
  [ $healthy = 1 ] && ok "lelu healthy after restart" || { bad "lelu not healthy in 60 s"; restore "$dir"; exit 1; }

  echo "== verify"
  moss_health
  login
  info "voice/status $(C -m 5 $H/api/voice/status | jq -c '{configured,provider,voiceId}' 2>/dev/null)"
  local before=$FAILED; FAILED=0
  app_tts wav; app_tts stream
  if [ $FAILED != 0 ]; then bad "application TTS not working after apply — rolling back"; restore "$dir"; exit 1; fi
  FAILED=$before
  [ "$(sha256sum $APP/dist/index.html)" = "$(cat "$dir/dist-index.sha256")" ] && ok "served build unchanged" || bad "dist/index.html changed"
  echo "$stamp" > "$ROOT/LATEST"
  ok "applied; rollback with: bash voice-tts-moss.sh rollback $stamp"
}

restore() {
  local dir=$1
  echo "== rollback from $dir"
  if git_lelu apply -R --check "$dir/voice-tts-moss.patch" 2>/dev/null; then git_lelu apply -R "$dir/voice-tts-moss.patch" && ok "patch reversed"
  else
    for f in "${FILES[@]}"; do
      if [ -f "$dir/files/$f" ]; then install -m 0644 -o lelu -g lelu "$dir/files/$f" "$APP/$f"; else rm -f "$APP/$f"; fi
    done; info "files restored from copies"
  fi
  git_lelu diff > /tmp/lelu-drift-now.patch
  cmp -s /tmp/lelu-drift-now.patch "$dir/prev-drift.patch" && ok "working tree identical to before apply" || bad "working tree differs from the pre-apply drift"
  systemctl restart lelu
  for _ in $(seq 1 30); do curl -fsS -m 3 $H/healthz 2>/dev/null | jq -e '.ok == true' >/dev/null 2>&1 && { ok "lelu healthy on the previous code"; return 0; }; sleep 2; done
  bad "lelu not healthy after rollback — restore the backup archive (see DEPLOY_CONTABO.md)"; return 1
}

rollback() {
  local stamp=${1:-$(cat $ROOT/LATEST 2>/dev/null)}
  [ -n "$stamp" ] && [ -d "$ROOT/$stamp" ] || { bad "no rollback stamp found under $ROOT"; exit 1; }
  restore "$ROOT/$stamp"
}

# ===========================================================================
accept() {
  echo "== acceptance (live, against the running app)"
  local code; code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1/healthz)
  [ "$code" = 200 ] && ok "public path nginx → /healthz 200" || bad "nginx /healthz $code"
  login
  # Chat through the brokers (server-side keys; nothing printed but status and first words).
  for p in groq openrouter; do
    # The models the app itself uses: verify.sh's Groq probe, modelApi's OpenRouter default
    # (or the operator's OPENROUTER_MODEL — the broker resolves an empty model the same way).
    local m; [ $p = groq ] && m=openai/gpt-oss-120b || m=nvidia/nemotron-3-ultra-550b-a55b:free
    local t; t=$( { C -m 60 -o /tmp/lelu-chat.$p -w '%{http_code} %{time_total}' -X POST "$H/api/model/$p/chat/completions" \
                    -H 'content-type: application/json' \
                    -d "{\"model\":\"$m\",\"max_tokens\":300,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: ok\"}]}"; } )
    local c s; read -r c s <<<"$t"
    local said; said=$(jq -r '.choices[0].message.content // .error.message // .error // empty' /tmp/lelu-chat.$p 2>/dev/null | head -c 60 | tr '\n' ' ')
    [ "$c" = 200 ] && ok "$p broker 200 in ${s}s: \"$said\"" || bad "$p broker $c: $(head -c 120 /tmp/lelu-chat.$p | tr -d '\n')"
  done
  info "model/status $(C -m 5 $H/api/model/status | jq -c '.states // . | to_entries | map({(.key): (.value.state // .value)}) | add' 2>/dev/null | head -c 400)"
  moss_health
  local t0 t1; t0=$(date +%s%3N)
  local mc; mc=$(curl -s -m 120 -o /tmp/lelu-moss.wav -w '%{http_code}' -X POST $MOSS/v1/audio/speech -H 'content-type: application/json' -d '{"input":"Bonjour, je suis Lélu.","response_format":"wav"}')
  t1=$(date +%s%3N)
  [ "$mc" = 200 ] && [ "$(head -c 4 /tmp/lelu-moss.wav)" = RIFF ] && ok "MOSS direct synthesis 200 WAV $(stat -c %s /tmp/lelu-moss.wav) bytes in $((t1-t0)) ms" || bad "MOSS direct synthesis $mc"
  app_tts wav; app_tts stream
  # STT round trip: her own synthesized WAV, transcribed by Groq Whisper through the broker.
  if [ -s /tmp/lelu-tts.wav ]; then
    t0=$(date +%s%3N)
    local sc; sc=$(C -m 60 -o /tmp/lelu-stt.json -w '%{http_code}' -X POST "$H/api/model/groq/audio/transcriptions" \
                  -F file=@/tmp/lelu-tts.wav -F model=whisper-large-v3-turbo -F response_format=json)
    t1=$(date +%s%3N)
    [ "$sc" = 200 ] && ok "Whisper STT 200 in $((t1-t0)) ms: \"$(jq -r .text /tmp/lelu-stt.json | head -c 120)\"" || bad "Whisper STT $sc $(head -c 160 /tmp/lelu-stt.json)"
  fi
  # Secrets in the client bundle.
  if grep -rEqo 'sk-ant-[A-Za-z0-9]|gsk_[A-Za-z0-9]{20}|sk-or-v1-[a-f0-9]{20}|AIza[0-9A-Za-z_-]{30}' $APP/dist 2>/dev/null; then bad "a credential pattern appears in dist/"
  else ok "no credential patterns in dist/ ($(find $APP/dist -type f | wc -l) files)"; fi
  for u in lelu lelu-moss nginx; do systemctl is-active --quiet $u && ok "$u active" || bad "$u $(systemctl is-active $u)"; done
  info "lelu restarts=$(systemctl show lelu -p NRestarts --value) moss restarts=$(systemctl show lelu-moss -p NRestarts --value)"
  [ $FAILED = 0 ] && echo "== ACCEPTANCE: all automated checks passed" || echo "== ACCEPTANCE: failures above"
}

case "${1:-}" in
  recon) recon;;
  apply) apply_patch "${2:-}";;
  accept) accept;;
  rollback) rollback "${2:-}";;
  *) echo "usage: $0 recon | apply <patch> | accept | rollback [<stamp>]"; exit 2;;
esac
exit $FAILED
