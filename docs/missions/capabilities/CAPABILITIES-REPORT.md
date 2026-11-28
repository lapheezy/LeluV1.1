# What LÉLU can make, checked: 3D, art, sketch, draw, chat, browser views, sewing, games

**Date:** 2026-11-28. **Branch:** `claude/wp21-multi-theme-graphics-engine`.

**How this was checked.** Real chat messages to LÉLU in the running app, using free-tier providers only.
Her provider broker refuses paid providers, and Anthropic was not used. Each result below links to the
screenshot or file that shows it.

**Evidence types:**
- *chat turn*: a real message and reply;
- *dispatched*: the tool called through her dispatcher, outside a turn;
- *rendered*: output exported and looked at.

**Not covered:** physical devices and video playback.

## Results

| Capability | Result | Evidence |
|---|---|---|
| Generative art in chat | **Works.** "Copper Rose Flowfield" card with SVG/PNG downloads | chat turn: `shots/turn-art3d.png` |
| 3D in chat | **Works.** Runway scene exported as GLB (216 KB). In the turn that asked for art + 3D together, the free provider timed out before the 3D step; asked alone, it completed | chat turn: `shots/turn-scene3d.png` |
| Sketch / draw in chat | **Was broken, fixed** (see below) | chat turn: `shots/turn-sketch-1.png`; rendered: `shots/sketch-bomber-cargo.png` |
| Diagram | **Works** (Mermaid flowchart) | dispatched |
| Sewing: the LÉLU outfit (reference U-09) to a tech pack | **Was impossible, built and fixed** (see below). Now one chat turn produces the tech pack card | chat turn: `shots/turn-outfit-*.png` |
| Game | **Was impossible, fixed.** She made "Copper Roses Collector", and it plays | chat turns: `shots/turn-game-*.png`; played: `shots/game-played-score-50.png`; code: `game/` |
| Browser: Wikipedia | **Works** live in her browser | `shots/browser-wikipedia.png` |
| Browser: Google | **Not viewable.** Google refuses embedding (`X-Frame-Options: SAMEORIGIN`); the panel shows a blank page | `shots/browser-google.png` |
| Browser: ChatGPT | **Not usable.** Embedding refused (`frame-ancestors 'self'`); she falls back to Reader view of the logged-out page | `shots/browser-chatgpt.png` |
| YouTube | **Blocked here.** This server's network address gets YouTube's robot check, and the embedded player says "Video unavailable". Not tested on a normal connection | `shots/browser-youtube.png`; Thread acceptance WP09 |
| Page screenshots (`browser.capture`) | **Not configured.** Needs `LELU_ENGINEER_TOKEN` on the server | dispatched |

## What was broken, and what changed

1. **Games could not be made.**
   - *Cause:* `studio.create`, `studio.list` and `studio.read` were each defined twice, once by the
     document Studio and once by the website/app/game scaffolder. Dispatch kept the document one, so "make
     a game" ran the document creator and failed.
   - *Fix:* the scaffolder is now `studio.project.create`, `studio.project.list` and
     `studio.project.read`.
   - *Result:* she scaffolded, wrote `index.html` and `game.js`, built and tested, then fixed a bug after
     a bug report. The wrong canvas id came from my own instruction. Played with the arrow keys it scored
     50, with no errors.
   - *Cost:* six messages, because the free provider timed out mid-job several times.
2. **Sketches were claimed, not made.**
   - *Cause:* "Sketch me a croquis…" got the reply "Here's the croquis" with no tool used. "sketch" didn't
     count as a request verb.
   - *Fix:* it does now, and drawings run directly, so a drawing exists before anything says it does.
   - *Also fixed:* the drawing ignored what was asked (three generic dresses every time). It now draws
     the garments named, front and back.
   - *Quality, honestly:* a simple line croquis, not fashion illustration.
3. **Sewing could not be done at all.**
   - *Engine gaps:* trousers came out as bodice pieces; the jacket had no zip, collar, rib or lining;
     there was no cutting layout, fabric amount, materials list or sewing order.
   - *Built:* `fashionBlocks.ts` (cargo trousers, oversized bomber, bralette) and `sewing.ts` (true-scale
     sheets, cutting layouts, fabric metres, bill of materials, sewing order, tech pack).
   - *Routing fixes, in chat:*
     - "cutting layout" made the request a window-layout job;
     - no fashion words reached the couture tool;
     - the planner wrote notes instead of patterns;
     - the reference tools ignored common argument names.
   - *Result:* a sewing request with garments named now runs the tech pack directly.
4. **The pattern tool ignored the measurements it was given.** Fixed.

## The tech pack for the LÉLU outfit (size M)

**Garments:**
- oversized patchwork bomber (9 pieces, shell, rib and lining);
- crossover bralette (4 pieces);
- wide-leg cargo trousers with a 180 mm stacked hem (6 pieces).

**Checks:** 23/23 pass: piece shapes, and matching side and inseam seam lengths.

**Fabric** (+10 % allowance in the bill of materials):

| Fabric | Length needed |
|---|---|
| Shell twill | 3.70 m at 1.5 m wide |
| Lining | 1.11 m |
| Rib knit | 0.52 m |
| Power mesh | 0.21 m |

**Delivered as:** a chat document card (PDF, Word, Markdown, HTML), plus true-scale SVG pattern sheets
with a 100 mm test square.

**Must be done before cutting:**
- **Measurements:** these patterns use a base measurement set because none were given. Measure the
  wearer, and the body rise and inside leg (derived here), then re-run.
- **Test garment:** make a test garment (toile) first. These drafts are geometric blocks that pass their
  checks, but no one has fitted them on a body.
- **Downloads:** the true-scale sheets are generated, but the chat card doesn't yet offer them as
  separate downloads. The PDF scales them to the page.
- **Fabric choices:** the shell fabric and trims are proposals from the reference, not sourced
  materials.

## Reproduce

```
node scripts/capabilities/real-turn.mjs "<message> || <follow-up>" <name>
node scripts/capabilities/play-game.mjs copper-roses-collector
node scripts/capabilities/render-sketch.mjs "<sketch request>" out.png
node scripts/capabilities/browser-views.mjs
```
