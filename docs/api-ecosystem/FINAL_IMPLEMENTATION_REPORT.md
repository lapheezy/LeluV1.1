# LÉLU V1.1 — API & Data Ecosystem: Final Implementation Report

**Branch:** `claude/gallant-ritchie-v7i0fn` (from `claude/master-integration` @ `62ddd61`)
**Commits:** `08b6fff` (phase 0) · `98943a8` (phases 1–2) · `7e7acf2` (phases 3–4) · `c274436` (phases 4–6) · docs commit (this report; see `git log`)
**Overall:** a working, verified first increment. Several phases are **PARTIAL**; each is listed below with what is missing.

| Phase | Status |
|---|---|
| 0 Baseline | PASS |
| 1 Research | PASS |
| 2 Registry | PARTIAL: discovery cache in memory, nothing persisted to Supabase |
| 3 Adapters | PARTIAL: no response cache for new adapters |
| 4 Cognition | PASS (currency proven in chat; other domains script-only) |
| 5 Usage | PARTIAL: AI budgets not enforced; per-browser storage; no price table |
| 6 UI | PARTIAL: Chromium emulation only, no physical iPhone or WebKit; pre-existing overlay overlap |
| 7 Verification | PASS where exercisable; Anthropic, signed-in discovery and physical iPhone BLOCKED |
| 8 Handoff | Committed and pushed; **no PR opened** (not requested) |

## Answers

1. **Repositories investigated:** all 9 named (public-apis, free-for-dev, openapi-directory, public-api-lists, SearXNG, MCP, OpenAPI Generator, Crawl4AI, Playwright), plus Firecrawl, LibreTranslate, Ollama, and the alternatives listed in Phase 1 (Readability, rss-parser, bottleneck, OpenTelemetry, LiteLLM).
2. **APIs investigated:** all 45 inventory items; 44 catalog entries (the hosted LLMs are grouped). 13 were probed live.
3. **Integrated:** 24 total. **New this work:** Free Dictionary, Open Library, Frankfurter, USGS earthquakes, public-apis discovery. The other 19 were already integrated in LÉLU (Wikipedia, Wikidata, Wikimedia, arXiv, Crossref, OpenAlex, NASA, OSM, Nominatim, Open-Meteo, GDELT, HN, RSS, NewsAPI, GitHub, YouTube, Playwright, Ollama, the hosted LLMs).
4. **Rejected or deferred:** 17 deferred and 1 rejected, each with its reason in [PHASE_1_RESEARCH.md](PHASE_1_RESEARCH.md). Main reasons:
   - needs an unconfigured key (Brave, Unsplash, Giphy, TMDB);
   - needs self-hosting (SearXNG, Crawl4AI, Firecrawl, LibreTranslate);
   - endpoint changed or unstable (REST Countries, Data.gov, Jikan, Gutendex);
   - terms forbid production use (TheMealDB);
   - over the fetch cap (APIs.guru);
   - heavier than the existing adapters (OpenAPI Generator, rejected).
5. **New capabilities LÉLU can actually use:**
   - word definitions;
   - book and author search;
   - ECB currency reference rates;
   - recent earthquakes;
   - discovery of candidate APIs from 2,170 catalogued ones;
   - a queryable catalog of evaluated sources;
   - cumulative usage accounting with per-source caps.
6. **Discovery and selection:**
   - Discovery is `GET /api/sources/discover`, served from the public-apis catalog, cached 24 h, signed-in only.
   - Selection is the existing `ResearchResolver`, now with dedicated-domain ranking. A source whose capability matches a domain the question names ranks first, and the existing `canSearch` declines anything off-topic. At most 4 sources are consulted.
7. **In real conversations:** through the existing router and the model's `research.web` tool. Proven live: the currency question went to Frankfurter, and LÉLU answered with the ECB rate and its attribution. Getting there required fixing two pre-existing routing bugs, both found live: the clock took over "today's …", and news sources outranked the rate source.
8. **Monitoring:** `UsageLedger` records every model call of the tool loop (provider-reported tokens, including cached and reasoning) and every knowledge-source call (ok/failed, latency, results, rate limits). Views cover session, day, week and month. Cost is shown only when a provider reports it; otherwise "unknown". Source budgets are hard stops.
9. **Security:**
   - No new secrets; the new sources are key-less and browser-side, so no new relay was added.
   - Discovery fetches a fixed URL only, through `safeFetch` (SSRF containment) behind `requestGuard`.
   - Catalog text is parsed as untrusted data.
   - A regex scan of new files and evidence found no secrets.
10. **UI:** a Usage & budgets section in the existing Settings panel.
11. **iPhone:** Playwright emulation of iPhone SE, iPhone 13 (live chat turn) and iPhone 15 Pro Max: no overflow, no page errors. **Not** tested on a physical iPhone or in WebKit/Safari.
12. **Desktop:** 1440×900, live currency turn plus the usage view.
13. **Tests passed:** `npm test` 1384/1384 (4 skipped, pre-existing); 18 new; `tsc` clean; `oxlint` clean.
14. **Tests failed:** none in the final run. Earlier failures during development were fixed and are covered by tests (dedup key, provider-name links, intent/time routing, ranking).
15. **Tested live:**
    - Dictionary, Open Library, Frankfurter, USGS and public-apis by script;
    - Frankfurter, Wikipedia, GDELT and RSS in chat;
    - Fireworks as the model provider.
16. **Mocked:** route auth (stub verifier), adapter parsing (injected fetchers), budgets, persistence, Anthropic usage shape.
17. **Visual evidence:** 10 screenshots plus 2 JSON records; see [evidence/INDEX.md](evidence/INDEX.md).
18. **Branch and SHA:** `claude/gallant-ritchie-v7i0fn`; last code commit `c274436`. The docs commit is the branch HEAD.
19. **Incomplete:** see [INTEGRATION_HANDOFF.md](INTEGRATION_HANDOFF.md).
20. **Next step:** persist `UsageLedger` aggregates to Supabase per user, and enforce AI-provider budgets inside `ProviderResolver`'s existing skip-and-record path. That makes cost control real across devices, and it was the most-requested control that remains partial.
