# M22.10 WP03 — Canonical integration: implementation report

Target: `integration/lelu-four-workforce-consolidation`, from `b74b378e`.

## Commits added on top of canonical (oldest first)

15 cherry-picks of the M22.9 voice line, each with a
`(cherry picked from commit <sha>)` trailer, then 2 integration fixes:

| # | New commit (summary) | From M22.9 | Resolution |
| --- | --- | --- | --- |
| 1 | Carry provenance, keywords and corrections through LÉLU's one memory path | `e481c2c4` | clean |
| 2 | Record M22.5 learning-integrity audit … | `8aa24ce1` | clean |
| 3 | Repair the perception typecheck and close the M22.6 learning and ASR provenance gaps | `2bcc3c66` | `FeatureUnderstanding.ts` kept absent (group-A perception file, not on canonical) |
| 4–5 | M22.6 evidence / remote verification | `3f24d798`, `afcfd8c7` | clean |
| 6 | Speak through an opt-in local voice … | `e4ce1764` | `.gitignore`: kept canonical, added only `.browser-libs/` and `.piper/` |
| 7–14 | M22.7–M22.9 voice, turn ownership, warm Piper, evidence | `8fe50238 … b46b0aa3` | clean |
| 15 | Keep her voice session alive through lost microphones, hidden pages and failed speech | `448770bd` | `ChatUniverse.tsx`: kept canonical's imports (no `useSurface`), applied only the mic hunk |
| 16 | One speaker at a time: Read aloud and LÉLU's voice stop each other cleanly | — | `e68a9719`, conflict fix (WP02) |
| 17 | Give every open chat window the same microphone as the Universe composer | — | `4e61922b`, found by live acceptance (below) |

Byte-level check after step 15: 36 of the 39 non-evidence files the voice
line touches are **identical** to `448770bd`. The 3 that differ are exactly
the 3 resolutions above. All `MISSION-22.5 … MISSION-22.9` evidence is
identical. Commits 16–17 then change two canonical-only files and refactor
the M22.9 mic hunk into a component.

## Preserved M22.9 behaviour (all in `VoiceEngine.ts` / `elevenLabsTts.ts`, byte-identical)

Persistent sessions · microphone loss detection and re-acquire · single
permission prompt · start/stop race protection · visibility / pagehide /
online / permission-change handling · sentence-level TTS · 15 s TTS timeout
and browser-voice fallback · long-response chunking on line breaks ·
barge-in and stale playback-event attribution · resource counters. The
Chat Universe mic state and the 44 px touch target are carried through
`VoiceToggle.tsx`, with the same markup, attributes and CSS selectors.

## Integration fixes

1. **Read aloud vs her voice** (`EnvironmentStages.tsx`, canonical-only
   component). See WP02.
2. **Chat window had no microphone** (`UniverseChatWindow.tsx`,
   canonical-only behaviour). On canonical, opening a chat window replaces the
   Universe composer. In the first live run the session continued after the
   typed hand-off with no visible mic and no stop control; the harness could
   not find a mic to end the session. The M22.9 button became
   `chat/universe/VoiceToggle.tsx`, rendered by both composers, each passing its
   own conversation id.

## Not integrated (deliberately)

Group A of the M22.9 branch (Cosmos reconciliation, feature replication /
perception, avatar hair and reference photos). It is not voice, and merging it
would require fusing two Cosmos tool implementations (`CosmosObjectTools.ts`)
with canonical's newer M17.3 one. It remains on `m22.9/persistent-voice-runtime`.

## Constraints honoured

No second voice engine, chat runtime, memory or provider. No new dependency
(`package.json` and locks unchanged). No Anthropic: the
`LELU_ANTHROPIC_API_KEY` present in this environment was removed from the
server process for all live runs. No ElevenLabs spend: its keys were removed
likewise and the local Piper voice was used. No LangChain/LangGraph, no
Supabase change, no deployment, no credential change.
