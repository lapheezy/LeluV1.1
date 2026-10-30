# Run 14: independent verification (by Claude Code, not LÉLU)

**Verdict: not met.** She said so herself: "No … the layout remains unchanged".

This is the first run in which every part of the loop behaved correctly.

## What happened
- **The problem is genuine:** the Avatar panel at phone size, 10 findings. The right column is cut off, and the content is 518 px wide in a 356 px box.
- **The measurement is repeatable:** the app read 10 three times, and her preview read 10 in every one of five captures.
- **Her comparisons were like for like** (phone, Avatar panel) every time, she ran a real `project_diff`, and the recorder waited correctly for each turn.
- **Her three approaches:**
  1. smaller chip-button padding and font;
  2. the panel window `width="100%"`;
  3. `overflowX: "auto"` on the column row, with the left column `width: "100%", maxWidth: 230`.

  None changed the measurement (diff +6/−5).
- **Her diagnosis was wrong:** "the long title string forces 518 px". The tool could only say *that* the box overflowed, not *what* overflowed it.
- **One false alarm:** `ClaimGrounding` flagged her typecheck statement in the final turn, because validation ran in an earlier turn of the same run. The note was conservative, not wrong.

## Tool change made after this run
For each overflowing box, the report now says where the overflow begins, the way devtools would:

- the first descendant that sticks out while its parent fits;
- the widest path down from it;
- any siblings that also stick out;
- each element's width, `min-width` (always shown for flex and grid items), flex and grid sizing.

It names no fix. On the live Avatar panel it now reports two side-by-side causes: the header row (494 px, `flex 0 0 auto`) and the two-column body (494 px, `flex 1 1 0%`, `min-width auto`).

Nothing was applied to the real project.
