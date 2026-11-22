# M22.9 persistent voice runtime — acceptance matrix

Statuses: VERIFIED · PARTIALLY VERIFIED · BLOCKED · FAILED · NOT TESTED.
"Simulated microphone" = Chromium fake capture; no physical audio device exists here.

| Gate | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| G1 | Exact branch recovered and verified | **VERIFIED** | `01-BRANCH-RECOVERY.md` (remote = local = `b46b0aa3`, 14 ahead / 0 behind `543da7c8`) |
| G2 | Existing implementation audited | **VERIFIED** | `02-IMPLEMENTATION-AUDIT.md` |
| G3 | Persistent mic lifecycle within platform limits | **PARTIALLY VERIFIED** | Unit: 20 lifecycle tests. Browser: 1 stream across 4 turns, re-acquire after loss (817 ms), 40 start/stop cycles clean. iOS Safari/PWA lifecycle **not tested** (no hardware). |
| G4 | Voice uses the existing cognition runtime | **VERIFIED** | Code path `handleUserSpeech → AIService.chat`; E2E replies from Groq/OpenRouter in the active MultiChatStore conversation |
| G5 | Speech recognition works | **PARTIALLY VERIFIED** | 13/13 spoken lines in the committed desktop/mobile runs (plus the recovery run's lines) transcribed verbatim by Groq Whisper — from synthesized speech through a simulated microphone. Physical microphone and human speech not tested. |
| G6 | Speech generation works | **PARTIALLY VERIFIED** | 18–32 TTS requests per run, all 200 (local Piper); browser `playing`/`ended` events. No speaker / listener. |
| G7 | Barge-in and interruption | **PARTIALLY VERIFIED** | 3× repeated barge-in (unit); 5 live barge-ins over her speech across 3 runs, stop 1.4–2.2 s after the user's line. Acoustic echo / false barge-in on real hardware not tested. |
| G8 | Successive conversational turns | **VERIFIED** | 4 spoken turns per run with one microphone stream and no restart (`getUserMediaCalls: 1`) |
| G9 | Voice and typed chat share context | **VERIFIED** | Run 3: typed question answered by the model with every voice topic and the user's name |
| G10 | Error recovery | **VERIFIED** (browser level) | Recovery run: TTS 500, mic loss, STT abort; real provider outage in a mobile run; unit: deny, no device, revoke, busy, hidden page |
| G11 | Mobile interface works | **PARTIALLY VERIFIED** | iPhone-13 emulation on Chromium: touch, 44 px target in viewport and unobstructed, voice turn, cleanup. Real iPhone Safari / PWA **not tested**. |
| G12 | Desktop interface works | **VERIFIED** | 3 desktop runs, mic state indicator `off/live/off`, screenshots `desktop-*` |
| G13 | Resource cleanup verified | **VERIFIED** | 0 open streams after every stop; AudioContexts created = closed (61/61); listeners flat over 30 cycles |
| G14 | No critical performance regression | **VERIFIED** | `07-PERFORMANCE-REPORT.md` — latencies in line with earlier M22.9; heap +≈40 KB/session over idle control, no growing structure |
| G15 | Targeted and integration tests pass | **VERIFIED** | 141/141 voice tests; new file 20/20 |
| G16 | Full regression recorded | **VERIFIED** | 2 346 tests: 2 339 pass, 1 pre-existing env failure (`genesis-interface`, identical at baseline), 6 skipped |
| G17 | Typecheck, lint, build recorded | **VERIFIED** | tsc 0; oxlint 0 errors, 175 warnings (identical set to baseline); build 0 |
| G18 | Real end-to-end acceptance | **PARTIALLY VERIFIED** | All 17 steps pass through the real app, STT, model and TTS — microphone simulated, no speaker, no human (`06-END-TO-END-ACCEPTANCE.md`) |
| G19 | Evidence committed and traceable | **VERIFIED** | `MISSION-22.9/0*-*.md`, `persistent-runtime/{logs,screenshots,scripts,test-results.json}`; commit on the branch |
| G20 | Pushed without altering canonical history | **VERIFIED** | fast-forward push of `m22.9/persistent-voice-runtime`; `543da7c8` untouched (see `FINAL-REPORT.md` §G) |

## Why each partial gate is partial

* **G3, G11** — iOS (Safari and installed PWA) cannot be run in this Linux
  container. The behaviour on backgrounding, lock and calls is implemented and
  unit-tested against simulated events, not observed on WebKit.
* **G5, G6, G7, G18** — there is no microphone, speaker or person here. The
  software pipeline is real end to end; acoustic capture, audibility, echo and
  false barge-in need a device.

No gate is BLOCKED or FAILED in software. The hardware gap is a single action:
run `06-END-TO-END-ACCEPTANCE.md`'s 17 steps once on an iPhone and once on a
desktop with a real headset.
