/**
 * ==========================================================
 * LÉLUVERSE COSMOS CLOUD NAV
 *
 * The floating Cotton Candy Cosmos navigation panel.
 * Navigates between LÉLU, SHAMAN, Executive Galaxies,
 * Agent Universes, Memory Garden, and panels.
 *
 * When collapsed: a small glowing cloud orb.
 * When expanded: cloud unfolds into navigation controls.
 * ==========================================================
 */

import { useState, useEffect, useCallback } from "react";
import CosmosStore from "./CosmosStore";
import type { CosmosState } from "./CosmosTypes";

export default function CosmosCloudNav() {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<CosmosState>(() => CosmosStore.getInstance().getState());
  const store = CosmosStore.getInstance();

  useEffect(() => {
    return store.subscribe(setState);
  }, []);

  const navigateTo = useCallback((id: string) => {
    store.navigateToEntity(id);
  }, []);

  if (!expanded) {
    // Collapsed: glowing cloud orb
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title="Open cosmos navigation"
        aria-label="Open cosmos navigation"
        style={{
          position: "fixed",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 28,
          pointerEvents: "auto",
          width: 42,
          height: 42,
          borderRadius: "50%",
          border: "1px solid rgba(255, 190, 225, 0.4)",
          background: "radial-gradient(circle at 35% 35%, rgba(255, 182, 215, 0.3), rgba(147, 197, 253, 0.2), rgba(192, 132, 252, 0.25))",
          boxShadow: "0 4px 20px rgba(255, 158, 203, 0.25), 0 0 15px rgba(147, 197, 253, 0.15), inset 0 1px 0 rgba(255,255,255,0.15)",
          cursor: "pointer",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: "rgba(255, 246, 251, 0.9)",
          fontSize: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: "lelu-cloud-drift 6s ease-in-out infinite alternate",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateX(-50%) scale(1.1)";
          e.currentTarget.style.boxShadow = "0 6px 28px rgba(255, 158, 203, 0.4), 0 0 25px rgba(147, 197, 253, 0.25)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateX(-50%) scale(1)";
          e.currentTarget.style.boxShadow = "0 4px 20px rgba(255, 158, 203, 0.25), 0 0 15px rgba(147, 197, 253, 0.15)";
        }}
      >
        ✦
      </button>
    );
  }

  // Expanded: cloud navigation panel
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 28,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "10px 16px",
        borderRadius: 20,
        background: "linear-gradient(165deg, rgba(255, 182, 215, 0.10), rgba(147, 197, 253, 0.08), rgba(192, 132, 252, 0.09), rgba(9, 12, 38, 0.93))",
        border: "1px solid rgba(214, 178, 255, 0.32)",
        boxShadow: "0 12px 44px rgba(255, 158, 203, 0.15), 0 0 20px rgba(147, 197, 253, 0.10), 0 8px 24px rgba(0, 0, 0, 0.3)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        animation: "lelu-environment-enter 0.25s ease",
        maxWidth: "95vw",
      }}
    >
      {/* Close button */}
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
        <span style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          color: "rgba(200, 180, 240, 0.6)",
          fontWeight: 600,
        }}>
          Navigate
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
          }}
        >
          ×
        </button>
      </div>

      {/* Navigation rows */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
        {/* Core navigation */}
        <NavCloudButton
          label="LÉLU"
          hue={195}
          active={state.selectedEntityId === "lelu-core"}
          onClick={() => navigateTo("lelu-core")}
        />
        <NavCloudButton
          label="SHAMAN"
          hue={220}
          active={state.selectedEntityId === "shaman"}
          onClick={() => navigateTo("shaman")}
        />
      </div>

      {/* Executive galaxies */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
        {state.executiveGalaxies.map((galaxy) => (
          <NavCloudButton
            key={galaxy.id}
            label={galaxy.name}
            hue={galaxy.visualDNA.hue}
            active={state.selectedEntityId === galaxy.id}
            energy={galaxy.activity.energy}
            onClick={() => navigateTo(galaxy.id)}
          />
        ))}
      </div>

      {/* Agent universes */}
      {state.agentUniverses.length > 0 && (
        <div style={{
          display: "flex",
          gap: 3,
          flexWrap: "wrap",
          justifyContent: "center",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          paddingTop: 6,
          marginTop: 2,
        }}>
          {state.agentUniverses.map((agent) => (
            <NavCloudButton
              key={agent.id}
              label={agent.name}
              hue={agent.visualDNA.hue}
              active={state.selectedEntityId === agent.id}
              energy={agent.activity.energy}
              size="small"
              onClick={() => navigateTo(agent.id)}
            />
          ))}
        </div>
      )}

      {/* Panel navigation */}
      <div style={{
        display: "flex",
        gap: 3,
        flexWrap: "wrap",
        justifyContent: "center",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        paddingTop: 6,
        marginTop: 2,
      }}>
        <PanelButton label="Council" onClick={() => {
          const { openPanel } = (window as any).__leluGenesis;
          openPanel?.("agents");
        }} />
        <PanelButton label="Memory" onClick={() => {
          const { openPanel } = (window as any).__leluGenesis;
          openPanel?.("memory");
        }} />
        <PanelButton label="Chat" onClick={() => {
          const { openPanel } = (window as any).__leluGenesis;
          openPanel?.("chat");
        }} />
        <PanelButton label="Overview" onClick={() => store.toggleOverview()} />
      </div>
    </div>
  );
}

function NavCloudButton({
  label,
  hue,
  active,
  energy = 0,
  size = "normal",
  onClick,
}: {
  label: string;
  hue: number;
  active: boolean;
  energy?: number;
  size?: "normal" | "small";
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isSmall = size === "small";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        overflow: "hidden",
        border: active
          ? `1px solid hsla(${hue}, 80%, 70%, 0.6)`
          : hovered
            ? `1px solid hsla(${hue}, 60%, 60%, 0.4)`
            : "1px solid rgba(255,255,255,0.12)",
        borderRadius: 999,
        background: active
          ? `linear-gradient(165deg, hsla(${hue}, 60%, 25%, 0.9), hsla(${hue + 20}, 50%, 15%, 0.92))`
          : "linear-gradient(165deg, rgba(30, 16, 54, 0.85), rgba(9, 12, 38, 0.9))",
        color: active ? `hsl(${hue}, 80%, 90%)` : "rgba(220, 210, 240, 0.85)",
        padding: isSmall ? "3px 8px" : "4px 10px",
        fontSize: isSmall ? 9 : 10.5,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        fontFamily: "system-ui, sans-serif",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        boxShadow: active
          ? `0 0 12px hsla(${hue}, 80%, 60%, 0.3)`
          : hovered
            ? "0 2px 10px rgba(0,0,0,0.3)"
            : "none",
        transition: "all 0.15s ease",
      }}
    >
      {/* Activity dot */}
      {energy > 0.2 && (
        <span style={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: `hsl(${hue}, 80%, 65%)`,
          boxShadow: `0 0 ${4 + energy * 6}px hsl(${hue}, 80%, 55%)`,
          animation: energy > 0.4 ? "genesis-signal-pulse 1.4s ease-in-out infinite" : undefined,
        }} />
      )}
      {label}
    </button>
  );
}

function PanelButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 999,
        background: "rgba(255,255,255,0.04)",
        color: "rgba(200, 190, 230, 0.7)",
        padding: "3px 8px",
        fontSize: 9,
        cursor: "pointer",
        fontFamily: "system-ui, sans-serif",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </button>
  );
}
