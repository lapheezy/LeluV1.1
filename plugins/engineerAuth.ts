/**
 * ==========================================================
 * LÉLU — WHO MAY DRIVE THE ENGINEERING RUNTIME
 *
 * ONE authorization decision, shared by every runtime and every
 * engineering route. Before this module the answer was "anyone":
 * `LELU_ENGINEER_TOKEN` was optional, and when it was unset every
 * endpoint that reads source, runs commands, spawns a preview server or
 * drives a headless browser returned 200 to an unauthenticated caller.
 * A VPS on a public address would have published all of that.
 *
 * The rule is now FAIL CLOSED:
 *
 *   no LELU_ENGINEER_TOKEN configured → 503, the runtime is disabled
 *   token configured, none presented    → 401
 *   token configured, wrong token       → 401
 *   token configured, correct token     → the request proceeds
 *
 * There is deliberately NO loopback exemption. Behind a reverse proxy
 * every request arrives from 127.0.0.1, so an exemption for local
 * addresses would be a total bypass on exactly the deployment this
 * protects — and a "same machine, so trusted" rule is not a boundary at
 * all once the proxy is the only thing in front of the port.
 *
 * The token is compared in constant time: a byte-by-byte comparison
 * that returns as soon as it differs leaks the length of the shared
 * prefix to anyone who can time the response.
 *
 * Two header names are accepted. `x-lelu-token` is what the app sends
 * (src/core/selfdev/SourceAccess.ts) and is the documented name;
 * `x-lelu-engineer-token` is what the self-view routes historically
 * required. They had drifted apart, so with a token configured the app
 * could not reach capture/preview/search at all — every call 401'd. One
 * gate that reads both is the fix, not two gates that disagree.
 * ==========================================================
 */

/** Minimal request shape — connect, Node and Deno all satisfy it. */
interface TokenBearingRequest {
  headers?: Record<string, string | string[] | undefined>;
}

interface TokenBearingResponse {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  /** Node's ServerResponse takes a string; the self-view routes type it
   *  optional. A required-string signature accepts both. */
  end: (body: string) => void;
}

export type EngineerAuthVerdict =
  | { ok: true }
  | {
      ok: false;
      /** 503 when the runtime is not configured at all, 401 when unauthorized. */
      status: 400 | 401 | 503;
      disabled: boolean;
      error: string;
    };

function envValue(key: string): string {
  if (typeof process === "undefined") return "";
  const raw = process.env[key];
  return typeof raw === "string" ? raw.trim() : "";
}

/** The configured access token, or "" when the runtime must stay disabled. */
export function engineerAccessToken(): string {
  return envValue("LELU_ENGINEER_TOKEN");
}

/**
 * Is the engineering runtime available at all?
 *
 * False is the DEFAULT, and it is the safe answer: a deployment that
 * never mentions LELU_ENGINEER_TOKEN exposes no command execution, no
 * source reads and no browser driving to the internet.
 */
export function engineerRuntimeEnabled(): boolean {
  return engineerAccessToken().length > 0;
}

/** Constant-time string equality, so a wrong token reveals nothing by timing. */
function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Both accepted header names, first non-empty wins. */
export function presentedToken(req: TokenBearingRequest): string {
  const headers = req.headers ?? {};
  for (const name of ["x-lelu-token", "x-lelu-engineer-token"]) {
    const value = headers[name];
    const single = Array.isArray(value) ? value[0] : value;
    if (typeof single === "string" && single.length > 0) return single;
  }
  const authorization = headers.authorization;
  const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof bearer === "string" && bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return "";
}

/**
 * The one decision every engineering route asks before doing anything.
 * Never echoes the configured token, its length, or a prefix of it.
 */
export function engineerAuthVerdict(req: TokenBearingRequest): EngineerAuthVerdict {
  const expected = engineerAccessToken();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      disabled: true,
      error:
        "The engineering runtime is disabled on this deployment: LELU_ENGINEER_TOKEN is not set. " +
        "Set it on the server (and VITE_LELU_ENGINEER_TOKEN in the client build) to enable it. " +
        "It is left unset on purpose on a public host — it reads source and runs commands.",
    };
  }
  if (!tokensMatch(presentedToken(req), expected)) {
    return {
      ok: false,
      status: 401,
      disabled: false,
      error: "Engineering runtime requires an access token (send x-lelu-token).",
    };
  }
  return { ok: true };
}

/**
 * Send the refusal. The body carries only what a caller needs to know
 * to proceed — never a workspace path, an operation list, an engine
 * version or anything else about the host.
 */
export function sendEngineerAuthFailure(
  res: TokenBearingResponse,
  verdict: Extract<EngineerAuthVerdict, { ok: false }>,
): void {
  res.statusCode = verdict.status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("WWW-Authenticate", 'Bearer realm="lelu-engineering-runtime"');
  res.end(
    JSON.stringify({
      ok: false,
      disabled: verdict.disabled,
      tokenRequired: !verdict.disabled,
      error: verdict.error,
    }),
  );
}
