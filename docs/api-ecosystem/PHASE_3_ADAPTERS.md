# Phase 3 — Adapters and Safe API Execution

**Status:** PARTIAL. Four new adapters work through the existing provider and selection path and are verified **live**. There is no response cache for them: LÉLU's `BaseProvider` cache isn't used by these providers, and `ResearchResolver` has no result cache.
**Code commits:** `7e7acf2` (providers), `c274436` (metering)

## Adapter convention used

There is no new adapter framework. The new sources implement the existing `Provider` interface (`src/providers/Provider.ts`), so they inherit what `ResearchResolver` already provides:

| Concern | Where it is enforced |
|---|---|
| Selection | `ResearchResolver.selectProviders` (capability tags plus the new dedicated-domain rank) |
| Input validation | Each provider's `canSearch()` declines anything that isn't its kind of question |
| Timeout | Per-provider `timeout` (10 s), bounded by the 20 s research phase deadline |
| Failure isolation | One failing source is recorded and skipped; the rest continue |
| Response validation | Results without a title are discarded (`runProviders`); each adapter checks `Array.isArray` and HTTP status |
| Usage metering and budgets | `UsageLedger` in `runProviders` (Phase 5) |
| Attribution | `KnowledgeResult.source`, `url`, `timestamp`, `metadata.license` |
| Base URL | `Endpoints.ts` (`DICTIONARY_API_URL`, `OPENLIBRARY_API_URL`, `FRANKFURTER_API_URL`, existing `USGS_EARTHQUAKE_API_URL`) |

## Adapters (`src/providers/ReferenceProviders.ts`)

| Provider | Claims | Notes |
|---|---|---|
| `dictionary` | "define X", "what does X mean", "X meaning", a bare single word | A 404 is "no definition", not an error. CC BY-SA attribution kept. |
| `openlibrary` | Any query, but priority 90, so it is last in keyword-less fallback. Chosen when a books domain or focus is named. | Strips "books by / written" filler |
| `frankfurter` | Currency questions only | Words such as "real", "won", "rand", "try" are not treated as currencies; a single currency needs explicit exchange intent. Output says *"once-daily reference rate, not a live market quote"*. |
| `usgs-earthquakes` | Earthquake / quake / seismic / tremor | 1, 7 or 30-day window from the wording; place filter on USGS `place`; reviewed events get higher confidence |

## Security

The new adapters run in the browser against public, key-less, CORS-enabled APIs, so no credential exists to leak and no server relay (an SSRF surface) was added. The only new server-side fetch is discovery, which uses a fixed URL through `safeFetch`.

## Verification

| Check | Kind | Result |
|---|---|---|
| Parsing, negatives and labelling (`tests/api-ecosystem.test.ts`, 6 tests) | **mocked** (injected fetcher) | pass |
| `scripts/verify-api-ecosystem-live.ts` | **live** | 4/4 pass. Dictionary 321 ms; Open Library 396 ms; Frankfurter 401 ms (1 USD = 0.89566 EUR, 2026-11-06); USGS 529 ms (M4.5, 101 km SSE of Palekastro, Greece) |
| Browser-side latency through the container's proxy | **live** | Frankfurter 5.0 s cold / 1.5 s warm; Dictionary 2.1 / 1.1 s; USGS 0.9 s; Open Library 1.8 / 1.4 s. The first in-chat Frankfurter call hit the original 8 s timeout, so all four were raised to the 10 s the existing providers use. |

Evidence: [evidence/phase3/live-verification.json](evidence/phase3/live-verification.json).
