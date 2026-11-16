/**
 * LÉLU — the signed-in user's Supabase access token as a bearer header,
 * for the server routes that act on the user's behalf (browse relay,
 * knowledge relay, integration API). The server verifies it with Supabase;
 * nothing here trusts it. Never logged, never put in a prompt.
 */

import SupabasePersistence from "./SupabasePersistence";

export function sessionAuthHeader(): Record<string, string> {
  try {
    const token = SupabasePersistence.getInstance().getAuthState().session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
