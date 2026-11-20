# M22.7 — SPEECH OUTPUT ACCEPTANCE

**Status:** **PARTIALLY VERIFIED** — real speech was synthesized, saved, proven intelligible and played by the browser; **no speaker exists in this container, so audibility is BLOCKED**.

---

## 1. What speaks now

`POST /api/voice/tts` chooses, in order:

1. **ElevenLabs** — when a key is configured (unchanged paid path).
2. **Local Piper** — new, opt-in via `LELU_LOCAL_TTS_BIN` + `LELU_LOCAL_TTS_MODEL`.
3. **503** — honest refusal when neither exists.

The client is unchanged: it already fetches this route and plays the bytes in an `HTMLAudioElement`.

| Item | Value |
|---|---|
| Engine | Piper 2023.11.14-2 (MIT), CPU |
| Voice | `en_US-amy-low` — **generic, not LÉLU's cloned voice** |
| Output | 16 kHz mono 16-bit WAV |
| Synthesis | 1.14–2.46 s per segment (8–18 s of audio), i.e. 7–8× faster than real time |
| Response header | `X-Lelu-Voice-Provider: local-piper:amy-low` |

## 2. Generated replies (all in `audio/`)

| File | Audio | Synthesis | Spoken text (start) |
|---|---|---|---|
| reply-01.wav | 10.66 s | 1597 ms | "Got it — 15 minutes until the design team meeting…" |
| reply-02.wav | 12.74 s | 1880 ms | "Saved and shared — got it. With the meeting in ~15 minutes…" |
| reply-03.wav | 18.17 s | 2166 ms | "With the meeting in ~15 minutes, would you like me to…" |
| reply-04.wav | 8.23 s | 1143 ms | "**Summarize the Jewelry/Fashion project status**…" |
| reply-05.wav | 16.70 s | 2456 ms | "That's *my* line! 😄 But seriously…" |
| reply-06.wav | 10.38 s | 1648 ms | "**Prep a quick brief** from the Designer…" |

## 3. Independent intelligibility check

Each audio file was posted back to Whisper and transcribed:

| File | Whisper's transcript of the audio | Verdict |
|---|---|---|
| reply-01 | "Got it, 15 minutes until the design team meeting. Want me to pull up any of the jewelry or fashion project notes, concepts, or renders so you have them ready?" | matches the text |
| reply-03 | "With the meeting in tilde 15 minutes, would you like me to 1. asterisk … 3." | matches, including spoken markdown symbols |
| reply-05 | "That's asterisk my asterisk line. Grinning face with smiling eyes but seriously…" | matches |

This proves the audio is **speech**, not silence or noise, and that it corresponds to the reply text — including the flaw that markdown (`*`, `**`, emoji names, `~`) is read aloud.

## 4. Playback

| Evidence | Result |
|---|---|
| `HTMLMediaElement.play()` calls | **6** |
| Source | `blob:http://127.0.0.1:4180/…` |
| `pause` event | 1 |
| `ended` event | 1 |
| Audio device | **none** — headless container |

Playback *started* six times and completed at least once; the rest were superseded by newer replies. Nothing was heard, because there is nothing to hear it with.

## 5. Known defect found by this run

The engine chunks replies for speech and requests each chunk separately; when turns arrive faster than she can speak, the queue falls behind and the reply heard can belong to an *earlier* transcript. In this run, the reply to "I'll remind you tomorrow morning at 9" was superseded by the document reply. This is a real product defect (queueing, not synthesis) and is recorded rather than hidden.

## 6. What remains BLOCKED

- Audibility through hardware.
- ElevenLabs path (no key) and VoxCPM2 (no worker) — neither was used.
- Any claim that this is LÉLU's voice: it is not.
