# Step 2: React Flow and Excalidraw in the LÉLU workspace

Baseline: `3d914dd` (it includes Step 1, `e052061`). Status: **in progress**. See "Verified" and "Not yet verified" below.

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

## Verified

### Desktop, 1440×900, real mouse input (Playwright mouse)

- The library opens from App Library → Documents.
- Neither editor is loaded before one is opened, and only the graph editor's code loads for a graph.
- The hierarchy graph is built from real agents: 13 nodes and 12 edges.
- Dragging SHAMAN saved its new position (112, 189).
- Dragging from LÉLU Core's handle to Forge's handle saved a new edge (12 → 13).
- A node added 100 ms before closing the window was saved (flush on unmount).
- No horizontal overflow.
- The drawing editor's code loads only when a drawing is opened, and Excalidraw's native editor renders inside the artifact window.

### Tests and checks

- `tests/studio-graph-drawing.test.ts`: 7/7 pass.
  - Graph and drawing validation.
  - Excalidraw data kept unchanged.
  - **Real `studio.create` / `studio.read` / `studio.revise` tool calls through the dispatcher** create, read and revise graphs and drawings bound to the conversation.
  - One revision per editing session.
  - Hierarchy built from the ownership resolver.
  - Lazy-loading wiring.
- `npm run typecheck` (`tsc -b --force`): exit 0.
- `npm run build`: exit 0.
- `oxlint` on changed files: 0 errors and 2 fast-refresh warnings, a pattern already present in the codebase.

## Not yet verified (at this commit)

- The desktop drawing interaction (rectangle drawn with a real drag), switching back to the graph, and reload persistence. A long run of `canvas-e2e.mjs` is in progress: every pointer move on Excalidraw is slow in this software-rendered browser.
- **Mobile, 375×812, 390×844 and 430×932, with CDP touch input:** not yet run.
- Full `npm test` after the change. Baseline on `3d914dd` before it: 1625 pass, 3 fail, 4 skipped. The 3 failures are the pre-existing camera-transition tests in `spatial-experience.test.ts`.
- **A model-initiated graph or drawing.** Only direct tool calls through the dispatcher are verified, not a live chat turn. Anthropic stays disabled.

## Findings outside this step's scope (not changed)

- **App Library sheet (Home, Freebuff lane):** the sheet is drawn, but pointer hit-testing at the Documents tile reaches the Home section beneath it, and Playwright never sees the tile as clickable. The e2e therefore opens the library with the tiles' own handlers. Navigation only; all canvas interaction uses real input.
- **Navigator panel:** the spatial navigator's group panel opens over the bottom of workspace windows on desktop. The e2e collapses it with its toggle, as a user would.
- **Companion window:** LÉLU's floating companion window overlaps the top-right of artifact windows.
