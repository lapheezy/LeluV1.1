/**
 * ==========================================================
 * LÉLUVERSE COSMOS INTEGRATION
 *
 * Wraps all cosmos components into a single integration layer
 * that mounts alongside the existing Genesis interface.
 *
 * The CosmosMap sits BEHIND the existing 3D scene as a
 * navigable spatial index. The cloud nav, overview, agent
 * council, and resizable panels compose around it.
 *
 * This component is mounted from GenesisScene and uses the
 * existing GenesisCore context for panel open/close state.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import { useGenesis } from "../GenesisCore";
import CosmosMap from "./CosmosMap";
import CosmosCloudNav from "./CosmosCloudNav";
import CosmosOverview from "./CosmosOverview";
import AgentCouncil from "./AgentCouncil";
import ResizablePanel from "./ResizablePanel";

export default function CosmosIntegration() {
  const { state: genesisState, openPanel } = useGenesis();
  const [councilExpanded, setCouncilExpanded] = useState(true);

  // Cleanup cosmos store on unmount
  useEffect(() => {
    return () => {
      // Don't destroy on hot reload — only on full unmount
    };
  }, []);

  // Bridge: expose openPanel to CloudNav's panel buttons
  useEffect(() => {
    (window as any).__leluGenesis = { openPanel };
    return () => { delete (window as any).__leluGenesis; };
  }, [openPanel]);

  const showCosmos = genesisState.activePanel !== "genesisv2" && genesisState.activePanel !== "visual";

  if (!showCosmos) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      {/* The Cosmos Map — the living spatial environment */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <CosmosMap />
      </div>

      {/* Cloud navigation — floating above everything */}
      <CosmosCloudNav />

      {/* Cosmos Overview minimap — bottom right */}
      <CosmosOverview />

      {/* Agent Council — right side resizable panel */}
      <ResizablePanel
        title="Agent Council"
        initialWidth={280}
        initiallyExpanded={councilExpanded}
        position="right"
        minSize={160}
        maxSize={420}
        resizeDirection="horizontal"
        hue={220}
        persistKey="lelu.council"
        zIndex={18}
        onExpandChange={setCouncilExpanded}
      >
        <AgentCouncil />
      </ResizablePanel>
    </div>
  );
}
