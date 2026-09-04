/**
 * ==========================================================
 * LÉLU — SERVER-SIDE IDENTITY FOR ENGINEERING APPLY
 *
 * Changing the REAL project is the one engineering action that
 * needs to know WHO is asking, and that question is answered
 * here — on the server, from a verified Supabase access token.
 *
 * Why this exists:
 *   The apply grant used to be a nonce the server handed to
 *   anyone who asked for one, with the actual permission check
 *   living in the browser. A plain `curl` with no identity could
 *   therefore request a grant and write to the real project. The
 *   client-side check is still useful (it stops a model asking
 *   for something the user never authorized) but it is advice,
 *   not enforcement. This is the enforcement.
 *
 * How verification works:
 *   The access token is presented to Supabase's own
 *   GET /auth/v1/user endpoint. Supabase validates the signature
 *   and expiry and returns the user. That needs only the project
 *   URL and the PUBLISHABLE (anon) key — never the service-role
 *   key, and never the JWT secret, so this server holds no
 *   credential capable of impersonating a user.
 *
 * Fail closed:
 *   No Supabase configuration means no way to establish identity,
 *   so apply is REFUSED. Copying, inspecting, editing, validating
 *   and diffing a sandbox workspace all still work without any
 *   identity at all — only the step that reaches the real project
 *   requires one.
 * ==========================================================
 */

export interface VerifiedIdentity {
  userId: string;
  email: string | null;
}

export interface IdentityCheck {
  ok: boolean;
  identity?: VerifiedIdentity;
  /** Safe to show a caller: never contains a token or a key. */
  reason: string;
  status: number;
}

function config(): { url: string; anonKey: string } | null {
  if (typeof process === "undefined") return null;
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim();
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    ""
  ).trim();
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ""), anonKey };
}

/** Is server-side identity verification even possible in this runtime? */
export function identityConfigured(): boolean {
  return config() !== null;
}

/** Read a bearer token without ever logging or returning it. */
function bearer(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers?.["authorization"] ?? req.headers?.["Authorization"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

/**
 * Establish the caller's identity from their Supabase session.
 *
 * Returns a decision rather than throwing, so every refusal carries a
 * reason the caller can act on without any of them leaking the token.
 */
export async function verifyRequestIdentity(req: {
  headers?: Record<string, string | string[] | undefined>;
}): Promise<IdentityCheck> {
  const settings = config();
  if (!settings) {
    return {
      ok: false,
      status: 503,
      reason:
        "This runtime cannot verify who is asking: no Supabase project is configured " +
        "(SUPABASE_URL and SUPABASE_ANON_KEY). Applying changes to the real project is " +
        "refused. Sandbox work does not require identity.",
    };
  }

  const token = bearer(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      reason:
        "No Supabase access token was presented. Applying changes to the real project " +
        "requires an authenticated session.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${settings.url}/auth/v1/user`, {
      headers: {
        // Supabase verifies the signature and expiry; this server never
        // parses or trusts the token itself.
        Authorization: `Bearer ${token}`,
        apikey: settings.anonKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      reason: `Could not reach Supabase to verify the session: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 401,
      reason: `Supabase rejected the session (HTTP ${response.status}). Not applying anything.`,
    };
  }

  let user: { id?: string; email?: string } | null = null;
  try {
    user = (await response.json()) as { id?: string; email?: string };
  } catch {
    user = null;
  }

  if (!user?.id) {
    return { ok: false, status: 401, reason: "Supabase returned no user for that session." };
  }

  return {
    ok: true,
    status: 200,
    identity: { userId: user.id, email: user.email ?? null },
    reason: `Verified Supabase identity ${user.email ?? user.id}.`,
  };
}
