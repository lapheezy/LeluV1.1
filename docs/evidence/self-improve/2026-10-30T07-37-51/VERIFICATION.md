# Run 23 — independent verification

Checked by Claude Code with its own scripts (`verification/*.mjs`), not with LÉLU's capture tool. Her copy (`.lelu-sandbox/default`) was served on its own Vite at :5401. The real app ran at :5173. Each run used fresh browser contexts.

## What she did (from `events.json` and `transcript.txt`)

She ran the whole loop in one turn, with no go-ahead needed, in 406 s:
- captured her app at phone size (home, then chat);
- chose a problem: the companion covers **New chat**, **Search all chats** and **Chats and notifications** in the chat header at phone size;
- stated an expected outcome before changing anything: zero controls covered at phone size in the chat panel;
- copied the project, searched and read the code (`LeluCompanion.tsx`, `CompanionStore.ts`);
- made one edit;
- passed typecheck;
- started a preview and captured it under the same conditions;
- compared (3 → 0, "resolved");
- diffed and reported.

**Her change** (`diff-default.patch.txt`): `defaultCompanionState()` moves the companion's default position from `x 0.86, y 0.2` to `x 0.7, y 0.3`.

Along the way:
- **Write refused:** her first `project_write` tried to save `project_read`'s display output into the file. The guard refused it and she used `project_edit` instead.
- **Timed-out capture:** one capture timed out at 150 s.

## The problem is real (and was introduced by Claude Code)

Since Pass 3, the companion is on by default at full-body size (110×235 at medium). At phone size, opening the chat starts her at (268, 51), which covers all three header controls.

| Real app, phone 390×844 | Result |
|---|---|
| `measure.mjs`, 3 loads | Covered at the first sample (1.5 s after the chat opens) on **3 of 3** loads. Her avoidance logic then moves her to (268, 305). |
| `timing.mjs`, every animation frame for 8 s | Covered from 1.5 s to 3.0 s after the chat opens, about 2 s in total. During that time a tap on those buttons lands on her. |

## Her change fixes it on phone: confirmed

| Her copy, phone 390×844 | Result |
|---|---|
| `measure.mjs`, 3 loads × 12 samples | She sits at (218, 136). **0** controls covered at every sample. |
| `timing.mjs`, every frame for 8 s | **0 ms** covered. |
| `tests/companion-mode.test.ts` and `tests/lelu-character.test.ts`, run on her copy | 15/15 pass. |

Her verdict, "the expected outcome is met", is **true for the outcome she stated** (phone).

## It regresses desktop: found by verification, not by her

She never captured desktop. At 1280×800 her new default spot puts the companion over the chat window's own header.

| Desktop 1280×800, `timing-desktop.mjs` | Real app | Her copy |
|---|---|---|
| load a | 0 ms covered | **4.5 s**: Open LÉLU menu, Close chat |
| load b | 0 ms covered | **4.5 s**: Open LÉLU menu, Close chat |
| load c | 0 ms covered | **6.4 s**: Open LÉLU menu, Close chat |

The covered stretch lasts until her avoidance logic moves her away. See `verification/desktop-c-hers-chat.jpg` and `verification/desktop-app-chat.jpg`.

## Verdict

**The change is not counted as the acceptance-test improvement, and it is not applied.**
- **Genuine:** the problem, the loop, the like-for-like comparison and the phone result.
- **But:** the change trades a phone defect for a desktop one of the same kind.

This is the first run where she:
- found a real, user-facing defect;
- fixed it on the viewport she named;
- reported a verdict the independent check confirms for that viewport.

Next: run 24 gives her this verification as a reviewer would. It names the regression and the measurement, never a fix, and she continues on her own copy.
