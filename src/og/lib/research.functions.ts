/**
 * OG research functions — Phase 5 placeholder.
 *
 * The real implementation is preserved verbatim in
 * `src/og/_deferred/research.server.ts.txt`: `webSearch`, `scrapeUrl` (via
 * Firecrawl), `youtubeSearch` and `youtubeTranscript`, all of which ran
 * server-side. They become the backbone of the ingestion pipeline in
 * integration-brief §7/§8, reimplemented over v1.1's tool layer — at which
 * point this file goes away.
 *
 * The contract below is byte-for-byte the original's: a discriminated result,
 * never a throw, because ResearchPanel branches on `ok` and renders `error`
 * directly. Returning `{ ok: true, sources: [] }` would have been the easy
 * shortcut and it would have been a lie — brief §12 forbids UI that reports
 * work which did not happen, and an empty source list reads as "searched,
 * found nothing" rather than "not built yet".
 */

export interface ResearchSource {
  url: string;
  title: string;
  description?: string;
}

export type WebSearchResult =
  | { ok: true; sources: ResearchSource[] }
  | { ok: false; error: string };

const NOT_INTEGRATED =
  "Research is not wired into the hybrid runtime yet (integration Phase 5). " +
  "The OG implementation is preserved in src/og/_deferred/research.server.ts.txt.";

/** Same name and call shape as the deferred original, so callers bind
 *  unchanged once Phase 5 lands. */
export async function runWebSearch(_args?: { data?: unknown }): Promise<WebSearchResult> {
  return { ok: false, error: NOT_INTEGRATED };
}

export default runWebSearch;
