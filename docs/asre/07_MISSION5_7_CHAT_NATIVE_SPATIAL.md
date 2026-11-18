# Mission 5.7 — Spatial Studio as a Chat Universe capability

Date: 2026-11-18 · Branch `claude/mission5-lelu-asre-integration-mm6xau` · from `b046964b`

## The correction this records

Spatial Studio is no longer something you navigate to. The existing ASRE/NRE
services, character persistence, temporal history, Forge intake and renderers
are unchanged and unrebuilt; what changed is where they are **presented** and
who can summon them.

LÉLU's `asre.*` tools now raise a **surface** in the conversation that is open
when the tool runs. The surface imports the workspaces that already existed
(`SpatialViewer`, `NumericalWorkspace`, `CreationWorkspace`,
`RenderWorkspace`) rather than copying them, so the user-facing controls and
LÉLU's own runs are one implementation, not two. The Visual Studio's Spatial
mode remains as the direct, secondary entry point (§5 of the brief).

## What was built

| File | Role |
| --- | --- |
| `src/core/asre/SpatialSummon.ts` | the summon event, the per-conversation roster, local persistence, tab switching, dismissal |
| `src/app/scene/genesis/chat/SpatialSurface.tsx` | the in-thread surface: 3D / Numerical / Create / Render-export, evidence bar, job state |
| `src/app/scene/genesis/chat/universe/UniverseChatWindow.tsx` | renders the conversation's surfaces in the Chat Universe thread |
| `src/app/scene/genesis/GenesisChat.tsx` | the same, in the classic chat panel; registers the active conversation for tools |
| `src/core/asre/AsreTools.ts` | `reconstruct`, `observe`, `job`, `character`, `history restore` and `export` each summon their surface |

Design rules enforced by the code:

- **No surface without a summons.** `SpatialSurfaces` renders only what a tool
  or control put in the roster; nothing is pre-seeded.
- **Nothing is re-derived in the UI.** Evidence counts, triangles, cell counts
  and the GLB URL come from `/api/asre/jobs/<id>`; the surface shows the job's
  own numbers, including "the reconstruction failed: <reason>".
- **The conversation owns the object.** Surfaces are stored per conversation
  (`lelu.spatial.surfaces.v1`) and are still there after a reload.
- **Older surfaces fold** to one line so a thread does not keep several live
  WebGL canvases running.

## Evidence — 16/16 checks in the real app

`scripts/asre/m57-chat-surface.cjs` drives the actual application on the dev
server: it opens Chat Universe, continues without an account, opens the chat,
then runs **LÉLU's own tool pathway** — `registerAsreTools()` +
`dispatchToolCall(toolNameForModel(id))`, i.e. registry → dispatcher/gate →
executor → `/api/asre`. It is the layer below the model's choice of tool, not a
harness around the UI.

```
PASS Chat Universe opens without an account
PASS A conversation is open
PASS asre.reconstruct returns a job
PASS A spatial surface appeared in the conversation
PASS The reconstruction opens in the conversation (three.js) — 15,860 triangles
PASS Numerical planes render in the chat
PASS asre.character creates the persistent character
PASS asre.character edits the hair (new version)
PASS Character surfaces are in the same conversation
PASS asre.history lists the versions
PASS Restore mints a new version (history is never rewritten)
PASS Export goes through the Forge gate — runtime.glb, source.obj, source.stl…
PASS The same capabilities are registered as LÉLU's tools (7)
PASS A spatial prompt routes to them; an unrelated one does not
PASS Surfaces are stored per conversation (they survive a reopen)
PASS After a reload the conversation still has its surfaces — 3 surfaces
```

Screenshots (`artifacts/mission57/`): `00-home`, `01-chat-universe`,
`02-conversation`, `03-surface-summoned`, `04-reconstruction-in-chat`,
`05-numerical-in-chat`, `06-character-in-chat`, `07-restored-in-chat`,
`08-export-in-chat`, `09-after-reload`.

## Acceptance criteria (§6 of the brief)

| # | Criterion | State |
| --- | --- | --- |
| 1 | Open Chat Universe | VERIFIED — `01-chat-universe.png` |
| 2 | Ask LÉLU to reconstruct an image | PARTIALLY VERIFIED — the image reaches `asre.reconstruct` and the job runs; the *model's* wording was not driven (no provider key in this container) |
| 3 | See the real pipeline start | VERIFIED — job id, engine, steps, then 15,860 triangles |
| 4 | Inspect the 3D inside the conversation | VERIFIED — `04-reconstruction-in-chat.png` (three.js inside the chat window) |
| 5 | Numerical inspection without leaving chat | VERIFIED — `05-numerical-in-chat.png` (voxel plane, 64³ lattice, 5,164 boundary cells) |
| 6 | Ask LÉLU to modify a component | PARTIALLY VERIFIED — `asre.character` ran through the dispatcher; the model's sentence was not driven |
| 7 | See the change and its render | VERIFIED — `06-character-in-chat.png` (hair → afro, v0002, live 3D) |
| 8 | Inspect history and restore | VERIFIED — v0003 minted from v0001, nothing rewritten (`07`) |
| 9 | Export from the same experience | VERIFIED — Forge gate export, `.glb/.obj/.stl` (`08`) |
| 10 | LÉLU can invoke the same operations | VERIFIED for registration + routing + execution of all seven tools; the model's tool *choice* remains untested here |

## Limits, stated plainly

- **No provider key in this container**, so the turn where LÉLU decides on her
  own to call `asre_reconstruct` was not driven end to end. Everything below
  that decision is real: the dispatcher, the gate, the executor, the service.
- The container ships **no system fonts**, so Chromium painted layout with no
  glyphs in every screenshot. A fontconfig file and DejaVu (`~/m57fonts`) plus
  the two committed Inter faces under `scripts/asre/fixtures/fonts/` make the
  evidence readable; the walkthrough needs
  `FONTCONFIG_FILE=$HOME/m57fonts/etc/fonts.conf`.
- The **hair edit reused a cached mesh** (shared component cache warmed by a
  previous run): the version changed and rendered, but `rebuilt nothing`, so it
  is not an incremental-build measurement. Cold-cache incremental numbers are
  WP07's (`docs/asre/06_MISSION5_WP07_E2E.md`).
- Only the silhouette engine ran (no TripoSR toolchain here), as in WP07.
