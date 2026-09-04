/**
 * ==========================================================
 * LÉLU
 * NEWS FALLBACK PROVIDERS — GNews, Guardian, NewsData
 *
 * Environment.ts has declared `gnews`, `guardian` and
 * `newsdata` as the fallback chain behind NewsAPI since before
 * this file existed, but no provider implemented them, so the
 * chain had one real link and three declared ones. These are
 * those links.
 *
 * Each requires its own key and reports itself unavailable
 * without one — an unconfigured source returns nothing rather
 * than throwing, so the resolver moves to the next source
 * instead of treating a missing key as an outage.
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";
import { endpoint } from "../core/Endpoints";
import { resolveFirst } from "../core/resolveEnv";

abstract class NewsSourceProvider implements Provider {
  abstract readonly name: string;
  abstract readonly capabilities: readonly string[];
  readonly category = "news";
  readonly priority = 86;
  readonly enabled = true;
  readonly requiresApiKey = true;
  readonly timeout = 15000;
  readonly cooldown = 1000;
  readonly maxConcurrent = 2;

  protected abstract key(): string | undefined;

  canSearch(query: string): boolean {
    // Without a key this source cannot answer, and saying so here keeps
    // it out of the chain rather than failing mid-search.
    return query.trim().length > 0 && Boolean(this.key());
  }

  protected async json(url: string): Promise<any> {
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeout) });
    if (!response.ok) {
      throw new Error(`${this.name} ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return response.json();
  }

  abstract search(query: string): Promise<KnowledgeResult[]>;
}

/* ---------------- GNews ---------------- */

export class GNewsProvider extends NewsSourceProvider {
  readonly name = "gnews";
  readonly capabilities = ["news", "current-events", "world"] as const;

  protected key(): string | undefined {
    return resolveFirst("GNEWS_API_KEY", "VITE_GNEWS_API_KEY");
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const apiKey = this.key();
    if (!apiKey) return [];

    const url =
      `${endpoint("gnews")}/search?q=${encodeURIComponent(query)}` +
      `&lang=en&max=10&apikey=${encodeURIComponent(apiKey)}`;
    const data = await this.json(url);

    return (data.articles ?? []).map((article: any, index: number): KnowledgeResult => ({
      id: `gnews-${index}-${article.publishedAt ?? ""}`,
      title: article.title ?? "Untitled",
      content: article.description ?? article.content ?? "",
      url: article.url ?? "",
      source: article.source?.name ? `GNews — ${article.source.name}` : "GNews",
      confidence: 0.9,
      timestamp: article.publishedAt,
      metadata: { image: article.image ?? null, outlet: article.source?.name ?? null },
    }));
  }
}

/* ---------------- The Guardian ---------------- */

export class GuardianProvider extends NewsSourceProvider {
  readonly name = "guardian";
  readonly capabilities = ["news", "current-events", "world", "analysis"] as const;

  protected key(): string | undefined {
    return resolveFirst("GUARDIAN_API_KEY", "VITE_GUARDIAN_API_KEY");
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const apiKey = this.key();
    if (!apiKey) return [];

    // show-fields=trailText,bodyText gives real article text rather than
    // a headline alone, which is what makes the result reasoning-usable.
    const url =
      `${endpoint("guardian")}/search?q=${encodeURIComponent(query)}` +
      `&page-size=10&order-by=newest&show-fields=trailText,bodyText,thumbnail` +
      `&api-key=${encodeURIComponent(apiKey)}`;
    const data = await this.json(url);

    return (data.response?.results ?? []).map((item: any): KnowledgeResult => ({
      id: `guardian-${item.id}`,
      title: item.webTitle ?? "Untitled",
      content: (item.fields?.trailText ?? item.fields?.bodyText ?? "").slice(0, 4000),
      url: item.webUrl ?? "",
      source: "The Guardian",
      confidence: 0.93,
      timestamp: item.webPublicationDate,
      metadata: {
        section: item.sectionName ?? null,
        pillar: item.pillarName ?? null,
        thumbnail: item.fields?.thumbnail ?? null,
      },
    }));
  }
}

/* ---------------- NewsData.io ---------------- */

export class NewsDataProvider extends NewsSourceProvider {
  readonly name = "newsdata";
  readonly capabilities = ["news", "current-events", "world"] as const;

  protected key(): string | undefined {
    return resolveFirst("NEWSDATA_API_KEY", "VITE_NEWSDATA_API_KEY");
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const apiKey = this.key();
    if (!apiKey) return [];

    const url =
      `${endpoint("newsdata")}/news?apikey=${encodeURIComponent(apiKey)}` +
      `&q=${encodeURIComponent(query)}&language=en`;
    const data = await this.json(url);

    if (data.status && data.status !== "success") {
      throw new Error(`newsdata: ${data.results?.message ?? data.message ?? "request rejected"}`);
    }

    return (data.results ?? []).map((article: any): KnowledgeResult => ({
      id: `newsdata-${article.article_id}`,
      title: article.title ?? "Untitled",
      content: article.description ?? article.content ?? "",
      url: article.link ?? "",
      source: article.source_id ? `NewsData — ${article.source_id}` : "NewsData",
      confidence: 0.88,
      timestamp: article.pubDate,
      metadata: {
        country: article.country ?? null,
        category: article.category ?? null,
        image: article.image_url ?? null,
      },
    }));
  }
}

/**
 * The NewsData live event stream. Exposed as a URL builder rather than a
 * Provider because a socket is a subscription, not a search — nothing in
 * LÉLU consumes a push stream today, and inventing a consumer here would
 * be the same "declared but dead" pattern this work exists to remove.
 * NEWSDATA_WEBSOCKET_URL configures it for whatever does consume it.
 */
export function newsDataWebsocketUrl(): string | null {
  const apiKey = resolveFirst("NEWSDATA_API_KEY", "VITE_NEWSDATA_API_KEY");
  if (!apiKey) return null;
  return `${endpoint("newsdataWebsocket")}?apikey=${encodeURIComponent(apiKey)}`;
}
