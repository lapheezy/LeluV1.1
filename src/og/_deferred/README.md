# Deferred OG modules

Two OG surfaces that the hybrid does not mount, kept as `.txt` so the bundler
ignores them:

| File | Why |
| --- | --- |
| `universe-index.tsx.txt` | The OG landing scene. It overlaps v1.1's own Genesis cosmos, and the brief names Core and Inner Sky as the two UIs to preserve. |
| `sitemap.xml.ts.txt` | A server route. v1.1 has no SSR tier. |

## What used to be here, and where it went

Everything tied to the OG deployment's host platform has been **deleted, not
deferred** — the project must not depend on that platform in any form, and
keeping its source around as reference was still keeping it around.

| Removed | Replaced by |
| --- | --- |
| The hosted AI gateway | v1.1's `AIProviderRegistry` and its fallback chain |
| The 33KB server chat route | `src/og/compat/chat.ts` → `AIService.chat()` |
| Cloud auth binding, auth panel and callback | Supabase auth directly |
| Service-role admin Supabase client | RLS-scoped browser client (`compat/server-fn.ts`) |
| Third-party search and page scraping | v1.1's knowledge provider registry, and `BrowserTool.visit()` |
| `youtube-transcript` package | YouTube's `timedtext` endpoint, called directly |

The replacements live in `src/og/lib/research.functions.ts` and are a smaller
dependency surface than the originals: one fewer paid third party, one fewer
gateway, and search results from the providers the rest of LÉLU already uses.
