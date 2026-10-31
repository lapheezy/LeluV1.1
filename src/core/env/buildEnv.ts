/**
 * ==========================================================
 * LÉLU — BUILD-TIME FACTS (base path, production flag)
 *
 * `import.meta.env` exists only when Vite compiles a module. Code
 * that read `import.meta.env.BASE_URL` / `.PROD` directly worked in
 * the dev server and the production bundle, but threw
 * "Cannot read properties of undefined" anywhere else — the node
 * test runner, server-side imports, scripts — which is why the
 * Genesis interface could not be rendered outside Vite.
 *
 * Each value is read through ONE static member access inside a
 * try, exactly like publicEnv.ts: Vite still replaces the literal
 * `import.meta.env.BASE_URL` at build time (so production gets the
 * real base), it never inlines the whole env record, and a runtime
 * without Vite gets the documented default instead of a crash.
 * ==========================================================
 */

/** Public base path the app is served from ("/" unless Vite `base` says otherwise). */
export const BASE_URL: string = (() => {
  try {
    const base = import.meta.env.BASE_URL;
    return typeof base === "string" && base ? base : "/";
  } catch {
    return "/";
  }
})();

/** True only in a Vite production build. */
export const IS_PROD: boolean = (() => {
  try {
    return import.meta.env.PROD === true;
  } catch {
    return false;
  }
})();

/** A path under the app's base, e.g. assetUrl("apple-touch-icon.png"). */
export function assetUrl(file: string): string {
  return `${BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`}${file.replace(/^\/+/, "")}`;
}
