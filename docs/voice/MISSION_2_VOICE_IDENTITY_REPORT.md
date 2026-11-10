# MISSION 2 — LÉLU VOICE IDENTITY INTEGRATION

Reference-audio discovery, VoxCPM2 adapter, and runtime wiring.
Evidence is separated by kind: **implementation** (code that exists),
**integration** (proven wiring), **runtime** (actually executed here),
**voice quality** (requires listening — not claimed).

---

## 1. Starting state

| Item | Value |
|---|---|
| Required branch | `integration/lelu-four-workforce-consolidation` |
| This chat's branch | `freebuff/44c122e89826b555c8003299`, created at the same commit |
| Starting SHA | `62ad310` — "Add LÉLU voice reference audio for Freebuff" |
| Working tree at start | clean |
| `62ad310` present | yes |

Cloud chats run on their own branch at the same commit; the architecture was
not changed and no extra branches were created.

## 2. Reference recording — verified

`public/audio/voice/lelu-voice-reference.m4a`

| Property | Measured value |
|---|---|
| Size | 696 337 bytes |
| SHA-256 | `9ac99650243c50a5d0e2975636aea99eceeefb33eda4a7d15c05c7468da241ae` |
| Container / codec | MP4/M4A, **AAC-LC** (`mp4a`), 104 kb/s |
| Duration | **48.81 s** |
| Sample rate / channels | **44 100 Hz, stereo** |
| Full decode | **clean** — every frame decoded, no errors (`ffmpeg -f null`) |
| Peak / RMS | 0.9483 / 0.1004 — **no clipping** (0 near-clipped samples) |
| Git LFS | not used; real bytes committed |

Reachable over HTTP from the running app exactly at the expected public path:

```
GET /audio/voice/lelu-voice-reference.m4a
→ 200  content-type: audio/mp4  bytes: 696337  sha256: 9ac99650… (identical)
```

The original was never renamed, moved, overwritten or duplicated.

## 3. Reference analysis — and the finding that matters

**Transcript** (machine transcription; Whisper `base` and `small` agree closely):

> To bring them tribute from the temple to guide them here. My only wish is to serve the gods.
> Before the High Priest, honey, you're gonna need it. Oh no, don't worry about me, boys.
> My only wish is to serve the gods. Remember? Well, if you guys want the gold and you don't want
> to get caught, right? You're going to need my help. Are you serious? I want it in on this game
> so I can get out. So when you guys are ready to go back to where you came from… Deal.
> Then I suppose that means you'll want these back.

Language: English (probability 0.964). One word is uncertain: `base` heard "in on the scale",
`small` heard "in on this game". Everything else matched.

**Acoustic measurements** (16 kHz mono decode, 50 ms windows, autocorrelation pitch):

| Measure | Value |
|---|---|
| Voiced fraction | 0.854 — near-continuous speech, few pauses |
| Pitch p5 / p25 / median / p75 / p95 | 79.4 / 139.1 / **197.5** / 258.1 / 367.0 Hz |
| Per-second median pitch | swings 87 → 368 Hz between adjacent seconds |

**This is not one person speaking one part.** The per-second pitch trace and the
dialogue transcript ("honey, you're gonna need it", "Are you serious?", "I want
it") show an acted scene with **more than one voice**.

That is decisive for this mission: cloning the whole file clones *the scene*, and
similarity to any single speaker will be poor, because VoxCPM2's prompt pairing
and reference conditioning both assume one consistent timbre. The adapter and
deployment therefore support cutting a single-speaker window
(`START=… DURATION=… prepare-reference.sh`) rather than pretending the whole clip
is a clean reference. Selecting that window by ear is the owner's call — I cannot
listen.

## 4. Implementation — what now exists

| File | Role |
|---|---|
| `src/core/voice/voiceIdentity.ts` | Frozen identity: committed path, transcript, language, 48 kHz. DOM-free so the server can import it. |
| `src/core/voice/adapters/VoxCpmTts.ts` | The replaceable adapter: status probe, reference-conditioned request, serialised generation, cancellation, measured timings. |
| `plugins/voxcpmApi.ts` | Server route `GET /api/voice/voxcpm/status`, `POST /api/voice/voxcpm/tts`; loads the reference from the repo, attaches the transcript, enforces the consent gate, rate limits, same-origin. |
| `deploy/voxcpm/lelu_voxcpm_server.py` | Inference server around the official `voxcpm` SDK; `POST /v1/audio/speech` with reference conditioning. Consumes the model on GPU. |
| `deploy/voxcpm/prepare-reference.sh` | Derives the reference WAV from the committed recording (the `.m4a` is only read). |
| `deploy/voxcpm/evaluate-voice.sh` | Runs the five evaluation sentences and saves samples. |
| `deploy/voxcpm/README.md` | Hardware, model pin, consent gate, and what is/is not verified. |
| `scripts/measure-voxcpm-overhead.ts` | Reproducible route-overhead measurement. |
| `tests/voice-voxcpm.test.ts` | 11 offline regression tests. |

Edits to existing files were deliberately three small ones:

| File | Change |
|---|---|
| `src/core/voice/elevenLabsTts.ts` | `speakText()` asks her reference voice first, falls back to the configured provider; `stopSpeaking()` cancels a pending generation; new `serverVoiceReady()`. |
| `src/core/voice/VoiceEngine.ts` | The one-time "does her server hold her voice" probe now asks `serverVoiceReady()` — otherwise a runtime holding only VoxCPM2 was demoted to the browser's system voice. |
| `vite.config.ts`, `server.ts` | Mount the new route in dev, preview and the Node server. |

Cognition, chat components, Cosmos and the existing provider path are untouched.

## 5. Integration — proven by test

Flow, using the existing pipeline end to end:

```
VoiceEngine.speakResponse / streamed segment       (existing)
  → chunkForSpeech                                  (existing)
    → speakText()                                   (existing seam)
      → speakWithVoxCpm()                           (adapter)
        → POST /api/voice/voxcpm/tts                (route)
          → POST /v1/audio/speech                   (VoxCPM2)
            → audio → the same HTMLAudioElement playback path
```

`tests/voice-voxcpm.test.ts` — **11/11 pass**:

- status reports no server/no reference/no consent honestly, and makes no network call;
- status reports the prepared reference and pinned model **without** returning the private path;
- generation **403** until consent is attested, and the model is never reached;
- generation **503** with no inference server; **503** when the reference is missing (never substituted);
- the request carries the **reference audio and its exact transcript**, `prompt_audio == reference_audio` (ultimate cloning), and the audio returns intact with the voice-identity header;
- upstream failure → **502 JSON**, never a 200 with audio that was not made; empty audio → **502**, never silence;
- over-long text → **413**; cross-origin → **403**; nothing reaches the model in either case.

## 6. Runtime — actually executed in this environment

| Check | Result |
|---|---|
| App boots with the new route | **yes** — Vite dev server, route mounted |
| `GET /audio/voice/lelu-voice-reference.m4a` | **200**, `audio/mp4`, 696 337 bytes, identical SHA-256 |
| `GET /api/voice/voxcpm/status` | **200**, reports `configured:false` and names exactly what is missing (no inference server, and consent not attested); after the reference WAV was derived it reports `referenceLoaded:true` with its real size — honest, not "working" |
| `GET /api/voice/status` (existing provider) | **200**, unchanged shape — no regression |
| Reference WAV derivation | **ran** — 4 300 366 bytes, SHA-256 `bf27bdb6…`, 44.1 kHz mono |
| Route overhead (stubbed upstream) | **median 34.7 ms, p95 43.3 ms**, min 16.7 / max 43.3; reference payload 5 733 824 bytes base64 |
| Typecheck (`tsc -b`) | **exit 0** |
| Lint on changed files | **0 errors, 0 warnings** |

Route overhead is the LÉLU side only (request, cached-reference encode, proxy hop,
response body). It **excludes** model inference; the harness says so in its output.

## 7. Regression — nothing broke

| Suite | Result |
|---|---|
| New VoxCPM2 tests | 11 / 11 pass |
| Existing voice suite (adapters, provider, core, streaming, continuity) | **43 / 43 pass** |
| **Full repository suite** | **1 953 pass, 0 fail**, 6 pre-existing skips (1 959 total) |

Existing text chat remains operational: the voice path is unchanged in shape, and
its tests still pass.

## 8. Hardware — measured, and why the model is not running here

| Resource | This environment |
|---|---|
| GPU | **none** (`nvidia-smi` absent) |
| CPU | 2 vCPU |
| RAM | 3.8 GiB |
| Disk free | 8.5 GiB |

`openbmb/VoxCPM2` (OpenBMB, **Apache-2.0** for code and weights; 2B params, BF16,
48 kHz mono, 30+ languages) needs **~8 GB VRAM** per the official model card.
vLLM-Omni is the official production path (OpenAI-compatible `/v1/audio/speech`,
continuous batching); llama.cpp-omni GGUF is the small-footprint path (~5 GB
VRAM). Reference RTF after warm-up is **~0.12 on an RTX 4090**.

**Exact blocker:** no GPU with ≥8 GB VRAM (and 3.8 GiB of RAM), so VoxCPM2 cannot
be *served* here. Smallest viable deployment: **one cloud GPU instance with 8 GB
VRAM** (e.g. T4/A10/3090 class), or ~5 GB VRAM via the GGUF path. Installation
alone is not deployment, so nothing here claims the model is running.

Consequence, stated plainly: **no audio was generated.** No time-to-first-audio,
no real-time factor for the model, no listening comparison.

## 9. The five evaluation sentences — prepared, not yet run

`deploy/voxcpm/evaluate-voice.sh` runs these through her clone once a GPU exists:

1. *Normal:* "Good evening. I have finished reviewing the repository, and everything is in order."
2. *Longer explanation:* "The interesting part is not that the parser failed, but why it failed: the fixture still expected three arguments, so every assertion after the first one was measuring the wrong value entirely."
3. *Question:* "Would you like me to walk you through the change, or would you rather see the diff first?"
4. *Warm:* "I missed you today, and I am glad you are here. Come, sit with me for a moment; the evening is quiet and there is no rush."
5. *Numbers / unusual words:* "In nineteen eighty-four, exactly forty-two satellites crossed the Oort cloud, and the Nginx reverse proxy logged three thousand one hundred and seven requests in under ninety seconds."

## 10. Voice quality — deliberately not claimed

| Criterion | Status |
|---|---|
| Speaker similarity, naturalness, pronunciation, timbre, cadence, artifacts, consistency | **not evaluated** — requires generated audio and listening |

An exact voice match is **not** claimed. With the full multi-voice clip as the
reference, low similarity is the *expected* outcome; a single-speaker window is
the fix and needs a human ear to choose.

## 11. Consent

Cloning is gated in two places, fail-closed:

- route → `403`, nothing reaches the model, unless `LELU_VOICE_CONSENT_ATTESTED=true`;
- inference server → refuses to start (`exit 2`) without the same attestation.

The mission states the recording is the owner's own voice. That is the operator's
attestation, not something software can verify, so the flag was **left unset** and
nothing was generated here. Set it only when the recording is your own voice or
you hold the speaker's explicit authorisation.

## 12. Acceptance status

| Criterion | Status |
|---|---|
| Committed reference located and verified | **PASS** (§2) |
| VoxCPM2 deployed | **BLOCKED** — no GPU with ≥8 GB VRAM (§8) |
| Reference-conditioned generation works | **implemented + tested against a stub**; not run on a real model |
| Generated voice evaluated against the recording | **BLOCKED** (depends on generation) |
| LÉLU speaks a real cognition response | **wired**; unverified at runtime |
| Audio playback in the existing app | **unchanged path**, not re-tested with real audio |
| Text and voice synchronised | preserved by design (same existing seam) |
| Stop / interruption | implemented; existing barge-in tests still pass |
| Existing text chat operational | **PASS** (§7) |
| Regression tests pass | **PASS** — 1 953 pass, 0 fail |
| Generated samples available for review | **BLOCKED** — none generated |

## Remaining blockers, in order

1. **GPU with ≥8 GB VRAM** (hard blocker for generation and audio quality).
2. **Consent attestation** by the operator (`LELU_VOICE_CONSENT_ATTESTED=true`).
3. **Single-speaker reference window** — pick it by ear; the committed clip contains several voices.
4. **Transcript confirmation** — machine-derived; one word uncertain ("this game"/"the scale").
