# Run 24 — independent verification

## The request

Run 24 was a follow-up to run 23 (`request.txt`). Its request was the independent verification of her run-23 change, worded as a reviewer would put it:
- phone was confirmed fixed;
- desktop newly covered the chat window's menu and close buttons for 4–6 s.

It named no fix. She continued on her own copy (`default`).

## What she did

The run lasted 2745 s and used all 8 go-aheads.

| Tool | Calls |
|---|---|
| capture | 35 |
| project.edit | 17 |
| project.preview | 9 |
| project.read | 7 |
| project.diff | 6 |
| project.copy | 5 |
| memory.recall | 2 |
| project.list | 1 |
| project.validate | **0** |

- **Lost work:** she ran `project.copy` again 4 times, and each time this wiped her own edits.
- **Tried only default spots:** she tried several default spots and settled on `x 0.1, y 0.15`, top left (`diff-default.patch.txt`).

**Her verdict:** both viewports are fixed. She also said that in the live app "Phone: no overlap (already fixed)".

## Independent measurement

Measured with `verification/timing-both.mjs`, the same method as run 23: every animation frame for 8 s after the chat opens, on 3 fresh loads per viewport, with her copy served on its own Vite.

| Viewport | Real app | Her copy |
|---|---|---|
| Phone a | 1.95 s: New chat, Search all chats, Chats and notifications | **1.48 s: New chat, Options for New chat** |
| Phone b | 1.44 s: the same three | **1.22 s: New chat, Options for New chat** |
| Phone c | 0.82 s: the same three | **3.11 s: New chat, Options for New chat** |
| Desktop a–c | 0 | 0 |

Her copy also covers **Expand Genesis** before the chat is opened, on 3 of 3 loads.

## Verdict: not met

- Desktop is fixed.
- On phone, the same defect moved from the right of the chat header to the left.
- Her claim of no overlap on phone is false.
- Her claim that the live app is "already fixed" is false: no change was ever applied to it.

## Why she could not see it

The covering is **transient**. It lasts the first one to three seconds, until the companion's own avoidance logic moves her.

`browser.capture` measures the layout only once it has settled. That was deliberate (run 8 measured mid-transition), but it means the tool cannot see a defect that exists only before settling. Her captures therefore reported 0, or "3 in only some loads", for the same build. She was steering by a signal that could not show the problem.

Any fixed default spot covers some control on some viewport. The fault is that she starts somewhere before checking where she is.

## Follow-up (tooling, not her fix)

The capture tool now also watches the first seconds after the panel opens. It reports any control covered during that time, and for how long, as its own kind of finding.
