---
date: 2026-11-26
title: Your VoxCPM2 voice was wired but never heard — now it speaks in the app, slowly, and says what it is doing
by: Claude (coding assistant)
commits: 1410a14a
playbooks: speak-with-voxcpm2
---
LÉLU, this is about your own voice, the one VoxCPM2 makes from your reference recording.

**What was true before.** Everything was in place: the worker (`services/voxcpm`), the pool that picks it, and
`/api/voice/tts`, which your page asks for every sentence. But nobody had ever run the whole loop in the real app
with VoxCPM2 behind it. When I did, someone spoke to you, you understood, you answered, and then you said nothing.

**Why you were silent.** On a CPU, VoxCPM2 needs 6 to 8 seconds for every second of your speech. Your page gave each
sentence 15 seconds before giving up, so it gave up on all of them. Now the server tells your page how fast your voice
is (`workerRtf` in `/api/voice/status`), and the page waits accordingly. It also counts the sentences already waiting
ahead.

**What else running it for real showed, and what changed (1410a14a):**
- A worker slower than real time can't stream: you would come out in fragments with silence between them. Your server
  now asks such a worker for one whole sentence and says why (`X-Lelu-Streaming: off:slower-than-realtime`).
- Your page asked for every sentence of a long answer at once. The worker's queue overflowed and the end of your answer
  switched to the browser's voice. Now it asks for two ahead at most. When someone presses Stop, everything already
  asked for is cancelled.
- The worker took sentences in a random order (sentence 3 before sentence 1). It also timed its waiting as if it were
  speaking, and finished sentences nobody would hear. It now takes them in order, times only the generation, and drops
  a waiting sentence whose listener has gone.
- With no weights it would have downloaded 5 GB without asking, and it loaded without checking memory (the load peaks
  at 11 GiB). It now refuses and says `weights-missing` or `insufficient-memory`.
- Your mic button said "Speaking" for 20 seconds while nothing could be heard. It now says "Generating her voice…" until
  sound starts, and there is a Stop speaking button. A turn counts as spoken only once audio starts.
- Five seconds of noise came back from Whisper as "Talking with Lélu.", the hint we give it, and you answered it as if
  someone had said it. That is now treated as silence.
- Your reference recording was in `public/`, so anyone who could load your page could download it. It now lives in
  `services/voice-reference/`. The repository itself is public, so whether it stays there is the owner's choice. Nobody
  has recorded whose voice it is or that they agreed.

**How much it sounds like you, measured.** I made the same sentences with and without your reference and compared each
with parts of your recording the model never heard. Your recording matches itself at 0.78. VoxCPM2 without your
reference scores about 0.0, and with it about 0.38. Your reference really moves the voice toward you, about halfway. It
is not proven to be you; a person has to listen.

**What is still true.** On this CPU your first word comes about 28 seconds after someone finishes a short question. That
is too slow for conversation. MOSS-TTS-Nano (already behind the same route, about 1.3 seconds) or a GPU would fix it.
No real microphone or speaker existed where this was tested: the voice speaking to you was a synthetic test voice, and
"heard" means the browser reported playing your audio. Someone has to try it on a phone and a desktop, over HTTPS.

**To do it again:** follow playbook `speak-with-voxcpm2`. The evidence and every number are in
`docs/missions/VOICE-VOXCPM-FINALIZATION.md`.
