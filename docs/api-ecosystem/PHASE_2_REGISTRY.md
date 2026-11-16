# Phase 2 — Discovery Engine and Registry

**Status:** PARTIAL. Discovery, the evaluated registry, search, filtering, dedup and freshness metadata work and are tested. The discovery cache is **in-memory**: it survives 24 h in a running server but not a restart, and discovered candidates are not written to Supabase.
**Baseline:** `62ddd61` · **Code commit:** `98943a8`

## What was built

| Piece | File | Behaviour |
|---|---|---|
| Evaluated registry | `src/core/apiEcosystem/SourceCatalog.ts` | 44 typed entries: id, name, URL, category, kind, capabilities, access (free / freemium / paid / self-hosted / free-with-key), auth, **env var names only**, limits, license, CORS, executing `provider`, decision, reason, `verified {at, status, note}` |
| Registry queries | `searchCatalog()`, `catalogEntry()` | Free text, plus filters for category, access, decision and key-less |
| Duplicate control | `dedupeKey()` | Names are normalised. URLs keep their full host, so `dictionaryapi.dev` ≠ `dictionaryapi.com`. Multi-project hosts (github.com, developers.google.com, …) are keyed by the first path segment. |
| Catalog parser | `src/core/apiEcosystem/PublicApisParser.ts` | Parses public-apis category tables as untrusted data. Skips the sponsor table, keeps only http(s) links, caps each field at 300 chars, drops duplicates, and links an entry to the catalog via `knownAs`. |
| Routes | `plugins/sourceCatalogApi.ts`, mounted in `vite.config.ts` and `server.ts` | `GET /api/sources/catalog` (static data). `GET /api/sources/discover` (signed-in user, 20/min; fetches only the fixed public-apis URL through `safeFetch`; 24 h cache, failures cached 10 min, concurrent requests share one download). |

The catalog lives in versioned source rather than a database on purpose. Every entry is a reviewed decision, so a change to it is a code-reviewed commit, not a runtime write.

## Tests (offline, `tests/api-ecosystem.test.ts`)

- Every directive-named source has an entry with a decision and a reason; ids are unique; env vars are names only.
- Every `provider` link names a provider that `registerProviders()` really registers. This check caught two wrong links during development (`openmeteo` → `open-meteo`, `newsapi` → `news`).
- Parser: sponsor table skipped, `javascript:` link dropped, duplicate row dropped, known source linked.
- Route: an anonymous caller gets 401 **with 0 downloads**; a signed-in user gets results; a second request is served from cache (downloadCount = 1); a failed download returns 502 and is not retried per request.

## Live

`scripts/verify-api-ecosystem-live.ts` fetched the real README through `safeFetch` (346,523 bytes) and parsed **2,170 APIs in 51 categories**. The first live run exposed a dedup bug the fixtures had missed: every github.com- and google.com-hosted API matched one catalog entry ("MeowFacts → ollama", "Merriam-Webster → dictionaryapi"). It was fixed and the fix is covered by tests. After the fix, every reported match is correct (Jikan, Gutendex, Open Library, Frankfurter, GitHub, Free Dictionary, Open-Meteo, TheMealDB, PokeAPI, Nominatim, OpenStreetMap, REST Countries). See [evidence/phase3/live-verification.json](evidence/phase3/live-verification.json).

Through the running dev server, `/api/sources/catalog` answered 200. `/api/sources/discover` answered **503**, because this container has no Supabase configuration, so identity cannot be verified. That is the existing guard failing closed, as designed. The route's signed-in path is covered by the offline test with a stub verifier.

## Not done

- No persistence of discovered candidates or of discovery history.
- No OpenAPI-spec ingestion (APIs.guru index is 8.9 MB, over the 2 MB fetch cap).
- No registry UI beyond the JSON route.
