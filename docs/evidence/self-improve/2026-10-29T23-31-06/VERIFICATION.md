# Run 10: independent verification (by Claude Code, not LÉLU)

**Verdict: not met.** She said so herself: "Expected outcome NOT met".

## What happened
- **Problem chosen:** the three header buttons (Minimize Genesis, ⌘K, fullscreen) are reported "covered" with the Avatar panel open. She attributed this to the companion overlay.
  - The capture report names the cover as the Avatar panel's own container: `div "◉Avatar◎ Chat—⊡✕…"`.
  - The companion is off in a fresh capture, and its overlay is `pointer-events: none`, so it is invisible to hit-testing.
  - Her diagnosis was wrong.
- **`copy1`:** she wrote `project_read`'s display text into `LeluCompanion.tsx` (+29/−443), including its header line and `N| ` prefixes. Typecheck failed (`TS1127` at 1:48). She abandoned the copy.
- **`copy2`:** three attempts. The last one wrote `src/index.css` as 12 lines (−1,089), keeping the stylesheet only as a comment: `/* (full original stylesheet – 1089 lines) */`. CSS is not typechecked, so validation "passed".
- **Her report:** after three approaches the covered findings were unchanged, so the expected outcome was not met. That matches the recorded captures.
- **Recorder defect:** `diff-copy2.patch.txt` includes `diff-copy1.patch.txt`, because the recorder wrote copy1's patch before reading copy2's diff. Fixed since then.

## Tool changes made after this run
- `project.write` now refuses, whatever `allowShrink` says, content that carries:
  - `project_read`'s display (its header line or `N| ` prefixes);
  - a comment standing in for code that was never written out (`unsavableContent`).
  
  The refusal points her to `project_edit`.
- The recorder reads every workspace diff before writing any patch file.

Nothing was applied to the real project.
