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
export type RelayKnowledgeId = "news" | "youtube";

/**
 * A knowledge-provider GET, with the credential added server-side.
 *
 * `url` is the real upstream URL WITHOUT the key; the server appends it.
 */
export async function knowledgeFetch(
  provider: RelayKnowledgeId,
  url: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  const target = new URL(url);
  const query = new URLSearchParams({
    provider,
    path: `${target.pathname}${target.search}`,
  });
  return fetch(`/api/knowledge/relay?${query.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}
