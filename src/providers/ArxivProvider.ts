/**
 * ==========================================================
 * LÉLU
 * ARXIV PROVIDER
 *
 * arXiv's query API answers in Atom XML. This provider used
 * to fetch that XML, discard it, and return a single
 * hardcoded "arXiv parsing coming soon" record carrying the
 * raw document as its content — a fake success, which is
 * worse than no provider at all: it spent a network
 * round-trip and then handed LÉLU's cognition a fabricated
 * result to reason over as though it were a real paper.
 *
 * The Atom is parsed properly here. DOMParser is used where
 * it exists (the browser) and a small scanner covers the
 * server runtimes, which have no XML parser built in.
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";
import { endpointUrl } from "../core/Endpoints";

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  authors: string[];
  link: string;
  categories: string[];
}

/** Undo the five XML entities arXiv's text can contain. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Collapse the hard-wrapped whitespace arXiv abstracts arrive with. */
function tidy(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function parseWithDom(xml: string): ArxivEntry[] | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return null;

  return Array.from(doc.getElementsByTagName("entry")).map((entry) => {
    const text = (tag: string) => entry.getElementsByTagName(tag)[0]?.textContent ?? "";
    const alternate = Array.from(entry.getElementsByTagName("link")).find(
      (link) => link.getAttribute("rel") === "alternate",
    );
    return {
      id: text("id"),
      title: tidy(text("title")),
      summary: tidy(text("summary")),
      published: text("published"),
      authors: Array.from(entry.getElementsByTagName("author")).map((a) =>
        tidy(a.getElementsByTagName("name")[0]?.textContent ?? ""),
      ),
      link: alternate?.getAttribute("href") ?? text("id"),
      categories: Array.from(entry.getElementsByTagName("category"))
        .map((c) => c.getAttribute("term") ?? "")
        .filter(Boolean),
    };
  });
}

/**
 * Server-side fallback. arXiv's Atom is machine-generated and regular, so
 * a scanner is sufficient and avoids adding an XML dependency for one
 * provider — but it is only the fallback: the browser uses a real parser.
 */
function parseWithScanner(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const blocks = xml.split(/<entry\b[^>]*>/).slice(1);

  for (const raw of blocks) {
    const block = raw.split("</entry>")[0] ?? "";
    const one = (tag: string) =>
      tidy(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(block)?.[1] ?? "");

    const authors = Array.from(block.matchAll(/<author\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/g))
      .map((m) => tidy(m[1]))
      .filter(Boolean);
    const categories = Array.from(block.matchAll(/<category\b[^>]*term="([^"]+)"/g))
      .map((m) => m[1])
      .filter(Boolean);
    const alternate =
      /<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(block)?.[1] ??
      /<link\b[^>]*href="([^"]+)"[^>]*rel="alternate"/.exec(block)?.[1] ??
      one("id");

    const title = one("title");
    if (!title) continue;
    entries.push({
      id: one("id"),
      title,
      summary: one("summary"),
      published: one("published"),
      authors,
      link: alternate,
      categories,
    });
  }
  return entries;
}

export default class ArxivProvider implements Provider {
  readonly name = "arxiv";
  readonly category = "research";
  readonly priority = 85;
  readonly enabled = true;
  readonly requiresApiKey = false;
  readonly timeout = 15000;
  readonly cooldown = 1000;
  readonly maxConcurrent = 2;
  readonly capabilities = ["research", "paper", "science", "academia"] as const;

  private readonly endpoint = endpointUrl("arxiv", "api/query");

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const response = await fetch(
      `${this.endpoint}?search_query=all:${encodeURIComponent(query)}` +
        `&start=0&max_results=10&sortBy=relevance`,
      { signal: AbortSignal.timeout(this.timeout) },
    );

    if (!response.ok) {
      throw new Error(`arXiv ${response.status}`);
    }

    const xml = await response.text();
    const entries = parseWithDom(xml) ?? parseWithScanner(xml);

    return entries.map((entry): KnowledgeResult => {
      const authorList =
        entry.authors.length > 3
          ? `${entry.authors.slice(0, 3).join(", ")} et al.`
          : entry.authors.join(", ");
      return {
        id: entry.id || crypto.randomUUID(),
        title: entry.title,
        // The abstract is the substance — this is what makes an arXiv hit
        // usable for reasoning rather than just a link.
        content: authorList ? `${authorList}. ${entry.summary}` : entry.summary,
        url: entry.link,
        source: "arXiv",
        confidence: 0.95,
        timestamp: entry.published,
        metadata: {
          authors: entry.authors,
          categories: entry.categories,
          arxivId: entry.id.split("/abs/")[1] ?? null,
        },
      };
    });
  }
}
