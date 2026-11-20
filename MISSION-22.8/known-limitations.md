# M22.8 — Known limitations

Everything here is true of the candidate as committed. Nothing in this list is
fixed by documentation.

## Blocked by the environment (not by the code)

1. **No physical microphone.** Capture was exercised with Chromium's
   `--use-file-for-fake-audio-capture`. Real device timing, gain control,
   permission UX, disconnection and device switching are unverified.
2. **No physical speaker.** Whether sound leaves the machine, how loud, and how
   it sounds in a room are unverified.
3. **No acoustic echo path.** The fake device never contains her own voice mixed
   with room reflections, so AEC quality and false-barge-in rate are unknown.
   `isBargeIn` may be too eager or too conservative with real audio.
4. **No GPU and no VoxCPM2 dependencies.** `torch`, `voxcpm` and
   `imageio-ffmpeg` are absent; the model is not downloaded. LÉLU's own voice
   cannot be produced here.

## Measured shortcomings

5. **First audio is 3.2–3.5 s median, not the 2 s target.** Breakdown: ~1.4 s
   to first text (model + routing + recall) and ~1.8 s from TTS request to first
   audible sample (mostly Piper's per-invocation model load). P90 is worse
   (5.3–5.7 s) and one run had a 13.4 s outlier at the model stage.
6. **ASR P90 is 593–914 ms**, above the 500 ms target even though the median
   (443–499 ms) meets it.
7. **Live stale-drop count is 0.** The ownership protection is proven by unit
   test, not by a live occurrence in these runs.
8. **Inter-sentence discontinuity was not directly measured.** Intra-sentence
   scheduling is contiguous by construction and measured; the gap *between*
   sentences of one reply has only indirect evidence.

## Functional gaps

9. **Piper is not LÉLU's voice.** It is a labelled fallback. Voice identity
   (G11's second half) is unresolved until VoxCPM2 (or another cloning model)
   is hosted.
10. **No emotional expression.** Prosody is fixed; nothing conditions delivery on
    context. This is deliberate (the mission keeps identity, intelligence and
    expression separate), but it means "expressive variation" is not delivered.
11. **Code blocks are skipped, not announced.** A reply that is mostly code is
    nearly silent.
12. **Emoji are deleted, not interpreted.** "I ❤️ it" becomes "I it.".
13. **Bare-domain reading is literal** — "lelu dot dev" rather than a brand
    pronunciation; there is no pronunciation dictionary.
14. **One-word barge-ins do not interrupt** (`isBargeIn` requires two words).
    That is a deliberate tuning choice that may not survive a listening test.
15. **Barge-in cannot un-speak.** If a turn is superseded after its first
    sentence played, that sentence was heard.
16. **Cross-tab conversations are not coordinated.** Ownership is per page.
17. **Half-duplex remains whenever AEC fails.** If the browser cannot cancel her
    output, the echo guard drops her own words but also risks dropping a real
    interruption that resembles her speech.

## Architecture limits accepted for this mission

18. **No duplicate service was created.** The work extends `VoiceEngine`,
    `elevenLabsTts`, `voiceApi` and `AIService`'s existing stream. That also
    means the speech layer inherits `VoiceEngine`'s singleton lifetime and its
    single-pipeline assumptions: one conversation can speak at a time per page.
19. **The server streams PCM only for the local engine.** ElevenLabs still
    returns a complete MP3; `stream: true` is ignored there. A provider-agnostic
    streaming contract would need a different route, and was not attempted.
20. **`window.__leluVoice` is a diagnostic surface, not an API.** Its shape may
    change; the acceptance harness reads it, so any change must update the
    harness.

## Not attempted at all

21. LiveKit full-duplex transport (untouched; unchanged from M22.7).
22. Server restart with a live page (procedure written, not executed).
23. Rate-limit behaviour driven through the real route (unit-level only).
24. Fault injection on the network path during a live turn.
25. Listening tests with human raters (no audio device; also out of scope).
