# M22.6 — ENVIRONMENT AND PROVIDER READINESS

**Date:** 2026-11-19
**Verdict:** **PARTIAL** — text/STT providers are available; browser, audio hardware and speech-output infrastructure are not.
No secret value was read, printed, written to an artifact, or committed. Only variable **names** were inspected.

---

## 1. Probe results

| Dependency | Probe | Result |
|---|---|---|
| Node / Bun | `node -v`, `bun -v` | `v26.13.0`, `1.4.4` |
| Dependencies | `bun install --frozen-lockfile` | 957 packages, 20 s |
| Typecheck | `npx tsc -b --force` | **0 errors** |
| Production build | `bun run build` | **0**, built in 22.22 s |
| Test runner | `npm test` | runs (see regression report) |
| Chromium (Playwright) | `npx playwright install chromium` | downloaded 114.7 MiB |
| Chromium launch | `chromium.launch()` | **FAILS** — `libnspr4.so: cannot open shared object file` |
| System package install | `apt-get install libnspr4 libnss3 …` | **DENIED** — not root; `apt-get download` also failed on stale/unavailable sources |
| LiveKit server | `command -v livekit-server` | absent |
| LiveKit agent deps | `python3 -c "find_spec('livekit')"` | absent |
| VoxCPM2 worker | `GET /api/voice/vox/health` | `available:false`, `ECONNREFUSED 127.0.0.1:8788` |
| ElevenLabs | `GET /api/voice/status` / `POST /api/voice/tts` | 503 — not configured |
| Local TTS binaries | `espeak`, `espeak-ng`, `festival`, `pico2wave`, `aplay` | all absent |
| ffmpeg | `command -v ffmpeg` | absent (no audio transcoding) |
| Microphone / speaker | container | **none** |

## 2. Provider availability (names only)

| Variable name | Present in env / `.env.local` | Used for |
|---|---|---|
| `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, `GROQ_API_KEY_3` | **Yes** | Whisper transcription (server broker resolved them) |
| `OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_2`, `OPENROUTER_API_KEY_7` | **Yes** | Text model responses |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Storage (no `SUPABASE_URL`; persistence unavailable) |
| `ELEVENLABS_*` | No | Scribe STT, ElevenLabs TTS |
| `LIVEKIT_*` | No | Live room/agent |
| `VOXCPM_*` | No | LÉLU voice worker |

The Groq key holders are the **server's**, not the browser's. The transcription test proves the broker path works without exposing the key to the page.

## 3. What was attempted to obtain a browser (and why it failed)

1. `npx playwright install chromium` — succeeded (browser files present).
2. First launch — failed on `libnspr4.so`.
3. `npx playwright install-deps` / `apt-get install -y libnspr4 libnss3 …` — `Could not open lock file /var/lib/dpkg/lock-frontend … are you root?` (uid 169530796).
4. `apt-get download …` — sources could not supply the pinned versions (`Can't find a source to download version … of libdrm2/libgbm1`), and 0 packages downloaded.

No user-space browser was substituted because the available ones (headless shell) need the same system libraries, and a text-only substitute would not constitute browser acceptance.

## 4. Minimum environment to clear the voice gate

| Requirement | Minimum |
|---|---|
| Browser | Chromium with `libnspr4`, `libnss3`, `libasound2`, `libgbm1`, `libxkbcommon0`, `libatk*`, `libcups2`, `libdrm2`, `libxcomposite/composite` (or `npx playwright install --with-deps chromium` as root) |
| Input | A real microphone, or Chromium `--use-file-for-fake-audio-capture=<wav>` for a *recorded* input test (must be labelled simulated) |
| Output | A speaker/loopback sink **and** one of: VoxCPM2 worker (GPU or ≥16 GiB RAM), or `ELEVENLABS_API_KEY` (generic voice, labelled) |
| Reply provider | An `.env.local` with one working text provider (present here via OpenRouter) |
| LiveKit (only for full-duplex claims) | `livekit-server` + `services/livekit-agent` Python env + `LIVEKIT_*` credentials |

## 5. Reproduction commands that **do** work in this container

```bash
bun install --frozen-lockfile
npx tsc -b --force
bun run build
PORT=4180 bun run server.ts            # serves dist/ + API brokers

# real speech recognition, real audio, no browser:
curl -s -X POST http://127.0.0.1:4180/api/model/groq/audio/transcriptions \
  -F "file=@docs/voice/listening-pack/05-B.wav;type=audio/wav" \
  -F "model=whisper-large-v3-turbo" -F "response_format=verbose_json"
```

Commands that **cannot** work here: `node verify/learning-integrity-acceptance.mjs` (browser launch), anything LiveKit/Vox/ElevenLabs, and any microphone test.

## 6. Safety

No paid API was added. No account was created. No credential or secret value appears in this report, in the test artifacts, or in Git. The transcription request carried audio only.
