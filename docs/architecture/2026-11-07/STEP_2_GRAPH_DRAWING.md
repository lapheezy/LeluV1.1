# Step 2: React Flow and Excalidraw in the LÉLU workspace

Baseline: `3d914dd` (it includes Step 1, `e052061`). Status: **complete, except one failing touch check** (see Results).

## Architecture decision

Graphs and drawings are **two new Creation Studio artifact kinds**, `graph` and `drawing`. They are not a new store, studio or routing system. As Studio artifacts they reuse the existing:

- stable ids;
- revision history (compare and restore);
- conversation binding;
- chat artifact cards;
- `artifact:<id>` windows in the existing module host and layout;
- `studio.create`, `studio.revise` and `studio.read` tools.

React Flow and Excalidraw are the **editors** inside the existing artifact window:

| Kind | Editor | Purpose |
|---|---|---|
| `graph` | React Flow | Structured, connected, node-based systems. Nested groups via `group` → `parentId`. `ref` points at a LÉLU entity. |
| `drawing` | Excalidraw | Freeform, visual, spatial thinking. Excalidraw's native scene data is stored unchanged. Its native menu saves/loads `.excalidraw` files and exports PNG/SVG. |

Both kinds support `links` to a world, conversation, project or artifact id.

Alternatives rejected:

- **Workspace views (`WorkspaceEngine`):** not persisted across reloads.
- **A new KvStore record:** that would be a second artifact store.

### Persistence

- Hand edits save through the new `StudioStore.saveEdit`: one "edited" revision per editing session (10 minutes). A LÉLU revision in between starts a new session.
- Edits are debounced (600 ms for graphs, 800 ms for drawings). A pending save is flushed when the editor unmounts and on `pagehide`.
- A `localStorage` quota failure is no longer silent: the editor shows "Not saved to this device".

### Seed data

"Agent hierarchy" builds a graph from the real agents: LÉLU Core → SHAMAN → executives (`ExecutiveOwnership.executiveOf`) → agents.

## Dependencies

| Package | Version | Licence | Peers |
|---|---|---|---|
| `@xyflow/react` (+ `@xyflow/system`) | 12.12.1 | MIT | react ≥17 (we use 19.2.7) |
| `@excalidraw/excalidraw` | 0.18.1 | MIT | react ^17, ^18 or ^19 |

The install added 88 packages, all under permissive licences:

- 72 MIT, 9 Apache-2.0 and 3 ISC;
- `fractional-indexing` (CC0), `pako` (MIT AND Zlib), `jszip` (MIT OR GPL-3.0, used under MIT) and `fuzzy` (MIT text licence).

## Bundle impact (`vite build`, before = `3d914dd`)

| | Before | After |
|---|---|---|
| Initial page (`index.html` assets) | 5932 KB (1884 KB gz) | 5946 KB (1889 KB gz), **+14 KB** |
| `GraphEditor` chunk (React Flow) | — | 129 KB (41 KB gz), lazy |
| `DrawingEditor` chunk + its dependency chunk (Excalidraw) | — | 1036 KB + 1778 KB (321 + 723 KB gz), lazy |

- Neither editor is referenced by `index.html`.
- The 1.78 MB chunk is imported only by `DrawingEditor` and Excalidraw's own font-subset workers.
- Measured at runtime: opening a graph loaded only `GraphEditor`, `@xyflow_react` and its CSS. Excalidraw loaded only when a drawing was opened.

## Dev-server fix (`vite.config.ts`)

`optimizeDeps.include: ["@xyflow/react", "@excalidraw/excalidraw"]`.

Without it, Vite discovered the libraries only when an editor first opened, re-bundled mid-session and reloaded. That left two React copies on the page and crashed it with `Cannot read properties of null (reading 'useState')`. The fix affects development only.

## Results: live runs (`canvas-e2e.mjs`, 15 checks per viewport)

| Viewport | Input | Result |
|---|---|---|
| 1440×900 | real mouse (Playwright) | **15/15** |
| 390×844 | real touch (CDP `Input.dispatchTouchEvent`) | 14/15 |
| 375×812 | real touch | 14/15 |
| 430×932 | real touch | 14/15 |

Logs are in `evidence/step2-graph-drawing/run-*.log` and the reports in `*-report.json`. These pass on every viewport:

- the library opens;
- neither editor loads before one is opened, and only the graph editor's code loads for a graph;
- the hierarchy graph comes from real agents (13 nodes, 12 edges);
- **connecting two nodes by dragging handle to handle** saves a new edge (12 → 13);
- a node added just before closing is saved (flush on unmount);
- Excalidraw's code loads only when a drawing is opened;
- **drawing a rectangle** with the rectangle tool, by a real drag, saves an element (revision 2);
- **switching drawing → graph** keeps all edits;
- **reload** brings back the graph (14 nodes) and the drawing (1 element);
- chat stays reachable;
- no horizontal overflow;
- no page errors.

**The one failing check: dragging a node by touch (all three phones).** On desktop, a mouse drag moves the node and saves its position.

`touch-probe.mjs` shows, on phones:

- the touch lands on the node (`react-flow__node … nopan`);
- touch and pointer events arrive (pointerdown → touchstart → pointermove/touchmove);
- the canvas does not pan;
- but the node does not move on screen, even zoomed in 3× (node 71×21 px).

So React Flow's node drag does not engage under this touch emulation, while its connection drag does (a different code path). **Unverified:** whether a physical iPhone behaves the same. This needs a device test before it is called a bug or an emulation artefact. Not fixed here.

## Tests and checks (exact results)

- `tests/studio-graph-drawing.test.ts`: **7/7 pass**.
  - Real `studio.create` / `studio.read` / `studio.revise` tool calls through the dispatcher create, read and revise graphs and drawings bound to the conversation.
  - One revision per editing session.
  - Hierarchy built from the ownership resolver.
  - Lazy-loading wiring.
- **Full `npm test`:**

  | | Pass | Fail | Skipped |
  |---|---|---|---|
  | After | 1714 | 3 | 4 |
  | Baseline `3d914dd` | 1625 | 3 | 4 |

  The 3 failures are the same tests by name in both runs: the camera-transition tests in `spatial-experience.test.ts` (`requestAnimationFrame` in Node). There are no new failures. The higher pass count is the new tests plus Freebuff's tests that arrived with the rebase.
- `npm run typecheck` (`tsc -b --force`): exit 0.
- `npm run build`: exit 0.
- `oxlint` on changed files: 0 errors and 2 fast-refresh warnings, a pattern already present in the codebase.

## Not verified

- **A model-initiated graph or drawing in a live chat turn.** Tool calls through the dispatcher are verified, but no model was called. Anthropic stays disabled.
- Physical iPhone or Safari: all phone results are Chromium emulation.
- Linking UI: `links` is stored and displayed, but there is no picker for choosing a world, conversation or project yet.

## Usage (this step)

- AI calls: **0**. No provider or token usage.
- Browser runs: about 20, including probes and 4 full viewport runs of about 15 minutes each in this software-rendered browser.
- Full test runs: 2 (baseline and after).
- Typecheck runs: about 6. Production builds: 2 (baseline and after).
- One `bun add`: 88 packages.
- Account-level usage meter: not accessible from this session.

## Findings outside this step's scope (not changed)

- **Studio library tile:** the module layout gave the Creation Studio library a small tile that clips its artifact cards. The e2e expands the window with its own Expand control, as a user would.
- **App Library sheet (Home, Freebuff lane):** the sheet is drawn, but pointer hit-testing at the Documents tile reaches the Home section beneath it, and Playwright never sees the tile as clickable. The e2e therefore opens the library with the tiles' own handlers. Navigation only; all canvas interaction uses real input.
- **Navigator panel:** the spatial navigator's group panel opens over the bottom of workspace windows on desktop. The e2e collapses it with its toggle, as a user would.
- **Companion window:** LÉLU's floating companion window overlaps the top-right of artifact windows.
