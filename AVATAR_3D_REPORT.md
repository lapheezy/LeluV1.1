# LÉLU avatar & 3D world: engineering report

Branch `claude/avatar-3d-world` (worktree of `claude/lelu-continuous-cognition-92p3jy`).
Scope: avatar, character pipeline, Meshy, Blender, 3D rendering, expressions, persistent
avatar state, room generation, environment simulation. No changes to auth, credential
infrastructure, cognition or memory.

## What is live

LÉLU's rig slot is `fj_mvwaqbim_55226d`:
`leluverse/assets/characters/lelu_character/rig/v004_headswap_mvvnvqa1/lelu.glb` (47 MB).
The user approved it from renders.

How it was built (every step is in the ledger, `generation_logs/jobs.json`):

| Job | What | Credits (est / used) |
|---|---|---|
| `fj_mvvfg2o3_ebd9c0` | Meshy multi-image-to-3d body (ref11 + ref09), 60k tris | 30 / 30 |
| `fj_mvvnf4v9_1ded97` | Meshy auto-rig of that body (24 joints, walk/run clips) | 5 / 5 |
| `fj_mvvnvqa1_b5672e` | Meshy head-and-shoulders bust from ref10 + ref18 + ref19, 8k texture, 2k geometry, 300k tris | 40 / 40 |
| `fj_mvwaqbim_55226d` | Blender: head swap + eye-only face projection + walk check | 0 / 0 |

Total spent: 75 credits (3110 → 3035).

The first full-body model, used on its own, was rejected: its face collapsed in the 60k remesh.
It is withdrawn, and its GLB/FBX stay out of git.

Known limits:
- Some of the old coarse curls remain on the shoulders and back. They are fused into one mesh
  with the torso and clothes, so automatic removal (`lelu_hairclean.py`) gets only part of them.
- There are no face shape keys on this model, so `AvatarBehaviour` drives body language only
  (no blink or lip sync).

## Pipeline added (all server-side, all free)

| Stage | File | What it does |
|---|---|---|
| Post-process | `plugins/blenderStage.ts` `postprocess()`, `scripts/blender/lelu_postprocess.py` | clean, measure, ARKit face keys, phone LOD, previews |
| Head swap | `headswap()`, `scripts/blender/lelu_headswap.py` | fit a bust's face to the body (nose + symmetric-chamfer scale search, translation ICP), cut at the choker, keep long hair, skin to Head/neck and copy body weights for hanging hair |
| Face/eyes | `scripts/blender/lelu_faceproject.py` | MediaPipe landmarks on render + reference, barycentric warp. Default: eye patches only (reference eyes on a fitted skin surface, lash fins removed, mirrored fit if hair spoils one side). Option: `paintFace` |
| Walk check | `scripts/blender/lelu_posecheck.py` | applies the rig's walking clip, renders front/¾/back |
| Old hair | `scripts/blender/lelu_hairclean.py` | experimental multi-view hair segmentation (partial) |
| Checks | `scripts/measure-glb.mjs`, `scripts/measure-behaviour.ts` | headless three.js: size, clip, AvatarBehaviour stay upright |

Every Blender result is recorded as a `kind: "blender"` job: 0 credits, `parentJobId` set,
inspected by `GlbInspector`, idempotent per source hash + script hash + options. It is then slotted
like any Meshy job.

CLI (`scripts/forge-character.ts`): `plan-head`, `headswap <rig> <head>`,
`blender <job>`, `unslot <slot> [reason]`.

## World & avatar state

- `src/core/world/RoomGenerator.ts`: description → kind, palette, lighting, furniture (21
  types from built-in shapes with `proportions`). Deterministic per seed. Nothing overlaps. LÉLU's
  spot and the view to her stay clear.
- `plugins/worldEngine.ts`: `generateEnvironment` (one version per generation), `removeGroup`,
  and `avatar` / `setAvatar`, which persist position and facing per environment and her resting
  mood in `cosmos/avatar.json`.
- Tools: `world.generate` and `world.avatar` (risk 1), registered with the existing world tools.
- Rendering: `WorldScene` draws `proportions`, and ✕ removes a whole generated piece.
  `LeluV2Presence` uses the persisted spot, facing (when idle) and mood.

## HTTP API additions (`plugins/meshyForgeApi.ts`)

```
POST /api/forge/world/generate                { description, name?, kind?, items?, seed?, radius?, environmentId?, replace?, enter? }
POST /api/forge/world/groups/<group>/remove   { environmentId? }
GET  /api/forge/world/avatar[/<character>]    ?environment=
POST /api/forge/world/avatar[/<character>]    { position?, facing?, towards?, mood?, environmentId? }
```

`GET /api/forge/world` now also returns `avatar`.

Bug fixed: the Forge store resolved to the repo root under Vite, because the env reader returns
`""` for unset keys and the code used `??`. It now uses `||`, so the dev server reads
`leluverse/assets` as intended.

## Dependencies & integration requirements

- **Blender:** `pip install bpy` (5.2.x, Python 3.13) in its own venv. Set
  `LELU_BLENDER_PYTHON=/path/to/venv/bin/python`, or `LELU_BLENDER_BIN` / `blender` on PATH.
  Without it, the Blender stages return 503 and change nothing.
- **Face/hair tools, in the same venv:** `mediapipe`, `opencv-python-headless`, `scipy`. System
  library `libegl1`.
- **Models:** `scripts/blender/models/face_landmarker.task` is committed (Apache-2.0). Segmentation
  `.tflite` files are downloaded on demand (URLs in `lelu_hairclean.py`).
- **Meshy:** `MESHY_API_KEY` (server only). Every spend goes through `approve`.
- No new npm dependencies.

## Tests

`tests/world-generate-avatar.test.ts` (new) plus the existing avatar, forge and world suites:
29/29 pass. `tsc` is clean for the app and plugins, except a type error in `plugins/modelApi.ts`
(not touched here).
