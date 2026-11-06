/**
 * ==========================================================
 * LÉLU — REFERENCE KNOWLEDGE PROVIDERS
 *
 * Four key-less sources that filled real gaps found in the
 * API-ecosystem inventory (docs/api-ecosystem/PHASE_1_RESEARCH.md):
 *
 *   dictionary         Free Dictionary API   — word definitions
 *   openlibrary        Open Library          — books and authors
 *   frankfurter        Frankfurter (ECB)     — currency reference rates
 *   usgs-earthquakes   USGS FDSN event API   — recent earthquakes
 *
 * Same shape as every other knowledge provider (Provider.ts), so
 * ResearchResolver selects, times out, meters and attributes them
 * exactly like the rest. Each one's canSearch() declines a query
 * that is not its kind, so it costs nothing when it is irrelevant.
 *
 * All four were probed live on 2026-11-06 (HTTP 200, CORS *).
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";
import { endpointUrl } from "../core/Endpoints";

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
const defaultFetch: FetchLike = (url) => fetch(url);

async function getJson(fetcher: FetchLike, url: string, label: string): Promise<any> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${label} ${response.status}`);
  return response.json();
}

const clip = (value: unknown, max = 600): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/* ---------------- dictionary ---------------- */

/** The word a definition question is about, or null when it is not one. */
export function definitionTerm(query: string): string | null {
  const q = query.trim().toLowerCase().replace(/[?.!"“”]+/g, "");
  const asked =
    q.match(/^(?:define|definition of|meaning of|what(?:'s| is) the (?:meaning|definition) of|synonyms? (?:of|for))\s+(?:the word\s+)?([a-z][a-z'-]{0,40})$/) ??
    q.match(/^what does\s+(?:the word\s+)?([a-z][a-z'-]{0,40})\s+mean$/) ??
    q.match(/^([a-z][a-z'-]{0,40})\s+(?:definition|meaning)$/) ??
    q.match(/^([a-z][a-z'-]{1,40})$/);
  return asked ? asked[1] : null;
}

export class DictionaryProvider implements Provider {
  readonly name = "dictionary";
  readonly category = "reference";
  readonly priority = 72;
  readonly enabled = true;
  readonly requiresApiKey = false;
  readonly timeout = 10000;
  readonly cooldown = 500;
  readonly maxConcurrent = 2;
  readonly capabilities = ["dictionary", "definition", "language"] as const;
  constructor(private readonly fetcher: FetchLike = defaultFetch) {}

  canSearch(query: string): boolean {
    return definitionTerm(query) !== null;
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const term = definitionTerm(query);
    if (!term) return [];
    const response = await this.fetcher(endpointUrl("dictionary", `api/v2/entries/en/${encodeURIComponent(term)}`));
    if (response.status === 404) return []; // the API's "no definition found"
    if (!response.ok) throw new Error(`Dictionary ${response.status}`);
    const entries = (await response.json()) as any[];
    if (!Array.isArray(entries)) return [];
    return entries.slice(0, 2).map((entry, index): KnowledgeResult => {
      const senses = (entry.meanings ?? []).flatMap((meaning: any) =>
        (meaning.definitions ?? []).slice(0, 2).map((d: any) => `(${meaning.partOfSpeech}) ${clip(d.definition, 240)}`),
      );
      return {
        id: `dictionary:${term}:${index}`,
        title: `${entry.word ?? term}${entry.phonetic ? ` ${entry.phonetic}` : ""}`,
        content: senses.slice(0, 5).join(" · "),
        url: entry.sourceUrls?.[0],
        source: "Free Dictionary API (Wiktionary)",
        confidence: 0.9,
        metadata: { license: entry.license?.name ?? "CC BY-SA 3.0" },
      };
    });
  }
}

/* ---------------- Open Library ---------------- */

export class OpenLibraryProvider implements Provider {
  readonly name = "openlibrary";
  readonly category = "reference";
  // After every general source: chosen when "books" is the focus, and only
  // last in the keyword-less fallback.
  readonly priority = 90;
  readonly enabled = true;
  readonly requiresApiKey = false;
  readonly timeout = 10000;
  readonly cooldown = 500;
  readonly maxConcurrent = 2;
  readonly capabilities = ["books", "literature", "authors"] as const;
  constructor(private readonly fetcher: FetchLike = defaultFetch) {}

  canSearch(query: string): boolean {
    return query.trim().length > 1;
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const q = query.replace(/\b(books?|novels?|by|written|author of|about)\b/gi, " ").replace(/\s+/g, " ").trim() || query;
    const fields = "key,title,author_name,first_publish_year,edition_count,subject";
    const json = await getJson(this.fetcher, endpointUrl("openlibrary", `search.json?q=${encodeURIComponent(q)}&limit=5&fields=${fields}`), "Open Library");
    return (json.docs ?? []).map((doc: any): KnowledgeResult => ({
      id: `openlibrary:${doc.key}`,
      title: clip(doc.title, 200) || "Untitled",
      content: [
        doc.author_name?.length ? `by ${doc.author_name.slice(0, 3).join(", ")}` : "",
        doc.first_publish_year ? `first published ${doc.first_publish_year}` : "",
        doc.edition_count ? `${doc.edition_count} edition(s)` : "",
        doc.subject?.length ? `subjects: ${doc.subject.slice(0, 5).join(", ")}` : "",
      ].filter(Boolean).join("; "),
      url: doc.key ? `https://openlibrary.org${doc.key}` : undefined,
      source: "Open Library",
      confidence: 0.8,
      metadata: { firstPublishYear: doc.first_publish_year },
    }));
  }
}

/* ---------------- Frankfurter (currency) ---------------- */

const CURRENCY_NAMES: Record<string, string> = {
  dollar: "USD", dollars: "USD", usd: "USD", euro: "EUR", euros: "EUR", pound: "GBP", pounds: "GBP", sterling: "GBP",
  yen: "JPY", yuan: "CNY", renminbi: "CNY", rupee: "INR", rupees: "INR", franc: "CHF", francs: "CHF",
  // "won", "real", "rand" and "try" are left out: as ordinary English words
  // they would turn "the real story in Ukraine" into a currency question.
  peso: "MXN", pesos: "MXN", reais: "BRL", krona: "SEK", kronor: "SEK", lira: "TRY", ringgit: "MYR", zloty: "PLN", baht: "THB",
  "canadian dollar": "CAD", "australian dollar": "AUD", "new zealand dollar": "NZD", "hong kong dollar": "HKD", "singapore dollar": "SGD",
};
/** Currencies the ECB publishes reference rates for (Frankfurter's set). */
const ECB_CODES = new Set("AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR".split(" "));

export interface CurrencyQuestion { amount: number; from: string; to: string[] }

export function currencyQuestion(query: string): CurrencyQuestion | null {
  const text = ` ${query.toLowerCase()} `;
  const found: Array<{ at: number; code: string }> = [];
  const multiWord = Object.keys(CURRENCY_NAMES).filter((name) => name.includes(" "));
  let scrubbed = text;
  for (const name of multiWord) {
    const at = scrubbed.indexOf(` ${name}`);
    if (at >= 0) {
      found.push({ at, code: CURRENCY_NAMES[name] });
      scrubbed = scrubbed.replace(name, " ".repeat(name.length));
    }
  }
  const original = ` ${query} `;
  for (const match of scrubbed.matchAll(/[a-z]+/g)) {
    const word = match[0];
    const at = match.index ?? 0;
    // A bare 3-letter code counts when written in capitals ("USD"), or in
    // lower case unless it is also an English word ("try").
    const asWritten = original.slice(at, at + word.length);
    const isCode = word.length === 3 && ECB_CODES.has(word.toUpperCase()) && (asWritten === word.toUpperCase() || word !== "try");
    const code = CURRENCY_NAMES[word] ?? (isCode ? word.toUpperCase() : undefined);
    if (code) found.push({ at, code });
  }
  found.sort((a, b) => a.at - b.at);
  const codes = [...new Set(found.map((f) => f.code))];
  const strongIntent = /exchange|\brates?\b|convert|conversion|currenc|forex|\bfx\b/.test(text);
  const pairIntent = codes.length >= 2 && /\bto\b|\bin\b|\binto\b|\bvs\.?\b|\bversus\b|\bagainst\b|worth/.test(text);
  if (codes.length === 0 || !(strongIntent || pairIntent)) return null;
  const amount = Number(text.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 1);
  const [from, ...rest] = codes;
  return { amount: Number.isFinite(amount) && amount > 0 ? amount : 1, from, to: rest.length ? rest.slice(0, 5) : from === "USD" ? ["EUR", "GBP", "JPY"] : ["USD", "EUR"] };
}

export class FrankfurterProvider implements Provider {
  readonly name = "frankfurter";
  readonly category = "finance";
  readonly priority = 71;
  readonly enabled = true;
  readonly requiresApiKey = false;
  readonly timeout = 10000;
  readonly cooldown = 500;
  readonly maxConcurrent = 2;
  readonly capabilities = ["currency", "exchange-rate", "finance"] as const;
  constructor(private readonly fetcher: FetchLike = defaultFetch) {}

  canSearch(query: string): boolean {
    return currencyQuestion(query) !== null;
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const ask = currencyQuestion(query);
    if (!ask) return [];
    const json = await getJson(
      this.fetcher,
      endpointUrl("frankfurter", `v1/latest?base=${ask.from}&symbols=${ask.to.join(",")}`),
      "Frankfurter",
    );
    const rates: Record<string, number> = json.rates ?? {};
    return Object.entries(rates).map(([code, rate]): KnowledgeResult => ({
      id: `frankfurter:${ask.from}:${code}:${json.date}`,
      title: `${ask.amount} ${ask.from} = ${(ask.amount * rate).toFixed(4)} ${code}`,
      content:
        `European Central Bank reference rate for ${json.date}: 1 ${ask.from} = ${rate} ${code}. ` +
        "This is a once-daily reference rate, not a live market quote.",
      url: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
      source: "Frankfurter (ECB reference rates)",
      confidence: 0.95,
      timestamp: json.date,
      metadata: { base: ask.from, quote: code, rate, kind: "daily-reference-rate" },
    }));
  }
}

/* ---------------- USGS earthquakes ---------------- */

const QUAKE = /\b(earthquakes?|quakes?|seismic|tremors?|aftershocks?)\b/i;

export class UsgsEarthquakeProvider implements Provider {
  readonly name = "usgs-earthquakes";
  readonly category = "science";
  readonly priority = 73;
  readonly enabled = true;
  readonly requiresApiKey = false;
  readonly timeout = 10000;
  readonly cooldown = 500;
  readonly maxConcurrent = 2;
  readonly capabilities = ["earthquake", "geology", "hazards"] as const;
  constructor(private readonly fetcher: FetchLike = defaultFetch, private readonly now: () => number = () => Date.now()) {}

  canSearch(query: string): boolean {
    return QUAKE.test(query);
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    if (!QUAKE.test(query)) return [];
    const days = /today|last\s+24|past\s+day/i.test(query) ? 1 : /month|30\s+days/i.test(query) ? 30 : 7;
    const start = new Date(this.now() - days * 86_400_000).toISOString().slice(0, 10);
    const place = query
      .replace(QUAKE, " ")
      .replace(/\b(recent|latest|today|this|past|last|week|month|days?|in|near|any|were|was|there|the|a|of|major|big|large|news)\b/gi, " ")
      .replace(/[^a-z\s-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const json = await getJson(
      this.fetcher,
      endpointUrl("usgsEarthquake", `fdsnws/event/1/query?format=geojson&orderby=time&starttime=${start}&minmagnitude=${place ? 2.5 : 4.5}&limit=${place ? 200 : 10}`),
      "USGS",
    );
    const features: any[] = Array.isArray(json.features) ? json.features : [];
    const matching = place ? features.filter((f) => String(f.properties?.place ?? "").toLowerCase().includes(place)) : features;
    return matching.slice(0, 8).map((f): KnowledgeResult => {
      const p = f.properties ?? {};
      const when = typeof p.time === "number" ? new Date(p.time).toISOString() : undefined;
      const depth = f.geometry?.coordinates?.[2];
      return {
        id: `usgs:${f.id}`,
        title: `M${p.mag ?? "?"} — ${clip(p.place, 160) || "unknown location"}`,
        content: `Magnitude ${p.mag} ${p.magType ?? ""} at ${when ?? "unknown time"}${typeof depth === "number" ? `, depth ${depth} km` : ""}. ` +
          `Status: ${p.status ?? "unknown"}${p.tsunami ? "; tsunami flag set" : ""}${p.alert ? `; PAGER alert ${p.alert}` : ""}.`,
        url: p.url,
        source: "USGS Earthquake Hazards Program",
        confidence: p.status === "reviewed" ? 0.95 : 0.85,
        timestamp: when,
        metadata: { magnitude: p.mag, depthKm: depth, status: p.status, windowDays: days, placeFilter: place || null },
      };
    });
  }
}
