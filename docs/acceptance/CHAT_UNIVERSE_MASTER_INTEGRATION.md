# Chat Universe — master integration and environment upgrade

Branch `claude/chat-universe-evolution-skidcz` (this session's integration branch; no
source branch was modified, nothing was force-pushed, nothing merged to `main`).

## 1. Freebuff recovery

| Work | SHA | Where it was | Result |
|---|---|---|---|
| Creative Kit | `dd62487` | `claude/lelu-open-source-expansion-qz626l` (11 commits) | **Merged** `58552c4` |
| Inline chat artifacts | `520a5d4` | `integration/lelu-four-workforce-consolidation` | **Merged** `a1706f3` |
| Browser reading + inline 3D | `1ba90af` | same | **Merged** `a1706f3` |
| Capability expansion | `4b272ce` | same + `freebuff/capability-expansion` | **Merged** `a1706f3` |
| Engine view in conversation | `1632fe2` (newer, unlisted) | same | **Merged** `a1706f3` |
| VoxCPM2 voice identity | `de4a265`, `e1ee9ae`, `157d9df` | `freebuff/44c122e…` | **Reconciled, not mounted** `5e938ee` — a second VoxCPM route beside the newer canonical one (`plugins/voxApi.ts` + `services/voxcpm`); the phone-header patch is superseded by the Workspace Steward. Its voice-cloning consent switch is not carried over and needs a decision. |
| Mobile Sovereign Runtime | `c4194b3` | **not on GitHub** (no branch, tag, PR ref or search hit) | **BLOCKED** — must be pushed from where it was made |
| Mobile entry points | `d620ac5` | **not on GitHub** | **BLOCKED** |
| Mission 14 cognitive continuity | `1227738`, `6218b04` | **not on GitHub** | **BLOCKED** |

Also checked: every other remote branch and PR head. Jules/Codelazr were already
reconciled (Mission 10.1); `main`, `master-integration`, `freebuff/1fb0099…` are
unrelated histories whose sources are all present (only the retired `MultiChatTabs.tsx`
differs); `companionCaption.ts` was deliberately removed (`97f161a`).

Merge regression found and fixed: `StudioArtifactCards` imported Excalidraw eagerly
(broke `genesis-interface` test; loaded Excalidraw with every chat) → lazy.

What exists of the sovereign runtime in the tree: `LocalInferenceProvider` (an honest
slot that probes for transformers.js / WebLLM and reports "not installed"; neither is a
dependency), a service worker, IndexedDB in several stores. No Storage Governor, ONNX
provisioning, offline gating, mission ledger or cognitive pulse exists anywhere.

## 2. Chat Universe environments

14 environments (`src/core/interface/Environments.ts`), each with a purpose, the work
it hosts, its layout and where it runs. All create/revise/export through the one
Studio store (versions, compare, restore, verified exporters) and record what they did
in the conversation with the artifact card.

| Environment | Real capability behind it |
|---|---|
| Chat, Cinematic, Gallery, Present, Board, 3D (ideas) | from the previous mission |
| Research | `/research` (Wikipedia, Crossref, arXiv), OpenAlex/Wikipedia queries, your conversation history search; sources with provenance (papers via DOI); open in browser, add to board |
| Document | report = conversation substance + every research brief + renumbered sources; edit, simplify, versions; DOCX/PDF/MD/HTML |
| Diagram | Mermaid source ⇄ live render, from conversation, versions; SVG/PNG/MMD |
| Data | tables → charts/workbooks; live keyless data; findings computed from the chart's numbers; findings → presentation |
| Code | code from the conversation; edit; HTML/JS run sandboxed; download |
| Film | storyboard → WebM rendered on device → play |
| Voice | read aloud (device voices), talk to LÉLU |
| Workbench | chat + browser + works, tiled by the steward |
| 3D (scenes) | presets, add/recolour/remove components, GLB/glTF/STL/OBJ, reopen the exported file |
| Gallery (visuals) | compositions, restyle, compare; sketch and collection commands |
| Present | plays the built deck; PPTX/PDF |

LÉLU stages herself after a turn (recommender over what was asked and made; chip with
reason, back, off switch). "turn this into a report / deck / diagram / chart / film",
"open the X workspace", "put the browser beside the chat", "tile my windows" run
through `workspace.transform|stage|arrange` with 0 model calls.

## 3. Workflow results (real app, Chromium)

| # | Workflow | Desktop | iPhone 15 Pro (emulated) |
|---|---|---|---|
| 1 | Research → sources → browser → board → diagram → report DOCX/PDF | VERIFIED | VERIFIED |
| 2 | Compose → restyle → compare → reload → PNG | VERIFIED | VERIFIED |
| 3 | 3D build → change → GLB/STL → reopen (30,272 triangles both) | VERIFIED | VERIFIED |
| 4 | USGS data → chart → findings → presentation → PPTX | VERIFIED | VERIFIED |
| 5 | Film → WebM (VP9, 12 s, EBML ✓, plays) | VERIFIED (345–390 s encode, GPU-less sandbox) | NOT TESTED (same code path) |
| 6 | Environments keep work; LÉLU arranges windows from words; reload restores | VERIFIED | VERIFIED |
| 7 | Mobile | — | VERIFIED in emulation; **NOT TESTED on Safari/iPhone hardware** |

Bugs the workflows exposed and that were fixed: auto-staging never fired for commands;
split ignored the named windows; the overflow watcher counted scrollable tab strips
(browser could only show alone); report was a transcript; commands polluted boards;
Present ignored the built deck; a fake trend over an unfinished day; squashed 3D view;
a maximised window could trap the chat on a phone; browser hand-off lost to mount timing.

## 4. Gate

- Tests: **2203 / 2197 pass / 0 fail / 6 skipped** (`npm test`).
- Typecheck `tsc -b --force`: clean. Production build: passes.
- Lint: new modules clean; repository total 174 warnings / 1 error (pre-existing error;
  warnings rose from merged Freebuff code).
- `verify:bundle`: PASS. `verify-bundle-secrets`: 1 check fails on Excalidraw's own
  embedded RSA *public* key — same chunk hash in the starting commit's build (pre-existing).

## 5. Measurements

- Startup bundle `index`: 376.81 KB (376.49 KB at the starting commit). Environments are
  one lazy 33 KB chunk (10.4 KB gz); Board 7 KB, 3D 7.5 KB, Excalidraw separate.
- Steward: 38.5 µs per 8-window desktop plan, 3 µs on a phone; intent parse 1.8 µs.
- Production, iPhone-size emulation: home 2.2–2.9 s, chat window 0.34–0.42 s,
  environment switches 0.5–1.5 s, 30–32 fps idle, JS heap ~418 MB.
- Desktop timings in this sandbox are dominated by CPU-emulated WebGL (idle 1 fps, equal
  at the starting commit) and are not representative of hardware.
- Film encode: 345–390 s here (measured encoder; stepped to 480×270).

## 6. Not done / limits

- Sovereign Runtime, mobile entry points, Mission 14: BLOCKED (never pushed).
- Local inference, offline model storage: NOT TESTED (no runtime installed in the tree).
- Server page reader needs a signed-in deployment (Supabase); refused honestly here.
- Many publishers refuse embedding; the browser offers Reader/Open.
- iPhone Safari on hardware: NOT TESTED.
