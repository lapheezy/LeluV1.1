/**
 * ==========================================================
 * LÉLU — AUTHENTICATED SOURCE ACCESS
 *
 * Integration brief §13: LÉLU should be able to recognise "I
 * need access to this source", open the legitimate login flow,
 * let the user authenticate securely, and resume.
 *
 * The security posture is the whole design, so it is stated
 * plainly. LÉLU NEVER:
 *
 *   - asks the user to type or speak a password or an OTP
 *   - stores a credential, a one-time code, or a cookie jar
 *   - submits a login form on the user's behalf
 *   - attempts to work around a paywall, a rate limit, a
 *     robots policy, or any other access control
 *
 * What she does instead is hand the user a URL and step back.
 * The user signs in through the real site, in a real browser,
 * under their own session — the same thing they would do
 * without her. LÉLU only learns that access became possible,
 * and retries the read.
 *
 * That is why this file has no credential type in it at all.
 * There is nowhere to put a password, which is the strongest
 * guarantee available that one is never kept.
 *
 * WHY DETECTION IS SEPARATE FROM RETRIEVAL
 * ----------------------------------------
 * BrowserTool.visit() already classifies a failed read as
 * "blocked", but that one word covers three different
 * situations with three different remedies: a page that renders
 * with JavaScript (nothing to be done here), a page that is
 * gone (nothing to be done at all), and a page that would be
 * readable if the user were signed in (something the user can
 * fix in ten seconds). Telling the user "that page refuses to
 * be read" when the real answer is "sign in and I'll read it"
 * is a worse failure than not trying.
 * ==========================================================
 */

import BrowserTool, { type BrowserPage } from "./BrowserTool";

export type AccessVerdict =
  | "readable"
  /** Readable once the user is signed in on this origin. */
  | "auth-required"
  /** Renders client-side or refuses direct reading; auth would not help. */
  | "not-directly-readable"
  /** Gone, wrong, or unreachable. */
  | "unavailable";

export interface AccessAssessment {
  verdict: AccessVerdict;
  url: string;
  /** What to tell the user, in their terms. */
  reason: string;
  /**
   * Where the user should sign in, when that is the remedy. Always the
   * source's own origin — never a form LÉLU renders, and never a third party.
   */
  signInUrl?: string;
}

/** Origins whose useful content is behind a session by design. */
const KNOWN_GATED_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "docs.google.com",
  "drive.google.com",
  "mail.google.com",
  "notion.so",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "medium.com",
  "substack.com",
];

/** Wording that means "you are not signed in", not "this is broken". */
const AUTH_MARKERS = [
  "sign in to continue",
  "log in to continue",
  "please sign in",
  "please log in",
  "you must be logged in",
  "session expired",
  "authentication required",
  "unauthorized",
  "members only",
  "subscribers only",
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Does this host normally require a session for its real content? */
export function isKnownGatedHost(url: string): boolean {
  const host = hostOf(url);
  return KNOWN_GATED_HOSTS.some((gated) => host === gated || host.endsWith(`.${gated}`));
}

/**
 * Decide what actually stands between LÉLU and this source.
 *
 * Takes a page BrowserTool has already fetched, so no extra request is made
 * just to classify a failure.
 */
export function assessAccess(page: BrowserPage): AccessAssessment {
  const url = page.url;
  const signInUrl = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  })();

  if (page.status === "read" && page.text.trim().length > 0) {
    // A 200 that renders a login wall is still a login wall.
    const head = page.text.toLowerCase().slice(0, 1_500);
    const gated = AUTH_MARKERS.some((marker) => head.includes(marker));
    if (gated && page.text.length < 4_000) {
      return {
        verdict: "auth-required",
        url,
        reason: "That page is showing a sign-in wall rather than its content.",
        signInUrl,
      };
    }
    return { verdict: "readable", url, reason: "The page was read." };
  }

  const error = (page.error ?? "").toLowerCase();

  if (/http 401|http 403/.test(error) || AUTH_MARKERS.some((m) => error.includes(m))) {
    return {
      verdict: "auth-required",
      url,
      reason: "That source refused access — it needs you to be signed in.",
      signInUrl,
    };
  }

  if (isKnownGatedHost(url)) {
    return {
      verdict: "auth-required",
      url,
      reason: `${hostOf(url)} keeps that behind a login, so it can only be read while you are signed in.`,
      signInUrl,
    };
  }

  if (/http 4\d\d|http 5\d\d|not found|timed out/.test(error)) {
    return { verdict: "unavailable", url, reason: page.error ?? "That source could not be reached." };
  }

  return {
    verdict: "not-directly-readable",
    url,
    reason:
      page.error ??
      "That page renders in the browser rather than serving readable text, so signing in would not help.",
  };
}

/** A read waiting on the user to authenticate. */
export interface PendingAccess {
  id: string;
  url: string;
  signInUrl?: string;
  reason: string;
  requestedAt: number;
}

/**
 * Reads parked until the user signs in.
 *
 * Held in memory only, and holding nothing but a URL. There is deliberately no
 * persistence: a parked read that outlives the session is a URL LÉLU would
 * retry against a session that no longer exists, and nothing here is valuable
 * enough to be worth writing down.
 */
export class AuthorizationQueue {
  private static instance: AuthorizationQueue | null = null;
  private readonly pending = new Map<string, PendingAccess>();

  static getInstance(): AuthorizationQueue {
    if (!AuthorizationQueue.instance) AuthorizationQueue.instance = new AuthorizationQueue();
    return AuthorizationQueue.instance;
  }

  /**
   * Park a read and describe what the user must do.
   *
   * The returned request carries a URL and a sentence. It never carries a
   * form, a field, or anywhere for a secret to be typed — LÉLU's part of this
   * is asking, and the sign-in happens somewhere she cannot see.
   */
  request(assessment: AccessAssessment): PendingAccess {
    const id = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: PendingAccess = {
      id,
      url: assessment.url,
      signInUrl: assessment.signInUrl,
      reason: assessment.reason,
      requestedAt: Date.now(),
    };
    this.pending.set(id, entry);
    return entry;
  }

  list(): PendingAccess[] {
    return [...this.pending.values()];
  }

  /**
   * Try a parked read again, after the user says they have signed in.
   *
   * Simply re-fetches. If the browser now carries the user's session for that
   * origin the read succeeds; if it does not, the read is still refused and
   * stays parked. There is no privileged path — LÉLU gets exactly the access
   * the user's own browser has, and nothing more.
   */
  async resume(id: string): Promise<{ ok: boolean; page?: BrowserPage; reason: string }> {
    const entry = this.pending.get(id);
    if (!entry) return { ok: false, reason: "That request is no longer waiting." };

    const page = await BrowserTool.visit(entry.url);
    const assessment = assessAccess(page);

    if (assessment.verdict === "readable") {
      this.pending.delete(id);
      return { ok: true, page, reason: "Access granted — reading it now." };
    }
    return { ok: false, reason: assessment.reason };
  }

  cancel(id: string): void {
    this.pending.delete(id);
  }

  /** Test seam. */
  static reset(): void {
    AuthorizationQueue.instance = null;
  }
}

export default AuthorizationQueue;
