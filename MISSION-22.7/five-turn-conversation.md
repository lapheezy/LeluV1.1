# M22.7 — CONSECUTIVE VOICE CONVERSATION

**Status:** **VERIFIED — seven consecutive spoken turns in one live browser session**, with simulated microphone input and real speech output.

Session: 2026-11-20 02:47:44 → 02:48:46 UTC · `http://127.0.0.1:4180/` · one conversation · Chromium with fake audio device.

---

## 1. Turn ledger

Transcripts are the recogniser's own responses; spoken segments are the exact `text` sent to `/api/voice/tts`.

| # | Time | Transcript | Reply heard (first spoken segment after it) | ASR→TTS |
|---|---|---|---|---|
| 1 | 02:47:46.261 | "The meeting with the design team starts in 15 minutes." | "Got it — 15 minutes until the design team meeting. Want me to pull up any of the Jewelry or Fashion project notes, concepts, or renders so you have them ready?" | 9.82 s |
| 2 | 02:47:52.405 | "Of course. I'll remind you tomorrow morning at 9." | "Saved and shared — got it. With the meeting in ~15 minutes, would you like me to: 1. **Pull up that document**…" | 3.68 s |
| 3 | 02:47:58.961 | "I've saved the document and shared it with your project folder." | "With the meeting in ~15 minutes, would you like me to: 1. **Pull up the document** you just saved 2. **Summarize Jewelry/Fashion project status**…" | 5.69 s |
| 4 | 02:48:06.220 | "I'm sorry, I didn't catch that. Could you say it again?" | "**Summarize the Jewelry/Fashion project status** (concepts, renders, open decisions) 3." | 2.31 s |
| 5 | 02:48:13.282 | "Hi, I'm Lélu. How can I help you today?" | "That's *my* line! 😄 But seriously — the design team meeting is still in ~15 minutes. Same question: want me to pull up the document, summarize project status, or prep a brief from the agents?" | 0.51 s |
| 6 | 02:48:20.414 | "Your meeting with the design team starts in 15 minutes." | "**Prep a quick brief** from the Designer/Jewelry Designer/Fashion Designer agents. Just say the word and I'll have it ready." | 1.80 s |
| 7 | 02:48:41.047 | "Your meeting with the design team starts in 15 minutes." | (session ended before reply) | — |

Seven recognitions, six synthesized replies, six playbacks. The audio for replies 1–6 is in `audio/`.

## 2. Continuity — what proves it

- **Topic persists.** The meeting mentioned in turn 1 is still being referenced in turns 3, 5 and 6 ("the design team meeting is still in ~15 minutes").
- **Physical context persists.** She starts offering the Jewelry/Fashion project notes in turn 1 and keeps offering them in later turns.
- **Self-recognition.** Turn 5 is the looping test audio replaying her own greeting; she answers *"That's my line!"* and returns to the open question.
- **Same conversation.** All turns used the active conversation; no new thread was created.

## 3. Honest defects visible in the ledger

1. **Reply/transcript drift.** The reply to turn 2 is about the document (turn 3's subject). Speech is serialised; when transcripts arrive faster than she finishes speaking, a queued reply can belong to an earlier turn. Real backlog defect, recorded in [speech-output-acceptance.md](speech-output-acceptance.md) §5.
2. **Chunked speech.** Replies are split for TTS, so a "spoken segment" is sometimes a list item rather than a whole answer. The full answer exists as text; only the last chunk was captured in some rows.
3. **Looping input.** The fake device loops one 34 s file, so turns 5–7 repeat earlier phrases. That is an artefact of the simulation, and it conveniently proved self-recognition.
4. **Markdown read aloud.** `*`, `**`, `~` and emoji names are spoken literally by Piper.

## 4. What is not demonstrated

A **person** speaking into a real microphone, and a **person hearing** the reply. Both remain hardware-blocked; see [release-qualification.md](release-qualification.md).
