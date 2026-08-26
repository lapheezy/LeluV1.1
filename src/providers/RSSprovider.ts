// src/providers/RSSProvider.ts

import { BaseProvider } from "./BaseProvider";
import config from "../core/ProviderConfig";
import { corsFetch } from "./corsFetch";
import type { KnowledgeResult } from "./Provider";

export class RSSProvider extends BaseProvider {
  readonly name = "rss";

  readonly category = "news";

  readonly priority = 73;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["news", "rss", "feed", "current-events"] as const;

  private readonly feeds = [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://techcrunch.com/feed/",
    "https://hnrss.org/frontpage",
    "https://www.nasa.gov/rss/dyn/breaking_news.rss",
  ];

  canHandle(query: string): boolean {
    const q = query.toLowerCase();

    return (
      q.includes("news") ||
      q.includes("latest") ||
      q.includes("today") ||
      q.includes("update") ||
      q.includes("headline") ||
      q.includes("rss") ||
      q.includes("google news") ||
      q.includes("elpheru")
    );
  }

  protected async execute(query: string): Promise<KnowledgeResult[]> {
    // Prefer the same-origin bridge so configured feeds are fetched by the
    // server and are not lost to browser CORS restrictions.
    try {
      const response = await fetch(
        `/api/rss/search?query=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(this.timeout) },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        data?: Array<{
          id: string;
          title: string;
          content: string;
          url?: string;
          source: string;
          timestamp: string;
        }>;
        error?: string;
      };
      if (response.ok && payload.ok) {
        return (payload.data ?? []).slice(0, 10).map((item) => ({
          id: item.id,
          title: item.title,
          content: item.content,
          url: item.url,
          source: item.source,
          confidence: 0.9,
          timestamp: item.timestamp,
        }));
      }
      if (response.status !== 404 && response.status !== 501) {
        throw new Error(payload.error ?? `RSS bridge HTTP ${response.status}`);
      }
    } catch (error) {
      // A static-only host may not expose the bridge. Keep the existing
      // public-feed fallback for that deployment mode, but surface real
      // configured-feed failures through the provider fallback chain.
      if (error instanceof Error && !/404|501|Failed to fetch|NetworkError/i.test(error.message)) {
        throw error;
      }
    }

    const results: KnowledgeResult[] = [];
    for (const feed of this.getFeeds(query)) {
      try {
        const response = await corsFetch(feed, undefined, this.timeout);
        if (!response.ok) continue;
        results.push(...this.parseFeed(feed, await response.text()));
      } catch {
        continue;
      }
    }
    return results.slice(0, 10);
  }

  private getFeeds(query: string): string[] {
    const configured = [
      ...config.rssFeeds,
      this.googleNewsUrl(query),
    ].filter((feed): feed is string => Boolean(feed));

    return [...configured, ...this.feeds].filter(
      (feed, index, all) => all.indexOf(feed) === index,
    );
  }

  private googleNewsUrl(query: string): string {
    const template = config.googleNewsRssUrl;
    if (!template) return "";
    return template.includes("{query}")
      ? template.replace("{query}", encodeURIComponent(query.replace(/\brss\b/gi, "").trim()))
      : template;
  }

  /**
   * Parse <item> (RSS 2.0) and <entry> (Atom) elements into real
   * headlines — the feed URL itself must NEVER appear as a result.
   */
  private parseFeed(
    feedUrl: string,
    xml: string,
  ): KnowledgeResult[] {
    const feedName = this.feedName(feedUrl);
    const blocks = [
      ...xml.matchAll(/<item[\s\S]*?<\/item>/gi),
      ...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi),
    ];

    const parsed: KnowledgeResult[] = [];

    for (const block of blocks) {
      const item = block[0];

      const title =
        this.tag(item, "title") ??
        "";

      if (!title.trim()) {
        continue;
      }

      const link =
        this.tag(item, "link") ??
        item.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ??
        "";

      const description =
        this.tag(item, "description") ??
        this.tag(item, "summary") ??
        this.tag(item, "content:encoded") ??
        "";

      const pubDate =
        this.tag(item, "pubDate") ??
        this.tag(item, "published") ??
        this.tag(item, "updated") ??
        "";

      const text = description
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      parsed.push({
        id: link || `${feedUrl}#${title}`,
        title: title.trim(),
        content: text,
        url: link || undefined,
        source: feedName,
        confidence: 0.85,
        timestamp: pubDate || new Date().toISOString(),
        metadata: { feed: feedUrl },
      });
    }

    return parsed;
  }

  /** First CDATA-free text content of a tag. */
  private tag(xml: string, name: string): string | null {
    const match = xml.match(
      new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"),
    );

    if (!match) {
      return null;
    }

    return match[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .trim();
  }

  private feedName(feedUrl: string): string {
    if (feedUrl.includes("arstechnica")) return "Ars Technica";
    if (feedUrl.includes("techcrunch")) return "TechCrunch";
    if (feedUrl.includes("hnrss")) return "Hacker News";
    if (feedUrl.includes("nasa.gov")) return "NASA";
    if (feedUrl.includes("news.google.com")) return "Google News";
    if (config.sapiolingoRssUrl && feedUrl === config.sapiolingoRssUrl) return "Sapiolingo RSS";
    if (config.elpheruRssUrl && feedUrl === config.elpheruRssUrl) return "Elpheru RSS";
    if (config.googleNewsRssUrl2 && feedUrl === config.googleNewsRssUrl2) return "Google News RSS 2";
    try {
      return new URL(feedUrl).hostname.replace(/^www\./, "");
    } catch {
      return feedUrl;
    }
  }
}