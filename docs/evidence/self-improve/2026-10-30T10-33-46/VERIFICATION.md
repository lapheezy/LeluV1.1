# Run 29 — the loop completed by LÉLU, with a verdict the independent check confirms

## The request

`request.txt` asked her to finish the loop on her copy `default`:
- validate it;
- preview it;
- capture the app and her preview at phone and desktop, app first;
- fix anything still covered;
- diff, and give her verdict.

It told her that the previous diff had listed files that were not hers, a fault since fixed. It named no result.

## What she did, in one turn (384 s, no go-ahead needed)

| Time | Step | Result |
|---|---|---|
| 6–31 s | `project.validate` | typecheck passed |
| 32 s | `project.preview` | running at :5310 |
| 34–84 s | Captured the app, phone, chat | 5 findings |
| 87–135 s | Captured her preview, phone, chat | **5 → 2.** Resolved: covered-while-opening New chat, Search all chats, Chats and notifications. Still present: a partly-off-screen "Options for Engineering" and the tab row's sideways overflow (both in the app too, not companion-related). |
| 137–245 s | Captured the app, desktop, chat | 1 finding, Expand Genesis covered-while-opening, seen in only some loads |
| 247–374 s | Captured her preview, desktop, chat | 0 findings |
| 376 s | `project.diff` | exactly her two files (below) |

**Her diff:**
- `LeluCompanion.tsx`: `setInterval(reconsider, 1500)` → `500`.
- `CompanionStore.ts`:
  - `EDGE_MARGIN` 12 → 100;
  - default spot `x 0.86, y 0.2` → `x 0.1, y 0.15`.

**Her verdict:** "no control covered by the companion, including while the panel opens — **met for both phone and desktop**". She also correctly said the two remaining phone findings are not caused by the companion.

## Independent check

The copy is unchanged since run 27; this run's diff is identical to the run-27 state. It was measured then with `../2026-10-30T09-43-44/verification/timing-checked.mjs`: every animation frame for 8 s after the chat opens, in fresh contexts, and every load confirmed rendered.

| Viewport | Real app | Her copy |
|---|---|---|
| Phone 390×844 (3 loads) | header controls covered 1.2–1.8 s on 3/3 | 0 on 3/3 |
| Desktop 1280×800 (3 loads) | 0 | 0 |
| iPhone SE, 430×932, tablet | covered on all three | 0 |
| Laptop 1440×900 | 0 | 0 |

Two more checks on her copy:
- typecheck passes;
- the companion and character tests pass, 15/15 (checked on the margin-48 state in run 25). The margin-100 state was validated by her (`tsc`).

**Her verdict matches the independent measurement.**

## The acceptance test

> "LÉLU herself has completed at least one real UI improvement using the complete self-development loop, and the changed behavior has been verified using genuine evidence."

| Part of the loop | Who did it, and where |
|---|---|
| Found the defect | **She** did, by capturing her own UI (run 23). It is a real, user-facing defect: at phone size, the header's three controls are covered for 1–2 s each time the chat opens. |
| Copy, search, read, edit | **She** did, in an isolated copy (runs 23–27). |
| Validate | **She** did. |
| Preview, compare like for like, at phone and desktop | **She** did. |
| Diff, verdict | **She** did (run 29). |
| Independent measurement | Confirms her verdict. |

**What others contributed.** Claude Code:
- wrote no line of her change and never edited her copy. The only exception is the reconstructed `.lelu-baseline.json` metadata (run 28), which is tooling, not code;
- gave review feedback that named problems, never fixes: the desktop regression (run 24), the transient covering and the placement side effect (run 30);
- fixed the tools when they misled her: transient covering was invisible, copies from earlier sessions were unknown to her context, and the diff was measured against the wrong baseline.

**Verdict: met, for the outcome she defined.**

## Not applied yet, and why

Applying her change to the real project is `project.apply`, which needs the owner's authorization. Claude Code has not granted one and will not.

A review found a side effect before it could be applied. `EDGE_MARGIN` also clamps where the user can drag her: at 100, on a 390 px phone, she can only stand between 100 and 180 px from the left. Run 30 gives her that finding to refine her change.
