# Mission 1 — Repository audit

TEMPORAL Studio / NRE / ASRE, first flagship integration LÉLU V1.1.

**Branch:** `temporal-studio/asre-core`, created at `3f8094e` from
`freebuff/dabd4582007a8c6e487b4757`. The working branch ref is untouched at the
same commit; all work below happens on the new branch. No production branch was
touched, nothing pushed, nothing committed.

**Method:** every claim in this document was produced by running a command or
reading a file in this worktree. Nothing is inferred from filenames.

---

## 1. Build and regression baseline (measured, not assumed)

| check | command | result |
|---|---|---|
| dependency install | `npm ci --no-audit --no-fund` | **fails** — ERESOLVE peer conflict (`@excalidraw/excalidraw` → `@radix-ui/react-tabs@1.0.2` wants React ≤18, project has 19.2.8) |
| dependency install (correct tool) | `bun install --frozen-lockfile` | **succeeds**, 957 packages, 2.83 s — the repo ships `bun.lock` (lockfileVersion 1) |
| typecheck | `npx tsc -b --force` | **exit 0** |
| test inventory | `ls tests \| wc -l` | **236** test files |
| 3D/forge subset | `tsx --test` on the 13 files mentioning GlbInspector / ForgeClient / Avatar3DReconstructor / LeluModelSource / meshy | **80 tests, 80 pass, 0 fail**, 13.6 s |

**Reproduce the baseline:**

```bash
bun install --frozen-lockfile
npx tsc -b --force
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-concurrency=1 tests/forge*.test.ts tests/spend-policy.test.ts \
  tests/creative-kit.test.ts tests/world-*.test.ts tests/studio-unified-model.test.ts
```

The full suite script (`package.json`) runs all 236 files and excludes
`autonomy-end-to-end.test.ts`; it was **not** run to completion here — only the
3D/forge subset was, and that is what the 80/80 refers to.

---

## 2. The twelve named targets — all exist, contents verified

| file | lines | what it actually is |
|---|---|---|
| `src/core/avatar/Avatar3DReconstructor.ts` | 381 | Singleton: reference image → Forge job → GLB download → IndexedDB persist, with `fingerprintOf()` so a stale GLB is never shown for a new photo. **Calls Meshy (paid) through the server.** |
| `src/core/avatar/AvatarProfile.ts` | 409 | Identity/appearance/presence config + pub-sub; the canonical embodiment profile. |
| `src/core/avatar/AvatarImageStore.ts` | 83 | `getReferenceImage` / `setReferenceImage` / `removeReferenceImage` (one saved reference). |
| `src/core/avatar/LeluModelSource.ts` | 103 | The single approved-model source: `ForgeClient.active("lelu_character")` → GLB + animation clips, reloads on `FORGE_CHANGED_EVENT`. Explicitly no second model path. |
| `src/core/forge/ForgeClient.ts` | 410 | Forge HTTP client: `status`, `addReference`, `request`, `waitFor`, `approveSlot`, `active`, `assetBytes`, `enterEnvironment`; job/wardrobe/world types. |
| `src/core/forge/GlbInspector.ts` | 349 | **Dependency-free GLB parser**: container integrity, meshes/vertices/triangles/bounds, materials/textures, skins/joints/humanoid bone coverage, per-vertex weight validity, animation clips driving joints. Draco is reported "not measurable", never as a pass. |
| `src/core/creative/Procedural3DEngine.ts` | 93 | `RenderEngine` plugin; `offline = true`, `providerDependent = false`; procedural LÉLU + scenes rendered through Three.js. |
| `src/app/scene/genesis/GenesisAvatarPanel.tsx` | 622 | Avatar UI driving `Avatar3DReconstructor.getInstance()`. |
| `src/app/scene/genesis/GenesisV2Scene3D.tsx` | 1482 | The live 3D scene. |
| `plugins/forge/forgeCore.ts` | 343 | Reference ingestion with **sha256 de-duplication and a manifest**, credit estimation, job ledger with an approval state machine. |
| `plugins/forge/forgeRunner.ts` | 204 | Job runner: task.json / validation.json written per job, validation before success. |
| `plugins/forge/meshyClient.ts` | 130 | Meshy provider client (`MESHY_API_KEY` server-side only). |

---

## 3. Reusable services ASRE should extend, not duplicate

| existing | reuse as |
|---|---|
| `GlbInspector.inspectGlb()` | **The export acceptance gate.** Reads the container itself and refuses degenerate geometry, broken skin weights and non-measurable Draco. ASRE adds reference-projection metrics on top; it must not write a second GLB reader. |
| `forgeCore.ingestReferences()` | **Provenance layer**: content-addressed ingestion, duplicate detection, refuses to overwrite a differing file at the same name. Exactly the "preserve the original reference" requirement. |
| `forgeCore` job ledger + approval states | **Task state machine** for ASRE jobs (`awaiting_approval → approved → submitted → …`). Reuse the semantics instead of inventing another. |
| `plugins/spendPolicy.ts` | **Free-first enforcement already exists**: `costOf(service)` classifies `"free" \| "paid"`, `CONSENT_HEADER = "x-lelu-user-consent"`, `parseSpendConsent`, `spendRefusal`. ASRE registers every worker here; a paid provider is unusable without scoped user consent. |
| `RenderEngine` (`src/core/creative/RenderEngine.ts`) | **The adapter contract precedent**: `id`, `name`, `description`, `offline`, `providerDependent`, `supports[]`, `run(request)`. ASRE's model adapters mirror this shape so the engine is backend-agnostic. |
| `SceneRenderBudget` | Frame-budget pattern for mobile-safe rendering (`full / reduced / paused`). |
| `AgentEventBus` | Real progress events (`tool_started` / `tool_progress` / `tool_result` / `tool_failed`) — the honesty mechanism ASRE jobs report through. |

---

## 4. Findings that constrain the build

1. **The only working reconstruction path is paid.** `Avatar3DReconstructor`
   requires `MESHY_API_KEY`, submits `image-to-3d` with `ai_model: "meshy-6"`,
   and fails with "MESHY_API_KEY is not set" otherwise. Directive §11 forbids a
   paid API in the core workflow, so ASRE must supply a local/free worker behind
   the same interface and Meshy must become an optional, consent-gated adapter.
   This is the single largest gap between the directive and the code.
2. **No numerical representation layer exists.** `GlbInspector` inspects glTF,
   and that is all. There is no serialization format, no round-trip test, no
   point-cloud or voxel handling. NRE (Mission 3) starts from zero.
3. **`studio/` is not TEMPORAL Studio.** It contains `templates/application`,
   `templates/game`, `templates/website` — project scaffolds with their own
   `studio.json` and `server.mjs`. There is no existing 3D engine there, so
   building one is not duplication; the name collision does need care so
   nothing in `studio/` starts depending on the engine by accident.
4. **The paid path is deeply wired.** `Avatar3DReconstructor` → `ForgeClient` →
   server → Meshy is referenced by the avatar panel and by the presence/scene
   components, so any replacement has to satisfy the same
   `ReconstructionStatus` contract (`idle / running / succeeded / failed`, with
   `storage: "persisted" | "memory-only"`) or the live avatar breaks.
5. **Governance is already mature.** `spendPolicy`, `credential-exposure` and
   `resource-sandbox` tests exist and pass. The engine inherits a real refusal
   path rather than needing new policy code.
6. **Dependency install is fork-sensitive.** `npm ci` cannot install this repo;
   only bun with the shipped lockfile can. Any CI or worker bootstrap must use
   `bun install --frozen-lockfile`, and the Android/Capacitor toolchain is
   separate from that.

## 5. Files and systems that must not be disturbed

- `src/core/avatar/*` behaviour, especially `LeluModelSource`'s single-source
  rule and `fingerprintOf` staleness guard.
- The live scene path `GenesisV2Scene3D.tsx` / `LeluV2Presence.tsx`.
- `leluverse/assets/characters/lelu_character/references/PRIMARY_SOURCE/`
  (hashes verified against its manifest this session: all four match).
- The Forge ledger at `leluverse/forge/ledger.json`.
- `supabase/` and any production configuration.
- `studio/templates/**` — unrelated product scaffolds.

---

## 6. What Missions 2–4 must therefore do

- **Mission 2 (model registry):** record licence, weights licence, VRAM,
  runtime and local-inference status per candidate; mark each `free`/`paid` in
  the shape `costOf()` expects. Nothing enters the registry on a README claim.
- **Mission 3 (NRE):** own serialization with round-trip tests, built beside
  `GlbInspector` (reusing it as the geometry reader for GLB sources) rather than
  replacing it.
- **Mission 4 (first free reconstruction):** a worker that needs no API key and
  no payment method, registered through `spendPolicy` as `free`, reporting
  through `AgentEventBus`, and gated by `inspectGlb` + reference comparison
  before any success state.

## 7. Status of this session's work

- Branch created; working branch ref intact at `3f8094e`.
- Dependencies installed via bun; typecheck exit 0; 3D/forge subset 80/80 pass.
- Nothing committed, nothing pushed, no production configuration read or
  modified.
