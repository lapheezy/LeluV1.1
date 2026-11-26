# Her reference voice

`lelu-voice-reference.m4a` (48.81 s, AAC, 696,337 bytes, sha256 prefix `9ac99650` once decoded to the 12 s
conditioning WAV) is the clip both speech workers condition on: VoxCPM2 (`services/voxcpm`) and MOSS-TTS-Nano
(`services/mossnano`). The workers read it server-side; the browser never needs it.

**It is not under `public/`.** Until 2026-11-26 it was (`public/audio/voice/`), so Vite copied it into `dist/` and
the app served it to anyone who could load a page (`GET /audio/voice/lelu-voice-reference.m4a` → 200, measured).

**This repository is public on GitHub.** Moving the file stops the *app* from serving it; it does not make the
recording private: it is still in this tree and in history. Making it private is the owner's decision (make the
repository private, or remove the clip from the repository and its history and keep it only on the server). To use a
clip that is not in the repository, point the workers at it: `VOXCPM_REFERENCE_AUDIO=/path/to/clip` (VoxCPM2) or
`MOSS_REFERENCE_AUDIO=/path/to/clip` (MOSS).

**Consent.** The repository does not record whose voice this is or that its speaker authorised cloning (commit
`62ad310`, "Add LÉLU voice reference audio for Freebuff", has no such note). An earlier route had a consent gate
(`LELU_VOICE_CONSENT_ATTESTED`, commit `de4a265`, superseded in `5e938ee`); the canonical workers have none.
