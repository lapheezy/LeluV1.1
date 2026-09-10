# Deferred OG modules

Kept verbatim (as `.txt` so the bundler ignores them) because they are the
reference for later phases, not because they are dead:

| File | Why it is here | Lands in |
| --- | --- | --- |
| `chat.server.ts.txt` | The 33KB OG chat engine. Its tool definitions, prompt shape, step budget and streaming contract are the thing the brief wants preserved — but its model calls go through Lovable's hosted gateway, which brief §15 replaces with v1.1's own provider registry. | Phase 3 |
| `ai-gateway.server.ts.txt` | `createLovableGateway` — the gateway being replaced. | superseded |
| `research.server.ts.txt` | `webSearch`, `scrapeUrl` (Firecrawl), `youtubeSearch`, `youtubeTranscript`. The ingestion tools §7/§8 need; v1.1 has no equivalent yet. | Phase 5 |
| `lovable/` | Lovable Cloud auth binding. v1.1 authenticates through Supabase directly. | superseded |

Nothing here is imported by the running app. Deleting them would throw away the
only record of how the OG chat actually behaved.

Added in Phase 2 — OG surfaces not mounted by `src/og/OgRoutes.tsx`:

| File | Why |
| --- | --- |
| `__root.tsx.txt` | TanStack's SSR root (`createRootRouteWithContext`, `HeadContent`, `Scripts`). react-router supplies the shell instead. |
| `universe-index.tsx.txt` | The OG landing scene. It overlaps v1.1's own Genesis cosmos, and the brief names Core and Inner Sky as the two UIs to preserve. |
| `AuthPanel.tsx.txt`, `auth.callback.tsx.txt`, `lovable-index.ts.txt` | Lovable Cloud auth. v1.1 authenticates against Supabase directly. |
| `research.functions.ts.txt` | Wraps `research.server.ts`; moves with it in Phase 5. |
| `sitemap.xml.ts.txt` | Server route; no SSR tier in v1.1. |
