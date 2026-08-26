/**
 * LÉLU RSS bridge.
 *
 * RSS is fetched server-side so the canonical chat/research path does not
 * depend on browser CORS relays. Feed URLs come from the existing env
 * contract; values and credentials are never returned to the client.
 */

interface ConnectLikeReq {
  method?: string;
  url?: string;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

type EnvReader = (key: string) => string | undefined;
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

interface FeedRecord {
  id: string;
  title: string;
  content: string;
  url?: string;
  source: string;
  timestamp: string;
}

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function tag(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return (match?.[1] ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos);/gi, (entity) => ({
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'",
    }[entity.toLowerCase()] ?? entity))
    .replace(/\s+/g, " ")
    .trim();
}

function feedName(feedUrl: string, env: EnvReader): string {
  if (env("VITE_SAPIOLINGO_RSS_URL")?.trim() === feedUrl || env("SAPIOLINGO_RSS_URL")?.trim() === feedUrl) return "Sapiolingo RSS";
  if (env("VITE_ELPHERU_RSS_URL")?.trim() === feedUrl || env("ELPHERU_RSS_URL")?.trim() === feedUrl) return "Elpheru RSS";
  if (env("VITE_GOOGLE_NEWS_RSS_URL_2")?.trim() === feedUrl || env("GOOGLE_NEWS_RSS_URL_2")?.trim() === feedUrl) return "Google News RSS 2";
  if (feedUrl.includes("news.google.com")) return "Google News";
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, "");
  } catch {
    return "RSS";
  }
}

function parseFeed(feedUrl: string, xml: string, env: EnvReader): FeedRecord[] {
  const blocks = [
    ...xml.matchAll(/<item[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi),
  ];
  const source = feedName(feedUrl, env);
  return blocks.flatMap((match, index) => {
    const item = match[0];
    const title = tag(item, "title");
    if (!title) return [];
    const link = tag(item, "link") || item.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] || "";
    const content = tag(item, "description") || tag(item, "summary") || tag(item, "content:encoded");
    const timestamp = tag(item, "pubDate") || tag(item, "published") || tag(item, "updated") || new Date().toISOString();
    return [{
      id: link || `${feedUrl}#${index}-${title}`,
      title,
      content,
      url: link || undefined,
      source,
      timestamp,
    }];
  });
}

function configuredFeeds(env: EnvReader, query: string): string[] {
  // All user-configured feeds are first-class sources. The two Google News
  // RSS.app feeds are intentionally kept separate so attribution remains
  // accurate; the built-in Google News template remains a final fallback.
  const configured = [
    env("VITE_SAPIOLINGO_RSS_URL")?.trim() || env("SAPIOLINGO_RSS_URL")?.trim() || "",
    env("VITE_ELPHERU_RSS_URL")?.trim() || env("ELPHERU_RSS_URL")?.trim() || "",
    env("VITE_GOOGLE_NEWS_RSS_URL")?.trim() || env("GOOGLE_NEWS_RSS_URL")?.trim() || "",
    env("VITE_GOOGLE_NEWS_RSS_URL_2")?.trim() || env("GOOGLE_NEWS_RSS_URL_2")?.trim() || "",
  ];
  const googleTemplate = env("VITE_GOOGLE_NEWS_TEMPLATE")?.trim() || env("GOOGLE_NEWS_TEMPLATE")?.trim() || "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en";
  if (googleTemplate.includes("{query}")) {
    configured.push(googleTemplate.replace("{query}", encodeURIComponent(query.replace(/\brss\b/gi, "").trim())));
  }
  return configured.filter(Boolean).filter((feed, index, all) => all.indexOf(feed) === index);
}

export function createRssApi(env: EnvReader): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  return {
    attach(middlewares) {
      middlewares.use("/api/rss/search", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
          next();
          return;
        }
        const requestUrl = new URL(req.url ?? "", "http://localhost");
        const query = requestUrl.searchParams.get("query")?.trim() ?? "";
        if (!query) {
          sendJson(res, { ok: true, data: [] });
          return;
        }
        const feeds = configuredFeeds(env, query);
        if (feeds.length === 0) {
          sendJson(res, { ok: false, configured: false, error: "No RSS feeds are configured." }, 503);
          return;
        }
        void Promise.allSettled(
          feeds.map(async (feed) => {
            const response = await fetch(feed, { signal: AbortSignal.timeout(12000) });
            if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);
            return parseFeed(feed, await response.text(), env);
          }),
        ).then((results) => {
          const data = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
          sendJson(res, { ok: true, configured: true, data: data.slice(0, 20) });
        }).catch((error) => {
          sendJson(res, { ok: false, configured: true, error: error instanceof Error ? error.message : String(error) }, 502);
        });
      });
    },
  };
}
