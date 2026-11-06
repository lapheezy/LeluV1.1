# Phase 2: Chat Owns the Phone (status: IN PROGRESS)

This is an interim commit, made at the owner's request before the session's usage ran out.

## Verified (emulated devices only; no physical iPhone yet)

The mobile Playwright e2e is `tests/e2e/mobile-chat.e2e.mjs` and runs in CI. All 145 phone checks and 4 desktop checks pass on iPhone 13, iPhone SE, iPhone 15 Pro Max, Galaxy S8, Pixel 7 and a 1440×900 desktop. See `evidence/phase-2-chat-mobile/mobile-report.json` and `desktop-report.json`.

On a phone, with the Chat Universe or a conversation open:

- Home, the spatial nav and the V1 scene are unmounted, and 0 scene canvases remain.
- There is exactly one composer.
- The conversation is a full-screen sheet.
- Safe-area padding is applied, and the composer font is ≥16 px, so iOS does not zoom.
- The composer stays visible when the keyboard is emulated, and the draft survives.
- Multi-chat stays isolated, history is restored, landscape works, and returning to Home restores Cosmos.

Application windows stack above the desktop chat panel (`APP_WINDOW_Z` = 101 > 100).

## Fixes found by the product-creation flow

1. A planned (multi-step) task dispatched its tool steps with no context, so a Studio artifact belonged to no conversation. The task is now bound to the turn's conversation, and its steps carry that conversation in their context (`Orchestrator`, `TaskExecutor.ownedToolContext`). The live run confirms that the artifact now has the conversation id.
2. A planned export step received the create step's prose output and failed with "No artifact matches". `StudioStore.resolve` and `AtelierStore.resolve` now accept an id found inside the reference. A unit test covers this.

## Tests

- The full `npm test` passes after both fixes: 1366 passed, 0 failed.
- After fix 2, the studio and atelier suites pass 11/11 and the typecheck is clean.

## Live product-creation run (after both fixes)

Results are in `evidence/phase-2-chat-mobile/product-creation-report.json`: 7 of 9 checks pass.

- PASS: LÉLU created a real Studio artifact, with a column chart of Lite, Standard and Pro.
- PASS: The artifact belongs to the conversation that requested it.
- PASS: The DOCX was written and verified from its bytes (14.0 KB).
- PASS: The artifact renders, and fills the screen on the phone.
- FAIL: No artifact card appears inside the conversation.
- FAIL: The run did not complete, because a screenshot timed out.

## Open / blockers

- **The chat turn hangs after the planned task finishes.** The conversation still shows "Working with tools · 2 tools used", even though both tools finished and the DOCX is verified (screenshot `07-regression/…-product-creation-failure.jpg`). Because the reply never settles, its artifact card is never attached. The refinement message then queues behind the stuck turn, so the refinement, persistence and independence steps are not reached. This hang is probably also behind the unresponsiveness seen during live turns. Next step: find where `Orchestrator.planAndExecute`, the task status, or the `GenesisChat` turn fails to settle.
- No physical iPhone test has been run. Everything above is Chromium emulation.
