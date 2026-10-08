/**
 * ==========================================================
 * LÉLU — OG INTERFACES IN THE DOCK
 *
 * §2 asks that the existing navigation expose the OG
 * interfaces, and §18 that switching between them preserve
 * identity and context. Both follow from putting them in the
 * dock LÉLU already has rather than building a second menu:
 * these are two more tabs on the same rail, and they route
 * through the same router, so the runtime underneath is never
 * torn down when you move between surfaces.
 *
 * They are rendered as links rather than panel ids because the
 * OG surfaces are routes, not Genesis panels — GenesisPanel is
 * a closed union and widening it would mean teaching the panel
 * router about screens it does not own.
 *
 * Touch targets follow the dock's own railSize so they satisfy
 * the same mobile ergonomics as every other tab (§16).
 * ==========================================================
 */

import { useNavigate } from "react-router-dom";

export interface OgDockTabsProps {
  /** The dock's tab size, so OG tabs match the rail exactly. */
  railSize: number;
  iconSize: number;
}

const OG_SURFACES = [
  { to: "/og/core", glyph: "▣", label: "OG Core", title: "OG Core — the window-manager desktop" },
  { to: "/og/chat", glyph: "◗", label: "OG Chat", title: "OG Chat — the Inner Sky conversation" },
] as const;

export default function OgDockTabs({ railSize, iconSize }: OgDockTabsProps) {
  const navigate = useNavigate();

  // Self-positioning, because the dock has three different shapes at three
  // breakpoints and the mount point is outside the rail container in all of
  // them. One fixed cluster keeps the OG entries in the same place whichever
  // shape the dock is currently wearing.
  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        zIndex: 30,
        display: "flex",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      {OG_SURFACES.map((surface) => (
        <button
          key={surface.to}
          type="button"
          onClick={() => navigate(surface.to)}
          className="lelu-tab-cloud"
          title={surface.title}
          aria-label={surface.label}
          style={{
            width: railSize,
            height: railSize,
            flexShrink: 0,
            borderRadius: 14,
            fontSize: iconSize,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "inherit",
            background: "rgba(255,190,120,0.08)",
            border: "1px solid rgba(255,190,120,0.28)",
            color: "rgba(255,214,170,0.85)",
          }}
        >
          {surface.glyph}
        </button>
      ))}
    </div>
  );
}
