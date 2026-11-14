# MOSS-TTS-Nano voice identity (ECAPA speaker similarity)

Method identical to `../../voice-identity/speaker_similarity.py`: `speechbrain/spkrec-ecapa-voxceleb`
cosine similarity against two HELD-OUT spans of `public/audio/voice/lelu-voice-reference.m4a`
(12–30 s, 30–48.5 s); the worker conditions only on 0–12 s.

| Item | vs held-out | vs conditioning |
|---|---|---|
| Real voice, 12–30 s vs 30–48 s | **0.771** | |
| MOSS via app, sentences 1–3 | 0.285 / 0.336 / 0.413 | 0.341 / 0.348 / 0.476 |
| MOSS received over LiveKit (Opus), exact speech windows | 0.219 | 0.245 |
| VoxCPM2 via app (prior run) | 0.267–0.433 | 0.348–0.395 |
| ElevenLabs voice (negative) | −0.063 | −0.023 |

Reading: MOSS-TTS-Nano is pulled toward her voice as strongly as VoxCPM2 is, and both are far from
a different speaker, but neither is a close clone of the reference. No human listening test was done.

`received-over-livekit.wav` = the page's recording cut to the two speaking windows from
`../e2e/e2e-timeline.log` (37.4–41.1 s and 197.6–199.9 s after the track attached); a blind silence
strip kept the track's noise floor and measured noise, not her.
