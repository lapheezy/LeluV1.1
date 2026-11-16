/**
 * LÉLU — the project's PUBLIC Supabase identity.
 *
 * Both values are public by design: a project URL is a hostname, and a
 * `sb_publishable_…` key is the client-safe key Supabase issues for
 * browsers (row-level security protects the data, not the key's secrecy).
 *
 * They are the last fallback, used only where the environment supplies
 * nothing usable. Why they exist at all: the platform's secret store
 * provides no URL, and the value it files under `Supabase` was observed
 * to be an `sbp_…` personal access token — an admin credential that is
 * not a publishable key, gets 401 from the project API, and must never
 * reach a browser. With nothing else to go on, Supabase stayed disabled.
 *
 * Any SUPABASE_URL / *_PUBLISHABLE_KEY set in the environment still wins.
 * The default key is used only together with the default URL, so it can
 * never be paired with a different project.
 */
export const SUPABASE_PUBLIC_DEFAULT = {
  url: "https://nrehsldbfxthspikaxvr.supabase.co",
  publishableKey: "sb_publishable_hb-9gS-K2ycoSf-Y6EbUdA_3s-XNeLV",
} as const;
