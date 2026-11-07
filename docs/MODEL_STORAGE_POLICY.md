# Model storage policy — who owns the bytes

A reconstructed avatar model is the only large, *paid* artifact LÉLU
handles. This is the contract for where its bytes live, what each layer
may do with them, and what happens when one of them fails. It exists
because the pending Meshy jobs (`forge-c4c1e9c2`, 30 credits and
`forge-ca8f7b98`, 5 credits) should not be approved until the answers are
written down.

## The four layers, and their jobs

| Layer | Owns | May it fail silently? |
|---|---|---|
| **Meshy CDN** (upstream) | The authoritative artifact for a job. | No — the download is verified (`<1024` bytes is rejected). |
| **IndexedDB** (`lelu-avatar-3d` / `models` / `reconstructed`) | The persisted model across sessions. Keyed by a fingerprint of the source reference. | No — a failed write is retried and *reported* as `memory-only`. |
| **HTTP cache** (browser) | Nothing of its own. One revalidatable copy of whatever `/models/*.glb` served, if the app ever serves one. | n/a |
| **Service worker** (`public/sw.js`) | The app shell only. **Models are explicitly excluded** (`v1`→`v2`). | n/a |

## Rules

1. **The runtime's own origin is not in the download path today.** The
   reconstruction pipeline fetches the GLB from Meshy and stores the
   `ArrayBuffer` in IndexedDB; `server.ts` is never asked for model bytes.
2. **If a model is ever served from LÉLU's origin** (`/models/*.glb`), it
   is served `public, max-age=0, must-revalidate` with a strong `ETag` and
   `Accept-Ranges` — never `immutable`, because a stable path can change
   content and `immutable` would make a replaced model unreachable. A
   replaced model therefore produces a new `ETag` and a full re-fetch.
3. **The service worker must not cache models.** It did: every same-origin
   `GET` was written to Cache Storage, so a 49 MB model was stored twice
   on the phone, a replaced model kept being served stale from that cache,
   and a `cache.put` quota failure was an unhandled rejection nobody saw.
   `isModelAsset()` now returns early for `.glb`/`.gltf`/`.fbx`/`.bin` and
   `/models/`, leaving the HTTP cache and IndexedDB to do their jobs. The
   cache name was bumped to `lelu-v2`, which also drops the stale `v1`
   cache on activate.
4. **A paid model is never discarded because storage failed.**
   `Avatar3DReconstructor.persist()` keeps the record in memory on a
   failed write, reports `storage: "memory-only"`, and retries on the next
   `getModelFor()` / `retryPersist()`. The status is honest: a
   memory-only model will not survive a reload, and the UI must not
   promise offline availability for it.
5. **A stale model is never shown for a new reference.** The record is
   keyed by `fingerprintOf(referenceImage)`; `hasStoredFor()` and
   `getModelFor()` both compare it, so replacing the reference hides the
   old model instead of mislabelling it.
6. **Clearing browser storage costs a re-download, and that is correct.**
   Measured in `scripts/verify-mobile-model-cache.mjs`: after
   `Storage.clearDataForOrigin` the model is fetched in full again. There
   is no server-side copy to restore from — deliberately, because a server
   copy would have to be authenticated per user to avoid publishing a
   likeness to the internet.

## What is NOT solved, and should be decided before approving the jobs

- **No recovery after a full storage clear** for a paid model: the Meshy
  task is finished and its CDN URLs expire, so the bytes on the phone are
  the only artifact. If that matters, the job ledger (not the browser)
  should keep the downloaded GLB server-side under the owner's account and
  re-serve it on demand.
- **Quota.** A 49 MB write needs roughly that much free quota; iOS Safari
  evicts origin storage under pressure. `navigator.storage.persist()` is
  not requested yet, so a model can be evicted without warning.
- **The 30-credit job targets 30k triangles / 2K textures**, which is far
  below 49 MB in practice. The 49 MB figure is the ceiling being designed
  for, not the expected size.
