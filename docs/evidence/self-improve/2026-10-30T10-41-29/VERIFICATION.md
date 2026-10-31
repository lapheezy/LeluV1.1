# Run 30 — her refinement regresses phone: not met

## The request

`request.txt` gave her a review finding on her run-29 change. `EDGE_MARGIN 100` also clamps where the user can drag her: on a 390 px phone, her left edge can only be between 100 and 180 px. It asked her to keep the outcome while letting the user place her near the edges.

## What she did

The run lasted 515 s, in one turn.
- She read `CompanionStore.ts` and `LeluCompanion.tsx`, and changed `figureRect` to clamp to the screen itself (0 px) instead of `EDGE_MARGIN`. Her own spot-picking still uses the margin.
- **Checks:** validated it (typecheck passed) and ran a preview.
- **Captures:** the app, then her preview, at phone and desktop.

**What her captures showed:**
- **Phone:** "5 → 2, resolved: the 3 header controls". Both remaining findings were marked **"in only some of 2 loads"**.
- **Desktop:** 1 → 1, "Expand Genesis" (state-dependent).

**Her verdict:** no control is covered on phone or desktop, and she can now be dragged to the very edges.

## Independent measurement

Method: `verification/timing30.mjs`, every animation frame for 8 s after the chat opens. There were 3 fresh loads per viewport, and every load was confirmed rendered.

| Viewport | Real app | Her copy (run 30) |
|---|---|---|
| Phone a | 3.0 s: the 3 header controls | **8.0 s, the whole window: New chat, Options for New chat** |
| Phone b | 0.97 s | **8.0 s: the same** |
| Phone c | 1.30 s | **8.0 s: the same** |
| Desktop a–c | 0 | 0 |

On all 3 phone loads she also covers **Expand Genesis** before the chat opens.

**Why:** her default spot is `x 0.1, y 0.15`. With the clamp at 0 instead of 100, a phone now places her at about (0, 10), over the header's left end, and she stays there. See `verification/phone-a-hers-chat.jpg`.

`browser.capture`, run on her preview afterwards (`verification/capture-tool-now-phone.jpg`), reports it too: **covered: New chat, Options for New chat, seen in 2 of 2 loads**. The captures she ran during her session had found it in only one of their two loads, and she called the result resolved anyway.

## Verdict

**Not met.** Phone regressed, from transient covering to persistent covering, and her claim about phone is false.

**The acceptance result of run 29 stands.** That copy state was the one measured, it met her stated outcome, and she verified it herself. Its review side effect (the drag range) is what she was trying to fix here.

**Nothing has been applied.** Her copy now holds the run-30 state. The run-29 state is recorded in `../2026-10-30T10-33-46/` (diff in the transcript; verification there).

## Tool fix from this run

Capture listed "Options for New chat" twice:
- once as **covered**, from the settled report, labelled `button[…]`;
- once as **covered-while-opening**, from the opening watch, labelled `button "…"`.

The same control is now recognised by its rectangle, so it is reported once (`tests/self-view.test.ts`).
