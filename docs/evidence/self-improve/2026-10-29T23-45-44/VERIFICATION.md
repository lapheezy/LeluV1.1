# Run 11: independent verification (by Claude Code, not LÉLU)

**Verdict: not met, and the fault is mine.** The problem she chose did not exist. My own detector reported it.

## What happened
- **The problem she chose:** she captured the chat at phone size and picked two `sideways-overflow` findings, the "New chat" and "Engineering" tabs: "content 159px wide in a 110px box".
- **That category was mine.** I added it to the capture tool after run 8. It flagged any clipping box whose content was wider than the box and that contained a control.
- **Nothing was hidden.** The screenshot (`app-chat-phone-independent.jpg`) shows both tabs whole, including their "···" options buttons. The per-control check, which measures against the real clip edges, found nothing.
- **Her attempts:** three approaches in `copy1`: `overflowX: auto` on the bar, `flexWrap`, then a narrower ellipsis `tabStyle`. Typecheck went red three times, and she repaired it each time. She captured the preview under the same conditions (phone, chat).
- **Her report:** "The expected outcome … was **not met**; the same warnings persist." True: the warning was a phantom, so nothing could clear it.
- **Her change would also have done harm.** It shrinks the 36 px icon buttons to 28 px (smaller touch targets) and blanks three unrelated `fontSize` lines.
- **The new guard worked.** Her first `project.write` again carried `project_read`'s display text. It was refused, and nothing was broken.

## Tool defects found and fixed
1. **The false positive.** `sideways-overflow` is now reported only when a control inside the box is actually cut off by it. The fixture test fails on the old rule and passes on the new one.
2. **The workspace diff could not show her change.** It trimmed the common prefix and suffix and called everything between them "changed": +531/−523, one block truncated at 8,000 characters. `plugins/lineDiff.ts` is a real LCS line diff with hunks, used by the Node and Deno adapters. The same files now give **+16/−8**. The Deno adapter's "modified" counts were whole-file totals, and are fixed too.

Nothing was applied to the real project.
