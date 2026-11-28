/**
 * The Cosmos's theme layer: when a theme (the world engine's active world) is chosen, it is drawn full
 * screen behind the Cosmos landing and the floating Chat Universe; the Cosmos scene pauses underneath
 * (render budget) while it is covered. No theme = the primary Cosmos, untouched.
 * In lightweight mode the world is drawn once and held (a still frame, no animation loop).
 */
import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useActiveWorld } from "./WorldEditor";
import { getSceneRenderBudget } from "../genesis/SceneRenderBudget";
import { getPerformance, subscribePerformance } from "../../../core/performance/PerformanceMode";
import "./world.css";

const WorldStage = lazy(() => import("./WorldStage"));

export default function CosmosTheme() {
  const world = useActiveWorld();
  const perf = useSyncExternalStore(subscribePerformance, getPerformance, getPerformance);
  const light = perf.mode === "light" || perf.effective?.profile === "light";
  useEffect(() => {
    const budget = getSceneRenderBudget();
    budget.setOccluded("cosmos-theme", !!world);
    return () => budget.setOccluded("cosmos-theme", false);
  }, [world]);
  if (!world) return null;
  // Inside the Cosmos scene's own container, right after its sky: above the primary Cosmos, below every
  // layer of the interface. (Appended to <body> at z 1 it covered chat windows and took their clicks;
  // prepended at z 0 an opaque layer hid it: both measured.)
  const sky = document.querySelector<HTMLElement>("[data-cosmos-sky]");
  const scene = sky?.parentElement ?? document.body;
  let host = document.getElementById("lelu-cosmos-theme-host");
  if (!host || host.parentElement !== scene) {
    host?.remove();
    host = document.createElement("div");
    host.id = "lelu-cosmos-theme-host";
    if (sky) sky.after(host);
    else scene.prepend(host);
  }
  return createPortal(
    <div className="cosmos-theme" data-cosmos-theme={world.families[0] ?? world.id} style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
      <Suspense fallback={null}>
        <WorldStage key={world.id} world={world} still={light} interactive={false} />
      </Suspense>
    </div>,
    host,
  );
}
