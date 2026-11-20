# WP05 — PERSONALITY-DRIVEN SPEECH

**Priority:** P0/P1 · **Gate G10:** VERIFIED (delivery), by construction
extensible in all four dimensions.

## 1. Audit: where each dimension already lives

Nothing new was invented. The four dimensions the mission separates map onto
authorities LÉLU already has:

| Dimension | Authoritative source (existing) |
| --- | --- |
| **A. Voice identity** — timbre, accent, stability | `src/core/voice/voiceIdentity.ts` (ElevenLabs: voice + model + `voice_settings`); local fallback `amy-low.onnx` |
| **B. Communication style** — vocabulary, structure, humour, directness | Her cognition: `AIService` + `src/core/identity/LeluIdentity.ts` (`communicationStyle`, `traits`, `coreValues`, `principles`) — the same text that reaches the screen |
| **C. Emotional expression** — excitement, curiosity, seriousness, reassurance | `LeluIdentity` trait state (strength + confidence + status) and the reply's own register |
| **D. Speech delivery** — pace, pauses, variation, sentence endings | **New, and only this**: `src/core/voice/speechProfile.ts` + `speechDelivery.ts` |

The rule kept throughout: **delivery never edits her words.** The only module
allowed to reformat a reply for the ear remains `spokenText.ts` (M22.8), and
it is tested to preserve meaning.

## 2. The implementation

```
LeluIdentity.getState()  ──┐
                           ├─► resolveSpeechDelivery(text, identity) ─► profile id
the sentence being spoken ─┘                                            │
                                                                        ▼
                                              speechProfile.ts: pace / variation / air
                                                                        │
                              POST /api/voice/tts { text, delivery } ───┘
                                                                        │
                                              server validates the id, picks the warm worker
```

- **`speechProfile.ts`** — a closed set of three deliveries, each one a named
  set of real Piper flags. Independently configurable: a profile can be
  retuned without touching a sentence or a personality rule.
- **`speechDelivery.ts`** — pure. Reads her *developed* traits (only
  `emerging`/`established`/`evolving`; a `candidate` observation must not
  change her voice) plus the register of the reply, and returns a profile, a
  pace percentage and a one-line reason.
- **`VoiceEngine.deliveryFor()`** — asks the resolver per sentence and passes
  the profile into `speakText`.
- **The server validates.** `requestedProfile()` accepts only the three ids;
  anything else falls back to `warm`. A client cannot invent a delivery, and
  no text is trusted as a flag.

### The three deliveries, and the evidence they differ

| id | label | `length_scale` | `noise_scale` | `noise_w` | `sentence_silence` |
| --- | --- | --- | --- | --- | --- |
| `warm` | conversational | 1.00 | 0.667 | 0.80 | 0.20 s |
| `calm` | measured | 1.12 | 0.550 | 0.70 | 0.30 s |
| `bright` | lively | 0.92 | 0.780 | 0.90 | 0.14 s |

Measured on one identical sentence (audio in `MISSION-22.9/audio/`):

| Profile | Duration | Bytes |
| --- | --- | --- |
| `warm` | **5.24 s** | 167 724 |
| `calm` | **5.60 s** (+6.9 %) | 179 116 |
| `bright` | **5.10 s** (−2.7 %) | 163 244 |

Same words, audibly different pace — which is the point of separating
delivery from content.

## 3. Register → delivery, and how personality overrides it

| Register (detected from the reply) | Delivery |
| --- | --- |
| supportive, correction, serious, research, technical, long-form | `calm` |
| humorous, excited | `bright` |
| casual, question | `warm` (her default) |

Her developed traits can overrule one step: developed **playfulness**
(`strength × confidence ≥ 0.2`) lifts a casual/question reply to `bright`;
developed **patience** (≥ 0.25) pulls a `bright` reply back to `calm`. In
other words, her voice becomes recognisably hers as her identity develops,
without a single sentence being scripted.

## 4. Verification — 30 representative replies

`tests/voice-speech-delivery.test.ts`, 4 tests over exactly the ten
categories the mission lists (3 replies each):

| Category | Example | Register | Delivery |
| --- | --- | --- | --- |
| Casual conversation | "Morning. I was just thinking about the garden." | casual | warm |
| Technical explanation | "Run `tsc -b --force`; a type error in the module stops the build." | technical | calm |
| Research discussion | "My hypothesis is that the variance comes from the model…" | research | calm |
| Humour | "…as well as a chocolate teapot. Ridiculous." | humorous | bright |
| Emotional support | "I'm sorry, that sounds exhausting. Take your time…" | supportive | calm |
| Correction | "Actually, I was wrong about the number…" | correction | calm |
| Excitement | "It works!! The whole pipeline is warm…" | excited | bright |
| Serious conversation | "The honest answer is that the hardware gate is unverified." | serious | calm |
| Follow-up question | "Do you want me to run it again with a longer silence?" | question | warm |
| Long-form explanation | five-sentence reflective answer | long-form | calm |

Each case also asserts that **the meaning survives speech**: technical terms
(`tsc`, `module`, `worker`, `ms`, `hypothesis`…) are still present in the
spoken text, numbers become words rather than disappearing, and delivery
decisions never mutate the reply.

Two further tests pin the *personality* half: an unpromoted trait changes
nothing, developed playfulness lifts a casual reply to `bright`, developed
patience outranks playfulness even for a joke, and a serious answer is
measured regardless of who is listening.

## 5. Limits

- The register classifier is **lexical**. Irony without a humour marker, or
  sarcasm, is read as `casual` — her voice will not "get" a joke that carries
  no signal of being one.
- ElevenLabs (when configured) receives her `voice_settings` from
  `voiceIdentity.ts` as before; the three delivery profiles shape the **local
  Piper** path, which is the only voice this mission could exercise. Mapping
  profiles onto ElevenLabs' `style`/`stability` would be a further change and
  is not claimed here.
- No emotional *content* generation was added. She does not become more
  playful in what she says; only in how a reply she already wrote sounds.
