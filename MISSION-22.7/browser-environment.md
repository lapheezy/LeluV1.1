# M22.7 — BROWSER ENVIRONMENT

**Result:** a real Chromium runs and loads LÉLU. No root, no system package manager, no paid browser service.

---

## 1. Why it failed in M22.6

Playwright's Chromium was present but could not start: `libnspr4.so` and 15 other shared libraries were missing, and `apt-get install` was refused (not root; uid 169530796).

## 2. What was done instead

1. Confirmed the host: **Ubuntu 24.04.5 LTS, x86_64**, matching the Noble packages exactly.
2. Downloaded the Noble `Packages.gz` indexes for `main` (`noble`, `noble-updates`) from `archive.ubuntu.com`.
3. Resolved the 14 root libraries **and their dependencies recursively** from those indexes (77 `.deb` files in total).
4. Fetched each `.deb` with `curl` and unpacked it with `dpkg-deb -x` into `.browser-libs/extract` — user-space only, nothing installed system-wide.
5. Launched Playwright's Chromium with:

```
LD_LIBRARY_PATH=<repo>/.browser-libs/extract/usr/lib/x86_64-linux-gnu
--no-sandbox --disable-dev-shm-usage
--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
--use-file-for-fake-audio-capture=<wav>
--autoplay-policy=no-user-gesture-required
```

`ldd` now reports **no missing libraries**. Reproducible via `MISSION-22.7/scripts/prepare-voice-runtime.sh`.

## 3. Verified browser capabilities

| Capability | Result |
|---|---|
| Page loads / React app boots | **Yes** — `StartupDiagnostic 15/15`, `BOOTSTRAP_DONE` |
| WebGL / Three.js scene renders | **Yes** — screenshots show the full UI and avatar |
| `navigator.mediaDevices.getUserMedia` | **Yes** — `Fake Default Audio Input` |
| `MediaRecorder` | **Yes** — VAD recorded 9 utterances, 3.7–6.5 s each |
| `fetch` to app APIs | **Yes** — every API call observed with status |
| `HTMLAudioElement.play()` | **Yes** — `play` events on `blob:` URLs, `ended` observed |
| `speechSynthesis` voices | **0** — no system speech engine on this image |
| Web Speech recognition | API present, returned no result (no Google speech backend) |
| Screenshots | `screenshots/01-chat-before-voice.png` … `04-second-session.png` |

## 4. Console noise that is expected

- `ERR_CONNECTION_REFUSED` for optional local services (LiveKit/Vox/engineer status) — not configured.
- `503` for `/api/voice/status` before Piper was configured; after configuration it returns 200 with `provider: "local-piper"`.
- Supabase `GoTrueClient` warning — no `SUPABASE_URL`, cloud sync off.
- three.js `Clock` deprecation and WebGL performance notices.

None of these stopped the voice loop.

## 5. Limits

- Input is Chromium's **file-backed fake device**; there is no physical microphone.
- There is **no audio output device**, so nothing can be *heard*; playback is proven by media events and by round-tripping the generated audio.
- Browser is headless; screenshots are the visual evidence.
