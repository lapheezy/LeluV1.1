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

- The full `npm test` passed: 1365/0, run before fix 2.
- After fix 2, the studio and atelier suites pass 11/11 and the typecheck is clean.
- The full suite has **not** been re-run since fix 2.

## Open / blockers

- The live product-creation e2e (`tests/e2e/chat-product-creation.e2e.mjs`) is not green. The last live run was stopped before the export fix could be confirmed live. The refinement, persistence and independence steps have not been reached.
- During live model turns the page becomes intermittently unresponsive: screenshots and evaluate calls time out. Long tasks stay small, while CPU time goes to native "(program)", which looks like rendering. This is not yet diagnosed.
- No physical iPhone test has been run. Everything above is Chromium emulation.
- Next steps: re-run the full suite, re-run the live flow, diagnose the stall, and complete evidence folders 11 and 13–15.
