# WP01 — Physical Audio Hardware Discovery

**Status: VERIFIED (inventory). Physical input and output: ABSENT.**

The engine must not be blamed for a hardware gap, and a hardware gap must not
be disguised as software success. This inventory establishes which is which
before any acceptance attempt was made.

## Inventory

Every command was run in the M23.0 execution container as
`uid=169530796(fba194f0c9c3c58bfdf5946c17) gid=1001(freebuff)`.

| Probe | Command | Result |
|---|---|---|
| Sound device nodes | `ls -la /dev/snd` | **No such file or directory** |
| ALSA cards | `cat /proc/asound/cards` | **No such file or directory** |
| ALSA proc tree | `ls -la /proc/asound` | **No such file or directory** |
| Device nodes matching audio | `ls /dev \| grep -iE "snd\|dsp\|audio\|mixer"` | **none** (156 entries, none audio) |
| Sound server | `command -v pactl pulseaudio pipewire pw-cli` | **all MISSING** |
| ALSA tools | `command -v aplay arecord` | **both MISSING** |
| Media tools | `command -v ffmpeg sox` | **both MISSING** (no synthetic device path either) |
| PCI enumeration | `lspci` | **unavailable** |
| USB enumeration | `lsusb` | **unavailable** |
| Kernel sound modules | `grep -c snd /proc/modules` | `/proc/modules` not present in this container |
| Cgroup | `/proc/self/cgroup` | `0::/freebuff/a194f0c9c3c58bfdf5946c17` |
| CPU | `nproc` | 8 |
| Memory | `free -g` | 15 GiB total |
| Disk | `df -h /workspace` | 28 GB free of 63 GB |

## Classification

| Class | Devices |
|---|---|
| **Physically accessible** | none |
| **Browser-accessible (real device)** | none |
| **Simulated** | Chromium fake capture (`--use-file-for-fake-audio-capture`), `AudioContext` PCM output |
| **Unavailable** | microphone, speaker, headset, USB audio, PCI audio, ALSA, PulseAudio, PipeWire |

### The browser's device list is not hardware

M22.9 recorded `speakerDevices: 3` from
`navigator.mediaDevices.enumerateDevices()` on this same machine, which has no
sound hardware at all. Chromium synthesises output device entries under
`--use-fake-device-for-media-stream`; a count of three is **not** evidence of
three speakers. For M23.0 `speakerDevices` is treated as "what the browser
enumerated", never as "what exists".

## Consequence for the mission

Physical acceptance (WP02, WP05) cannot be executed here. Rather than repeat
impossible attempts, this mission:

1. Records the limitation here, with the commands and outputs above.
2. Prepares a reproducible hardware procedure
   (`physical-audio-acceptance.md` §Procedure).
3. Specifies exactly what a physical run must establish, and what evidence it
   must produce, so the test can be executed on a real device without
   redesign.
4. Keeps software acceptance as a **separate** qualification, labelled
   SIMULATED on every artifact.

## What the container *can* exercise

| Path | Exercised in M23.0 |
|---|---|
| Mic capture → VAD → ASR | yes, simulated WAV through Chromium's capture device |
| ASR → cognition → reply | yes, real model providers (rate-limited) |
| Reply → warm Piper → PCM playback | yes, real worker, real `AudioContext` |
| Barge-in and cancellation | yes, software paths; acoustic behaviour not measurable |
| Device failure / recovery | software paths only (`NoSuchDevice`/track-end handling); no physical unplug |

## Available external test environments

| Environment | Suitability |
|---|---|
| Any Linux desktop with ALSA or PipeWire | full physical run; procedure in `physical-audio-acceptance.md` |
| macOS / Windows desktop with a browser | full physical run; same page, same procedure |
| A laptop with a headset (recommended) | echo cancellation measurable without speaker/mic coupling ambiguity |

The run needs no special build: the same server, the same page, the same
microphone permission prompt.
