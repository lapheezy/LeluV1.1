/**
 * Lightweight / full-weight mode (owner, 2026-11-28): "keep a lightweight mode and a full weight mode, and
 * LÉLU can adjust it to fit the environment, device, GPU or CPU."
 *
 * - auto  (default): LÉLU decides. The scene's render manager picks the profile from the device's evidence
 *         (GPU renderer, WebGL, data saver, screen, CPU cores, memory) and then from MEASURED frame rate,
 *         stepping down when frames are slow and back up when they recover.
 * - light: lightweight, whatever the device. The 3D world gives way to the light sky; heavy glass blur and
 *          ambient animation are dropped.
 * - full : full weight: paint at the device's own ceiling. Refused, and said so, where there is nothing to
 *          paint with (no WebGL, or a software rasteriser): forcing it there would only fail.
 *
 * This is the one store. The app applies it through the existing SceneRenderManager (no second renderer
 * policy); LÉLU sets it with the performance.mode tool or from the chat.
 */

export type PerformanceModeId = "auto" | "light" | "full";
export interface PerformanceState {
  mode: PerformanceModeId;
  /** Who set it and why (shown in the controls and in her reply). */
  by: "owner" | "lelu" | "default";
  reason: string;
  /** What the renderer is actually doing, published by the app (evidence, not intent). */
  effective?: { profile: string; reason: string; renderer: string; fps: number; refused: string | null; cores: number | null; memoryGb: number | null };
}

const KEY = "lelu.performance.v1";
export const PERFORMANCE_EVENT = "lelu-performance";
let state: PerformanceState = { mode: "auto", by: "default", reason: "LÉLU adjusts to this device" };
try {
  const saved = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(KEY) ?? "null") : null;
  if (saved && ["auto", "light", "full"].includes(saved.mode)) state = { mode: saved.mode, by: saved.by ?? "owner", reason: saved.reason ?? "" };
} catch {
  /* default */
}
const listeners = new Set<() => void>();

export function getPerformance(): PerformanceState {
  return state;
}
export function setPerformanceMode(mode: PerformanceModeId, by: PerformanceState["by"], reason: string): PerformanceState {
  state = { ...state, mode, by, reason };
  try {
    localStorage?.setItem(KEY, JSON.stringify({ mode, by, reason }));
  } catch {
    /* memory only */
  }
  emit();
  return state;
}
/** The app reports what the renderer really did with the mode. */
export function publishEffective(effective: NonNullable<PerformanceState["effective"]>): void {
  const prev = state.effective;
  if (prev && prev.profile === effective.profile && prev.refused === effective.refused && prev.reason === effective.reason && Math.round(prev.fps) === Math.round(effective.fps)) return;
  state = { ...state, effective };
  emit();
}
export function subscribePerformance(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(): void {
  for (const fn of listeners) fn();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PERFORMANCE_EVENT));
}

/** Plain words for the controls and her reply. */
export function describePerformance(s: PerformanceState = state): string {
  const mode = s.mode === "auto" ? "Auto (LÉLU adjusts to this device)" : s.mode === "light" ? "Lightweight" : "Full weight";
  const e = s.effective;
  const now = e ? ` Rendering now: ${e.profile}${e.fps ? ` at ${Math.round(e.fps)} fps` : ""} (${e.reason}${e.renderer ? `; GPU: ${e.renderer}` : ""}${e.cores ? `; ${e.cores} CPU threads` : ""}${e.memoryGb ? `; ${e.memoryGb} GB memory` : ""}).` : "";
  const refused = e?.refused ? ` Full weight was refused: ${e.refused === "refused:software" ? "this device draws with a software rasteriser, not a GPU" : "WebGL is not available here"}.` : "";
  return `${mode}.${now}${refused}`;
}
