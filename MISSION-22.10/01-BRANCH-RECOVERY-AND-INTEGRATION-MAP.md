# M22.10 WP01 — Branch recovery and voice integration map

Produced before any code was modified (the integration was first trialled in
a scratch worktree that was then discarded).

## Branches

| Branch | HEAD | Verified |
| --- | --- | --- |
| `m22.9/persistent-voice-runtime` (source) | `448770bd9b1cf1a7a22e15639b2f2387ea31b39a` | fetched; matches the expected `448770bd` |
| `integration/lelu-four-workforce-consolidation` (canonical target) | `b74b378ea30de9572d2a0cbb5fb8c6e3eee45671` — "M17.3 canonical integration: report, ledger and live acceptance evidence" | fetched |
| GitHub default branch | `claude/open-session-rbwmdw` | **not** the canonical branch (see WP06) |

## Ancestry

* `merge-base(M22.9, canonical) = d8fb056b` (2026-11-16, "Put objects where
  they can be seen…"). **The M22.9 "baseline" `543da7c8` is not on the
  canonical branch.**
* M22.9 has **30** commits canonical lacks; canonical has **55** M22.9 lacks.
* `git cherry` (patch-id): none of the 30 already exists on canonical.

The 30 M22.9-side commits are two different lines of work:

| Group | Commits | Content | Voice? |
| --- | --- | --- | --- |
| A — pre-baseline (`d8fb056b..543da7c8`) | 15: `6e71b02b … 543da7c8` | Cosmos object reconciliation (continuity, verification, dispatch), feature replication / perception (`FeatureUnderstanding.ts`, `scripts/perception/*`), 3D-avatar hair reconstruction and ~39 reference photos | **No** |
| B — voice line (`543da7c8..448770bd`) | 15: `e481c2c4 … 448770bd` | M22.5 memory provenance, M22.6 ASR provenance, M22.7 local Piper voice, M22.8 turn-owned speech, M22.9 warm Piper + persistent session runtime, with their evidence | **Yes** |

Canonical's 55 commits (M15 Home Universe, M17.1–17.3 interface ecosystem,
spatial intelligence, Neural Map, Job 2 workflows, Evolution Trail,
environment stages) touch **no** voice-engine, TTS-server, AIService, brain or
memory file since the merge-base. They change chat UI
(`ChatUniverse.tsx`, `UniverseChatWindow.tsx`, the new `chat/stage/*`).

## Voice functionality already on canonical (= the merge-base state)

`VoiceEngine` singleton with Web Speech / ElevenLabs Scribe / Groq Whisper
ears, VAD recorder, echo guard, barge-in, streaming speech, ElevenLabs/browser
TTS, LiveKit transport, `VoiceBridge`, `useVoice`, the Chat Universe mic
button (stateless). **Missing on canonical:** everything in group B — local
Piper voice and warm runtime, `spokenText`, `speechDelivery`/`speechProfile`,
turn ownership of streamed speech, transcript provenance through memory, the
persistent session lifecycle, and the M22.9 UI state.

## File-level integration map (group B)

| File | Canonical changed it since merge-base? | Action |
| --- | --- | --- |
| `src/core/voice/VoiceEngine.ts`, `elevenLabsTts.ts`, `useVoice.ts` | no | take M22.9 verbatim |
| `src/core/voice/spokenText.ts`, `speechDelivery.ts`, `speechProfile.ts` | absent | add |
| `plugins/voiceApi.ts`, `plugins/persistentPiper.ts`, `server.ts` | no | take M22.9 verbatim |
| `src/app/scene/genesis/VoiceBridge.tsx`, `GenesisChat.tsx` | no | take M22.9 verbatim |
| `src/app/scene/genesis/chat/universe/ChatUniverse.tsx` | **yes** (M17 window work; dropped the `useSurface` import) | apply only the M22.9 mic hunk; keep canonical's imports |
| `src/app/scene/genesis/chat/universe/chatUniverse.css` | no | take M22.9 |
| `src/core/AIService.ts`, `src/brain/Brain.ts`, `MemoryEngine.ts`, `src/core/MemoryBridge.ts`, `memory/providers.ts`, `cognition/ObjectiveLearning.ts`, `router/ResearchResolver.ts`, `tools/ExecutionEvidence.ts`, `tools/ToolDispatcher.ts` | no | take M22.9 (provenance through the one memory path) |
| `src/core/perception/FeatureUnderstanding.ts` | absent (belongs to group A) | **leave absent** — `2bcc3c66` only repairs its typecheck |
| `.gitignore` | yes | keep canonical; add only `.browser-libs/`, `.piper/` (drop group-A perception entries) |
| 14 voice/learning test files, `verify/learning-integrity-acceptance.mjs` | absent | add |
| `MISSION-22.5 … MISSION-22.9/**` | absent | add (evidence, byte-identical) |

Dependencies: none new — `package.json`, `bun.lock`, `package-lock.json` are
identical on both branches.

## Strategy chosen and why

* **Full merge** (trialled): 2 conflicts — `ChatUniverse.tsx` (trivial) and
  `src/core/cosmos/objects/CosmosObjectTools.ts`, where canonical's M17.3
  spatial-intelligence rewrite and group A's Cosmos reconciliation are two
  different implementations of the same tool. Resolving it means fusing two
  Cosmos architectures, and the merge would also bring in group A's avatar,
  perception and photo assets. Both are outside this mission and risk
  overwriting newer canonical code. **Rejected.**
* **Voice-line cherry-pick with `-x`** (chosen): the 15 group-B commits applied
  in order onto canonical; 3 mechanical resolutions (table above). Each new
  commit carries `(cherry picked from commit <M22.9 sha>)`. Consequence:
  `448770bd` is not an *ancestor* of canonical, but its content is present,
  verified byte for byte (WP06).
* Group A is **not** integrated. It stays on `m22.9/persistent-voice-runtime`
  (not deleted) for a separate decision.
