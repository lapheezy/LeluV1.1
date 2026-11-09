/**
 * ==========================================================
 * LÉLU — public-apis CATALOG PARSER
 *
 * Turns the public-apis README (github.com/public-apis/public-apis)
 * into discovery candidates. The README is UNTRUSTED TEXT: it is
 * parsed as table data only, every field is length-capped, only
 * http(s) links survive, and nothing from it is ever used as an
 * instruction. A candidate is a lead to evaluate, not an
 * integration.
 *
 * Row shape under each "### Category" heading:
 *   | [Name](url) | Description | Auth | HTTPS | CORS |
 * ==========================================================
 */

import { dedupeKey, SOURCE_CATALOG } from "./SourceCatalog.ts";

export interface DiscoveredApi {
  name: string;
  url: string;
  description: string;
  category: string;
  /** "none" when the catalog says No; otherwise the scheme it names (apiKey, OAuth, …). */
  auth: string;
  https: boolean;
  cors: "yes" | "no" | "unknown";
  /** Catalog id when LÉLU already has (or evaluated) this source. */
  knownAs?: string;
}

const MAX_FIELD = 300;
const ROW = /^\|\s*\[([^\]]{1,200})\]\(([^)\s]{1,500})\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/;

function clean(value: string): string {
  return value.replace(/`/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD);
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parsePublicApis(markdown: string): DiscoveredApi[] {
  const known = new Map<string, string>();
  for (const source of SOURCE_CATALOG) {
    known.set(dedupeKey(source.name), source.id);
    known.set(dedupeKey(source.url), source.id);
  }

  const seen = new Set<string>();
  const results: DiscoveredApi[] = [];
  let category = "";
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.{1,80})$/);
    if (heading) {
      // The sponsor block ("APIs Covered Under …") has a 3-column table; it is
      // skipped because ROW requires 5 columns, but keep it out of categories too.
      category = /covered under/i.test(heading[1]) ? "" : clean(heading[1]);
      continue;
    }
    if (!category) continue;
    const row = line.match(ROW);
    if (!row) continue;
    const url = safeUrl(row[2]);
    if (!url) continue;
    const name = clean(row[1]);
    const key = dedupeKey(name) || dedupeKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const auth = clean(row[4]);
    const cors = clean(row[6]).toLowerCase();
    results.push({
      name,
      url,
      description: clean(row[3]),
      category,
      auth: /^no$/i.test(auth) || auth === "" ? "none" : auth,
      https: /^yes$/i.test(clean(row[5])),
      cors: cors === "yes" ? "yes" : cors === "no" ? "no" : "unknown",
      knownAs: known.get(key) ?? known.get(dedupeKey(url)),
    });
  }
  return results;
}

export interface DiscoveryFilter {
  text?: string;
  category?: string;
  /** Only APIs needing no credential, served over HTTPS, browser-callable. */
  freeOpen?: boolean;
  limit?: number;
}

export function filterDiscovered(apis: DiscoveredApi[], filter: DiscoveryFilter = {}): DiscoveredApi[] {
  const words = (filter.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const category = filter.category?.toLowerCase();
  const out = apis.filter((api) => {
    if (category && api.category.toLowerCase() !== category) return false;
    if (filter.freeOpen && !(api.auth === "none" && api.https && api.cors === "yes")) return false;
    if (words.length === 0) return true;
    const haystack = `${api.name} ${api.description} ${api.category}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  return out.slice(0, Math.max(1, Math.min(filter.limit ?? 25, 100)));
}
