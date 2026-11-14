# Task: archived-memory recall costs 1.5–2.1 s per chat turn (NOT an index problem)

**Status:** open · **Found:** performance mission (2026-11-13) · **Re-measured:** 2026-11-14

## Symptom
Every chat turn issues `GET /rest/v1/legacy_memories?…or=(value.ilike.%term%,key.ilike.%term%…)`
(`src/core/memory/providers.ts`, `OgArchiveProvider.context`) before routing, and it takes
**1.5–2.1 s** in the browser (real turns, production build). It sits on the critical path
(`MemoryBridge.enrich` → `Brain.recall`), ahead of the model call.

## Evidence that an index will not fix it
Read-only inspection of the live project the app uses (`nrehsldbfxthspikaxvr`, "Lelu"):

| Fact | Value |
|---|---|
| Rows in `public.legacy_memories` | **69** (144 kB) |
| Existing indexes | pkey; unique (user_id, category, key); (user_id, updated_at desc); (user_id, importance desc) |
| `pg_trgm` | available (1.6), not installed |
| RLS | one policy, "own memories", ALL |
| `EXPLAIN ANALYZE` of the exact query shape (6 ILIKE terms, order by created_at, limit 8) | **Seq Scan, 5.6 ms execution**, 19 ms planning |

The database is under 2% of the observed time. A trigram index on 69 rows would change
nothing measurable and adds write cost and a schema migration (this table is not even created by a
migration in this repo — it came from the OG project). **Do not add an index for this.**

## Where the time actually goes (hypotheses to measure first)
1. Network round trip from the client to Supabase us-east-1 (and, in this measurement, through an
   egress proxy). Measure `responseStart - requestStart` vs total for this request on the VPS.
2. Client-side session work before the request (`getSession`/token refresh for a guest/anon client).
3. Sequential placement: recall awaits before routing although its result is only context.

## Proposed changes (in order; each to be measured)
1. **Bound it:** a 400 ms deadline on the archive band only (other memory bands keep their own),
   returning "no archive context" on timeout — the archive is a frozen snapshot, so a miss costs
   little.
2. **Cache it per session:** 69 frozen rows can be fetched once (one request, ~144 kB max) and
   filtered locally; invalidate never (the table is a snapshot) or on sign-in change.
3. Only if the archive grows by orders of magnitude: revisit `pg_trgm` / FTS with a migration,
   checked against existing migrations and RLS, applied to the test project
   (`ugshflwlyakipeduifkd`) first.

## Acceptance
Real guest turn on the production build: archive request off the critical path or ≤ 400 ms;
same memory recalled for a question the archive answers (add a test with a stored fact).
