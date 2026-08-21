/**
 * ==========================================================
 * LÉLUVERSE — GENESIS COSMOS PANEL
 *
 * A touch-friendly minimap of the infinite cosmos.
 * Shows all entities, galaxies, zodiac, storms, cities.
 * Tap any node to navigate the 3D camera there.
 * Resizable glass panel — drag edges to resize, drag header to move.
 * ==========================================================
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import CosmosStore from "./cosmos/CosmosStore";
import InfiniteCosmos from "./engines/InfiniteCosmos";
import type { CosmosState } from "./cosmos/CosmosTypes";
import { genesisTheme } from "./GenesisTheme";

interface Props {
  onClose: () => void;
}

/** Navigate the 3D camera to a world position */
function navigateTo3D(x: number, y: number, z: number) {
  const cam = (window as any).__cosmosCamera;
  if (cam?.navigateTo) {
    // Position camera offset from target so we can see the object
    cam.navigateTo(
      { x: x, y: y, z: z + 12 },
      { x, y, z },
    );
  }
}

/** Single node on the minimap */
function MapNode({
  x, y, label, color, size, onClick,
}: {
  x: number; y: number; label: string; color: string; size: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position: "absolute",        left: `${50 + x * 0.28}%`,
          top: `${50 + y * 0.28}%`,
        transform: "translate(-50%, -50%)",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: `1px solid ${color}88`,
        boxShadow: `0 0 ${size}px ${color}66`,
        cursor: "pointer",
        pointerEvents: "auto",
        zIndex: 10,
        transition: "transform 0.2s ease",
      }}
      title={label}
    >
      <span style={{
        position: "absolute",
        top: size + 4,
        left: "50%",
        transform: "translateX(-50%)",
        fontSize: 8,
        color: "rgba(200,220,240,0.8)",
        whiteSpace: "nowrap",
        fontFamily: "system-ui, sans-serif",
        letterSpacing: "0.05em",
        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
        pointerEvents: "none",
      }}>
        {label}
      </span>
    </button>
  );
}

export default function GenesisCosmosPanel({ onClose }: Props) {
  const [state, setState] = useState<CosmosState>(() => CosmosStore.getInstance().getState());
  const [cosmosStats, setCosmosStats] = useState(() => InfiniteCosmos.getInstance().getStats());
  const panelRef = useRef<HTMLDivElement>(null);

  // Panel dimensions and position
  const [panelWidth, setPanelWidth] = useState(Math.min(520, typeof window !== "undefined" ? window.innerWidth * 0.92 : 520));
  const [panelHeight, setPanelHeight] = useState(420);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 }); // offset from center

  // Resize drag state
  const [resizeEdge, setResizeEdge] = useState<"top" | "right" | "corner" | null>(null);
  // Move drag state
  const [moving, setMoving] = useState(false);
  const [mapScale, setMapScale] = useState(1);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });

  const dragStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const unsub1 = CosmosStore.getInstance().subscribe(setState);
    const unsub2 = InfiniteCosmos.getInstance().subscribe(() => {
      setCosmosStats(InfiniteCosmos.getInstance().getStats());
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // Resize handler
  const handleResizeStart = useCallback((edge: "top" | "right" | "corner") => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeEdge(edge);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragStart.current = { x: clientX, y: clientY, w: panelWidth, h: panelHeight, px: panelPos.x, py: panelPos.y };
  }, [panelWidth, panelHeight, panelPos]);

  // Move handler — drag the header to reposition
  const handleMoveStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    setMoving(true);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragStart.current = { x: clientX, y: clientY, w: panelWidth, h: panelHeight, px: panelPos.x, py: panelPos.y };
  }, [panelWidth, panelHeight, panelPos]);

  useEffect(() => {
    if (!resizeEdge && !moving) return;
    const onMove = (e: TouchEvent | MouseEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      if (resizeEdge) {
        const dx = clientX - dragStart.current.x;
        const dy = dragStart.current.y - clientY;

        if (resizeEdge === "top" || resizeEdge === "corner") {
          setPanelHeight(Math.max(200, Math.min(window.innerHeight * 0.92, dragStart.current.h + dy)));
        }
        if (resizeEdge === "right" || resizeEdge === "corner") {
          setPanelWidth(Math.max(280, Math.min(window.innerWidth * 0.95, dragStart.current.w + dx)));
        }
      }

      if (moving) {
        const dx = clientX - dragStart.current.x;
        const dy = clientY - dragStart.current.y;
        setPanelPos({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
      }
    };
    const onUp = () => { setResizeEdge(null); setMoving(false); };

    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchend", onUp);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizeEdge, moving]);

  // Build map nodes from cosmos state
  const nodes: Array<{ id: string; x: number; y: number; label: string; color: string; size: number; camX: number; camY: number; camZ: number }> = [];

  nodes.push({ id: "lelu", x: 0, y: 0, label: "LÉLU CORE", color: "#67e8f9", size: 16, camX: 0, camY: 0, camZ: 0 });
  nodes.push({ id: "shaman", x: -15, y: 10, label: "SHAMAN", color: "#a78bfa", size: 10, camX: 0, camY: 3, camZ: 0 });

  for (const galaxy of state.executiveGalaxies) {
    nodes.push({
      id: galaxy.id,
      x: galaxy.position.x * 3,
      y: galaxy.position.z * 3,
      label: galaxy.name,
      color: `hsl(${galaxy.visualDNA.hue}, 70%, 60%)`,
      size: 8,
      camX: galaxy.position.x,
      camY: galaxy.position.y,
      camZ: galaxy.position.z,
    });
  }

  for (const universe of state.agentUniverses) {
    nodes.push({
      id: universe.id,
      x: universe.position.x * 3.5,
      y: universe.position.z * 3.5,
      label: universe.name,
      color: `hsl(${universe.visualDNA.hue}, 60%, 55%)`,
      size: 6,
      camX: universe.position.x,
      camY: universe.position.y,
      camZ: universe.position.z,
    });
  }

  // Solar system at 3D position (60, -5, -50) — map spread apart
  nodes.push({ id: "solar", x: 55, y: -50, label: "\u2600 SOLAR SYSTEM", color: "#fbbf24", size: 16, camX: 60, camY: -5, camZ: -38 });
  // Earth within solar system
  nodes.push({ id: "earth", x: 65, y: -42, label: "Earth", color: "#2266aa", size: 8, camX: 68, camY: -5, camZ: -47 });
  // Saturn — outer solar system
  nodes.push({ id: "saturn", x: 72, y: -58, label: "Saturn", color: "#dbc48e", size: 7, camX: 82, camY: -5, camZ: -62 });
  // Zodiac at 3D position (100, 10, -90) — well separated
  nodes.push({ id: "zodiac", x: 100, y: -80, label: "\u2726 ZODIAC", color: "#a78bfa", size: 16, camX: 100, camY: 10, camZ: -78 });
  // Galaxy — far opposite direction
  nodes.push({ id: "galaxy", x: -80, y: -70, label: "Galaxy", color: "#818cf8", size: 10, camX: -50, camY: 15, camZ: -50 });

  // Edge handle styles
  const edgeStyle = (edge: "top" | "right" | "corner"): React.CSSProperties => ({
    position: "absolute",
    zIndex: 100,
    pointerEvents: "auto",
    touchAction: "none" as const,
    ...(edge === "top" ? {
      top: -4, left: 0, right: 0, height: 14,
      cursor: "ns-resize",
      background: resizeEdge === "top" ? "rgba(103, 232, 249, 0.12)" : "transparent",
    } : edge === "right" ? {
      top: 0, right: -4, bottom: 0, width: 14,
      cursor: "ew-resize",
      background: resizeEdge === "right" ? "rgba(103, 232, 249, 0.12)" : "transparent",
    } : {
      top: -4, right: -4, width: 22, height: 22,
      cursor: "nwse-resize",
      background: resizeEdge === "corner" ? "rgba(103, 232, 249, 0.15)" : "transparent",
      borderRadius: "0 6px 0 0",
    }),
  });

  return (
    <AnimatePresence>
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.7 }}
        style={{
          position: "fixed",
          bottom: 80,
          left: `calc(50% + ${panelPos.x}px)`,
          transform: "translateX(-50%)",
          width: panelWidth,
          height: panelHeight,
          background: "rgba(8, 16, 38, 0.82)",
          border: "1px solid rgba(148, 163, 184, 0.15)",
          borderRadius: genesisTheme.radius.lg,
          backdropFilter: genesisTheme.glass.blurSoft,
          WebkitBackdropFilter: genesisTheme.glass.blurSoft,
          boxShadow: genesisTheme.elevation.float.boxShadow,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          pointerEvents: "auto",
          zIndex: 30,
        }}
      >
        {/* Resize handles */}
        <div style={edgeStyle("top")} onMouseDown={handleResizeStart("top")} onTouchStart={handleResizeStart("top")} />
        <div style={edgeStyle("right")} onMouseDown={handleResizeStart("right")} onTouchStart={handleResizeStart("right")} />
        <div style={edgeStyle("corner")} onMouseDown={handleResizeStart("corner")} onTouchStart={handleResizeStart("corner")} />

        {/* Visual edge indicators */}
        <div style={{
          position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
          width: 40, height: 2, borderRadius: 1,
          background: resizeEdge === "top" ? "rgba(103, 232, 249, 0.5)" : "rgba(148, 163, 184, 0.2)",
          pointerEvents: "none", zIndex: 99,
        }} />
        <div style={{
          position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
          width: 2, height: 40, borderRadius: 1,
          background: resizeEdge === "right" ? "rgba(103, 232, 249, 0.5)" : "rgba(148, 163, 184, 0.2)",
          pointerEvents: "none", zIndex: 99,
        }} />

        {/* Draggable header */}
        <div
          onMouseDown={handleMoveStart}
          onTouchStart={handleMoveStart}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 16px",
            borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
            flexShrink: 0,
            cursor: moving ? "grabbing" : "grab",
            touchAction: "none",
            userSelect: "none",
          }}
        >
          <span style={{ color: "rgba(200, 220, 240, 0.9)", fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase" as const, fontFamily: "system-ui, sans-serif" }}>
            ✦ COSMOS MAP
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "rgba(148, 163, 184, 0.6)", fontSize: 9, fontFamily: "monospace" }}>
              {cosmosStats.loadedChunks} chunks · {cosmosStats.totalStars} stars · {cosmosStats.totalGalaxies} galaxies
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "rgba(148, 163, 184, 0.1)",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                borderRadius: 6,
                color: "rgba(200, 220, 240, 0.8)",
                fontSize: 11,
                padding: "3px 8px",
                cursor: "pointer",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              ✕
            </button>          </div>
        </div>

        {/* Quick-nav buttons */}
        <div style={{
          display: "flex",
          gap: 6,
          padding: "6px 12px",
          overflowX: "auto",
          flexShrink: 0,
          borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
          scrollbarWidth: "none",
        }}>
          {[
            { label: "◉ Core", x: 0, y: 0, z: 0 },
            { label: "☀ Solar", x: 60, y: -5, z: -38 },
            { label: "🌍 Earth", x: 68, y: -5, z: -47 },
            { label: "✦ Zodiac", x: 100, y: 10, z: -78 },
            { label: "↺ Reset", x: 0, y: 0, z: 0 },
          ].map((dest) => (
            <button
              key={dest.label}
              type="button"
              onClick={() => navigateTo3D(dest.x, dest.y, dest.z)}
              style={{
                background: "rgba(103, 232, 249, 0.08)",
                border: "1px solid rgba(103, 232, 249, 0.2)",
                borderRadius: 6,
                color: "rgba(103, 232, 249, 0.9)",
                fontSize: 9,
                fontWeight: 600,
                padding: "4px 8px",
                cursor: "pointer",
                whiteSpace: "nowrap" as const,
                fontFamily: "system-ui, sans-serif",
                letterSpacing: "0.05em",
                flexShrink: 0,
              }}
            >
              {dest.label}
            </button>
          ))}
        </div>

        {/* Map area with pinch-to-zoom and pan */}
        <div
          onTouchStart={(e) => {
            if (e.touches.length === 2) {
              const dx = e.touches[0].clientX - e.touches[1].clientX;
              const dy = e.touches[0].clientY - e.touches[1].clientY;
              pinchRef.current = { dist: Math.hypot(dx, dy), scale: mapScale };
            } else if (e.touches.length === 1) {
              panRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: mapOffset.x, oy: mapOffset.y };
            }
          }}
          onTouchMove={(e) => {
            if (e.touches.length === 2 && pinchRef.current) {
              e.preventDefault();
              const dx = e.touches[0].clientX - e.touches[1].clientX;
              const dy = e.touches[0].clientY - e.touches[1].clientY;
              const dist = Math.hypot(dx, dy);
              const newScale = Math.max(0.15, Math.min(8, pinchRef.current.scale * (dist / pinchRef.current.dist)));
              setMapScale(newScale);
            } else if (e.touches.length === 1 && panRef.current) {
              e.preventDefault();
              const dx = e.touches[0].clientX - panRef.current.x;
              const dy = e.touches[0].clientY - panRef.current.y;
              setMapOffset({ x: panRef.current.ox + dx, y: panRef.current.oy + dy });
            }
          }}
          onTouchEnd={() => { pinchRef.current = null; panRef.current = null; }}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setMapScale(s => Math.max(0.15, Math.min(8, s * delta)));
          }}
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            background: "radial-gradient(ellipse at center, rgba(30, 40, 60, 0.5) 0%, rgba(8, 12, 24, 0.8) 100%)",
            touchAction: "none",
          }}
        >
          {/* Zoomable/pannable container */}
          <div style={{
            position: "absolute",
            inset: 0,
            transform: `translate(${mapOffset.x}px, ${mapOffset.y}px) scale(${mapScale})`,
            transformOrigin: "center center",
            transition: pinchRef.current ? "none" : "transform 0.1s ease-out",
          }}>
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {[-2, -1, 0, 1, 2].map(i => (
              <line key={`h${i}`} x1="0%" y1={`${50 + i * 20}%`} x2="100%" y2={`${50 + i * 20}%`} stroke="rgba(100, 140, 200, 0.06)" strokeWidth={0.5} />
            ))}
            {[-2, -1, 0, 1, 2].map(i => (
              <line key={`v${i}`} x1={`${50 + i * 20}%`} y1="0%" x2={`${50 + i * 20}%`} y2="100%" stroke="rgba(100, 140, 200, 0.06)" strokeWidth={0.5} />
            ))}
          </svg>

          {nodes.map(node => (
            <MapNode
              key={node.id}
              x={node.x}
              y={node.y}
              label={node.label}
              color={node.color}
              size={node.size}
              onClick={() => navigateTo3D(node.camX, node.camY, node.camZ)}
            />
          ))}

          <div style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
            width: 20, height: 20, border: "1px solid rgba(103, 232, 249, 0.3)", borderRadius: "50%", pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
            width: 4, height: 4, background: "rgba(103, 232, 249, 0.5)", borderRadius: "50%", pointerEvents: "none",
          }} />
          </div>
        </div>

        {/* Bottom stats bar */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "6px 16px",
          borderTop: "1px solid rgba(148, 163, 184, 0.1)",
          flexShrink: 0,
        }}>
          <span style={{ color: "rgba(148, 163, 184, 0.5)", fontSize: 9, fontFamily: "monospace" }}>
            chunk: {cosmosStats.cameraChunk.cx},{cosmosStats.cameraChunk.cy},{cosmosStats.cameraChunk.cz}
          </span>
          <span style={{ color: "rgba(148, 163, 184, 0.5)", fontSize: 9, fontFamily: "monospace" }}>
            tap to navigate · pinch to zoom
          </span>
        </div>

        {/* Bottom resize handle */}
        <div
          onTouchStart={handleResizeStart("top")}
          onMouseDown={handleResizeStart("top")}
          style={{
            height: 12,
            cursor: "ns-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            touchAction: "none",
          }}
        >
          <div style={{ width: 32, height: 3, borderRadius: 2, background: "rgba(148, 163, 184, 0.25)" }} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
