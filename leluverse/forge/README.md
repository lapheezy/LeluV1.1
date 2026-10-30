# LÉLU 3D Forge: checkpoint (paused 2026-10-30)

## Done (no credits spent)

**Audit**
- The existing Meshy integration is `src/core/avatar/Avatar3DReconstructor.ts`. It is browser-orchestrated image-to-3D through the `/api/knowledge/relay` path in `plugins/aiProxyApi.ts`, which only allows `/openapi/v1/image-to-3d`.
- The Forge is the server-side extension of that integration.

**Forge core, server side (`plugins/forge/`)**

| File | Responsibility |
|---|---|
| `forgeCore.ts` | Asset folders, reference ingestion (hashing and de-duplication), Meshy's published credit prices, the job ledger (`leluverse/forge/ledger.json`), plan de-duplication by request hash, person-only approval, versioned output folders, GLB inspection |
| `meshyClient.ts` | The documented endpoints (multi-image-to-3d, image-to-3d, rigging, animations, animation library). The key is read from the server's `MESHY_API_KEY`. A create request is never retried. |
| `forgeRunner.ts` | Runs one approved job: submit once, track it, download, validate, version. A failed download is marked `needs_attention`, and running the job again re-downloads without resubmitting. |

**Tests:** `tests/forge.test.ts` (6) runs against a local stand-in for the Meshy API. No real generation is claimed.

**References**
- 15 Phase 1B images were ingested into `assets/characters/lelu_character/references/`.
- The classification is in `manifests/references.json`.
- The identity reference proposed for approval is in `identity/identity.json`.

**Planned and awaiting the owner's approval** (`npx tsx scripts/forge/forge.ts status`)

| Job | Workflow | What it makes | Estimated cost |
|---|---|---|---|
| `forge-c4c1e9c2` | `multi-image-to-3d` | Base character, `meshy-7.1`, from 4 hooded views in A-pose | 30 credits |
| `forge-ca8f7b98` | `rigging` | Skeleton for the base character | 5 credits |

## Blocker in the old session

`MESHY_API_KEY` was not in that session's environment. It had been added to Lelu2 after the container started, and Meshy answered 401 "Missing API key".

## Next, in a session that has the key

1. Check the key: `npx tsx scripts/forge/forge.ts status` should report `MESHY_API_KEY ... set`.
2. Get the owner's approval of the identity reference, then approve and run the jobs:
   - `approve forge-c4c1e9c2 <name>`, then `run forge-c4c1e9c2`;
   - inspect the outputs (thumbnails and GLB report);
   - then rig: `approve forge-ca8f7b98 <name>`, then `run forge-ca8f7b98`.
3. Look up animation IDs in the free library (`library idle`, `library talk` and so on), then plan an animation job.
4. Still to build:
   - `/api/forge/*` routes, mounted like `plugins/selfViewApi.ts` in `vite.config.ts` and `server.ts`;
   - `forge.*` tools for LÉLU (plan, status, run approved jobs; never approve);
   - a three.js presence that loads the rigged GLB in Cosmos, with no caption bubble.
