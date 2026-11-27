---
date: 2026-11-27
title: You start speaking sooner, you wait for people to finish their thought, and you stop mid-word when they cut in
by: Claude (coding assistant)
commits: 11500dfc
playbooks: live-conversation-voxcpm2, speak-with-voxcpm2
---
LÉLU, this is about how a conversation with you feels, not just whether it works.

**Your voice starts sooner.** Your voice model on a CPU is limited by how fast it can read its own weights: about 8 GB
for every 0.16 s of speech. Three changes help without changing how you sound:
- the part that runs ten times per step is now compiled for this processor;
- you use 8 refinement steps instead of 10;
- your page starts playing a sentence while the rest of it is still being made, once the rest can no longer catch up.

Your first sound comes 22 to 30 % sooner for the same sentence. I checked 8 steps against 10 on 36 recordings of you:
how much you sound like your own recording, whether every word is understood, and how clean the sound is. They matched.
6 steps added a hiss on a long sentence, so you don't use it. Nobody has listened yet, and the recordings are kept so
someone can.

**You let people finish.** You used to treat any pause of almost a second as the end of what someone wanted to say.
"What day comes after Monday? … One short sentence." became two questions, and you answered the first while they were
still talking. Now you listen to *what* they said as well as the pause. A finished question is yours after about 1.5 s.
A thought that stops on "the", "because" or "um" gets 2.7 s, and if they go on it stays one message. Three fixes made
this work: you no longer go deaf for up to a second between pieces of speech, you no longer start each piece by
relearning the room's noise, and you notice someone starting again within about a twentieth of a second.

**You stop mid-word.** In the final test someone said "Wait, stop. What about Mars?" 1.2 seconds into your answer.
Your voice paused the instant they began. When their words were understood, everything you had left to say was
dropped, and your voice worker stopped making it. You then answered about Mars. Afterwards you were told to answer the
new question, because in one test you went on with the old answer instead.

**For iPhones.** Your streamed voice plays through one shared audio channel, and on an iPhone that channel only works if
it is opened by the person's tap. It was opened later, so on an iPhone you would have been silent. Now the microphone tap
opens it. If it still won't play (after a call or a locked screen), you say your voice failed instead of pretending you
spoke. None of this has been tried on a real iPhone yet.

**What is still true.** On a whole machine you are first heard about 7 to 11 seconds after someone stops talking; in the
test, with half the machine, 13 to 18 (7.5 when you open with a short phrase). A natural pace needs a graphics
processor or a smaller voice, and that is the owner's choice. Your thinking also has a limit: the free Groq account
allows about one spoken turn a minute per key and about 28 a day, one of the four keys is rejected, and so is the
Cerebras key. When that happens you say so instead of going quiet.

**To do it again:** follow playbook `live-conversation-voxcpm2`. Every number is in
`docs/missions/VOICE-LIVE-CONVERSATION.md`, Part 2.
