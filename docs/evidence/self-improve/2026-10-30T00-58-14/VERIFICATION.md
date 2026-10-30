# Run 16: independent verification (by Claude Code, not LÉLU)

**Verdict: not met.** She said so herself: "the **expected outcome was not met**".

## What happened
- **The problem:** the genuine Avatar-panel overflow, 10 findings.
- **Her comparisons were like for like:** the app read 10 three times, and her preview read 10 four times.
- **Her change (+14/−9):** wrapping and shrinking rules on the "Direction" note box, and `maxWidth: "100%"` on the right column. Neither changed the measurement.
- **Her write and edit attempts:**
  - one `project.write` carrying display text was refused by the guard;
  - five `project.edit` calls did not match the file.
- **She did not run `project_diff` itself.** The diff above was read by the recorder.

## Was the tool's new diagnostic to blame?
Partly.

- After run 14 the report followed the furthest-right path down from the overflowing box. In a column layout every child is stretched to the same width, so that path could lead to an element that is only stretched, not to the one forcing the width.
- I had misread it myself: I took the header row for a cause. It needs only 223 px.

**Tool change made after this run:**
- Each element in the chain now states the narrowest it can be (`needs at least N px`, its min-content width).
- At a branch the chain follows the child that forces the width, and marks the others "fits when not stretched".

On the live Avatar panel it now reads:

- the two-column body row (`display flex`, no wrap) **needs at least 494 px** in a 356 px box;
- its right column needs 224 px, because of the two-column grid of fields;
- the header row fits when not stretched.

Nothing was applied to the real project.
