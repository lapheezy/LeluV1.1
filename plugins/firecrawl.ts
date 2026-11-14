/**
 * ==========================================================
 * LÉLU — FIRECRAWL (server side, every configured key)
 *
 * The page reader (`/api/browse`, plugins/browseApi.ts) fetches a page
 * directly and extracts its text. That fails on pages built by scripts and
 * on sites that refuse plain fetches. Firecrawl renders the page in a real
 * browser and returns its main content as markdown, so it is the reader's
 * fallback — not a second browsing system, and not a new model tool:
 * `browser.read` → BrowserTool → /api/browse → (direct | Firecrawl).
 *
 * Keys: FIRECRAWL_API_KEY, FIRECRAWL_API_KEY_1.._4 — all of them, rotated.
 * Values are trimmed (stored keys have arrived with a trailing space, which
 * Firecrawl rejects). A key that is out of credits, rate-limited or refused
 * sits out for a while and the next key is tried. Keys never leave the
 * server and are never logged; only slot numbers are reported.
 * ==========================================================
 */

export type EnvReader = (name: string) => string | undefined;

export const FIRECRAWL_KEY_NAMES = [
  "FIRECRAWL_API_KEY",
  "FIRECRAWL_API_KEY_1",
  "FIRECRAWL_API_KEY_2",
  "FIRECRAWL_API_KEY_3",
  "FIRECRAWL_API_KEY_4",
] as const;

const API = "https://api.firecrawl.dev/v1";

/** How long a key sits out, by why it was refused. */
const COOLDOWN_MS = {
  credits: 60 * 60_000, // 402: out of credits — wait for the billing period / top-up
  refused: 60 * 60_000, // 401/403: the key itself is rejected
  rate: 60_000, // 429: per-minute limit
} as const;

export interface FirecrawlPage {
  url: string;
  title: string;
  text: string;
  /** 1-based key slot that served it (never the key). */
  slot: number;
}

export class FirecrawlError extends Error {
  readonly status: number;
  readonly attempts: Array<{ slot: number; status: number }>;
  constructor(message: string, status: number, attempts: Array<{ slot: number; status: number }>) {
    super(message);
    this.status = status;
    this.attempts = attempts;
  }
}

export interface FirecrawlClient {
  configured(): boolean;
  keyCount(): number;
  scrape(url: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<FirecrawlPage>;
  /** Remaining credits per slot, for status and verification (no key material). */
  credits(): Promise<Array<{ slot: number; remaining: number | null; cooling: boolean; error?: string }>>;
}

export function firecrawlKeys(read: EnvReader): string[] {
  const keys: string[] = [];
  for (const name of FIRECRAWL_KEY_NAMES) {
    const value = (read(name) ?? "").trim();
    if (value && !keys.includes(value)) keys.push(value);
  }
  return keys;
}

export function createFirecrawl(read: EnvReader, doFetch: typeof fetch = fetch, now: () => number = Date.now): FirecrawlClient {
  const keys = firecrawlKeys(read);
  const coolingUntil = new Map<number, number>();
  let next = 0; // round-robin start, so credits are spent across accounts

  const available = (): number[] => {
    const order: number[] = [];
    for (let i = 0; i < keys.length; i += 1) {
      const slot = (next + i) % keys.length;
      if ((coolingUntil.get(slot) ?? 0) <= now()) order.push(slot);
    }
    return order;
  };

  return {
    configured: () => keys.length > 0,
    keyCount: () => keys.length,

    async scrape(url, options = {}) {
      if (keys.length === 0) throw new FirecrawlError("Firecrawl is not configured", 503, []);
      const attempts: Array<{ slot: number; status: number }> = [];
      const order = available();
      if (order.length === 0) throw new FirecrawlError("every Firecrawl key is cooling down (credits or rate limit)", 429, attempts);
      next = (next + 1) % keys.length;
      for (const slot of order) {
        const signals = [AbortSignal.timeout(options.timeoutMs ?? 25_000)];
        if (options.signal) signals.push(options.signal);
        let response: Response;
        try {
          response = await doFetch(`${API}/scrape`, {
            method: "POST",
            headers: { Authorization: `Bearer ${keys[slot]}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
            signal: AbortSignal.any(signals),
          });
        } catch (error) {
          // A timeout or network failure is about the page/request, not the key.
          throw new FirecrawlError(error instanceof Error && error.name === "TimeoutError" ? "Firecrawl timed out" : "Firecrawl could not be reached", 504, attempts);
        }
        attempts.push({ slot: slot + 1, status: response.status });
        if (response.status === 402 || response.status === 401 || response.status === 403 || response.status === 429) {
          coolingUntil.set(slot, now() + (response.status === 402 ? COOLDOWN_MS.credits : response.status === 429 ? COOLDOWN_MS.rate : COOLDOWN_MS.refused));
          await response.body?.cancel().catch(() => undefined);
          continue; // another key may serve it
        }
        const payload = (await response.json().catch(() => null)) as
          | { success?: boolean; error?: string; data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string; url?: string; statusCode?: number } } }
          | null;
        if (!response.ok || !payload?.success) {
          // The page itself failed (bad URL, site error): no other key changes that.
          throw new FirecrawlError(payload?.error ? String(payload.error).slice(0, 200) : `Firecrawl answered ${response.status}`, response.status, attempts);
        }
        const meta = payload.data?.metadata ?? {};
        return {
          url: meta.sourceURL ?? meta.url ?? url,
          title: String(meta.title ?? "").trim(),
          text: String(payload.data?.markdown ?? "").trim(),
          slot: slot + 1,
        };
      }
      throw new FirecrawlError("every Firecrawl key refused the request (credits, rate limit or key)", 429, attempts);
    },

    async credits() {
      return Promise.all(
        keys.map(async (key, slot) => {
          const cooling = (coolingUntil.get(slot) ?? 0) > now();
          try {
            const response = await doFetch(`${API}/team/credit-usage`, {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(8_000),
            });
            const body = (await response.json().catch(() => null)) as { data?: { remaining_credits?: number } } | null;
            if (!response.ok) return { slot: slot + 1, remaining: null, cooling, error: `HTTP ${response.status}` };
            return { slot: slot + 1, remaining: body?.data?.remaining_credits ?? null, cooling };
          } catch {
            return { slot: slot + 1, remaining: null, cooling, error: "unreachable" };
          }
        }),
      );
    },
  };
}
