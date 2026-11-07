# Phase 2: Chat Owns the Phone, and Multi-Step Tool Turn Completion

- Branch: `claude/master-integration`
- Baseline: `d4e70e2`
- All verification ran in Chromium emulation. No physical iPhone was used.

## Outcome

| Gate | Result |
|---|---|
| Live product creation through chat (iPhone 13 emulation) | **15 of 15 checks pass** (`evidence/phase-2-chat-mobile/product-creation-report.json`) |
| Mobile chat e2e, in CI (5 phones + desktop) | **149 of 149 pass** (`mobile-report.json`) |
| Full `npm test` | **1378 pass, 0 fail** |
| Typecheck | clean |

The live run covers the whole flow, in the conversation, on the phone:

1. The request is sent.
2. LÉLU creates the brief with a column chart (Lite, Standard, Pro).
3. The DOCX is written and verified from its bytes (13.9 KB).
4. **The final reply and the artifact card appear in the conversation, and the turn completes.**
5. The card opens the artifact full-screen.
6. Refinement: the *same* artifact gets **revision 2**, with a line chart over Lite, Standard, Pro and Max, and a verified revision-2 DOCX.
7. After a reload, the artifact, its two revisions, the 4 messages and the 2 cards are all still there.
8. A different conversation shows no trace of the product.
9. No page errors occur.

## The turn-completion failure: what was actually wrong

The turn was traced live by instrumenting `Orchestrator.process`, the `AIService` message channel, `MultiChatStore` and the activity store. Traces are in `evidence/phase-2-chat-mobile/16-turn-lifecycle-traces/`.

Before the fix (`turn-stuck-before.log`):

- `Orchestrator.process` **resolved** 8.4 s after it started, with a reply. No promise was left hanging.
- **No assistant message was ever emitted.** The conversation stored only `["user"]`.
- The published activity stayed `status: "running"` indefinitely.

Five defects sat at the seam between tool execution and the conversation. Each was found by measurement, not by guessing.

1. **The reply was never delivered.** Planned (multi-step) and engineering turns return their reply as a string from `Orchestrator.process`, and only `ai.chat` emits on the reply channel. With nothing stored, no reply rendered, and `GenesisChat`'s `finally` block had no reply to attach the artifact card to.
   - Fix: `AIService.deliverReply()`, the same channel and shape as other replies. `GenesisChat` calls it once when the turn resolved with text but no stored reply, so `ai.chat` replies are never duplicated.
2. **The activity was published while still running.** `recordTurnActivity().stop()` published the unfinished record, so the Universe window showed "Working with tools" forever.
   - Fix: `stop(failed)` publishes the finished record.
3. **Task tool events had no owner.** Planned steps were dispatched with no context, so the artifact belonged to no conversation, and the card event was keyed to a timestamp nothing owned.
   - Fix: `planAndExecute` binds the task to the turn's conversation.
   - Fix: `ownedToolContext()` gives each step the runtime context, with that conversation and a bound event key.
4. **The export step failed.** The planner wrote `artifact: "{{steps.s1.output.id}}"`. The interpolator only understood `.output`, so the raw placeholder reached the tool, which answered "No artifact matches" (`export-step-field-path-before.log`).
   - Fix: `interpolate()` accepts a field path.
   - Fix: `StudioStore.resolve` and `AtelierStore.resolve` take the id found inside a step's output ("Created [art_…]").
5. **The refinement never reached the model.** The intent detector labelled "Change the chart in the Lumo brief…" as `project`, and `ProjectResolver` answered "Project created" by parsing the text.
   - Fix: `refersToConversationArtifact()` sends such a turn to the model, which has `studio.revise`. This is the same narrow exemption the router already makes for engineering and workflow requests.
   - Fix: the planner is also given this conversation's artifacts, and only this conversation's.

**Responsiveness.** The page stopped producing frames for about 35 s after a turn (`gpu-stall-before.log`: no frames submitted, then `GpuChannel::OnDestroyCommandBuffer` 2.9 s). The cause was LÉLU's docked companion: a WebGL canvas that kept rendering *under* the full-screen sheet, where it couldn't be seen.

- Fix: on a phone, when a sheet owns the screen, the companion window unmounts, as Home and Cosmos already do. Desktop is unchanged, and so is the face behind the classic chat panel.
- After the fix: 60 fps across eight windows covering 64 s, with 0 canvases under the sheet (`gpu-stall-after.log`).

## Files changed (since `d4e70e2`)

- `src/core/AIService.ts`: `deliverReply`
- `src/app/scene/genesis/GenesisChat.tsx`: delivers an unanswered turn's reply; `recording.stop(turnFailed)`
- `src/app/scene/genesis/chat/activityRecorder.ts`: `stop(failed)` publishes the finished record
- `src/core/orchestrator/Orchestrator.ts`: binds the planned task to its conversation; gives the planner the conversation's artifacts
- `src/core/agentic/TaskExecutor.ts`: `ownedToolContext`; tool event key binding; `interpolate` field paths
- `src/core/studio/StudioStore.ts`, `src/core/atelier/AtelierStore.ts`: resolve an id inside a reference
- `src/core/studio/StudioTools.ts`: `conversationArtifactsContext`, `refersToConversationArtifact`
- `src/core/AIRouter.ts`: an artifact refinement is not handed to `ProjectResolver`
- `src/app/scene/genesis/avatar/LeluCompanion.tsx`: the companion window unmounts under a phone sheet
- Tests:
  - new: `tests/turn-completion.test.ts`
  - extended: `tests/creation-studio-tools.test.ts`, `tests/chat-surface.test.ts`
  - updated: `tests/engineering-chain.test.ts`. A source-shape regex now allows guards after `!namesTool`; it still requires `!namesTool` to gate `ProjectResolver`.
- `tests/e2e/chat-product-creation.e2e.mjs`: the independence step reopens the Universe and checks a genuinely different conversation.

## Regression tests (`tests/turn-completion.test.ts`, 11 tests, all pass)

These use the real TaskEngine, TaskExecutor, dispatcher, Studio and activity recorder. Only the model is scripted.

1. A single tool step completes, and the published record is `done`.
2. and 4. Sequential tools (create, then export via `{{steps.s1.output.id}}`) produce a verified DOCX, with the card recorded for the asking conversation.
3. Two tool calls in one assistant turn produce two cards.
5. A reply produced outside `ai.chat` is delivered to its conversation, and only when the turn is unanswered.
6. A failing tool settles the turn as `failed`, and the next turn recovers.
7. Stop during a running tool settles the task as `cancelled` and finishes the turn.
8. A queued refinement revises the same artifact (line chart, Max, revision-2 DOCX).
   - 8b: the planner prompt names this conversation's artifact.
   - 8c: the refinement routes to the model.
9. Two conversations run planned turns at once and keep their own artifacts and cards.

Interpolation of field paths is covered by its own unit test.

## Latency, tokens and cost

- **Chat completion latency** (creation turn, from `Orchestrator.process` start to reply delivered): 6.3 s, 6.9 s and 10.0 s across three instrumented live runs. The reply is emitted less than 1 ms after the orchestrator resolves. Before the fix the turn never completed.
- **Model calls** in the final live run: 10, all HTTP 200, through the dev server's provider proxy (Fireworks routing).
- **Token usage and cost:** **not available.** Neither the dev server's model proxy nor the page records usage for these calls, so this report gives none rather than estimating.

## Remaining issues

1. **Universe chat bubble rendering:**
   - LÉLU's reply shows raw markdown (`**…**`).
   - Wide content (the artifact card, the export checks line) makes the thread scroll horizontally, which clips bubbles at the edges.

   This is visible in `15-persistence-recovery/…after-reload.jpg`. It is a presentation defect, not a lifecycle one, and was not changed here.
2. **Extra change in the model's revision.** The refinement's revision note begins "– paragraph: Lumo is a ligh…", so beyond the requested chart change the model also removed a paragraph. The tool did what it was told; this is a question of the model's edit quality.
3. **Companion texture cost.** On returning Home the companion remounts and re-uploads its textures. This is the Phase 3 item: a single avatar instance and the duplicate texture upload.
4. **Physical iPhone.** Nothing here was tested on a physical device. Every result is Chromium emulation.
