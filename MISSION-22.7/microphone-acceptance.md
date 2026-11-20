# M22.7 — MICROPHONE ACCEPTANCE

**Status:** **PARTIALLY VERIFIED** — a real browser captured real audio through `getUserMedia` and `MediaRecorder`, but the device is Chromium's simulated one, not physical hardware.

---

## 1. Setup

| Item | Value |
|---|---|
| Browser | Playwright Chromium (`chromium-1234`), headless, sandbox disabled |
| Input device | `--use-fake-device-for-media-stream` + `--use-file-for-fake-audio-capture=.piper/fake-mic-5.wav` |
| Permission | `--use-fake-ui-for-media-stream` (auto-grants; **the permission prompt path was not exercised**) |
| Device label returned | `Fake Default Audio Input` |
| Source audio | 34.04 s, 48 kHz mono 16-bit, five real speech phrases separated by 3 s silence |
| Page | `http://127.0.0.1:4180/` (built app served by `server.ts`) |

The WAV is real recorded speech (the repository's listening pack); the **microphone is simulated**. Every statement below is about the capture path, not about a person holding a phone.

## 2. Observed capture

Nine VAD utterances in one 45 s session, each with real signal:

| # | Time | Audio | Peak | Silence close |
|---|---|---|---|---|
| 1 | 02:47:46 | 4.859 s | 0.164 | 940 ms |
| 2 | 02:47:52 | 5.590 s | 0.198 | 940 ms |
| 3 | 02:47:58 | 5.799 s | 0.203 | 940 ms |
| 4 | 02:48:06 | 6.583 s | 0.338 | 940 ms |
| 5 | 02:48:13 | 6.165 s | 0.190 | 940 ms |
| 6 | 02:48:20 | 6.374 s | 0.170 | 940 ms |
| 7 | 02:48:22 | 1.933 s | 0 (silence) | 1672 ms |
| 8 | 02:48:41 | 4.702 s | 0.169 | 940 ms |
| 9 | 02:48:44 | 1.985 s | 0.193 | 418 ms |

Turn 7 is the engine correctly **rejecting a silent region** (`spoke:false`) instead of sending it to recognition — silence handling verified live.

Each speaking turn produced a `POST /api/model/groq/audio/transcriptions` that returned 200. The audio therefore reached the intended processing stage; this is the evidence M22.6 lacked.

## 3. Permission, devices, release

| Requirement | Status |
|---|---|
| Permission request | **Not exercised** (auto-granted by flag) |
| Permission denial + recovery | unit-tested only (`mapMediaError`) |
| Device enumeration / selection | not exercised (single fake device) |
| Stream acquisition | **VERIFIED** (audio captured) |
| Encoding / buffering | **VERIFIED** (`MediaRecorder` produced decodable audio) |
| Correct sample rate | device default; recogniser accepted it |
| Mic released after session | **PARTIAL** — session stopped, a second session then captured normally (no duplicate-stream symptom); track-level release not observable from outside |
| Repeated activation without duplicate streams | **VERIFIED behaviourally** (second session produced one stream's worth of turns) |

## 4. What is BLOCKED

- A physical microphone and the OS permission prompt.
- iOS/Safari microphone and playback restrictions.
- Cross-origin iframe permission delegation.

Those need a real device. The harness for them is the same script with the fake-device flags removed.
