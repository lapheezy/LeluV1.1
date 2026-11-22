# M22.10 WP05 — Integration acceptance matrix

All runs below used the **integrated canonical build** (server version
`e68a9719` plus the `VoiceToggle` change committed as `4e61922b`; the browser
runs were made on that exact source, built before the commit).

* **Real:** `bun server.ts`, Groq Whisper (server relay), the app's model
  providers (OpenRouter answered every desktop turn), local Piper speech,
  Chromium audio/playback events.
* **Simulated:** the microphone (Chromium fake capture of
  `.piper/session-mic.wav`, plan `logs/mic-plan.json`), and in two rows the
  platform event (marked).
* **Absent:** speaker, headset, human listener, iPhone/WebKit.

| # | Requirement | Simulated-browser result | Evidence | Physical status |
| --- | --- | --- | --- | --- |
| 1 | Chat Universe mic activates | ✅ 1 `getUserMedia`, `listening` at +0.5 s | `logs/e2e-desktop.json` `session` | NOT TESTED |
| 2 | Listening state reflects actual mic | ✅ button `off → live → off`; `suspended` while capture is lost; `off` after denial | desktop, visibility, denial runs | NOT TESTED |
| 3 | Voice messages enter the correct conversation | ✅ all 4 voice turns + the typed turn in the one active conversation | `conversationAfter` | — |
| 4 | Responds through the existing model runtime | ✅ `AIService.chat` → `provider: OpenRouter` on every reply | `conversationAfter[].provider` | — |
| 5 | TTS plays responses | ✅ 34/34 `/api/voice/tts` 200 (local-piper); `playing`/`ended` events | `tts[]`, `media[]` | speaker NOT TESTED |
| 6 | Barge-in stops playback | ✅ 2/2 lines spoken over her; she stopped 3.0 s / 1.7 s after the line ended | `bargeInFromPhase` | acoustic NOT TESTED |
| 7 | Interrupted turns do not contaminate later turns | ✅ 34 spoken sentences attributed by content: **0** from an earlier turn; `staleStreamsDropped 0`; every reply answers its own question | `logs/contamination-desktop.json` | — |
| 8 | Microphone loss detected | ✅ `captureLosses 1` (real `track.stop()` + `ended`) | `logs/e2e-recovery.json` `micRecovery` | NOT TESTED |
| 9 | Microphone recovery | ✅ re-acquired in **821 ms**, `micStreamsOpen 1`; after a second loss the next line was transcribed | `micRecovery`, `sttNetworkFailure` | NOT TESTED |
| 10 | Denial: no repeated prompts | ✅ one tap → exactly **1** `getUserMedia`, state `denied`, button `off`, 0 streams (headless Chromium denial, no auto-accept) | `logs/e2e-denial.json` | Safari NOT TESTED |
| 11 | Visibility transitions release/restore | ✅ *(simulated `visibilitychange`)*: hidden + mic lost → `idle`, button `suspended`, **0** re-acquire attempts while hidden; visible → restored in **469 ms**, `listening`. `pagehide` → inactive, every track `ended` | `logs/e2e-visibility.json` | iOS background/lock NOT TESTED |
| 12 | No accumulation over repeated sessions | ✅ 30 cycles: streams 30/30 released, 0 open; AudioContexts 61/61 closed; window/document listeners 91/7 flat; heap 39.24 → 41.18 MB | `logs/resource-probe.json` | — |
| 13 | Typed messages retain voice context | ✅ typed: "list the topics…" → "We've covered Lima (Peru), an ocean fact (oxygen from phytoplankton), a math question (7×8=56), and confirmed…" | `conversationAfter` (last message) | — |
| 14 | Mobile chat independent of hidden Cosmos rendering | ✅ iPhone-13 profile: WebGL draw calls per 5 s — home 192, **chat open 0, chat + live voice 0** | `logs/mobile-cosmos-probe.json` | WebKit NOT TESTED |

Additional mobile checks (`logs/e2e-mobile.json`): mic 44×44 px, in viewport,
unobstructed (`elementFromPoint` → mic); touch start/stop; all tracks ended.

## Measured timings (desktop, integrated build)

| | Turn 1 | Turn 2 (barge-in) | Turn 3 (barge-in) | Turn 4 |
| --- | --- | --- | --- | --- |
| STT request (ms) | 635 | 2 118 | 449 | 298 |
| Transcript → first text | 4 522 | 2 448 | 2 363 | 1 967 |
| Transcript → first audible | 6 434 | 5 674 | 2 983 | 2 363 |

Tap → microphone live: median 589 ms (240–1 134) over 30 cycles.

## Observations (not failures of the integration)

* With the speech server failing every sentence, the phase stays `speaking`
  until the streamed reply finishes (22 s in the recovery run), then returns
  to `listening`. The phase follows the reply in progress, not audio that
  never played. This is inherited M22.9 behaviour, recorded here.
* Read aloud while a voice session listens can be heard by the open mic
  (WP02 residual).

## Physical acceptance still required

Every "NOT TESTED" cell needs one run on hardware: a desktop with a real
headset, and an iPhone in Safari and as an installed PWA. Run the 17 steps of
`MISSION-22.9/06-END-TO-END-ACCEPTANCE.md` plus rows 10–11 here.
