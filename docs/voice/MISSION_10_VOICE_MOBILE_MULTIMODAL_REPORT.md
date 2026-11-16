# Mission 10: Voice, Mobile, Multimodal Perception (first increment)

**Branch:** `claude/gallant-ritchie-v7i0fn`
**Commits:**
- `253c114` merge of `claude/master-integration` @ `558d0fb`
- `44b67b8` ElevenLabs ears, metered voice, production mount
- `53fe1fd` barge-in fix
- `7d41c12` screen-share module
- `b701be6` screen-share wiring and vision-model fix
- the report commit (see `git log`)

**Environment:** a Linux cloud container with Chromium. There is **no physical iPhone or Android device, no Xcode, no microphone, no speakers and no Bluetooth**. Everything "live" below ran in Chromium against the real app, real ElevenLabs and the real model providers. Chromium's microphone was a recording of real speech that ElevenLabs synthesized in a different voice from hers.

## Classification

| Capability | Status | Evidence |
|---|---|---|
| Speech → **ElevenLabs STT** → existing `AIService.chat` | **PASS** | 9 of 9 utterances transcribed across runs. Scribe takes 0.48 s for a short clip in isolation, and 1.1–4.2 s in the app. |
| ElevenLabs **TTS** in her voice, in the app | **PASS** | `eleven_v3` with voice "Jessica". 1.06–1.68 s to synthesize; **1.70 s** from request to playback (3.40 s on the first reply of a session). |
| **Voice → cognition**, same conversation, memory, tools | **PASS (path)** | The utterance reaches `AIService.chat(text, media, …, {conversationId})`. The engine already did this; nothing parallel was added. One clean live turn: "what is the capital of Peru?" → "The capital of Peru is Lima.", spoken. |
| **Anthropic as primary** | **BLOCKED (billing)** | Routing now tries Anthropic first: `DEFAULT_PROVIDER=anthropic`, `CODING_PROVIDER=anthropic`, `LELU_ENABLE_ANTHROPIC=true`. The account answers *"Your credit balance is too low to access the Anthropic API."* |
| **Multi-turn conversation / memory continuity** | **UNVERIFIED** | Turn 2 onward failed on provider availability, not on voice (see Blockers). One run was contaminated by my own concurrent screen test and is not counted. |
| **20 consecutive turns** | **NOT RUN** | No provider could carry 20 turns today. The free tiers were exhausted (OpenRouter: 50 a day). |
| **Interrupting her** (barge-in) | **PARTIAL** | Bug found live: `isSpeaking()` ignored ElevenLabs playback, so barge-in on her voice **never** worked on either path. Fixed in `53fe1fd`, and the recording path now keeps listening while she speaks or thinks. A clean live re-verification after the fix is still pending. |
| Partial (live) transcripts | **PARTIAL** | Available from browser Web Speech where it works. The ElevenLabs path transcribes per utterance (voice-activity segmented); realtime streaming STT is not wired. |
| Noise, network loss, reconnection | **UNVERIFIED** | Not tested in this environment. |
| **Screen sharing: capture, change detection, stop** | **PASS** | `getDisplayMedia` (surface "browser"); frames kept only on change; the "what changed" turn carried before and now frames; stop ends capture (live → not live). |
| **Screen understanding by a model** | **BLOCKED (providers)** | Frames reached the model request. But no provider could see today: Anthropic has no credit, OpenRouter hit its daily cap, Groq has no vision access, and Gemini has no key. |
| Share-screen control in Genesis chat | **PASS** | It sits beside the mic in the existing composer, in view on desktop and on iPhone 13 emulation. |
| Usage accounting for voice | **PASS** | ElevenLabs' own `character-cost` and `fiat-cost-before-overages` are recorded through the Phase 9 gate. Groq Whisper is now metered too. |
| Native iOS (Swift SDK, AVAudioSession, App Intents, background audio) | **UNVERIFIED** | No Xcode or device here. Nothing native was changed. |
| Android (MediaProjection, foreground service, Bluetooth) | **UNVERIFIED** | No device here. |
| Physical iPhone Safari | **UNVERIFIED** | Emulation only, and that isn't counted. |
| Wake word, background, lock screen | **UNVERIFIED / BLOCKED BY PLATFORM** | iOS forbids hidden always-on listening; nothing was claimed or built for it. |
| Avatar lip sync with ElevenLabs audio | **UNVERIFIED** | Not tested in this increment. |

## Repositories

| Repository | Decision | Why |
|---|---|---|
| `elevenlabs/elevenlabs-swift-sdk` | **Not integrated yet** | Needs the native iOS app and Xcode. On the web, ElevenLabs is reached through LÉLU's own server broker, so the key stays server-side. |
| `elevenlabs/skills`, `elevenlabs-flutter` | Not used | The app isn't Flutter. The REST STT/TTS used here is the same service. |
| `pipecat-ai/pipecat` | **Rejected for the web path** | `VoiceEngine` already has voice-activity detection, turn-taking, barge-in, echo suppression and routing into `AIService.chat`. Pipecat would be a **second voice runtime**, which the directive forbids. |
| `livekit/agents` | **Rejected for the web path** | No need for WebRTC to a server agent: cognition runs in the page. The Swift SDK brings LiveKit along when native work starts. |
| `k2-fsa/sherpa-onnx` | **Deferred** | Offline STT fallback. Its WASM build is large for phones; evaluate it with the native app. |

## What changed

- **`plugins/voiceApi.ts`**:
  - new `POST /api/voice/stt` (ElevenLabs Scribe), with per-client rate limits (TTS 60/min, STT 40/min) and a 12 MB upload cap;
  - ElevenLabs usage headers are passed through to the page;
  - the route is **now mounted in `server.ts`**. It existed only in Vite dev, so production had no ElevenLabs voice.
- **`src/core/voice/elevenLabsStt.ts`** (new): metered and budget-gated Scribe client, plus repair of her misheard name ("Lei Liu" and "Leilou" were heard live).
- **`elevenLabsTts.ts`**: metered and gated. If the budget is spent, it falls back to the browser's **free** voice.
- **`VoiceEngine.ts`**:
  - ElevenLabs first, then Whisper;
  - a spent budget stops listening and says why;
  - five bugs found live and fixed:
    1. the first reply of every session used the browser voice;
    2. a broken recognizer lost the first sentence for about 54 s;
    3. barge-in never fired on her ElevenLabs voice;
    4. the recording path stopped listening while she spoke or thought;
    5. spoken turns ignored a shared screen.
- **`src/core/perception/ScreenShare.ts`** (new):
  - consent comes from the browser's picker;
  - a 64×36 luminance diff decides when the screen changed;
  - at most 5 frames are kept, with no model call per frame;
  - frames are attached to the **user's turn**.
- **`GenesisChat.tsx`**: a Share-screen toggle beside the mic; typed turns carry the frames.
- **`OpenRouterProvider.ts`**: the vision model OpenRouter used for every image turn had been **retired** (404). It's now `OPENROUTER_VISION_MODEL`, default `google/gemma-4-31b-it:free`.

## Findings that need your action

1. **Anthropic: no credit.** Add credits in Plans & Billing, then keep these configured on the server: `DEFAULT_PROVIDER=anthropic`, `CODING_PROVIDER=anthropic`, `LELU_ENABLE_ANTHROPIC=true`.
2. **The documented `VITE_DEFAULT_PROVIDER` and `VITE_LELU_ENABLE_ANTHROPIC` are silently ignored.** The runtime bridge skips any entry whose `VITE_` name is set, and the page never reads `import.meta.env`. Use the unprefixed names.
3. **Fireworks is suspended** ("reaching the monthly spending limit or failure to pay past invoices").
4. **OpenRouter's free tier: 50 requests a day**, exhausted during testing. Its response says adding 10 credits raises this to 1,000 a day.
5. **Cerebras returns 401** (key refused).
6. **ElevenLabs is on the free tier: 10,000 characters a month.** This mission used about 1,100. A 20-turn spoken conversation takes about 3,000–6,000.
7. **LÉLU's own provider chain** gives each provider a 12 s per-rung budget, which OpenRouter regularly exceeded with tools. When all providers fail, the chain answers with the "offline" notice or a raw research dump, and in voice that gets **spoken**.
8. **About 29 s of research prefetch** precedes the model call on factual questions. It dominates spoken-turn latency.

## Measured latencies (live)

| Stage | Measured |
|---|---|
| ElevenLabs STT (Scribe), short clip, isolated | 0.48 s |
| ElevenLabs STT in the app | 0.85–4.2 s; 12.8 s under contention |
| ElevenLabs TTS synthesis (`eleven_v3`) | 1.06–1.68 s alone; 3.7–8.2 s in the app (larger segments) |
| TTS request → audio playing | 1.70 s; 3.40 s first-ever playback |
| Speech end → transcript | about 2–4 s |
| Transcript → spoken answer (clean turn) | about 55 s: about 29 s research prefetch, Anthropic refusal, OpenRouter answer, then TTS |

CPU, RAM, battery, frame rate and network for voice were **not measured** in this increment.

## Tests

- **Full suite (final):** **1675 pass, 0 fail, 4 skipped.** An earlier run had one failure: a source-shape test pinning the literal `ai.chat(prompt, media, context`, which I widened to accept `turnMedia`.
- **New tests:** `tests/voice-elevenlabs.test.ts` (8) and `tests/screen-share.test.ts` (3).
- **Live scripts:**
  - `scripts/verify-voice-e2e.cjs`: real speech in, real reply out;
  - `scripts/verify-screen-e2e.cjs`: real tab capture.

## Evidence

- `docs/voice/evidence/voice-e2e.json`, `voice-e2e-desktop.png`: clean single-turn run, with the engine, network and ledger timeline.
- `docs/voice/evidence/multi/`: 5-turn run. **Contaminated** by my own concurrent screen test; kept for transparency and **not counted**.
- `docs/voice/evidence/screen/`:
  - `screen-e2e.json`, `screen-share-target.png`, `screen-share-lelu.png`: capture, change and stop;
  - `composer-share-desktop.png`, `composer-share-iPhone13.png`: the control in the real composer.

## Next steps (in order)

1. Restore a paying provider (Anthropic credit), then re-run the voice conversation for 20 turns, including memory and post-fix barge-in, and the screen-understanding questions.
2. Stream TTS playback, since the server currently buffers the whole MP3, and wire ElevenLabs realtime STT for partial transcripts.
3. Native iOS: Swift SDK, `AVAudioSession`, App Intents, background audio. This needs a Mac with Xcode and a physical iPhone.
4. Android: needs a device.
5. Avatar lip sync driven by her ElevenLabs audio.
