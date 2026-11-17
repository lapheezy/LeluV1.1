/**
 * ==========================================================
 * LÉLU — SPATIAL STUDIO (Mission 5, WP03)
 *
 * The ASRE/NRE creation environment as a mode of the ONE Visual Studio
 * (GenesisVisualStudio): not a separate page or demo. Four workspaces
 * share one selection so a reconstruction can be inspected numerically,
 * a character edited and either one rendered and exported:
 *
 *   Reconstruct  image(s) → real job → hypotheses → geometry
 *   Numerical    voxel planes, evidence, confidence history, provenance
 *   Create       persistent character components, versions, restore
 *   Render       interactive preview, Forge edit / export / placement
 *
 * Every control calls the real service (src/core/asre/AsreClient.ts).
 * ==========================================================
 */
import { useState } from "react";
import ReconstructWorkspace from "./ReconstructWorkspace";
import NumericalWorkspace from "./NumericalWorkspace";
import CreationWorkspace from "./CreationWorkspace";
import RenderWorkspace from "./RenderWorkspace";
import type { RenderTarget } from "./spatialUi";

export type SpatialTab = "reconstruct" | "numerical" | "create" | "render";
const TABS: Array<{ key: SpatialTab; label: string }> = [
  { key: "reconstruct", label: "Reconstruct" },
  { key: "numerical", label: "Numerical" },
  { key: "create", label: "Create" },
  { key: "render", label: "Render" },
];

let requested: SpatialTab | null = null;
/** Commands (and LÉLU) can ask for a tab before the studio opens. */
export function openSpatialTab(tab: SpatialTab): void {
  requested = tab;
}

export default function GenesisSpatialStudio() {
  const [tab, setTab] = useState<SpatialTab>(() => {
    const r = requested;
    requested = null;
    return r ?? "reconstruct";
  });
  const [job, setJob] = useState<string | null>(null);
  const [target, setTarget] = useState<RenderTarget | null>(null);
  const render = (t: RenderTarget) => {
    setTarget(t);
    setTab("render");
  };
  return (
    <div data-lelu-spatial-studio={tab} style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
      <nav style={{ display: "flex", gap: 6 }} aria-label="Spatial workspaces">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            data-spatial-tab={t.key}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12, fontFamily: "inherit", cursor: "pointer", border: tab === t.key ? "1px solid rgba(34,211,238,0.5)" : "1px solid rgba(255,255,255,0.08)", background: tab === t.key ? "rgba(34,211,238,0.12)" : "transparent", color: tab === t.key ? "#a5f3fc" : "rgba(203,228,255,0.6)" }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {/* Keep the reconstruct workspace mounted so a running job keeps being followed. */}
      <div style={{ display: tab === "reconstruct" ? "block" : "none" }}>
        <ReconstructWorkspace selectedJob={job} onSelectJob={setJob} onRender={render} />
      </div>
      {tab === "numerical" ? <NumericalWorkspace selectedJob={job} /> : null}
      {tab === "create" ? <CreationWorkspace onRender={render} /> : null}
      {tab === "render" ? <RenderWorkspace target={target} onTarget={setTarget} /> : null}
    </div>
  );
}
