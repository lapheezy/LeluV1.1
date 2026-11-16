# Phase 7 — End-to-End Verification

**Status:** PASS for everything this container can exercise. **BLOCKED:** Anthropic (no key), the signed-in discovery route (no Supabase config), and a physical iPhone or WebKit.
**Verified at code commit:** `c274436` (branch `claude/gallant-ritchie-v7i0fn`), 2026-11-06, Node v22.23.4.

## Regression

| Command | Before (`62ddd61`) | After (`c274436`) |
|---|---|---|
| `npm test` | 1366 pass / 0 fail / 4 skipped | **1384 pass / 0 fail / 4 skipped** (18 new) |
| `tsc -b --force` | exit 0 | exit 0 |
| `oxlint` (changed files) | n/a | exit 0 |

## Live versus mocked matrix

| # | Capability | Mocked test | Live |
|---|---|---|---|
| 1 | Catalog ingestion (public-apis) | ✅ fixture | ✅ 2,170 APIs / 51 categories |
| 2 | Discovery filter / free-open | ✅ | ✅ (script) |
| 3 | Duplicate detection | ✅ | ✅. The live run found and drove the fix for false matches. |
| 4 | Registry search | ✅ | ✅ `/api/sources/catalog` via dev server |
| 5 | Discovery auth gate | ✅ 401, 0 downloads | ⛔ 503: no Supabase in this container (fails closed) |
| 6 | Source selection | ✅ 4 domains | ✅ currency, in chat |
| 7 | Dictionary / Open Library / Frankfurter / USGS | ✅ | ✅ all four by script; Frankfurter in chat |
| 8 | Normalisation and attribution | ✅ | ✅ (ECB attribution shown in chat) |
| 9 | Timestamps | ✅ (rate date, quake time) | ✅ |
| 10 | Error handling / failure isolation | ✅ 502, cached failure | ✅ GDELT and RSS timeouts isolated; answer still produced |
| 11 | Rate-limit classification | ✅ | not observed live (no 429 occurred) |
| 12 | Discovery cache | ✅ 1 download for 2 requests | n/a |
| 13 | Adapter response cache | ❌ not implemented | n/a |
| 14 | Budget warning and hard stop | ✅ | not triggered live |
| 15 | AI token accounting | ✅ | ✅ Fireworks tokens, including cached and reasoning |
| 16 | External API accounting | ✅ | ✅ 4 sources recorded |
| 17 | Chat-driven research | n/a | ✅ currency; ❌ dictionary (model chose not to search) |
| 18 | Anthropic | ✅ usage shape | ⛔ `ANTHROPIC_API_KEY` unset |
| 19 | Mobile and desktop UI | n/a | ✅ Chromium emulation, 5 viewports; ⛔ physical iPhone / WebKit |
| 20 | Secrets | n/a | ✅ regex scan of all new files and evidence: none |

Live credentials present in this container (names only): `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `FIREWORKS_API_KEY`. Absent: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `NASA_API_KEY`, Supabase.

## Security checks

- Discovery cannot be used as a proxy: it fetches only the fixed URL, never a URL from the request. It goes through `safeFetch` (address checks, pinned socket, redirect re-check, byte cap, deadline), behind `requestGuard`.
- Catalog content: table cells only, 300-char caps, only http(s) links (`javascript:` link test), never placed in a prompt.
- No new credential, no client-side key, and no new server relay for the new sources.

## Commands

```
npm test
npx tsc -b --force
npx tsx scripts/verify-api-ecosystem-live.ts docs/api-ecosystem/evidence/phase3/live-verification.json
npm run dev   # then:
node scripts/verify-api-ecosystem-ui.cjs desktop docs/api-ecosystem/evidence/phase4 "Convert 100 USD to EUR — what is today's exchange rate?"
node scripts/verify-api-ecosystem-ui.cjs "iPhone 13" docs/api-ecosystem/evidence/phase6 "define serendipity"
node scripts/verify-api-ecosystem-ui.cjs "iPhone SE" docs/api-ecosystem/evidence/phase6 --replay docs/api-ecosystem/evidence/phase6/ledger-iPhone13.json
```
