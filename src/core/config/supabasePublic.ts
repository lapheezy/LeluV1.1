/**
 * LÉLU — the project's PUBLIC Supabase identity, used only on request.
 *
 * Both values are public by design: a project URL is a hostname, and a
 * `sb_publishable_…` key is the client-safe key Supabase issues for
 * browsers (row-level security protects the data, not the key's secrecy).
 *
 * These are NOT an implicit fallback. A deployment with no Supabase
 * variables is local-only: no client, no auth probe, no network request.
 * An operator who intentionally wants this project's identity sets
 * `SUPABASE_USE_PUBLIC_DEFAULT=true` (or the VITE_ form).
 *
 * Any SUPABASE_URL / *_PUBLISHABLE_KEY set in the environment still wins.
 * The default key is used only together with the default URL, so it can
 * never be paired with a different project.
 */
export const SUPABASE_PUBLIC_DEFAULT = {
  url: "https://nrehsldbfxthspikaxvr.supabase.co",
  publishableKey: "sb_publishable_hb-9gS-K2ycoSf-Y6EbUdA_3s-XNeLV",
} as const;
