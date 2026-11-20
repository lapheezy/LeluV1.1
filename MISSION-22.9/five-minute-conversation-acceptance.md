# WP07 — FIVE-MINUTE CONVERSATION ACCEPTANCE

**Priority:** P0 · **Gate G13: PARTIALLY VERIFIED**
**Classification: SIMULATED. This is not human conversational acceptance.**

## What was run

A continuous **7 minutes 23 seconds** session (443 s) in Chromium against the
real server with the warm voice runtime, driven by a recorded WAV of thirty
questions fed to the microphone input
(`.piper/fake-mic-paced.wav`, 11-second gaps, Chromium
`--use-file-for-fake-audio-capture`). No person spoke, and no speaker
produced sound.

Log: `MISSION-22.9/logs/m22.9-warm-paced.json`.

## Measured

| Fact | Value |
| --- | --- |
| Duration | 443 s |
| Turns requested / measured | 30 / **30** |
| Turns with a response spoken | **26** |
| Turns with no speech at all | **4** (#18, #19, #28, #29) |
| Sentences spoken | 40 |
| Playback: plays / ended / pauses | 33 / 23 / 23 |
| ASR latency | median **468 ms** (P90 495, max 961) |
| Transcript → first TTS | median **1 435 ms** (P90 2 628, max 6 400) |
| Transcript → first audio | median **2 480 ms** (P90 3 664, max 7 786) |
| Sentence synthesis | median **804 ms** (n = 20, min 73, max 1 535) |
| Barge-ins | **9** |
| Stale responses played | **0** |
| Audio errors / page errors | **0** |
| Failed TTS requests | **0** (server: `failures: 0`) |
| Worker restarts during the run | **0** |
| Model loads during the run | 3 (one per delivery profile used) |
| Recognition accuracy | **not measured** — the harness scores delivery, not word error; transcripts are in the log for inspection |

Sample transcripts from the run (verbatim, including the recogniser's own
mishearings): " What is the capital of Peru?", " What time complexity does
binary search half?", " a name for a pet cat.", " Tell me a very short joke.",
" Hello Lélu, are you listening?", " Does HTTP stand for?".

## The ten scripted beats — coverage, honestly

The mission asks for a conversation containing specific beats. This run used a
fixed recorded question set; it contains *some* of them by accident, not by
script:

| # | Beat | In this run? |
| --- | --- | --- |
| 1 | Ordinary opening | ✅ ("Hello Lélu, are you listening?") |
| 2 | Follow-up question | ⚠️ partially (consecutive questions on unrelated topics) |
| 3 | Topic change | ✅ frequent (each recorded question is a new topic) |
| 4 | Interruption | ✅ 9 barge-ins |
| 5 | Correction | ❌ not scripted, not observed |
| 6 | Technical question | ✅ ("What time complexity does binary search half?", "Does HTTP stand for?") |
| 7 | Contextual reference to something earlier | ❌ **not tested** — the question set has no callback |
| 8 | Short period of silence | ✅ the paced WAV has 11 s gaps |
| 9 | Return to a previous topic | ❌ **not tested** |
| 10 | Natural closing | ⚠️ ("That is all for now." arrived, but produced no spoken reply) |

Beat 10's failure is itself a finding: the closing utterance received a
transcript and **no reply** — one of the four turns that produced no speech.

## Conversation coherence

- No response was spoken against the wrong turn (`staleStreamsDropped = 0`).
- No duplicate or overlapping speech: 33 plays, 23 ended, 23 paused — the
  difference is accounted for by interruptions, not by overlap.
- Context retention **cannot be assessed** from independent questions; the run
  provides no evidence either way, and none is claimed.

## Verdict

**What this proves:** her voice runtime survives a sustained seven-minute
session in a real browser — 30 turns, 40 sentences, 3 delivery profiles, zero
worker restarts, zero stale responses, zero audio errors, and a median
first-audio of 2.48 s.

**What this does not prove:** that a person can hold a five-minute
conversation with her. There is no microphone, no speaker, no human, and the
scripted correction/context-return beats did not run. G13 stays
**PARTIALLY VERIFIED**, and the words "human conversational acceptance" do not
appear anywhere in this mission's claims.
