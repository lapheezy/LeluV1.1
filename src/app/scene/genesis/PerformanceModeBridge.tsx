/**
 * Applies the lightweight / full-weight mode (core/performance/PerformanceMode) through the scene's
 * EXISTING render manager, and publishes back what the renderer really did. No second render policy.
 *   auto  → no override: the manager's own capability + measured-fps adaptation (LÉLU adjusting).
 *   light → cap the world at "light"; <html data-lelu-weight="light"> drops heavy blur and ambient motion.
 *   full  → ask for the device's own ceiling; refused (and reported) on no-WebGL or software GL.
 */

import { useEffect, useSyncExternalStore } from "react";
import { getSceneRenderManager } from "./SceneRenderManager";
import { getPerformance, publishEffective, subscribePerformance } from "../../../core/performance/PerformanceMode";

export default function PerformanceModeBridge() {
  const perf = useSyncExternalStore(subscribePerformance, getPerformance, getPerformance);
  const manager = getSceneRenderManager();
  const snap = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);

  useEffect(() => {
    if (perf.mode === "auto") manager.setOverride(null);
    else if (perf.mode === "full") manager.setOverride({ profile: "full", reason: `full weight, chosen by ${perf.by}${perf.reason ? `: ${perf.reason}` : ""}`, source: `performance:${perf.by}` });
    else if (snap.ceiling !== "light") manager.setOverride({ profile: "light", reason: `lightweight, chosen by ${perf.by}${perf.reason ? `: ${perf.reason}` : ""}`, source: `performance:${perf.by}` });
    else manager.setOverride(null); // already light on this device: nothing to force
  }, [perf.mode, perf.by, perf.reason, manager, snap.ceiling]);

  useEffect(() => {
    const light = perf.mode === "light" || snap.profile === "light";
    document.documentElement.dataset.leluWeight = light ? "light" : "full";
    const nav = navigator as unknown as { hardwareConcurrency?: number; deviceMemory?: number };
    const stats = (window as unknown as { __leluRenderStats?: { fps?: number } }).__leluRenderStats;
    publishEffective({
      profile: snap.profile,
      reason: snap.reason,
      renderer: snap.capability?.renderer ?? "",
      fps: stats?.fps ?? 0,
      refused: perf.mode === "full" ? snap.overrideRefused : null,
      cores: nav.hardwareConcurrency ?? null,
      memoryGb: nav.deviceMemory ?? null,
    });
  }, [perf.mode, snap]);

  return null;
}
