# Run 13: independent verification (by Claude Code, not LÉLU)

**Verdict: not met.** She said so herself, and the problem she chose was not a defect.

## What happened
- **Problem chosen:** with the Memory panel open at phone size, three header buttons (Minimize Genesis, ⌘K, fullscreen) were reported "covered".
- **Her attempts:** she shrank the bottom sheet's height in steps (80vh → 65vh → 45vh → 30vh). She validated each step (typecheck passed) and captured her preview under the same conditions (phone, memory) each time. The same 3 findings remained every time. Her verdict: "**has not been met**".
- **She described a diff without running one.** Her reply included a diff "excerpt", but `project_diff` never ran. The reply automatically carried "⚠️ Not verified: … project_diff did not run successfully in this turn" (`ClaimGrounding`, working as designed in a live run). The excerpt does match the copy's real diff, which the recorder read afterwards.
- **Three of four go-aheads got no reply at all.**
- **Her final change would have done harm:** `height: "30vh"` makes every phone panel less than a third of the screen.
- **The new write guard fired:** one `project.write` with display text was refused.

## Why the problem was not a defect
- The "cover" is the expanded panel's modal backdrop (`GenesisModuleHost`, `isExpanded`): a fixed `inset: 0` layer at `rgba(2,6,23,0.55)` that holds the panel window.
- Controls behind an open modal's backdrop are covered on purpose. A real tap at the button does not reach it, which is correct while the modal is open.
- The capture tool reported them as layout problems. It had done the same in run 10.

## Tool change made after this run
- A see-through fixed layer covering the whole viewport is recognised as a modal backdrop. Controls behind it are counted (`behindModal`) and named as such in the report, not listed as problems. An opaque layer over controls is still a problem.
- Live now, at phone size:
  - **Memory panel:** 0 findings, 3 behind the backdrop.
  - **Avatar panel:** 10 findings, all genuine. The right column is cut off; the content is 518 px wide in a 356 px box.

Nothing was applied to the real project.
