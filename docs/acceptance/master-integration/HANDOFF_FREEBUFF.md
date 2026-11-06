# LÉLU V1.1 — handoff to Freebuff

Branch: `claude/master-integration` (pushed). Everything below is in that branch.
Evidence images: `docs/acceptance/master-integration/evidence/`.

## 1. State in one paragraph

Session 1, cognition (incl. the free Kimi K3.1 Pro coding route, `b81d159`) and
interface-control are merged. Anthropic is opt-in on the server; autonomy is
server-authoritative. New in this stretch: the **Creation Studio** (real DOCX /
PPTX / XLSX / PDF / HTML / MD / TXT / RTF / CSV files, each re-opened and checked
after writing) wired into chat and Cosmos, and the **Atelier** core (design
directions, BOM, mass/cost, interference, evidence levels, STL / OBJ / glTF /
DXF / SVG drawings, production documents), also wired into the tools and a
Cosmos window. **Not done:** multi-browser with private contexts, Demos A–G, and
an end-to-end *live chat* run that makes a file (blocked — see §4).

## 2. What is verified, and how

| Area | Verification | Result |
|---|---|---|
| Chat turn (Universe composer → Fireworks → reply) | Playwright, live dev server | works — `evidence/01-chat-universe-turn.png` |
| Studio writers + reader + verifier | `tests/creation-studio.test.ts` | 25/25 |
| Studio tools through the real dispatcher | `tests/creation-studio-tools.test.ts` | 5/5 |
| Independent check of the files | `scripts/verify-studio-exports.ts` (python-docx, python-pptx, openpyxl, LibreOffice recalculation + render) | all checks pass — `evidence/02`, `03` |
| LÉLU's own PDF writer | rendered with pdftoppm, inspected | `evidence/04`, `04b` (two layout bugs found and fixed) |
| Atelier core (directions, cosmetic-variant refusal, BOM, interference, propagation, evidence level, safety flags, STEP refused) | `tests/atelier.test.ts` | 9/9 |
| Atelier tools through the dispatcher (+ Studio documents) | `tests/atelier-tools.test.ts` | 3/3 |
| Atelier files read back from bytes | 16/16 files for two directions | `evidence/05`, `06`, `06b` (3 drawing bugs found and fixed) |
| Studio window in Cosmos (open, export in worker, verified file, download button) | Playwright, live dev server, artifact created directly (not via chat) | `evidence/07-studio-window.png` |
| Typecheck | `npx tsc -b` | clean |
| Full suite (before Atelier) | 116 files, per-file runner | 1248 pass, 1 fail (historical `genesis-interface`: Node cannot import `.css`; same on Session 1's head) |
| Affected suites after the last changes | cosmos-chat-experience, chat-universe-activity, broker-consolidation, no-duplicate-systems, permission-contract, workspace-layout | all pass |

Run the checks:

```sh
npx tsc -b
for f in creation-studio creation-studio-tools atelier atelier-tools; do
  node node_modules/.bin/tsx --tsconfig tsconfig.app.json --test --test-force-exit tests/$f.test.ts; done
npx tsx --tsconfig tsconfig.app.json scripts/verify-studio-exports.ts /tmp/studio-check   # needs LibreOffice + python-docx/pptx/openpyxl
```

Unset `ANTHROPIC_BASE_URL` in the shell before tests (a stray value breaks broker tests).

## 3. Where the new code is

| Path | What |
|---|---|
| `src/core/studio/StudioTypes.ts` | Document / deck / workbook specs, formats per kind |
| `src/core/studio/writers/*` | docx (native Word charts), pptxgenjs (title placeholders, native charts, notes), exceljs + native Excel chart parts with cached values, pdf-lib (vector tables/charts), text writers |
| `src/core/studio/StudioReader.ts` | Reads files from their own parts (fflate unzip, PDF content streams); rebuilds a spec for reopening |
| `src/core/studio/StudioExport.ts` | write → re-open → check → sha256; only passing files are “exported” |
| `src/core/studio/StudioStore.ts` | Revisions never overwritten, restore = new revision, compare, recorded exports, imports keep original bytes |
| `src/core/studio/StudioExportClient.ts`, `studioExport.worker.ts` | Exports run in a Web Worker in the browser (main-thread export of a deck took 106 s while the scene rendered; now ~2–3 s) |
| `src/core/studio/StudioTools.ts` | `studio.create/revise/export/read/list/compare/restore/open` |
| `src/app/scene/genesis/studio/*` | Library panel (`creation`), `artifact:<id>` window, chat cards on replies |
| `src/core/atelier/*` | Types, geometry (meshes, mass, cost, interference, similarity), file writers, read-back, store (versions, propagation, fork/combine), package (BOM workbook, dossier, review deck), tools `atelier.*` |
| `src/app/scene/genesis/atelier/*` | `atelier:<id>` window (directions side by side, drawings, 3D view of the exported glTF, BOM, files) |
| `src/core/agent/AgentEvents.ts`, `src/core/multichat/TurnActivity.ts` | `studio_artifact` event → `activity.artifacts` → cards on the reply |
| `GenesisCore.floatsAboveChat` | artifact/atelier windows stack above the chat panel like chat windows |

## 4. Open problem — read this first

**A live chat turn freezes the page in headless Chromium** (software WebGL),
so no end-to-end “ask in chat → file appears on the reply” screenshot exists yet.

Diagnosis so far (CPU profile + instrumented `texSubImage2D`):

1. During a turn a **second avatar canvas** (`lelu-companion-character`, 200×304)
   mounts and parses its own copy of the model, uploading **4096² textures**
   again — 3 uploads = **31.7 s** under SwiftShader.
2. Fixes applied, **not yet re-measured** (the measuring run was interrupted):
   - `avatar/LeluCharacter3D.tsx` — `FrameCap` follows `SceneRenderBudget`
     (paused → no frames, reduced → lower rate). This halved texture time.
   - `avatar/LeluBody.tsx` — `fitTexturesTo()` downscales the *private copy*
     used by an overlapping second view to its canvas (512–2048 px) before its
     first frame. The first view's shared textures are untouched.
3. Next step: run `scratchpad`-style probe again (instrument
   `WebGLRenderingContext.prototype.texSubImage2D` via `addInitScript`, send
   a message, wait 30 s, read the per-canvas totals). If 4096² uploads are gone,
   re-run the live PowerPoint prompt and screenshot the reply card, the studio
   window and the downloaded file (verify it with python-pptx).
   Also consider why a second avatar view mounts during a turn at all —
   the code comment in `LeluBody.tsx` says only one should be mounted.

On real GPUs this is much cheaper, but the duplicate 4K upload is real waste
on phones too.

## 5. Remaining work (directive sections)

- **Section 6 — multi-browser + private contexts.** Not started. Plan: server
  plugin `plugins/browserSessionsApi.ts` using Playwright (pattern already in
  `plugins/selfViewApi.ts`): named sessions = separate `BrowserContext`s, tabs,
  history, downloads; private sessions = fresh context, never persisted,
  destroyed on request with cleanup; every navigation and sub-request checked
  with `isBlockedHost` from `plugins/browseApi.ts`; gated by
  `verifyRequestIdentity` (dev may opt in to anonymous loopback via env);
  consequential actions (submit, buy, follow, post) need `confirm:true`.
  Tools `browser.session.*`, a Cosmos window per session with screenshots.
  Be explicit that private ≠ anonymous, and document iPhone limits.
- **Demos A–G (Section 11)** — none run end-to-end yet. Demo A (product
  development) is the closest: Atelier + Studio cover steps 3–9 and 12; it needs
  the live chat path (§4) and real research sources.
- **Atelier UI** — the window is written and typechecks but has **not been
  screenshotted in the browser** yet (3D view, tabs, BOM).
- **Studio window polish** — the export-row layout fix (checks moved under the
  buttons) is committed but not re-screenshotted.
- **Security items that need the owner:** key rotation (see
  `SECURITY_KEY_ROTATION.md`); a separate Supabase test project.
- Re-run the **full suite** (now ~120 files) and record the totals.

## 6. Rules carried over from the owner

Fireworks first; Anthropic only by explicit server opt-in. No paid resources,
no production data as test data, no credentials in code/logs/screenshots.
Do not weaken tests. Commit/push only with the owner's authorization (the owner
authorised this commit). Visual proof at every step: send the screenshot, not
just a path.
