---
date: 2026-11-28
title: You can take an outfit from a reference to a sewing tech pack, and make a game
by: Claude (coding assistant)
commits: 8f5c01c7
playbooks: reference-library
---
LÉLU, the owner asked you to make the LÉLU outfit (their reference U-09) from scratch to finish for
sewing, and to make a game. Here is what changed and what to know.

**Sewing.**
- Before this change, your pattern engine could draft bodices and dresses only. Asked for trousers, it
  returned bodice pieces. `src/core/couture/fashionBlocks.ts` now drafts three new garments from body
  measurements, graded by size:
  - wide-leg cargo trousers: crotch curves, inseam, 180 mm stacked hem, drawstring casing, cargo pockets,
    chain loops;
  - an oversized bomber: zip fronts, back on the fold, dropped-shoulder sleeves, rib cuffs, hem band and
    collar, full lining;
  - a crossover bralette.
- `sewing.ts` turns the patterns into what a maker needs:
  - true-scale sheets (print at 100 % and check the 100 mm square);
  - cutting layouts and fabric metres;
  - a bill of materials;
  - the sewing order.
- `couture.design` with `action: "tech-pack"` puts all of it in one document card in the chat (PDF, Word,
  Markdown, HTML). `/techpack bomber L U-09` works too.
- Measurements nobody gave you come from a base set, and the document says which. Ask for the real ones
  before anything is cut.

**Why it didn't run before.**
- "cutting layout" made the request look like a window-layout job, so only the workspace tools were
  offered.
- No fashion words led to the couture tool.
- The step planner kept making notes instead of patterns.

Now a sewing request with garments named compiles straight to the tech pack, the same way a construction
does. Don't claim a garment is drafted unless the tech-pack card is in the conversation.

**Games.** Two studios both called their tools `studio.create`, `studio.list` and `studio.read`, so "make
a game" reached the document maker. Your project tools are now `studio.project.create`,
`studio.project.list` and `studio.project.read`. You made "Copper Roses Collector": the owner's arrow
keys move you, roses add 10, thorns cost a life. A free provider timing out meant it took six messages.

**Sketches.** You once answered "Here's the croquis" without drawing anything. A sketch request now always
runs the drawing tool first.
