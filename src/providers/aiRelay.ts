/**
 * ==========================================================
 * LÉLU — PROVIDER CREDENTIAL RELAY (client side)
 *
 * The browser half of `plugins/aiProxyApi.ts`.
 *
 * A provider used to hold its own API key, read from
 * `import.meta.env.VITE_*`, which Vite inlines into the client
 * bundle. This module lets a provider make the identical upstream
 * call WITHOUT ever holding a key: the request goes same-origin to
 * `/api/ai/relay`, and the server attaches the credential.
 *
 * This is not a second provider, router, or fallback chain. Each
 * provider still builds its own payload, picks its own model, parses
 * its own response and throws its own errors, so ProviderResolver's
 * existing priority + failover behaviour is completely unchanged.
 * The relay returns the upstream status and body verbatim — a 500
 * still reads as a 500, an SSE stream still streams — so a provider
 * cannot tell the difference apart from where the key lives.
 *
 * Precedence is deliberate:
 *   1. a locally-held key (a developer's .env) → direct call, exactly
 *      as before, so existing local setups keep working unchanged;
 *   2. otherwise the relay, when the server reports the provider
 *      configured;
 *   3. otherwise the provider is honestly unavailable.
 * ==========================================================
 */

/** Provider ids understood by the relay — must match plugins/aiProxyApi.ts. */
export type RelayProviderId =
  | "anthropic"
  | "groq"
  | "openrouter"
  | "cerebras"
  | "mistral"
  | "fireworks"
  | "githubmodels";

/**
 * How a provider presents a LOCALLY-held key on the direct path.
 *
 * Only relevant when a runtime injected a key deliberately (a
 * verification script, a native shell) — the relay handles the normal
 * case server-side. Nearly every provider takes a bearer token, but
 * Anthropic's Messages API uses `x-api-key`; sending Bearer there is a
 * 401, which would silently drop Claude out of the fallback chain in
 * exactly the runtimes that bothered to supply a key.
 */
function directAuthHeaders(provider: RelayProviderId, apiKey: string): Record<string, string> {
  if (provider === "anthropic") {
    return { "x-api-key": apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

let statusPromise: Promise<Record<string, boolean>> | null = null;

/**
 * Which providers the SERVER holds a credential for. Booleans only —
 * the endpoint never returns a key, a prefix, or a length.
 *
 * Memoized: provider initialization runs for every provider at
 * startup and this must not become six requests. `refreshRelayStatus`
 * clears it for tests and for a runtime that gains credentials later.
 */
export function relayStatus(): Promise<Record<string, boolean>> {
  if (statusPromise) return statusPromise;
  statusPromise = (async () => {
    try {
      const response = await fetch("/api/ai/providers", {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return {};
      const payload = (await response.json()) as {
        ok?: boolean;
        providers?: Record<string, { configured?: boolean }>;
      };
      if (!payload.ok || !payload.providers) return {};
      const out: Record<string, boolean> = {};
      for (const [id, entry] of Object.entries(payload.providers)) {
        out[id] = entry?.configured === true;
      }
      return out;
    } catch {
      // No relay in this runtime (a static deployment, or a plain
      // node/bun verification run). Not an error — the provider simply
      // falls back to its local key, or reports itself unavailable.
      return {};
    }
  })();
  return statusPromise;
}

/** Forget the cached capability report (tests, or credentials added later). */
export function refreshRelayStatus(): void {
  statusPromise = null;
}

/** Whether the server can supply this provider's credential. */
export async function relayAvailable(provider: RelayProviderId): Promise<boolean> {
  return (await relayStatus())[provider] === true;
}

/**
 * Make a provider's upstream request.
 *
 * `url` is the provider's real upstream URL — the same string it
 * would have fetched directly — so the call site stays readable and
 * a provider's endpoint is never duplicated in a second table.
 *
 * When `apiKey` is present the call goes out directly, unchanged.
 * Otherwise it is relayed, and the server attaches the credential.
 */
export async function providerFetch(
  provider: RelayProviderId,
  url: string,
  options: {
    apiKey: string;
    headers?: Record<string, string>;
    body: unknown;
    signal?: AbortSignal;
  },
): Promise<Response> {
  if (options.apiKey) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {}),
        ...directAuthHeaders(provider, options.apiKey),
      },
      body: JSON.stringify(options.body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  const target = new URL(url);
  return relayFetchJson(provider, target, options);
}

function relayFetchJson(
  provider: RelayProviderId,
  target: URL,
  options: { headers?: Record<string, string>; body: unknown; signal?: AbortSignal },
): Promise<Response> {
  return fetch("/api/ai/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      path: `${target.pathname}${target.search}`,
      // Non-secret headers only (e.g. OpenRouter's HTTP-Referer). The
      // server drops anything not on its own allowlist regardless.
      headers: options.headers ?? {},
      body: options.body,
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/** Knowledge/research providers the relay can reach — see aiProxyApi.ts. */
export type RelayKnowledgeId = "news" | "youtube";

/**
 * A knowledge-provider GET, with the credential added server-side.
 *
 * NewsAPI and the YouTube Data API take their key as a query parameter
 * and were called straight from the browser, so those keys shipped in
 * the bundle too. `url` is the real upstream URL WITHOUT the key; the
 * server appends it.
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

/** Whether the server holds this knowledge provider's credential. */
export async function knowledgeAvailable(provider: RelayKnowledgeId): Promise<boolean> {
  try {
    const response = await fetch("/api/ai/providers", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const payload = (await response.json()) as {
      knowledge?: Record<string, { configured?: boolean }>;
    };
    return payload.knowledge?.[provider]?.configured === true;
  } catch {
    return false;
  }
}

/**
 * The same thing for a request whose body cannot go inside a JSON
 * envelope — speech-to-text posts multipart audio. The body is sent
 * byte-for-byte and the server attaches the credential, so voice does
 * not need a browser-side key either.
 */
export async function providerFetchRaw(
  provider: RelayProviderId,
  url: string,
  options: { apiKey: string; body: BodyInit; signal?: AbortSignal },
): Promise<Response> {
  if (options.apiKey) {
    return fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: options.body,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  const target = new URL(url);
  const query = new URLSearchParams({
    provider,
    path: `${target.pathname}${target.search}`,
  });
  // No Content-Type is set deliberately: the browser writes the
  // multipart boundary itself, and the relay forwards that header
  // verbatim so the upstream can parse the parts.
  return fetch(`/api/ai/relay-raw?${query.toString()}`, {
    method: "POST",
    body: options.body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
