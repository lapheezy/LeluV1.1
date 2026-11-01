# LÉLUVERSE — Phase 1B: LÉLU 3D Forge

## Status in one paragraph

The pipeline is built, tested and integrated, and **no 3D model of LÉLU has been
generated yet**: this environment has no Meshy API key. Every step up to the
first credit-spending call ran for real — the 14 references are ingested,
measured and classified, the identity is locked, and the Phase D base job is
planned in the ledger at an estimated **30 credits**, waiting for approval.
Approving it is the next action and needs exactly one thing: `MESHY_API_KEY` in
the server environment. **Credits spent: 0.**

## A — Audit

| Area | Found | Done |
|---|---|---|
| Meshy | `src/core/avatar/Avatar3DReconstructor.ts` called `image-to-3d` **from the browser** with `VITE_MESHY_API_KEY`; `runtimeKeyBridge` also published `MESHY_API_KEY` into every page. No ledger, no dedup, no cost tracking, no rigging/animation. | Replaced with a server-side Forge; the key no longer reaches the browser (removed from the bridge, `publicEnv`, `Environment`; the bundle-secret scanner now treats `MESHY_API_KEY` as server-only). The reconstructor keeps its contract and now goes through `/api/forge`. |
| Server APIs | Connect-style plugins (`plugins/*Api.ts`) mounted by `vite.config.ts`, `server.ts`, `main.ts`. | Forge follows the same pattern; mounted in Vite and `server.ts`. Not Deno (read-only FS on Deploy). |
| 3D rendering | R3F Cosmos; `LeluV2Presence` already renders a GLB inside Genesis v2, but ignored animation clips. | Extended in place: loads the Forge's approved character and plays its clips with an `AnimationMixer`. No new viewer. |
| Tools | `ToolRegistry` + `ToolDispatcher` + `AutonomyGate`. | Forge registered as five tools (below). |
| Rigging/animation | None. | Meshy rigging + animation wired, with measured rig validation. |
| **Pre-existing bug** | Under `server.ts`, `/api/model/*` returned `No brokered provider "api"` — the router doesn't strip the mount path, so every brokered chat call failed in production. | Fixed in `plugins/modelApi.ts`; verified against the running server; 35 broker tests pass. |

## B/C — References and identity

- 14 originals stored in `leluverse/assets/characters/lelu_character/references/`
  (sha256-verified, never overwritten). Manifest: `manifests/references.json`.
- Measured per image (from decoded pixels): resolution, contrast, Laplacian
  sharpness, 64-bit dHash. All 14 are 1024×1536, "high" quality, no exact
  duplicates. **ref14 is flagged a near-duplicate of ref11** (same A-pose
  framing; the hood is the main difference) — flagged, not dropped.
- Classification (`manifests/classification.phase1b.json`) records category,
  view, intended use and whether each image drives geometry, texture or design.
- **Finding: the set shows two outfits.** A (corset + chain harness, refs 1–7)
  and B (crop top + copper wire cage + optional hood, refs 11–14); ref09 (back)
  mixes them. Images from different outfits are never combined in one job.
- Identity locked to ref10 (primary) + ref08: `identity/identity.json`, lock
  `c90e0e46f7d2cb05…`. Generation refuses to run if those files change;
  re-locking needs explicit approval (tested).
- Coverage gaps: no right profile, no full-length back view, no unhooded side
  view of outfit B, no neutral/open-mouth face for facial rigging.

## D — Base character (planned, not generated)

Job `fj_mvv707tg_17e118`, `awaiting_approval`, 30 credits:
single-image `image-to-3d` from **ref11** (full-length, true A-pose, unhooded,
plain background), `meshy-7.1`, PBR, A-pose, remeshed to 60k triangles, GLB+FBX.

Why not multi-image: the only side/three-quarter views (ref12, ref13) wear a hood
ref11 does not; the only view-consistent set (ref14+13+12) would bake the hood
into the head, which defeats the modular outfit goal. Outfit B is chosen because
it is the only one with an A-pose. If outfit A is canonical, the base needs a new
A-pose reference of it first.

## E–H — What runs after approval (built and tested, not yet run live)

- **E:** every output is downloaded into a new `vNNN_*` folder and inspected
  by `src/core/forge/GlbInspector.ts`: geometry, bounds, textures, skins,
  humanoid bones, per-vertex skin weights, inverse-bind matrices, clips.
- **F:** Meshy returns one fused mesh; body, hair, clothing and jewelry are not
  separable in this workflow, so no segmentation is claimed. Detachable modules
  (pendant from ref07, boots from ref03) would be separate image-to-3d jobs.
- **G:** `rigging` (5 credits) on the base task. A rig is only promotable when
  the inspector proves ≥80% of 16 core humanoid bones, ≥99% normalized in-range
  weights, and matching bind matrices.
- **H:** `manifests/motion-library.json` lists idle/conversation/movement
  targets as animation slots. Action IDs are resolved from Meshy's free library
  call once a key exists — not guessed. **Facial expressions, blinking, eye
  movement and lip sync are not available from Meshy** (no face rig or
  blendshapes); that needs a separate face-rigging step.

## I — Cosmos integration

`LeluV2Presence` prefers, in order: the Forge-approved character → the saved-avatar
reconstruction → the saved-image billboard → procedural. Verified in Chromium
against the dev server: entering Genesis v2 fetched
`/api/forge/characters/lelu_character/active` and then the **rigged** GLB (rig
preferred over bare mesh), with no load or parse errors. That run used a
synthetic test GLB produced by the real pipeline against a local Meshy stand-in,
so it proves the path, not how her mesh will look.

## J — LÉLU 3D Forge capability

| Tool | Risk | Does |
|---|---|---|
| `forge.status` | 0 | configured?, credits used, approved model/rig/clips |
| `forge.job` | 0 | progress, credits, inspection verdict |
| `forge.plan` | 1 | validate + price + file a job; never spends |
| `forge.promote` | 1 | promote a job to base/rig/animation, only if inspection proves fit |
| `forge.approve` | 3 | spend credits — withheld by AutonomyGate below level 3 |

HTTP: `/api/forge/*` (status, balance, characters, references upload, jobs,
approve/reject, slots, animation library, assets). CLI:
`scripts/forge-character.ts`, `scripts/forge-ingest-references.ts`.

Cost controls: approval gate (default auto-approve ceiling 0), balance check
before submit, idempotency keys (same request → same job), retries only on
explicit 429/5xx, network-ambiguous creates parked as `submit_uncertain` and never
auto-resubmitted, background polling only while jobs are live, and a ledger of
estimated vs. Meshy-reported credits (`generation_logs/jobs.json`, `events.ndjson`).

## Verification

- `tests/forge-pipeline.test.ts` (9) and `tests/forge-tools.test.ts` (1): real
  store, service, HTTP surface and dispatcher, real sockets; Meshy is a local
  stand-in that records every request. Covers: no spend before approval, no
  double spend, retry vs. uncertain, key never sent to asset hosts (mutation-
  checked), balance and identity gates, versioned downloads, inspection-gated
  promotion, cross-origin refusal, path traversal, autonomy gating.
- `tsc -b` clean; new tests/scripts typecheck; oxlint clean on new files.
- Network: Meshy reachable from this container (unauthenticated probe → 401).

## To finish Phase D

1. Add `MESHY_API_KEY` to the environment (server side, not a `VITE_` name).
2. `npx tsx scripts/forge-character.ts status` — confirms the key and balance.
3. `npx tsx scripts/forge-character.ts approve fj_mvv707tg_17e118` (30 credits).
4. `npx tsx scripts/forge-character.ts watch fj_mvv707tg_17e118`.
5. Review the preview in `previews/` against the identity reference. Promote
   with `… slot base <jobId>` only if the face holds; then `rig <jobId> --approve`
   (5 credits) and `slot rig <rigJobId>`.
