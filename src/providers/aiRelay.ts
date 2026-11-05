/**
 * ==========================================================
 * LÉLU — KNOWLEDGE CREDENTIAL RELAY (client side)
 *
 * The browser half of the knowledge half of `plugins/aiProxyApi.ts`.
 *
 * NewsAPI and the YouTube Data API take their key as a QUERY PARAMETER
 * and were called straight from the browser, so those keys shipped in
 * the bundle. This module makes the identical upstream call without the
 * browser ever holding one: the request goes same-origin and the server
 * appends the credential.
 *
 * WHAT THIS FILE IS NOT
 *
 * It used to also relay AI model providers — a second server-owned
 * credential mechanism alongside the model broker (`core/Endpoints`
 * → `/api/model/<provider>/…`), with its own allowlist, its own
 * `/api/ai/providers` status endpoint, its own cache and its own
 * provider-id spelling. Two mechanisms for one responsibility is two
 * places to register the next provider and one of them to forget, and
 * the id vocabularies had already drifted apart.
 *
 * Model traffic — chat, tools, streaming AND audio — now goes through
 * the broker only. Nothing about credentials belongs here except the
 * knowledge providers, which are a different registry reaching a
 * different server endpoint with a different (query-parameter) auth
 * shape. Do not add a model provider back to this file.
 * ==========================================================
 */

/** Knowledge/research providers the relay can reach — see aiProxyApi.ts. */
export type RelayKnowledgeId = "news" | "youtube" | "meshy" | "guardian" | "gnews" | "newsdata" | "geoapify" | "nasa" | "firms";

/**
 * A knowledge-provider GET, with the credential added server-side.
 *
 * `url` is the real upstream URL WITHOUT the key; the server appends it.
 */
export async function knowledgeFetch(
  provider: RelayKnowledgeId,
  url: string,
  options?: { signal?: AbortSignal; method?: "GET" | "POST"; body?: unknown },
): Promise<Response> {
  const target = new URL(url);
  const query = new URLSearchParams({
    provider,
    path: `${target.pathname}${target.search}`,
  });
  const post = options?.method === "POST";
  return fetch(`/api/knowledge/relay?${query.toString()}`, {
    method: post ? "POST" : "GET",
    headers: post ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
    ...(post ? { body: JSON.stringify(options?.body ?? {}) } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

/**
 * Whether the server holds a key for this provider. Booleans only; false
 * when there is no server (a static build) or it cannot be reached.
 */
export async function knowledgeConfigured(provider: RelayKnowledgeId): Promise<boolean> {
  try {
    const response = await fetch("/api/knowledge/providers", { headers: { Accept: "application/json" } });
    if (!response.ok) return false;
    const data = (await response.json()) as Record<string, unknown>;
    const knowledge = (data.knowledge ?? data) as Record<string, { configured?: boolean } | undefined>;
    return knowledge[provider]?.configured === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Synchronous availability for providers whose canSearch() is sync.   */
/* ------------------------------------------------------------------ */

let availability: Record<string, boolean> | null = null;
let availabilityRequest: Promise<void> | null = null;

/**
 * Whether the server holds a key for `provider`: true / false once the
 * server has answered, undefined before. The first call starts one
 * request to /api/knowledge/providers (booleans only — no key ever
 * reaches the browser); later calls read the cached answer.
 */
export function knowledgeAvailable(provider: RelayKnowledgeId): boolean | undefined {
  if (availability) return availability[provider] === true;
  if (!availabilityRequest && typeof fetch === "function") {
    availabilityRequest = fetch("/api/knowledge/providers", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const data = response.ok ? ((await response.json()) as Record<string, unknown>) : {};
        const knowledge = (data.knowledge ?? data) as Record<string, { configured?: boolean } | undefined>;
        availability = Object.fromEntries(Object.entries(knowledge).map(([id, entry]) => [id, entry?.configured === true]));
      })
      .catch(() => {
        availability = {};
      });
  }
  return undefined;
}
