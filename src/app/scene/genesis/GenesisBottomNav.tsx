/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS BOTTOM NAVIGATION
 *
 * The reference's floating bottom dock: four rounded glass
 * pills — Chat, History, Workspaces, Reasoning — centered near
 * the bottom of the workspace. Each pill drives the EXISTING
 * panel router (openPanel), so nothing is duplicated.
 *
 * Desktop/tablet only: on phones the compact GenesisDock bar
 * (which already leads with these four destinations) takes over
 * to keep one-handed reach and avoid double navigation.
 * ==========================================================
 */

import { useGenesis } from "./GenesisCore";
import GenesisNavIcon, { type GenesisNavIconName } from "./GenesisNavIcons";

interface NavPill {
  id: "chat" | "history" | "workspaces" | "reasoning";
  label: string;
  icon: GenesisNavIconName;
}

const PILLS: NavPill[] = [
  { id: "chat", label: "Chat", icon: "bubble" },
  { id: "history", label: "History", icon: "list" },
  { id: "workspaces", label: "Workspaces", icon: "grid" },
  { id: "reasoning", label: "Reasoning", icon: "spark" },
];

export default function GenesisBottomNav() {
  const { state, openPanel } = useGenesis();

  function isActive(id: NavPill["id"]): boolean {
    // The whole screen IS the workspace preview, so Workspaces reads
    // as the current surface until another panel takes the stage.
    if (id === "workspaces") {
      return state.activePanel === "workspaces" || state.activePanel === "none";
    }
    return state.activePanel === id;
  }

  return (
    <div
      className="lelu-tab-bar"
      style={{
        position: "absolute",
        left: "50%",
        bottom: "clamp(18px, 3vh, 30px)",
        transform: "translateX(-50%)",
        zIndex: 3,
        display: "flex",
        gap: 8,
        padding: 6,
        borderRadius: 999,
        pointerEvents: "auto",
      }}
    >
      {PILLS.map((pill) => {
        const active = isActive(pill.id);
        return (
          <button
            key={pill.id}
            type="button"
            onClick={() => openPanel(pill.id)}
            className={`lelu-tab-cloud${active ? " lelu-tab-cloud-active" : ""}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 999,
              padding: "9px 18px",
              fontSize: 12.5,
              fontWeight: 500,
              letterSpacing: "0.03em",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            <GenesisNavIcon name={pill.icon} size={16} strokeWidth={1.6} />
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
