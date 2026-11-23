/**
 * Passwordless email authentication helpers.
 *
 * Kept separate from SupabasePersistence so the request, callback and error
 * semantics can be unit-tested without a network or a browser. The caller
 * passes the existing Supabase auth object; this module never creates a
 * second client, stores a credential, or logs a token.
 */

export interface EmailAuthClient {
  signInWithOtp(credentials: {
    email: string;
    options?: { emailRedirectTo?: string; shouldCreateUser?: boolean };
  }): Promise<{ error: { message?: string } | null }>;
  verifyOtp(params: {
    email: string;
    token: string;
    type: "email";
  }): Promise<{ error: { message?: string } | null }>;
}

/** The only place the sign-in notice is worded, so UI and harness agree. */
export const EMAIL_SIGN_IN_NOTICE =
  "Check your email for a sign-in link. Open it on this device to finish signing in. If the email includes a code, enter it below.";

/**
 * A user-facing message for an auth failure.
 *
 * Supabase can echo the submitted address or part of a URL in an error. The
 * message is not a place for either, so known cases are rewritten and any
 * residual address/token-shaped text is removed. The original is never
 * logged.
 */
export function explainEmailAuthError(message: string | undefined, email?: string): string | null {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/signups? not allowed|email signups? (are )?disabled|otp.*disabled|email.*disabled/.test(lower)) {
    return "This project does not allow email sign-up. Ask the project owner to enable email sign-in or create an account for this address.";
  }
  if (/rate limit|only request this after|too many requests/.test(lower)) {
    return "A sign-in email was requested recently. Wait a moment before requesting another.";
  }
  if (/expired|invalid.*(token|otp|link)|token.*invalid|otp.*invalid|verification.*failed/.test(lower)) {
    return "That sign-in link or code is invalid or has expired. Request a new one.";
  }
  if (/invalid.*email|email.*invalid|unable to validate email/.test(lower)) {
    return "Enter a valid email address.";
  }
  if (/failed to fetch|network|fetch failed|timed? ?out/.test(lower)) {
    return "Could not reach Supabase. Check the network and try again.";
  }
  if (/invalid api key/.test(lower)) {
    return "This deployment's Supabase key is not valid for the configured project.";
  }

  return sanitizeAuthDetail(message, email);
}

/** Remove an address and token-shaped fragments from a diagnostic string. */
export function sanitizeAuthDetail(message: string, email?: string): string {
  let clean = message;
  if (email) clean = clean.split(email).join("the email address");
  clean = clean
    .replace(/access_token=[^\s&"']+/gi, "access_token=[redacted]")
    .replace(/refresh_token=[^\s&"']+/gi, "refresh_token=[redacted]")
    .replace(/token=[^\s&"']+/gi, "token=[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]");
  return clean.length > 300 ? `${clean.slice(0, 297)}...` : clean;
}

/** Ask Supabase to send a normal email sign-in link/code. */
export async function requestEmailLink(
  auth: EmailAuthClient,
  email: string,
  redirectTo?: string,
): Promise<{ error: string | null }> {
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { error: "Enter a valid email address." };
  }
  const { error } = await auth.signInWithOtp({
    email: address,
    options: {
      // The project's Auth settings remain the authority: if sign-up is
      // disabled, Supabase refuses and this returns a useful explanation.
      shouldCreateUser: true,
      ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
    },
  });
  return { error: explainEmailAuthError(error?.message, address) };
}

/** Verify an emailed one-time code when the project's template includes one. */
export async function verifyEmailCode(
  auth: EmailAuthClient,
  email: string,
  token: string,
): Promise<{ error: string | null }> {
  const address = email.trim().toLowerCase();
  const clean = token.replace(/\s+/g, "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { error: "Enter a valid email address." };
  }
  if (!clean) return { error: "Enter the code from your email." };
  const { error } = await auth.verifyOtp({ email: address, token: clean, type: "email" });
  return { error: explainEmailAuthError(error?.message, address) };
}

/**
 * Read only the non-secret error fields of a magic-link callback.
 *
 * A successful callback carries tokens in the fragment; this function never
 * returns them. It exists so a cancelled or expired sign-in can say what
 * happened without surfacing the URL.
 */
export function authCallbackError(hashOrSearch: string): string | null {
  if (!hashOrSearch) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(hashOrSearch.replace(/^[#?]/, ""));
  } catch {
    return null;
  }
  const error = params.get("error");
  const description = params.get("error_description") ?? params.get("error_code");
  if (!error && !description) return null;
  if (/access_denied|cancelled|canceled/i.test(`${error ?? ""} ${description ?? ""}`)) {
    return "Sign-in was cancelled. You can request a new link when you are ready.";
  }
  return "That sign-in link is invalid or has expired. Request a new one.";
}

/** Remove a consumed callback fragment without retaining any token. */
export function stripAuthCallback(hashOrSearch: string): string {
  return hashOrSearch.replace(/^#/, "").replace(/^([?&])/, "");
}
