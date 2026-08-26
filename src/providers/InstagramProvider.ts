/**
 * LÉLU Instagram Graph API provider.
 *
 * This reads media for a configured Instagram Business/Creator account.
 * It is intentionally disabled until both the Graph access token and
 * Instagram user id are supplied through the environment.
 */

import { BaseProvider } from "./BaseProvider";
import type { KnowledgeResult } from "./Provider";

interface InstagramMedia {
  id?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
}

export default class InstagramProvider extends BaseProvider {
  readonly name = "instagram";
  readonly category = "social";
  readonly priority = 92;
  readonly requiresApiKey = true;
  readonly timeout = 12000;
  readonly cooldown = 1000;
  readonly maxConcurrent = 2;
  readonly capabilities = ["instagram", "social", "media", "photo", "reels"] as const;

  constructor() {
    super();
    // Configuration is server-side; the provider stays registered so a
    // missing account reports honestly and the resolver can continue through
    // its normal fallback chain.
    this.enabled = true;
  }

  canHandle(query: string): boolean {
    // "elpheru" is included so a bare brand query (no "instagram" word)
    // still routes to the live Instagram Graph API when it is configured.
    return /\b(?:instagram|ig|reels?|posts?|social media|elpheru)\b/i.test(query);
  }

  protected async execute(query: string): Promise<KnowledgeResult[]> {
    if (!this.enabled) return [];

    const url = new URL("/api/instagram/media", window.location.origin);
    url.searchParams.set("query", query);
    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: InstagramMedia[];
      error?: string;
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? `Instagram API ${response.status}`);
    }

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2 && !/^(instagram|ig|show|find|search|posts?|reels?)$/.test(term));

    return (payload.data ?? [])
      .filter((item) => {
        if (terms.length === 0) return true;
        const text = `${item.caption ?? ""} ${item.media_type ?? ""}`.toLowerCase();
        return terms.some((term) => text.includes(term));
      })
      .slice(0, 10)
      .map((item, index) => ({
        id: item.id ?? `instagram-${index}`,
        title: item.caption?.split(/\s+/).slice(0, 12).join(" ") || `${item.media_type ?? "Media"} from Instagram`,
        content: item.caption ?? "Instagram media item",
        url: item.permalink,
        source: item.username ? `Instagram @${item.username}` : "Instagram",
        confidence: 0.92,
        timestamp: item.timestamp,
        metadata: {
          mediaType: item.media_type,
          mediaUrl: item.media_url,
          permalink: item.permalink,
        },
      }));
  }
}
