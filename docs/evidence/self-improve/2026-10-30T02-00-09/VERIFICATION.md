# Run 19: independent verification (by Claude Code, not LÉLU)

**Verdict: does not count.** She reached a layout that measures clean but did not complete the loop.

## What happened
- **First copy, `self_improvement_copy`:** five approaches on the Avatar panel, all measured 10 → 10.
- **Second copy, `self_improve_loop`:** iterative edits, compared like for like (phone, Avatar). Her captures read 10 after each of the first three edits.
- **The decisive edits came after her last capture (1423 s):**
  - 1486 s: the two-column row became `flexDirection: "column"`;
  - 1520 s: the window's fixed `width` prop was removed;
  - 1555 s: the left column became `width: "100%"`.

  Together with her earlier single-column field grid (`gridTemplateColumns: "1fr"`), this stacks the panel's content.
- **Her final typecheck FAILED (1613 s):** her own edit left a duplicate `flexShrink` key in one style object.
- **She never captured, fixed or diffed that final state.** The recorder had used its four go-aheads, its limit and my choice, and she was stopped mid-iteration.
- **Her last reply** says plainly that the layout problem was not solved and the build fails. It was true for everything she had measured.

## Independent measurement of her final copy
Phone 390×844, Avatar panel, settled: **0 findings** (`independent/self_improve_loop-final-avatar-panel.jpg`). The panel is stacked: the header wraps, and the Companion switch, Default/3D and the reference area are whole.

## Why this does not count
- The acceptance test requires that LÉLU complete the loop and that the changed behaviour be verified with genuine evidence.
- Here her final state fails typecheck, was never captured or compared by her, and her verdict was "not solved".
- Claude Code's measurement afterwards is not her completing the loop.

## Recorder change made after this run
The limits that cut her off are raised to at most 8 neutral go-aheads and 60 minutes.

Nothing was applied to the real project.
