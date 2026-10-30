# Run 21: independent verification (by Claude Code, not LÉLU)

**Verdict: not met.** It is the same state-dependent defect as run 20, and her change does not fix it.

## What happened
- **The problem:** the chat tabs at phone size again. The Engineering tab's "···" button is cut off when that tab carries an unread dot.
- **Her change (+2/−2, `MultiChatTabs.tsx`):** the tab bar gets `overflowX: "auto"`, and the tab button's `maxWidth` goes from 180 to 120.
- **Her captures:** app 2 → preview 2 → preview 0. There was no edit between the last two preview captures.
- **Her verdict:** "the overflow issue is resolved".
- **One capture failed:** the screenshot timed out waiting for fonts.

## Independent check
Three captures each, two loads per capture (phone, chat panel):

| | Findings, per capture |
|---|---|
| App | 2 · 0 · 0 (the 2 seen in 1 of 2 loads) |
| Her preview | 0 · 0 · **2** (the 2 seen in 1 of 2 loads) |

Whenever a background message's unread dot is on the Engineering tab, her preview still cuts the "···" button off (`independent/preview-with-unread-dot-still-cut-off.jpg`). The capture tool marks these findings as depending on the app's state at load time, and the comparison lists them as "not evidence either way". Her "resolved" verdict does not follow from the evidence.

## Tool change made after this run
The capture's event on the bus now carries the conditions, the state-dependent count and, for a preview, the comparison she was given, so the evidence shows what she was told. (It recorded only a count before.)

Nothing was applied to the real project.
