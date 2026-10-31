# Run 20: independent verification (by Claude Code, not LÉLU)

**Verdict: not met.** Her "met" rests on two different app states, not on her change.

## What happened
- **The problem she chose:** the chat panel at phone size had 2 findings. The "Engineering" tab's options button was partly off-screen, and the tab strip's content was 255 px in a 240 px box.
- **Her change (+3/−2, `MultiChatTabs.tsx`):** tabs may shrink (`flexShrink: 1`, `maxWidth: 120`), and the tab button's `maxWidth` goes from 180 to 120.
- **Her captures:** app 2 → preview 2 → preview **0**, all at phone with the chat panel, typecheck passing each time.
- **Her verdict:** "The expected outcome is met."

## Independent check: two loads each, same conditions
| Load | Live app | Her preview |
|---|---|---|
| 1 | 0 findings | **2 findings** |
| 2 | **2 findings** | 0 findings |

- **The 2 findings appear only when a background message has arrived** before the capture. The Engineering tab then shows an unread dot, which widens it and pushes its "···" button out of the strip.
- **Her preview with the dot showing still cuts the button off** (`independent/preview-load1-…`).
- **Her "2 → 0" compared a load with the dot against a load without it.** Her change does not fix the state that produces the defect. The defect is real, but it depends on that state.

## Tool change made after this run
- Captures of her app and previews now load the page **twice**, independently.
- A finding seen in only some loads is marked `[in 1 of 2 loads — depends on the app's state when it loaded]`.
- The before/after comparison lists such findings as "NOT EVIDENCE either way", never as resolved or new.
- Reply numbers are checked against both the total and the stable count.

Nothing was applied to the real project.
