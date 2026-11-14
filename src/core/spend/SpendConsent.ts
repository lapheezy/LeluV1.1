/**
 * ==========================================================
 * LÉLU — the user's own words → spending consent (client half)
 *
 * Called ONLY from the two places that carry what the user typed or said:
 * the chat composer (GenesisChat) and spoken input (VoiceEngine). Agents,
 * background jobs, scheduled tasks, tools and model output never call it,
 * so none of them can create an authorization (tests/spend-policy.test.ts
 * scans the source to keep it that way). The server parses the words
 * itself (plugins/spendPolicy.ts parseSpendConsent) and enforces the grant
 * at every paid boundary.
 * ==========================================================
 */
import { sessionAuthHeader } from "../persistence/sessionAuth";

/** Cheap prefilter: only messages that could be consent reach the server. */
const MAYBE_CONSENT =
  /\b(authori[sz]|approve|you (?:can|may) (?:use|spend)|go ahead and use|use (?:the )?paid|paid (?:use|capacity)|revoke|stop (?:all )?paid|no more paid|don'?t spend)/i;

export interface ConsentOutcome {
  /** A line for the turn's context so LÉLU can confirm it in her reply. */
  note: string;
}

export async function captureSpendConsent(text: string, source: "typed" | "spoken"): Promise<ConsentOutcome | null> {
  if (!MAYBE_CONSENT.test(text) || typeof fetch === "undefined") return null;
  try {
    const response = await fetch("/api/spend/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-lelu-user-consent": source, ...sessionAuthHeader() },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      granted?: { service: string; maxUsd: number | null; maxRequests: number; expiresAt: number; costKnown: string } | null;
      revoked?: number;
    };
    if (typeof body.revoked === "number") {
      return {
        note: `SPENDING: the user revoked paid authorization (${body.revoked} active grant(s) ended). Confirm that no paid service will be used.`,
      };
    }
    const g = body.granted;
    if (!g) return null;
    const until = new Date(g.expiresAt).toLocaleTimeString();
    return {
      note:
        `SPENDING: the user explicitly authorized paid use of ${g.service}` +
        `${g.maxUsd !== null ? ` up to $${g.maxUsd}` : ""}, at most ${g.maxRequests} request(s), until ${until}. ` +
        `${g.costKnown}. Confirm this scope to the user in one short sentence; it applies to this job only.`,
    };
  } catch {
    return null;
  }
}
