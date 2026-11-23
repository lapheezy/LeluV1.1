# Complete persistence inventory (WP03)

The machine-readable version — with per-pathway status, verification and the
runtime key dump — is `persistence-inventory.json`. This document explains how it
was produced and what it means.

## Method

The mission warns that searching filenames proves nothing. So the inventory was
built twice, independently:

1. **Static sweep.** `ripgrep` over `src/` and `public/` for
   `localStorage.*`, `sessionStorage.*`, `indexedDB.open`, `caches.*`,
   service-worker `fetch` handlers, `window.name`, `navigator.storage`,
   Supabase table access (`memory_items`, `user_preferences`, …), file
   download/export helpers, and server-side request logging.
2. **Runtime sweep.** In the live browser session, after real use (a chat turn, a
   memory deletion, seeded projects, two restarts): every `localStorage` key with
   its size, `indexedDB.databases()`, `caches.keys()`, and
   `navigator.serviceWorker.getRegistrations()`.

Result: **18 pathways**, 7 covered, 5 partially covered, 3 unaudited, 3 not
memory-derived or out of scope by design.

## What the runtime sweep actually saw

44 `localStorage` keys, all under `lelu.`. Three IndexedDB databases:
`lelu-memory` (the memory store), `lelu-user` (profile), `lelu-avatar-images`
(images/models). Zero Cache Storage entries and zero service-worker registrations
in development — the service worker is production-only.

Memory-relevant keys observed, with byte sizes at that moment:

| Key | Bytes | Carries memory text? |
|---|---|---|
| `lelu.projects.v1` | 1,559 | yes — checkpoints, notes, objectives |
| `lelu.multichat.workspace.v1` | 3,595 | yes — conversation turns |
| `lelu.memory.deletions.v1` | 201 | no — hashes and ids only |
| `lelu.memory.migration.v1` | 671 | no — counts/locations; previews stripped |
| `lelu.memory.healing.v1` | 175 | no — counts and state |
| `lelu.memory.deletions.guard.v1` | 82 | no — counters |
| `lelu.lelu.knowledge.v1` | 13,746 | derived knowledge — partial |
| `lelu.lelu.self.v1` | 3,429 | self-description — partial |
| `lelu.lelu.selfstudy.trace.v1` | 2,174 | activity text — unaudited |

## The important negative findings

- **No Cache API path carries memory.** `public/sw.js` returns immediately for
  non-GET requests, so no chat completion or provider response is ever cached;
  navigations and static assets are. Verified in source and at runtime (0 entries).
- **Provider request logging does not persist content.** `plugins/modelApi.ts`
  writes one line per turn containing provider, model, status, byte count,
  message count and token estimates — the function is commented "no prompt text
  and no credential", and the format confirms it.
- **No file-system persistence of memory exists on the client.** Downloads are
  user-initiated exports of artifacts the user asked for.

## The findings that are not negatives

- **P14 — Supabase `memory_items` is a real mirror.** Deletion now removes the
  row (`SupabasePersistence.forgetMemory`), and hydration can no longer restore a
  tombstoned id (test L). The cloud request itself could not be exercised here
  (no account), so it is PARTIALLY VERIFIED.
- **P15 — the OG surface deletes server-side rows with no tombstone**
  (`src/og/lib/memories.functions.ts`). That store is outside this client's
  ledger. Named as uncovered.
- **P09 / P10 — telemetry/activity and the user profile** may echo user text and
  have no deletion mechanism. Named as unaudited rather than counted as safe.
- **P13 — `window.name`** holds only a workspace marker now; a legacy build could
  have left a KvStore payload there, which is read once and copied into the swept
  backends. Dormant, not deleted.

## What the inventory deliberately refuses to claim

The inventory does **not** say "all persistence is covered". It says: every
pathway that can carry a remembered statement into a prompt is either filtered at
read time, cleaned in storage, or explicitly listed as uncovered with its risk.
The last group is why M22.6's recommendation is conditional.
