# M22.10 WP02 — Conflict and compatibility audit

Searched the integrated tree (canonical + voice line) for every owner of the
resources the persistent runtime manages. "New" means added on canonical
after the merge-base `d8fb056b`.

| Check | Finding | Severity | Action |
| --- | --- | --- | --- |
| Duplicate VoiceEngine implementations | One engine (`src/core/voice/VoiceEngine.ts`, singleton). `src/og/lib/voice-engine.ts` is the archived OG UI's own module, pre-existing, not mounted by Genesis. All 20 call sites use `VoiceEngine.getInstance()` (composer mic, Chat Universe mic, hold-the-planet, navigator mic, LiveKit dock, Voice environment "Talk to LÉLU", native capability registry). | none | — |
| Multiple microphone stream owners | `VoiceStudioPanel` opens `getUserMedia` only as a permission probe and stops the tracks at once; `og/VoicePanel`, `native/capabilities/mic`, `camera` are pre-existing, on-demand, and not part of a chat voice session. Only the engine holds a stream for a conversation; its counters prove 0/1 (WP05). | none | — |
| Duplicate audio contexts | Engine: one output context (`elevenLabsTts`) + one per-utterance VAD/recorder context, always closed (61/61 in M22.9). Other contexts: `og/VoicePanel`, `creative/kit/VideoComposer`, `BrowserCapabilities` — pre-existing, not voice-session. | none | — |
| Competing start/stop lifecycle handlers | Only `VoiceEngine.toggle()/end()` start or stop the session; no canonical code calls `getUserMedia` for chat voice. | none | — |
| Conflicting visibility / page lifecycle listeners | Other `visibilitychange` listeners: `MultiChatStore` (flush), `SceneRenderManager` (render budget), `PersistentRuntime`, `SelfStudyEngine`, `CapabilityLedgerClient`, `useIntegration`. None touches the microphone, recognition or speech; the engine binds its own once. | none | — |
| Duplicate TTS providers / fallback paths | Server TTS has one route (`/api/voice/tts`: ElevenLabs → local Piper); browser fallback inside the engine. **New on canonical:** the Voice environment's "Read aloud" (`chat/stage/EnvironmentStages.tsx`) speaks through `window.speechSynthesis` directly. | **medium** | fixed (below) |
| Chat Universe vs GenesisChat state divergence | Both read the same engine through `useVoice()` after integration; canonical's Chat Universe mic had no state. | low | M22.9 hunk applied |
| Conversation identifiers / routing | Voice turns go to `MultiChatStore.getActiveId()`; the M22.9 Chat Universe mic switches the active conversation to the composer's target before starting (same rule as a typed send). `UniverseChatWindow` (heavily changed on canonical) has no mic of its own. | none after integration | — |
| Duplicate playback / barge-in | One queue (`elevenLabsTts` pump) and one `cancelSpeech()`; typed replies in `GenesisChat` stream through the same `beginStreamingSpeech`. Read aloud was the only other speaker. | covered by the medium item | — |
| Conflicting provider configuration | No provider config changed on either side since the merge-base; `package.json`/locks identical. | none | — |
| Non-voice structural conflict | `CosmosObjectTools.ts`: canonical M17.3 vs M22.9-lineage Cosmos reconciliation. | high **if** merged | avoided: group A not integrated (WP01) |

## The one real conflict: Read aloud vs LÉLU's voice

**Behaviour before the fix.** Both use the device speech queue.
* Read aloud starting called `speechSynthesis.cancel()`: LÉLU's browser-voice
  speech stopped, and the engine was not told.
* LÉLU starting to speak (or a barge-in) called `cancel()`: the reading
  stopped, but a cancelled utterance fires `error`, not `end`, so the button
  stayed on "■ Stop" with nothing playing.
* While a reading played with a voice session open, the engine did not know
  anything was talking. No echo guard and no barge-in applied to it.

**Minimum compatible correction** (`e68a9719`, `EnvironmentStages.tsx`, +17/−3):
1. Read aloud awaits `VoiceEngine.cancelSpeech()` before queuing anything.
2. "Talk to LÉLU" stops a reading first.
3. A cancelled reading resets its button; a run token ignores late events from
   a superseded run.

The device-voice reader was kept as designed: offline, no network. It was not
rerouted through her voice.

**Residual (not fixed, documented):** if the user starts Read aloud *while* a
voice session is listening, the open microphone can hear the reading. The
engine's echo guard does not know that text. That needs a design decision:
route Read aloud through the engine, or pause listening while it reads. It is
recorded, not guessed at.
