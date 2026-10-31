# Run 25 — independent verification

## The request

Run 25 was a follow-up to run 24 (`request.txt`). It gave her:
- the run-24 measurement;
- the fact that `browser.capture` now reports controls covered while a panel opens ("covered-while-opening").

It named no fix.

## What she did

The run lasted 1130 s and used 1 go-ahead.

She captured the app at phone and desktop size and got covered-while-opening findings for the chat header. She then read `CompanionStore.ts` and `LeluCompanion.tsx` and changed behaviour, not only the default spot:

| Change | Before | After |
|---|---|---|
| `setInterval(reconsider, …)` in `LeluCompanion.tsx` | 1500 ms | 500 ms (she checks whether she is in the way 3× as often) |
| `EDGE_MARGIN` | 12 | 48 (distance kept from the screen edges) |
| Default spot | `x 0.86, y 0.2` | `x 0.1, y 0.15` (from run 24) |

`project.validate` passed twice. She started a preview and compared it at phone size like for like.

**Her verdict:** "Not resolved" for both phone and desktop.

## Her verdict described an earlier state

The order of events in `events.json`:

| Time | Event |
|---|---|
| 896 s | Phone preview capture: the 3 header controls covered while opening, still present. |
| 956 s | Edit: `EDGE_MARGIN` 12 → 48. |
| 960 s | Desktop preview capture; **timed out** at 1110 s. |

Her last phone comparison therefore predates her last edit, and no capture of her final copy completed. "Not resolved" was honest about what she had measured, but she had not measured her final copy.

## Her final copy, measured independently

Her copy (`.lelu-sandbox/default`) was served on its own Vite. The method is the same as in runs 23 and 24: every animation frame for 8 s after the chat opens, in fresh contexts. Controls are counted as covered when the companion is what `elementFromPoint` returns at their centre.

| Viewport | Real app | Her copy |
|---|---|---|
| Phone 390×844, load a | 1.40 s: New chat, Search all chats, Chats and notifications | **0** |
| Phone 390×844, load b | 0.93 s: the same | **0** |
| Phone 390×844, load c | 1.82 s: the same | **0** |
| iPhone SE 375×667 | 1.67 s: the 3 header controls **and** Open LÉLU menu, Close chat; Enter fullscreen covered before opening | **0** |
| 430×932 | 1.32 s: the 3 header controls | **0** |
| Tablet 768×1024 | 3.64 s: Open LÉLU menu, Close chat | **0** |
| Desktop 1280×800, loads a–c | 0 | 0 |
| Laptop 1440×900 | 0 | 0 |

**Where she sits** (`measure.json`, 3 loads × 12 samples):
- In her copy, at (48, 104) on phone, on every sample: below the header row, clear of every control.
- In the real app, she starts over the header, at (268, 51), on 1 of the 3 loads, then moves to (268, 305).

**Tests on her copy:**
- `tsc -b`: passes.
- `tests/companion-mode.test.ts` and `tests/lelu-character.test.ts`: 15/15 pass.

**Review notes:**
- The comment above `setInterval` still says "every second and a half"; it now runs every 0.5 s.
- `EDGE_MARGIN 48` also widens the gap she keeps from every edge, on every screen. That is visible, though not a defect.

## Verdict

**The change is a genuine improvement, independently verified on 8 viewports.** No viewport has her covering a control, and the real app has her covering controls on 4 of them.

**It does not yet count for the acceptance test.** Her own loop never measured her final copy, and her stated verdict ("not resolved") describes an earlier state.

Run 26 asks her to capture and judge her current copy, with no changes and no hint of the result.

Nothing has been applied to the real project. Applying it is `project.apply`, which needs the owner's authorization.
