/**
 * ==========================================================
 * LÉLU — BROKERED MODEL TRANSPORT
 *
 * One question, asked in one place: when a provider is about to
 * send a request, whose credential goes on it?
 *
 * The broker and the brokered URL already existed —
 * Endpoints.endpointUrl() rewrites a provider's base to
 * /api/model/<id> in the browser, and plugins/modelApi.ts
 * attaches the server's own key. What did not exist was a
 * provider that could work WITHOUT a key of its own, so every
 * provider still resolved a real secret client-side, sent it as
 * a redundant Authorization header the broker ignored, and
 * reported itself unavailable without one. That requirement is
 * the only reason runtimeKeyBridge had to publish real keys
 * into the page.
 *
 * This module breaks that loop. It answers three things:
 *
 *   1. Am I brokered?        → Endpoints.isBrokeredInBrowser
 *   2. Am I configured?      → the SERVER says, via /api/model/status
 *   3. What auth do I send?  → brokered: none. Direct: the real key.
 *
 * It is NOT a second broker and not a second runtime. It adds
 * no transport of its own: providers keep their own fetch, their
 * own request shapes, their own streaming and tool handling. The
 * only thing that moves is ownership of the credential.
 * ==========================================================
 */

import { isBrokeredInBrowser } from "../Endpoints";

/** Providers the server broker fronts. Mirrors modelApi's BROKERED. */
export type BrokeredProviderId =
  | "anthropic"
  | "groq"
  | "openrouter"
  | "cerebras"
  | "mistral"
  | "fireworks"
  | "gemini"
  | "githubModels";

/**
 * Why a provider request failed, in terms a caller can act on.
 *
 * The fallback chain already distinguishes "try the next provider" from
 * "stop"; these make the REASON reportable without ever naming a credential.
 */
export type ProviderErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "BROKER_UNAVAILABLE"
  | "PROVIDER_AUTH_FAILURE"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_REQUEST_FAILURE"
  | "PROVIDER_TIMEOUT"
  | "INVALID_MODEL"
  | "INVALID_REQUEST";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly provider?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Classify an upstream response into a code and a safe message.
 *
 * The body is used to pick the code but never echoed wholesale: provider
 * errors can quote the request, and a quoted request can carry a header.
 */
export function classifyProviderFailure(
  provider: string,
  status: number,
  body = "",
): ProviderError {
  const text = body.toLowerCase();

  if (status === 401 || status === 403) {
    return new ProviderError(
      "PROVIDER_AUTH_FAILURE",
      `${provider}: configured but authentication failed.`,
      provider,
      status,
    );
  }
  if (status === 429) {
    return new ProviderError(
      "PROVIDER_RATE_LIMITED",
      `${provider}: rate limited — the chain will try another provider.`,
      provider,
      status,
    );
  }
  if (status === 402 || text.includes("payment required") || text.includes("insufficient")) {
    return new ProviderError(
      "PROVIDER_REQUEST_FAILURE",
      `${provider}: out of credit.`,
      provider,
      status,
    );
  }
  if (status === 404 && (text.includes("model") || text.includes("not found"))) {
    return new ProviderError("INVALID_MODEL", `${provider}: that model is not available.`, provider, status);
  }
  if (status === 400 || status === 422) {
    return new ProviderError("INVALID_REQUEST", `${provider}: the request was rejected as malformed.`, provider, status);
  }
  if (status === 408 || status === 504) {
    return new ProviderError("PROVIDER_TIMEOUT", `${provider}: timed out.`, provider, status);
  }
  // 5xx from our OWN origin on a brokered path means the broker, not upstream.
  return new ProviderError(
    "PROVIDER_REQUEST_FAILURE",
    `${provider}: request failed (HTTP ${status}).`,
    provider,
    status,
  );
}

/** Is this provider's credential the server's responsibility? */
export function isBrokered(id: BrokeredProviderId): boolean {
  return isBrokeredInBrowser(id);
}

/**
 * Auth headers for an outgoing provider request.
 *
 * Brokered: NONE. The browser has no key to send, and sending one would both
 * require it to hold a secret and be ignored — the broker overwrites auth with
 * the server's own credential. Direct (server-side, tests, Node runtimes): the
 * real header the provider expects.
 */
export function authHeaders(
  id: BrokeredProviderId,
  localKey: string,
  build: (key: string) => Record<string, string>,
): Record<string, string> {
  if (isBrokered(id)) return {};
  return localKey ? build(localKey) : {};
}

/* ------------------------- server-authoritative status ------------------------- */

interface StatusCache {
  providers: Record<string, boolean>;
  fetchedAt: number;
}

let cache: StatusCache | null = null;
let inFlight: Promise<StatusCache> | null = null;

/** How long a status answer is trusted. Configuration does not change often. */
const STATUS_TTL_MS = 60_000;

/**
 * Ask the server which providers it can actually reach.
 *
 * One request, cached, de-duplicated across concurrent callers — six providers
 * initialising at once must not become six identical requests. Returns booleans
 * only; the endpoint is built never to return key material.
 */
async function loadStatus(): Promise<StatusCache> {
  if (cache && Date.now() - cache.fetchedAt < STATUS_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch("/api/model/status", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as { providers?: Record<string, boolean> };
      cache = { providers: body.providers ?? {}, fetchedAt: Date.now() };
      return cache;
    } catch {
      // The broker being unreachable is not the same as nothing being
      // configured, but a provider cannot send without it either way. Cache
      // the empty answer briefly so a dead broker is not polled per request.
      cache = { providers: {}, fetchedAt: Date.now() };
      return cache;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Warm the status cache. Called once during provider registration so the
 * first turn does not pay for the lookup.
 */
export async function primeBrokerStatus(): Promise<Record<string, boolean>> {
  if (typeof fetch !== "function") return {};
  const { providers } = await loadStatus();
  return providers;
}

/** What the server last said about this provider. Undefined = not yet known. */
export function brokerKnows(id: BrokeredProviderId): boolean | undefined {
  return cache?.providers[id];
}

/**
 * Is this provider usable?
 *
 * Brokered: whatever the SERVER says — the browser is not entitled to an
 * opinion, because forming one requires seeing a key. Before the first status
 * answer arrives this returns true: the provider is allowed into the chain and
 * a real attempt decides it. Reporting "not configured" from ignorance would
 * silently drop a working provider on the first turn after a cold start.
 *
 * Direct: the local key, as before.
 */
export function providerConfigured(id: BrokeredProviderId, localKey: string): boolean {
  if (!isBrokered(id)) return localKey.length > 0;
  const known = brokerKnows(id);
  return known === undefined ? true : known;
}
