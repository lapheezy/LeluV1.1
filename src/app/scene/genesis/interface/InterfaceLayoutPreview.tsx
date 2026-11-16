/**
 * LÉLU — LAYOUT PREVIEW
 *
 * While a proposal that moves windows is previewed, its target geometry
 * is drawn as labelled outlines over the live workspace. The real
 * windows do not move until the user approves, so the preview is exact
 * and fully reversible.
 */

import { MODULE_CATALOG } from "../GenesisDock";
import useInterface from "./useInterface";

export default function InterfaceLayoutPreview() {
  const view = useInterface();
  const proposal = view.previewing;
  if (!proposal || !proposal.windowsChanged) return null;

  const entries = Object.entries(proposal.next.windows).filter(([, l]) => l.presentation === "inline" || l.presentation === "expanded");
  const labelOf = (id: string) => (id === "chat" ? "Chat" : MODULE_CATALOG.find((m) => m.id === id)?.label ?? id);

  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 8990 }}>
      {entries.map(([id, l]) => (
        <div
          key={id}
          style={{
            position: "absolute",
            left: l.presentation === "expanded" ? "4vw" : l.x,
            top: l.presentation === "expanded" ? "8vh" : l.y,
            width: l.presentation === "expanded" ? "92vw" : l.width,
            height: l.presentation === "expanded" ? "84vh" : l.height,
            rotate: l.rotation ? `${l.rotation}deg` : undefined,
            border: "2px dashed rgba(250, 204, 21, 0.85)",
            borderRadius: 14,
            background: "rgba(250, 204, 21, 0.06)",
            boxShadow: "0 0 0 1px rgba(2,6,23,0.6)",
            transition: "all 240ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 6,
              left: 8,
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(250, 204, 21, 0.9)",
              color: "#1c1917",
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {labelOf(id)} → {Math.round(l.width)}×{Math.round(l.height)}
          </span>
        </div>
      ))}
    </div>
  );
}
