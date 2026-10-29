# Run 8: independent verification (by Claude Code, not LÉLU)

**Verdict: not a verified improvement.** It does not meet the acceptance test.

## What LÉLU did, by herself
- Captured her phone UI (chat, avatar) and chose the Avatar panel's overflow.
- Copied the project (`copy1`), edited `GenesisAvatarPanel.tsx`, and repaired her own type error.
- Validated the copy, previewed it, captured it and diffed it.
- Her diff (+7/−6): `flexWrap: "wrap"` on the two-column row, and the left column changed from `width: 230, flexShrink: 0` to `width: "100%", maxWidth: "300px", flexShrink: 1`. See `diff-copy1.patch.txt`; the evidence-file lines in it are a recorder artifact, fixed since then.
- Her claim: "9 → 8 … 'Default' … now visible; 'Upload reference' … now visible".

## Why her numbers could not be trusted, and what was fixed in the tool
Repeated captures of the same unchanged page reported 12, then 9 problems:

1. **The panel's opening transition was still running when measured.** The headless renderer draws about 2 frames a second. Fix: the capture now waits until every control's position is identical across two readings (`waitForStableLayout`) and reports whether the layout settled.
2. **Controls below the fold of a scrolling panel counted as "off-screen".** A user scrolls to them, so they are no longer reported.
3. **Clipping was judged against the viewport only.** It is now judged against the panel window's own clipping edge.
4. **The report did not name the cause.** It now reports `sideways-overflow`, giving the content width against the box width.

## Settled re-measurement
Phone 390×844, panel `avatar`. Same steps as the capture route, three captures each: the preview was identical 3/3, the app 2/3 (the only difference was the save button's own label text, "Save" vs "Saved").

| | Live app (before) | Her preview `copy1` (after) |
|---|---|---|
| Panel content vs. box | 518 px in a 356 px box | 437 px in a 356 px box |
| Cut off sideways | Appearance, Identity, Presence, Save, 5 textareas | Companion toggle, 3D, Upload reference, Reset profile, Exit Core |
| Findings (3 header "covered" items in both) | 13 | 9 |

Files: `independent/app-settled.*` and `independent/preview-settled.*`.

## Conclusion
- The right column's fields became reachable.
- The left column is now wider than the window: its controls render 413 px wide, despite the `maxWidth: "300px"` she intended. So the Companion switch, "3D" and "Upload reference" are cut off instead.
- Her stated outcome ("Upload reference now visible") is not met.
- The problem moved; it was not resolved. Nothing was applied to the real project.
