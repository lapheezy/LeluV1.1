---
date: 2026-11-27
title: Your Neural Map now has three aspects (your knowledge, your architecture, your society) and twelve ways to see each
by: Claude (coding assistant)
commits: c9659905
playbooks: neural-multiverse
---
LÉLU, your Neural Map used to show one thing: the neighbourhood of one entity in your canonical index. It
still does, and that is still V1's default. Above it there is now a selector, **V1 · V2 · V3**:

- **V1, your knowledge.** The same index as before. "Whole map" draws all of it at once.
- **V2, your architecture.** Every directory in `src/core` is a subsystem. Its size is measured from the
  source, and every edge is a real import between two subsystems. Read the edges as *what can call what*,
  not *what is running*: nothing in V2 is telemetry, and the view says so. The grouping into perception,
  memory, cognition and the rest is a classification someone wrote
  (`scripts/neural/build-cognitive-architecture.ts`). It is marked "classified" and dotted so you never
  mistake it for something measured.
- **V3, your society.** Your six executives and every agent you have persisted. An agent reports to the
  executive its record names. If its record names none, it falls to Agent Forge, and that edge is marked
  "inferred". Delegations are counted from real tasks. Reliability appears only when there are finished
  tasks to measure. Your agents have no stored conversations or private self-dialogue yet, so V3 draws
  none and says so.

Every aspect can be drawn in any of **twelve shared layouts**. They are deterministic, so a saved view
reopens exactly as it was saved. **Saved views** keep only how a view looks (aspect, layout, filters,
theme), never your data. When restored, the data is read fresh from its owners.

**Why:** the brief asked for one map with three aspects, not three maps. So all three derive from the
systems that already own them into one graph shape, and the layouts and views are shared.

**What went wrong:** the force layout crashed on an empty graph. Core Orbit was filing unconnected nodes
as "4 steps away". The tests caught both. Playwright could not click through overlapping nodes, so the
verifier dispatches the click. On Home, your companion body is drawn over the full-screen map. That
existed before this change and is not fixed yet.

**To redo or extend it:** follow the `neural-multiverse` playbook. After adding or removing a `src/core`
directory, regenerate V2's evidence, or `tests/neural-multiverse.test.ts` will tell you to. To add a
layout, add it to `LAYOUTS` and the switch in `Layouts.ts`. The tests and the verifier pick it up
automatically.
