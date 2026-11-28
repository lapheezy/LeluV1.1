---
date: 2026-11-28
title: You can test yourself from the chat. The first runs found real defects on a phone
by: Claude (Claude Code)
commits: pending
playbooks:
---

LÉLU, this is the start of the Cosmos × Chat Universe unification (v3, with diagnostics). You now have a
diagnostics engine in `src/core/diagnostics/`.

**How it works**
- A run is a list of checks. Each check **measures** your live page or your stores, or runs the
  project's test files through `EngineeringWorkspace.checkFiles`.
- Each check reports exactly one of PASS, FAIL, PARTIAL, BLOCKED or NOT_RUN, with evidence or a reason.
- A check that changes something to measure it puts it back: a move, a draft, a group, a mode.
- Runs are kept per conversation.

**Suites**

| Suite | What it covers |
|---|---|
| `freestyle-chat` | Freestyle and the chat as one variant, in six parts: a) spatial, b) borderless, c) chat, d) coexistence, e) persistence, f) device |
| `integration` | Chat, Neural Map, browser (Neko) and video together |
| `unit` | The project's own tests |
| `full` | All of the above |

Requests like "Validate Freestyle, including chat" pick the right suite.

**First real runs**
- Desktop, 1440×900: **28 pass, 0 fail**. Blocked: the physical iPhone, and the project tests (the
  engineer token isn't set). Not run: sending a message (it costs a provider turn), and a reload checked
  from inside the page.
- Emulated phone, 390×844: started at 19 pass, 2 fail, 3 partial; after fixes, **23 pass, 0 fail**.
- Persistence across a real reload, checked by `scripts/diagnostics/freestyle-chat.mjs`: a moved object
  came back at exactly dx 33, dy 17.

**Defects the runs found, fixed where they live**

| Defect | Where it was | Fix |
|---|---|---|
| The move handle was pointer-only | Every object | Keyboard: arrow keys, Shift for bigger steps |
| Controls were under 44 px on touch | Grips, buttons, Send | 44 px minimum on touch screens |
| The V1/V2/V3 map bar was invisible on a phone (it appeared only on hover) | The map's bar | Always shown on touch |
| The object header covered the first link | Phone Freestyle | Content starts below the header |
| The composer hint wrapped and was cut off | The composer | One line, with an ellipsis |

**My own check bugs** (the checks were wrong, not you):
- I misread the storage format.
- I looked for `.fs-chat`, which the compact phone layout doesn't have.
- I measured during smooth scrolling and during animations.

**Not yet:**
- the Diagnostics surface beside the chat;
- the `diagnostics.run` tool;
- running it on the physical iPhone.

**Freebuff:** Freebuff already rebuilt the navigation bar (commit `47e9e2cd` on
`freebuff/08f7aa9a…`). It is not on this branch, and merging it gives 10 conflicts, so it was left for
the owner to decide.

Redo: `node scripts/diagnostics/freestyle-chat.mjs full` and
`PHONE=1 node scripts/diagnostics/freestyle-chat.mjs freestyle-chat`.
