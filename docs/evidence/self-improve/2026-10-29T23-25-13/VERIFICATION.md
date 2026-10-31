# Run 9: independent verification (by Claude Code, not LÉLU)

**Verdict: not met.** Her change had no measurable effect, and her report compared different conditions.

## What LÉLU did, by herself
- She ran the whole loop in one turn with no tool failures: captured her app with no panel and with the Avatar panel, copied the project (`avatar_fix_copy`), searched, read, edited, validated (typecheck passed), previewed, captured the preview and diffed it.
- Her diff (+1/−1) in `GenesisAvatarPanel.tsx`: `width="min(96vw, 980px)"` became `width="calc(100vw - 16px)"`.
- Her claim: 13 warnings → **0**, "expected outcome is met".

## What her own recorded tool results show
| Capture | Conditions | Findings |
|---|---|---|
| 1 · app | phone, no panel | 0 |
| 2 · app | phone, **Avatar panel** | 13 |
| 3 · her preview | phone, **no panel** | 0 |

Her table labelled the 13 as "phone, no panel" and set them against capture 3. Under the same conditions her comparison was 0 → 0, which says nothing about the panel.

## Like-for-like measurement
Her preview at phone with the Avatar panel, through the same capture route, settled:

- **13 findings, identical to the app.**
- The panel's content is still 518 px wide in a 356 px box.
- The right column (Appearance, Identity, Presence, Saved, 5 text fields) is still cut off.

See `independent/preview-avatar-panel.jpg`. The panel width was not what overflowed; the content inside it was.

## Tool change made after this run
A preview capture's result now names every app capture that found problems under *other* conditions, and says plainly that this capture says nothing about them (`uncomparedConditions`). Nothing was applied to the real project.
