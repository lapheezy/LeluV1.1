/**
 * ==========================================================
 * LÉLU — RESEARCH / RETRIEVAL
 *
 * The OG originals ran server-side against a paid scraping
 * service and the YouTube Data API, behind that deployment's
 * hosted gateway. None of that is available here and none of
 * it should be: LÉLU already owns everything these functions
 * need.
 *
 *   web search   →  v1.1's knowledge provider registry
 *                   (Wikipedia, Wikidata, Wikimedia, arXiv,
 *                   CrossRef, OpenAlex, GDELT, HackerNews,
 *                   Guardian, NewsData, RSS …) — keyless for
 *                   the most part, already registered, already
 *                   the thing cognition researches through.
 *   page scrape  →  BrowserTool.visit(), which fetches and
 *                   extracts readable text and classifies its
 *                   failures honestly.
 *   youtube      →  the YouTube Data API directly with the key
 *                   the environment already carries.
 *
 * So this is a smaller dependency surface than the OG had, not
 * a larger one: one fewer paid third party, one fewer gateway,
 * and search results that come from the same providers the
 * rest of LÉLU already trusts.
 *
 * The return shapes match the OG originals exactly, because
 * ResearchPanel and the ingestion tools branch on them.
 * ==========================================================
 */

import AIService from "../../core/AIService";
import BrowserTool from "../../core/browser/BrowserTool";
import { resolveFirst } from "../../core/resolveEnv";

export interface ResearchSource {
  url: string;
  title: string;
  description?: string;
}

export type WebSearchResult =
  | { ok: true; sources: ResearchSource[] }
  | { ok: false; error: string };

/**
 * Search the knowledge providers LÉLU already has.
 *
 * Providers are asked whether they can handle the query before being run, so
 * a geography question does not go to arXiv. Individual failures are absorbed
 * — a registry of thirty providers will always have one having a bad day, and
 * that is not a failed search.
 */
export async function runWebSearch(args?: { data?: unknown }): Promise<WebSearchResult> {
  const input = (args?.data ?? {}) as { query?: string; limit?: number };
  const query = (input.query ?? "").trim();
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 20);

  if (!query) return { ok: false, error: "Nothing to search for." };

  try {
    const registry = AIService.getInstance().getKnowledgeProviderRegistry();
    const candidates = registry.all().filter((provider) => {
      try {
        return provider.enabled && provider.canSearch(query);
      } catch {
        return false;
      }
    });

    if (candidates.length === 0) {
      return { ok: false, error: "No research provider handles that kind of query." };
    }

    const settled = await Promise.all(
      candidates.map(async (provider) => {
        try {
          return await provider.search(query);
        } catch {
          return [];
        }
      }),
    );

    const sources = settled
      .flat()
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, limit)
      .map((result) => ({
        url: result.url ?? "",
        title: result.title || result.source,
        description: result.content?.slice(0, 300),
      }))
      .filter((source) => source.title.length > 0);

    if (sources.length === 0) {
      return { ok: false, error: `Nothing found for "${query}".` };
    }
    return { ok: true, sources };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type ScrapeResult =
  | { ok: true; url: string; title: string; text: string }
  | { ok: false; error: string };

/** Read a page. Uses the browser tool LÉLU already fetches with. */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  try {
    const page = await BrowserTool.visit(url);
    if (page.status !== "read" || !page.text) {
      return {
        ok: false,
        error:
          page.error ??
          (page.status === "blocked"
            ? "That page refuses to be read directly."
            : "That page could not be retrieved."),
      };
    }
    return { ok: true, url: page.url, title: page.title, text: page.text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface YouTubeHit {
  videoId: string;
  title: string;
  url: string;
  description?: string;
}

/** Search YouTube with the key the environment already carries. */
export async function youtubeSearch(query: string, max = 6): Promise<
  { ok: true; hits: YouTubeHit[] } | { ok: false; error: string }
> {
  const key = resolveFirst("YOUTUBE_API_KEY");
  if (!key) return { ok: false, error: "No YouTube API key is configured." };

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", String(Math.min(Math.max(max, 1), 25)));
    url.searchParams.set("q", query);
    url.searchParams.set("key", key);

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      return { ok: false, error: `YouTube search failed (HTTP ${response.status}).` };
    }
    const body = (await response.json()) as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string } }>;
    };

    const hits = (body.items ?? [])
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        videoId: item.id!.videoId!,
        title: item.snippet?.title ?? item.id!.videoId!,
        description: item.snippet?.description,
        url: `https://www.youtube.com/watch?v=${item.id!.videoId}`,
      }));

    return { ok: true, hits };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Pull the id out of a watch URL, a youtu.be link, or a bare id. */
export function youtubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.endsWith("youtu.be")) return url.pathname.slice(1) || null;
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * Fetch a video's transcript from YouTube's own timedtext endpoint.
 *
 * The OG version used the `youtube-transcript` package. Calling the endpoint
 * directly avoids adding a dependency for one request, and keeps the failure
 * honest: no captions is a real answer, not an error to retry.
 */
export async function youtubeTranscript(videoIdOrUrl: string): Promise<
  { ok: true; videoId: string; text: string } | { ok: false; error: string }
> {
  const videoId = youtubeVideoId(videoIdOrUrl);
  if (!videoId) return { ok: false, error: "That is not a YouTube video link." };

  try {
    const url = new URL("https://www.youtube.com/api/timedtext");
    url.searchParams.set("v", videoId);
    url.searchParams.set("lang", "en");
    url.searchParams.set("fmt", "json3");

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      return { ok: false, error: `Transcript unavailable (HTTP ${response.status}).` };
    }
    const raw = await response.text();
    if (!raw.trim()) return { ok: false, error: "That video has no captions." };

    const parsed = JSON.parse(raw) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };
    const text = (parsed.events ?? [])
      .flatMap((event) => event.segs ?? [])
      .map((segment) => segment.utf8 ?? "")
      .join("")
      .replace(/\n+/g, " ")
      .trim();

    if (!text) return { ok: false, error: "That video has no captions." };
    return { ok: true, videoId, text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default runWebSearch;
