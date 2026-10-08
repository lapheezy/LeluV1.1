/**
 * ==========================================================
 * LÉLU — SUPABASE AUTH STORAGE
 *
 * The OG original shipped a session broker for its old host
 * platform's preview surface: on that platform's domains,
 * inside a frame, it posted the Supabase auth session to the
 * editor origin over postMessage so several preview surfaces
 * could share one login, and fell back to localStorage
 * everywhere else.
 *
 * LÉLU has no relationship with that platform, so the broker
 * was unreachable code carrying a postMessage path to a
 * third-party origin — and it shipped in the Android bundle.
 * It is removed. The session is stored locally, full stop.
 *
 * The export keeps its name because the generated Supabase
 * client imports it by that name, and the seam is worth
 * keeping: this is where storage would change if the session
 * should ever move to a Capacitor secure store on device.
 * ==========================================================
 */

/** Where the Supabase client keeps its session. */
export function brokeredPreviewStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
