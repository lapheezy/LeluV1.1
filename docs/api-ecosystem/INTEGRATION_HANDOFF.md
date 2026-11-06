# Integration Handoff — API & Data Ecosystem

## State

- **Branch:** `claude/gallant-ritchie-v7i0fn`, pushed to origin. It is 4 code/doc commits plus a docs commit ahead of `claude/master-integration` (`62ddd61`). At the time of writing, `claude/master-integration` had not moved, so the branch merges without conflicts.
- **No PR was opened.** None was requested. Merge through the usual integration workflow when ready.
- **No force-push**, no history rewrite, and no other branch touched.

## Files

**New:** `src/core/apiEcosystem/{SourceCatalog,PublicApisParser}.ts`, `plugins/sourceCatalogApi.ts`, `src/providers/ReferenceProviders.ts`, `src/core/observability/UsageLedger.ts`, `src/app/scene/genesis/UsageSection.tsx`, `tests/api-ecosystem.test.ts`, `scripts/verify-api-ecosystem-{live.ts,ui.cjs}`, `docs/api-ecosystem/**`.

**Modified, all additive.** These are shared hot files, so review them when merging concurrent work:

| File | Change |
|---|---|
| `src/core/router/ResearchResolver.ts` | 4 `DOMAIN_CAPS` rows, `SPECIFIC_DOMAIN_CAPS` rank boost, budget check and metering in `runProviders` |
| `src/core/router/ProviderResolver.ts` | `meteredGenerate` wraps the 3 `provider.generate` calls; failure recorded after `markFailure` |
| `src/core/router/TimeResolver.ts`, `IntentDetector.ts` | "what is today" scoped to date-as-subject |
| `src/core/tools/ToolDispatcher.ts` | 4 `RESEARCH_FOCUS` entries |
| `src/core/Endpoints.ts`, `RegisterProviders.ts`, `ENV_VARS.md` | 3 endpoints, 4 providers, docs rows |
| `vite.config.ts`, `server.ts` | Mount `/api/sources` |
| `GenesisSettingsPanel.tsx` | Render `<UsageSection />` |

**Overlap watch:** `claude/lelu-continuous-cognition-92p3jy` and `freebuff/1fb0099…` were active on 2026-11-06. Neither was modified. If either edits `ResearchResolver.ts` or `ProviderResolver.ts`, expect textual conflicts in the hunks above only.

## Environment

No new credentials are required. Optional base-URL overrides: `DICTIONARY_API_URL`, `OPENLIBRARY_API_URL`, `FRANKFURTER_API_URL`. Discovery needs the existing Supabase identity configuration; without it, the route fails closed (503).

## Remaining work, in recommended order

1. Persist `UsageLedger` aggregates per user (Supabase), so usage and budgets follow the user across devices.
2. Enforce AI-provider budgets in `ProviderResolver`, reported like a cooldown skip, never as a silent paid fallback.
3. Add a response cache for the reference providers (short TTL; rates are daily, quakes are minutes).
4. Persist discovery results and expose them in a UI (today they are JSON only).
5. Verify on a physical iPhone in Safari, and fix the companion-overlay overlap on phones (avatar workstream).
6. Verify Anthropic live once `ANTHROPIC_API_KEY` is configured.
7. Deferred sources, as keys or hosting become available: SearXNG (self-host), Brave Search (key), OpenAPI ingest (streamed APIs.guru).
