# Run 27 — independent verification

## The request

The request (`request.txt`, the same as run 26's) asked her to finish the loop on her current copy, without re-copying it. It is the first run on the fixed runtime, which now tells her about copies from earlier sessions.

## What she did

Her first turn lasted 0–919 s.

| Time | What she did | Result |
|---|---|---|
| 4–48 s | Validated her run-25 copy as it stood; started its preview | Validation passed |
| 101 s, 219 s | Captured it at phone and desktop | Phone: 2 findings, **none covered-while-opening**. Desktop: 1 finding, seen in only some loads. |
| 270 s, 366 s | Captured the app under the same conditions | Phone: 5 findings, including the 3 header controls covered-while-opening |
| 370 s, 397 s | Called `avatar.companion` | It reported the real companion OFF; it had been turned off before this run |
| 417 s | Raised `EDGE_MARGIN` from 48 to 100 | — |
| 455 s | Validated | Passed |
| 554 s | Previewed and compared at phone, like for like | **"5 finding(s) before → 2 now; resolved: covered-while-opening: New chat, Search all chats, Chats and notifications."** |
| 614–769 s | Validated and captured another copy, `self_improvement_copy` | Phone: the 3 header controls resolved. Desktop: unchanged. |
| 919 s | Called `project.diff` | — |

**Her report:**
- the covered-while-opening problems are resolved on phone;
- the 2 remaining phone findings are a partly-off-screen button and a sideways overflow, both present in the app too;
- desktop has not been verified after her last edit, and the diff is not done.

**At the go-ahead the provider went offline** ("I'm in offline mode right now"), so she gave no final verdict.

## Her copy as it stands, measured independently

Copy: `.lelu-sandbox/default`, with `EDGE_MARGIN 100`, reconsider every 500 ms, and the default spot at the top left.

Method:
- every animation frame for 8 s after the chat opens, in fresh contexts;
- each load waits for the chat composer to exist, and records how many controls it saw.

A first pass found one blank load (a cold Vite compile), which would have measured "0 covered" on an empty page. The script now flags such loads; this pass has none.

| Viewport | Real app | Her copy |
|---|---|---|
| Phone 390×844, loads a / b / c (19 controls each) | 1.58 / 1.17 / 1.78 s: New chat, Search all chats, Chats and notifications | **0 / 0 / 0** |
| Desktop 1280×800, loads a / b / c | 0 | 0 |
| iPhone SE 375×667, 430×932, tablet 768×1024, laptop 1440×900 (first pass, each load rendered) | covered on SE, 430×932 and tablet | **0 on all** |

**Where she sits:** on phone she stands left of centre below the header, at about (100, 150). See `verification/phone-a-hers-chat.jpg`.

## Status

- **Measured by her own tools:** the phone result, like for like, after validation.
- **Confirmed independently:** phone, and every other size measured.
- **Missing from her loop:**
  - a desktop capture of the final state;
  - the diff;
  - her verdict.

  The provider outage stopped her before she could give them.

**Not counted yet.**

The next run asks her to complete exactly those three steps on this copy.
