# Mission 10.3 — acceptance report

Date: 2026-11-07. Branch: `claude/gallant-ritchie-v7i0fn`, merged into `claude/master-integration`.

**Providers:**
- Chat: OpenRouter (`deepseek/deepseek-v4.1-flash-1017`).
- Vision: `openrouter/auto`.
- Voice: ElevenLabs (`scribe_v1` for transcription, `eleven_v3` for speech).
- Anthropic was **disabled** for every run after the 20-turn conversation.

All evidence is in this folder. The 20-turn run's evidence is in `docs/voice/evidence/conversation-20b/`.

## Verdict in one paragraph

**Passed, verified live:**
- Navigator/composer fix: passed at all four sizes.
- Share Screen capability gating: 4/4 cases passed.
- Regression gates: all passed.
- The 24d756f stop classification held through the whole 20-turn run. No provider timeout was ever turned into "Stopped".

**Did not pass, for reasons outside the code under test:**
- **Chat-driven creation:** the enabled model mostly returns no usable content or runs past its time limit.
- **Most voice-reliability scenarios:** ElevenLabs' free monthly character quota is used up. On fresh pages, the recorder sometimes never sent the speech for transcription; the cause is still open.

Each item below says exactly what was and was not shown.

## 1. The 20-turn run (`conversation-20b`)

The run was not interrupted. It finished on its own: exit 0, 86 minutes, 20 lines spoken, 28 voice turns, 2 barge-ins, 49 transcript messages. Per-turn data is in `conversation-20b-turns.json`.

| Measure | Result |
|---|---|
| Lines spoken | 20 |
| Lines transcribed | 19 of 20. Line 7 ("What's a synonym for happy?") was never heard. 18 lines needed the harness to say them a second time, because the first utterance landed while the previous turn was still processing (17 "not-ready" events). |
| Transcription accuracy | Exact text whenever a line was matched to its turn (word match 100 %, apart from punctuation and "Leilu" for "Lélu"). The 83 % mean in the JSON is lowered by alignment: lines heard on a repeat are counted against the next window. |
| Transcription latency (end of speech → transcript) | Best 0.8 s. Typically 10–23 s, which includes waiting for the busy loop. |
| Completed turns with an answer | 20 of 28 turns got a response; 8 were superseded by the next utterance (barge-in or a repeat). |
| Real model answers | **0**. 18 responses were the offline notice. 1 was a raw research digest (an irrelevant Wikimedia result for "square root of 81"). 1 came from local memory ("Your name is Sam … favorite color is teal"). |
| "Stopped before anything ran" | **0** (the previous run had 20 of 20). The 24d756f fix held. |
| Voice responses played | 38 ElevenLabs audio segments played to the end and none failed. Almost all of them were **the offline notice read aloud**, which is the defect fixed below. |
| History | All 49 messages are in the transcript, in order. |
| Memory continuity | Name kept (from local memory, with no provider). Favourite colour recalled, but awkwardly phrased. The city (Lima) was never established, because no turn was ever answered by a model. |
| Typed turn | **Blocked.** The navigator's capability groups covered the composer (`typed-turn-blocked.png`). Fixed below. |

**Root cause of the failed turns.** Taken from the ledger, not the summary. Each turn's main OpenRouter call ended after 31–35 s with `BodyStreamBuffer was aborted`. That was `OpenRouterProvider`'s own hard-coded **30 s** cap, firing under a resolver budget of **45 s** per provider. The chain then fell through to Fireworks (412, suspended), Anthropic (400, no credit), Groq (429) and Cerebras (401), and ended in the offline notice. That notice wrongly said providers were "unreachable or unconfigured". **No timeout was treated as a user cancellation:** every turn fell through the chain instead of stopping.

## 2. Navigator over the composer — fixed and verified

**Cause.** The composer sits inside the chat window's stacking context (panel layer). Its own higher z-index therefore never rose above the navigator (navigation layer), and the open capability groups sat on top of the textarea.

**Fix.** `SpatialNavigator.tsx` plus the pure helper `composerClearance.ts`:
- While the chat is open, the navigator measures `[data-lelu-composer]` and moves itself up just clear of it.
- If moving up would leave the screen, it collapses the tall capability groups instead.
- It is not disabled, and its controls are unchanged.

**Verified** with `scripts/verify-navigator-composer.cjs` (`navigator/`). Interaction was real: touch taps on phone sizes, mouse clicks on desktop.

| Viewport | Navigator lifted | Overlap | Textarea, Send, Share hit by a real tap | Message landed | Navigator toggles afterwards | Voice still active |
|---|---|---|---|---|---|---|
| Desktop 1440×900 | 145 px | 0 | yes | yes | yes | yes |
| 375×812 | 91 px | 0 | yes | yes | yes | yes |
| 390×844 | 91 px | 0 | yes | yes | yes | yes |
| iPhone 13 (emulated) | 91 px | 0 | yes | yes | yes | yes |

The chat conversation was the same before and after every interaction.

## 3. Share Screen by capability — fixed and verified

**Fix.**
- `screenCapability.ts` checks `typeof navigator.mediaDevices.getDisplayMedia === "function"` and a secure context. It does not look at the user agent.
- `GenesisChat` renders the button only when that check passes.
- A refusal now shows a visible, dismissible notice in the composer. A tooltip is not enough on touch screens. Refusal, cancellation, device failure and "this browser can't share" have different wording.

**Verified** with `scripts/verify-share-capability.cjs` (`share/`):
- **iOS-like:** `getDisplayMedia` absent, button hidden.
- **Desktop:** button shown.
- **Android-like** (Pixel 7 emulation): button shown.
- **Refusal** (`NotAllowedError`): notice reads "Screen sharing was declined, so nothing was captured. …".
- In all 4 cases, voice stayed active (listening) and a typed message was sent and landed.

The iOS case removes `getDisplayMedia` before the app loads. Chromium's iPhone emulation still has it, so this is a stand-in for WebKit, not a real iPhone.

## 4. Chat-driven creation — not achieved with the enabled provider

`scripts/verify-chat-creation.cjs` (`creation/`) sent five real messages through the composer, with real clicks and nothing seeded.

| Step | Result |
|---|---|
| Create graph (Rainfall Q1 bar chart) | Offline notice after 44 s. No artifact. |
| Create drawing (Water cycle diagram) | Offline notice after 54 s. No artifact. |
| Revise graph | Offline notice. Nothing to revise. |
| Revise drawing | The reply came from a **project** tool ("Updated Water cycle diagram … 4 task(s) added"). The request was routed to project updates, not to the diagram tool. |
| Retrieve earlier artifact | "Not completed … No artifact" (none existed). A "Water cycle" diagram view (r1) did appear in the workspace during this turn. |
| After reload | The conversation persisted (10 messages). No Studio artifacts existed. The diagram view was **gone**. |

**Provider limitation, exactly as observed.** A direct broker call to `deepseek/deepseek-v4.1-flash-1017` returned `content: null` and spent its whole token budget on `reasoning`. The resolver reports such answers as "OpenRouter returned no usable content." Longer answers exceed the time limit. The model is the configured one, and you asked me not to change provider routing, so I left it.

**Tool limitation, found in the code** (not rebuilt, per scope):
- Drawings come from `artifact.create` / `artifact.edit` (kind `diagram`), which live in `WorkspaceEngine`. That store is **in memory only**: one revision counter, no per-revision history, no link to a conversation.
- Graphs live in Creation Studio (`studio.create` with chart blocks). Those do keep persisted revisions and a `conversationId`.

So "revision history persists" is achievable for graphs but not, with the current tool, for drawings.

## 5. Screen understanding — capture verified, answers not

`scripts/verify-screen-e2e.cjs` (`screen/`), real `getDisplayMedia` on a shared tab:
- **Share started:** browser surface, 1 frame kept.
- **Inbox question:** the frame was attached (`shared-screen.jpg`).
- **Error-dialog question:** the before and after frames were both attached.
- **Explicit stop:** live before stop yes, live after stop no, 0 frames after stop. Nothing is captured in the background.
- **Answers:** both were the offline notice. OpenRouter (vision via `openrouter/auto`), Groq and Fireworks all failed in the ledger, and this script does not record the error text.

**Not shown in this run:** a correct description of the inbox or the error dialog. Mission 10 showed it earlier, when a vision model was available.

## 6. Voice reliability

**Code changes:**
- `turnFailure.ts` gives one classifier for six outcomes: provider timeout, transcription failure, playback failure, user cancellation, network failure, provider unavailable. It has 8 unit tests, including the exact error strings from the 20-turn run.
- `VoiceEngine`:
  - failure notices are **no longer spoken as answers**: the turn records `failure`, the state gets `turnFailure`, and she goes back to listening;
  - transcription failure, playback failure and barge-in cancellation are recorded distinctly.
- `ProviderResolver` collects each provider's error. The final notice says "took too long" or "network failed" when that is what happened, and the response metadata carries `failureKind`.
- `OpenRouterProvider`'s cap is now never shorter than the per-provider budget, and a timeout is reported as "OpenRouter timed out after Ns", not as a stream abort.

**Live results** (`scripts/verify-voice-reliability.cjs`, `voice/` and `voice-rest/`). Failures were injected only at the network edge:

| Scenario | Result |
|---|---|
| First sentence | **Transcribed exactly** ("What is the capital of Peru? One sentence") in 5.3 s on the first utterance. The answer was a research digest (provider failed). ElevenLabs TTS **refused: 401 quota**. A direct probe confirmed it: 2 characters were accepted, 110 characters were refused. |
| Network failure | **Pass on classification.** Classified `network-failure`, not spoken (0 TTS requests), history kept. The recovery turn was transcribed, but the provider answered "unavailable" (no usable content). |
| Transcription failure | **Pass.** `transcription-failure` was recorded when both Scribe and Whisper returned 500. The next utterance was transcribed. |
| Provider timeout (injected hang) | **Not demonstrated live.** The injected utterance was never sent to transcription. The unit tests cover the classification, and the 20-turn run is live evidence that real timeouts fall through rather than stop. |
| Playback failure | **Not demonstrated live.** The utterance was never sent to transcription. The playback-failure path did fire for real in the first-sentence scenario (ElevenLabs 401 → "failure"). |
| User cancellation (barge-in) | **Not demonstrated live in this rerun.** She never started speaking, because there was no answer and no TTS quota. The 20-turn run recorded 2 real barge-ins: the reply was cut and the next turn ran. |

**Open defect.** In 3 of 7 fresh-page scenarios, the spoken clip was never sent for transcription (no `/api/voice/stt` request). The page was making background model calls at the time. The cause has not been identified. In the 20-turn run the same thing appears as the 18 repeats.

## 7. Platform limitations (honest)

- **No real phones were used.** "iPhone 13", "Pixel 7", 375×812 and 390×844 are Chromium device emulations. iOS Safari's missing `getDisplayMedia` was reproduced by removing the API. No native runtime was used.
- **Microphone:** a virtual microphone (real ElevenLabs-synthesized speech played into a Web Audio `MediaStream`), not a person.
- **Screen sharing:** Chromium auto-selects the shared tab by title. That stands in for the person choosing it in the picker.
- **ElevenLabs:** free tier (10,000 characters/month), now effectively used up. The 20-turn run read the offline notice aloud on most turns, which is exactly the defect fixed here.
- **Providers:**
  - Anthropic: disabled, and has no credit.
  - Fireworks: account suspended (412).
  - Groq: rate-limited (429).
  - Cerebras: wrong key (401).
  - OpenRouter's configured DeepSeek flash: reasoning-only or slow replies.

## 8. Regression gates (baseline: 1675 pass / 0 fail / 4 skipped at ca7e36d)

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (full) | **1691 pass / 0 fail / 4 skipped** (1695 tests) |
| `npm run build` | pass (only the existing chunk-size warning) |
| `npm run lint` | pass: 0 errors, warnings only, all in pre-existing scripts, none in new files |
| Voice, chat/artifact and navigator suites (targeted) | 223/223 pass, including `tests/mission-10-3.test.ts` (8/8) |

## 9. Usage and cost (what the meters show; nothing invented)

**Tests and runs:**
- **Turns:**
  - 20-turn run: 20 spoken lines, 28 voice turns.
  - Reliability: 7 scenarios, 6 transcriptions.
  - Creation: 5 typed turns.
  - Navigator and share checks: 8 typed turns.
  - Screen: 2 questions.
- **Browser runs:** 20-turn ×1, navigator ×2, share ×1, creation ×3 (2 aborted by CPU contention or a stale path), reliability ×3, screen ×1.
- **Build/typecheck/test runs:** typecheck ×1, full tests ×1, targeted tests ×2, lint ×1, build ×1.

**Meter readings:**
- **OpenRouter:**
  - 20-turn run ledger window: 40 calls, $0.0084 reported. The ledger keeps only the last 100 records, so the run total is somewhat higher.
  - Reliability: 24 calls.
  - Probes: 1 call (37 tokens, $0.0000027).
  - Screen: 1 successful call ($0.00029).
  - Creation: not separately metered by the script.
  - Every reported cost was well under $0.02 in total.
- **ElevenLabs:**
  - 20-turn run, ledger window: 15 TTS segments (2,246 characters), plus 23 more segments played before the window. 11 STT calls, $0.0141 reported.
  - Reliability: 6 STT calls, 1 TTS call (refused).
  - Probes: 2 TTS calls (2 characters accepted, 1 refused).
  - The monthly character quota is effectively exhausted.
- **Anthropic:** disabled. 6 refused calls (400, no credit) occurred inside the 20-turn run, which was started before this mission with Anthropic enabled. No calls after that, and no charge.

## 10. After merging into `claude/master-integration`

The merge commit was clean: no conflicts, no force, and no history was rewritten. Concurrent work on the integration branch is kept, including its own `DrawingEditor` and `GraphEditor` studio files, which this mission did not test or change. Gates on the merged tree:

| Gate | Result |
|---|---|
| `npm run typecheck` | pass, after `npm install` added `@excalidraw/excalidraw` and `@xyflow/react`. `package.json` already listed them, but the integration branch's lock file and `node_modules` did not have them. The updated `package-lock.json` is committed. |
| `npm test` | **1790 pass / 0 fail / 4 skipped** (1794 tests) |
| `npm run build` | pass |
| `npm run lint` | pass (0 errors) |
