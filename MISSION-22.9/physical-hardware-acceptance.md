# PHYSICAL MICROPHONE AND SPEAKER ACCEPTANCE

**WP03 · Gates G6 (microphone) and G7 (speaker): BLOCKED**

## 1. The finding, stated plainly

This runtime has **no audio hardware**. That is measured, not assumed:

```
$ ls /dev/snd
ls: cannot access '/dev/snd': No such file or directory
$ aplay -l
bash: aplay: command not found
$ lspci | grep -i audio
(no audio device)
$ pactl info
bash: pactl: command not found
```

No ALSA device node, no ALSA userland, no PCI audio controller, no
PulseAudio/PipeWire server. A container without `/dev/snd` cannot capture or
play sound, whatever a browser reports. So:

- **Physical microphone acceptance: BLOCKED** — there is nothing to speak into.
- **Physical speaker acceptance: BLOCKED** — there is nothing to listen to.
- **Every audio result in this mission is software**, produced with
  Chromium's `--use-file-for-fake-audio-capture` and an `AudioContext`, and is
  labelled as such.

The browser-side diagnostic now reports what the browser sees: `VoiceEngine`
enumerates `audiooutput` devices once the mic is held and publishes
`speakerDevices` (a count, or `null` for "never asked"). During the M22.9 run
Chromium reported **3** output devices — while the container has **no**
`/dev/snd` at all. That gap is exactly why enumeration is not audibility, and
why the hardware gate stays blocked: the browser lists sinks that do not exist
as hardware, and nothing in this environment can play or capture a sound.

## 2. What was prepared so acceptance is one command on real hardware

### Device inventory to record

| Fact | How | Where it goes |
| --- | --- | --- |
| Microphone count and labels | `navigator.mediaDevices.enumerateDevices()` after permission | `window.__leluVoice.diagnostics.speakerDevices` for outputs; labels in the run log |
| Permission state | `VoiceEngine.getState().permission` | run log |
| Capture actually delivering samples | non-zero RMS from the `AudioWorklet` VAD over 3 s | run log |
| Echo cancellation / noise suppression / AGC granted | `MediaStreamTrack.getSettings()` (`echoCancellation`, `noiseSuppression`, `autoGainControl`) | run log — the *requested* constraints are already in `VoiceEngine.start()`; whether the device granted them is a hardware fact |
| Output latency | `AudioContext.baseLatency + outputLatency` | run log |
| Device hot-unplug / re-plug | `navigator.mediaDevices.ondevicechange` | scenario E/F |

### Scenarios (each needs a human and a device)

| # | Scenario | Pass condition | Status here |
| --- | --- | --- | --- |
| A | Ordinary conversation | 5 consecutive turns, transcript correct, reply audible | **BLOCKED** |
| B | User interruption | she stops within 500 ms of the user starting to speak; the new utterance is answered | **BLOCKED** (software equivalent measured in `full-duplex-acceptance.md`) |
| C | Background noise | recognition still correct with a fan/TV at conversational level | **BLOCKED** |
| D | Echo | her own output is not transcribed as user speech with speakers at normal volume | **BLOCKED** (the software echo guard is tested; acoustics are not) |
| E | Device failure | unplugging the microphone mid-turn surfaces a device error, not a hang | **BLOCKED** |
| F | Recovery | re-plugging resumes conversation without reloading the page | **BLOCKED** |

### Procedure

1. Open the app on a machine with a microphone and speakers (HTTPS or
   `localhost`).
2. Start voice, allow the microphone, and record
   `JSON.stringify(window.__leluVoice.diagnostics)` plus
   `getSettings()` for the live track.
3. Run scenarios A–F in order. For each, record: transcript, reply, measured
   `firstAudioLatencyMs` / `firstAudibleLatencyMs`, whether she stopped on
   interruption, and any error shown.
4. For D specifically: set speaker volume to a normal level, ask a question
   whose answer she speaks for more than five seconds, and confirm no turn is
   started by her own voice.
5. Save the log beside this document and change G6/G7 from BLOCKED to
   VERIFIED only if A–F actually ran.

## 3. Why this is not "partially verified"

The mission is explicit: *do not claim hardware acceptance using simulated
inputs.* Simulated runs prove the software path and nothing about a device.
G6 and G7 therefore stay **BLOCKED**, and the simulated results are kept in
their own documents (`full-duplex-acceptance.md`, `five-minute-conversation-acceptance.md`)
so they can never be mistaken for device acceptance.
