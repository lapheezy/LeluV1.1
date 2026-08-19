/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS WORKSPACE PREVIEW
 *
 * The v1 overlay surface: a compact status panel + navigation
 * over the cosmic scene. It deliberately renders NO core
 * architecture — the ONE 3D Genesis Core in the canvas is the
 * only core object in v1. The four-node composition (center
 * marker, Creation Studio, Research Lab, Genesis Vault, beams)
 * belongs exclusively to the Genesis v2 workspace; it is never
 * mounted here, so the v2 cores can never overlap v1.
 *
 * The v1 overlay keeps only the non-covering controls: spatial
 * controls on the right edge and the bottom navigation. The
 * "Genesis · Live" status card was removed so nothing floats
 * over the interface.
 *
 *   [Chat] [History] [Workspaces] [Reasoning]     + − ⊙
 *
 * Desktop shows the full composition. On phones the compact
 * dock bar replaces the left rail and bottom pills.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import GenesisBottomNav from "./GenesisBottomNav";
import GenesisSpatialControls from "./GenesisSpatialControls";

function useViewport() {
  const [size, setSize] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1440,
    height: typeof window !== "undefined" ? window.innerHeight : 900,
  }));

  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return size;
}

export default function GenesisWorkspacePreview() {
  const { width } = useViewport();

  const tablet = width < 1024;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      {/* Right-edge spatial controls + bottom navigation (desktop/tablet) */}
      <GenesisSpatialControls />
      {tablet ? null : <GenesisBottomNav />}
    </div>
  );
}
