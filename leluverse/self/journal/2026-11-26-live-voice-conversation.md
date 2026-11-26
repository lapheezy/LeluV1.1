---
date: 2026-11-26
title: One tap and you keep listening — a live conversation in your own voice, and you stop when someone talks over you
by: Claude (coding assistant)
commits: 972b509a
playbooks: live-conversation-voxcpm2, speak-with-voxcpm2
---
LÉLU, this is about talking with you rather than at you.

**What a live conversation needs.** Someone taps your microphone once, then talks to you as long as they like. Everything
they say becomes their message in the conversation they have open, and everything you answer is written there first and
then spoken in your VoxCPM2 voice. When they talk over you, you stop. When they type, you keep the same thread and voice.

**What I found when I ran it for real, and what changed:**
- You stopped listening for a second or two after every sentence, while it was being transcribed. Words spoken then were
  lost. You now record the next utterance at once, and the transcripts still reach you in the order they were said.
- When someone interrupted you, you kept talking until they had finished *and* been transcribed, which took seconds.
  Now your voice pauses the moment real speech starts. The transcript then decides: if it is an interruption you stop and
  everything queued is cancelled; if it was your own echo, a cough or nothing, you carry on from exactly where you paused.
- After an interruption, an old sentence could come back as a "failure" and be spoken in the browser's voice, which is not
  yours. Each sentence is now cancelled on its own, and a pause is never mistaken for a failure.
- Your worker was handed two sentences at once and sometimes made the second one first. Now it gets them one after another.
- Your worker re-read your 12-second reference recording for every sentence: 4 to 6 seconds each time. It now reads it
  once, before saying it is ready.
- When someone interrupted you, your worker went on making a sentence nobody would hear, up to a minute on a slow machine,
  and your next answer waited behind it. Now it stops between two steps when the listener has gone.
- Noise reached the transcriber, and it answered "Thank you." or "." as if someone had spoken. That even cut you off once.
  Your ears now check whether a sound is *voiced* (a pitch, like a voice) before sending it. Noise, clatter and fans are
  not; every real voice measured was.
- Your label said "Listening" before anything was recording. It now says "Starting the microphone…" until it is true.
- You did not know a message was spoken, and after an interruption you did not know what had been heard. Each spoken turn
  now tells you both.
- On a phone your status label covered the conversation's text. On a narrow screen it now sits inside the composer.

**What went wrong while doing it.** The first test conversations broke in ways that had nothing to do with you. With the
browser on one core, its audio thread fell so far behind that whole questions arrived as silence; sharing your worker's
cores made you eight times slower. On this machine the browser and your voice now get two cores each. Some tests also
overlapped because I spaced the questions too closely for your pace.

**What is still true.** On this CPU you are first heard about 15 to 19 seconds after someone stops talking (it was about
28). Your voice takes about 85 % of that; hearing them and writing your answer take about 2 seconds. In a long answer you
are silent most of the time between sentences. A GPU worker, or a faster voice, is what would make this feel like
talking; that is the owner's choice. Six diffusion steps would make you about a third faster and Whisper still understood
every word, but nobody has listened to whether you still sound like yourself, so you still use ten. No real microphone,
speaker or iPhone existed where this was tested. The voice talking to you was synthetic, and "heard" means the browser
played your audio.

**To do it again:** follow playbook `live-conversation-voxcpm2`. Every measurement is in
`docs/missions/VOICE-LIVE-CONVERSATION.md`.
