# M23.0 — Known Limitations

Every limitation below is a real gap in this mission's evidence, stated so it
cannot be mistaken for a success.

## Blocked by the environment (no defect in LÉLU)

1. **No physical microphone or speaker.** No `/dev/snd`, no ALSA, no
   PulseAudio/PipeWire, no audio device nodes, no `aplay`/`arecord`/`ffmpeg`
   (`hardware-discovery.md`). Every gate that needs a device is BLOCKED.
2. **Browser acoustic echo cancellation is unmeasured.** `echoCancellation:
   true` is requested; whether it removes her voice from the mic in a real room
   is unknown. It cannot be tested without a speaker and a microphone.
3. **Acoustic false barge-in and double-talk are unmeasured.** Only the
   decision function was measured, not a room.
4. **No five-minute human conversation.** The defining experience test of this
   mission did not happen, and no simulated run is offered in its place
   (`five-minute-human-conversation.md`).
5. **No listening evaluation of any voice.** Nobody heard the samples in
   `audio/`. Naturalness, warmth and pronunciation are unjudged.
6. **The 30-minute soak is one machine, idle-ish.** It says nothing about
   behaviour under a second concurrent session.

## Open engineering gaps

7. **An unusable voice is discovered by crashing a worker.** The warm pool
   loads a 63 MB model and only learns it cannot use it when the binary aborts
   on the first sentence. A pre-flight phoneme-map check would turn that into a
   clear startup error (`voice-identity-readiness.md`).
8. **The echo guard now lets short interruption words through.** This is
   deliberate — 37 of 228 genuine interruptions were being discarded — but it
   has a cost: an echo transcript of exactly *"no"* would now become a spurious
   turn. Her sentences do not begin with interruption words, so the scripted
   corpus never produces one. A physical run should count them.
9. **A question mark is trusted as a signal of a human turn.** Echo that ASR
   punctuates as a question would be treated as speech. Punctuation is the
   recogniser's, not the speaker's.
10. **Delivery is per sentence, not per word.** No emphasis on a chosen word,
    and pauses exist between sentences only (`personality-expression-
    acceptance.md`).
11. **`speakerDevices` counts what the browser enumerated, not what exists.**
    A VM with no sound card reported 3 output devices in M22.9. It is not
    hardware evidence.
12. **Model providers are free-tier and rate-limited.** During the 100-turn run
    Groq returned TPM and TPD 429s and OpenRouter was out of free daily quota.
    The fix makes those turns *explained and spoken*, not *answered* — a person
    still does not get an answer when the provider refuses.

## Scope limitations of this mission

13. **No clone of LÉLU's voice.** She speaks a generic Piper fallback, labelled
    `status: "fallback", cloned: false`. No VoxCPM2 or other cloning model was
    installed: multi-GB weights plus torch against a 4 GiB budget and no GPU.
14. **No new hardware test environment was created.** The procedure is
    prepared; executing it needs a machine with a sound card.
15. **TTS latency measured under contention.** The M23.0 profile samples were
    generated while the acceptance run was using the CPU, so their inference
    times are inflated. Audio durations are unaffected.

## Not limitations, but worth recording

* The four M22.9 silent turns are **explained**, not eliminated: two turns were
  superseded while a rate-limited model call was still stalled. Silence is now
  recorded and, for provider refusals, spoken. A refusal still costs the person
  an answer.
* `voice.onnx` is not `amy-medium` renamed: it is a different speaker (alba,
  en-GB RP) that fails for the same single reason.
