/**
 * ==========================================================
 * LÉLU — CORS-RESILIENT FETCH
 *
 * Knowledge providers run inside the browser, where many news
 * APIs and RSS hosts send no `Access-Control-Allow-Origin`
 * header. Those requests fail with a TypeError BEFORE any
 * data is received — even though the same endpoint works from
 * a server.
 *
 * This helper tries the direct request first (zero overhead
 * when the host allows CORS), and on network-level failure
 * retries once through a public CORS relay so LÉLU's existing
 * providers keep working from the browser. No provider logic
 * changes — this is purely a transport-level fallback.
 * ==========================================================
 */

const RELAY = "https://api.allorigins.win/raw?url=";

export async function corsFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 12000,
): Promise<Response> {
  const attempt = async (target: string): Promise<Response> => {
    const response = await fetch(target, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // A CORS-blocked response can surface as an opaque/errored
    // response in some browsers — treat those as failures too.
    if (response.type === "opaque" && response.status === 0) {
      throw new TypeError("Opaque CORS response");
    }
    return response;
  };

  try {
    return await attempt(url);
  } catch (error) {
    // Only transport-level failures (CORS blocks, DNS, aborted
    // preflight) justify the relay — HTTP error statuses from a
    // real response must propagate untouched.
    const transportFailure =
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "NetworkError");

    if (!transportFailure) {
      throw error;
    }

    return attempt(`${RELAY}${encodeURIComponent(url)}`);
  }
}
