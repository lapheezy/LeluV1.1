# KNOWN LIMITATIONS

Every item below is a fact about what was or was not demonstrated. None of
them is a guess, and none is hidden in a footnote elsewhere.

## Hardware

1. **No physical microphone or speaker exists in this environment.**
   `/dev/snd` is absent, there is no ALSA userland, no PCI audio device and no
   sound server. Every audio result is software. G6 and G7 are **BLOCKED**.
2. **No acoustic echo cancellation was measured.** The browser is *asked* for
   AEC/NS/AGC and the software echo guard (`isEchoUtterance`) is tested, but
   whether a real speaker's output leaks into a real microphone was not
   observed.
3. **No audibility claim.** Browser playback events prove a player ran, not
   that a human heard anything. `firstAudibleLatencyMs` is the browser's own
   `playing` report — closer, still not ears.

## Voice

4. **LÉLU has no established voice identity.** The diagnostic serves
   `status: "fallback"`, `cloned: false`. `amy-low` is a placeholder voice and
   is never described as hers.
5. **Two of the three voice models present cannot load.** `amy-medium.onnx`
   and `voice.onnx` abort with `"aɪ" is not a single codepoint` — a
   model/binary phoneme-map mismatch. The candidate set is therefore one voice.
6. **No listening evaluation was performed.** The blind protocol exists; no
   panel ran, so no candidate is adopted on quality grounds.
7. **VoxCPM2 remains unavailable** (no torch, no weights, no GPU, multi-GB
   download against a 4 GiB checkpoint budget, CPU inference too slow for a
   conversation).

## Runtime

8. **Warm audio is not sample-streamed.** `--json-input` cannot emit
   `--output_raw` (measured: 10 bytes), so a sentence arrives complete. This
   is a real regression in *streaming granularity* that is more than paid for
   in *time to first audio* (426 → 114 ms), but it is a trade, not a free win.
9. **A second delivery profile costs a model load** the first time it is used,
   because per-request `length_scale` is ignored by the JSON protocol.
10. **Idle workers stay resident.** A warm worker holds ~95–145 MiB until the
    server exits. There is no idle eviction; a host with many profiles would
    need one (the knob exists in the code, it is not enabled).
11. **Server restart with a live page was not tested** (the M22.8 D5 procedure
    still has not been run). Boot prewarm is verified; the reconnect path is
    not.
12. **Storage exhaustion was not tested.** The code path (output file never
    appears → 20 s timeout → `timeout`) is reasoned, not measured.

## Conversation

13. **The long conversation run is SIMULATED.** It uses Chromium's
    `--use-file-for-fake-audio-capture` with a recorded WAV. It is not human
    conversational acceptance, and it is labelled simulated in its own
    document.
14. **Interruption was exercised in software only.** Barge-in counts come from
    the VAD and playback cancellation, not from a person talking over her.
15. **The model provider is what it is.** First-text latency is dominated by
    the response provider, which this mission neither changed nor optimised.
16. **Delivery is lexical.** Sarcasm without a marker reads as casual; her
    voice will not treat it as a joke.

## Method

17. **The benchmark's comparison is asymmetric on purpose** (cold credited at
    first byte, warm at complete sentence) and is stated as such; the warm
    numbers are the pessimistic ones.
18. **`medianSynthesisMs` in the live server (656 ms) is larger than the
    benchmark's 114 ms** because live sentences are longer and Chromium shares
    the CPU. Both numbers are reported; neither is presented as the other.
