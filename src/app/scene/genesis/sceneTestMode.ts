/**
 * ==========================================================
 * LÉLU — SCENE TEST MODE
 *
 * Browser acceptance needs the REAL application: the same
 * GenesisInterface, the same GenesisChat, the same
 * GenesisCore, memory, providers and persistence. What it
 * does not need is the 3D world, whose WebGL canvases saturate
 * an automation session before a conversation can be typed.
 *
 * This is the narrowest possible switch: in a DEVELOPMENT
 * build only, `?scene=off` makes the workspace router render
 * no scene at all (the same state the app already enters on a
 * phone when chat owns the screen). Nothing else changes —
 * no store, no memory path, no provider, no chat behaviour.
 *
 * `IS_DEV` is inlined to `false` in production, so the flag
 * cannot be reached by a link in a shipped build.
 * ==========================================================
 */

import { IS_DEV } from "../../../core/env/buildEnv";

/** Pure form, so the rule can be tested without a browser. */
export function sceneDisabledBySearch(search: string, isDev: boolean): boolean {
  if (!isDev) return false;
  try {
    return new URLSearchParams(search).get("scene") === "off";
  } catch {
    return false;
  }
}

/** The live decision for this page. */
export function sceneTestDisabled(): boolean {
  if (!IS_DEV) return false;
  if (typeof window === "undefined") return false;
  return sceneDisabledBySearch(window.location.search, true);
}
