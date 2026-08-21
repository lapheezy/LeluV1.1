/**
 * ==========================================================
 * LÉLUVERSE — RESIZABLE PANEL WRAPPER
 *
 * Wraps any Genesis panel with touch-draggable resize handles
 * on the top edge (vertical) and right edge (horizontal).
 * Users can drag to resize the panel on all devices.
 * ==========================================================
 */

import { useRef, useState, useCallback, useEffect } from "react";

interface Props {
  children: React.ReactNode;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  initialWidth?: number;
  initialHeight?: number;
}

export default function ResizablePanel({
  children,
  minWidth = 280,
  maxWidth = typeof window !== "undefined" ? window.innerWidth * 0.95 : 800,
  minHeight = 200,
  maxHeight = typeof window !== "undefined" ? window.innerHeight * 0.92 : 700,
  initialWidth,
  initialHeight,
}: Props) {
  const [width, setWidth] = useState(initialWidth ?? Math.min(480, maxWidth));
  const [height, setHeight] = useState(initialHeight ?? Math.min(480, maxHeight));
  const [dragging, setDragging] = useState<"top" | "right" | "corner" | null>(null);
  const dragStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const onDragStart = useCallback((edge: "top" | "right" | "corner") => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(edge);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragStart.current = { x: clientX, y: clientY, w: width, h: height };
  }, [width, height]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: TouchEvent | MouseEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const dx = clientX - dragStart.current.x;
      const dy = dragStart.current.y - clientY; // inverted: drag up = taller

      if (dragging === "top" || dragging === "corner") {
        setHeight(Math.max(minHeight, Math.min(maxHeight, dragStart.current.h + dy)));
      }
      if (dragging === "right" || dragging === "corner") {
        setWidth(Math.max(minWidth, Math.min(maxWidth, dragStart.current.w + dx)));
      }
    };
    const onUp = () => setDragging(null);

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
  }, [dragging, minHeight, maxHeight, minWidth, maxWidth]);

  const handleStyle = (edge: "top" | "right" | "corner"): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: "absolute",
      zIndex: 100,
      pointerEvents: "auto",
      touchAction: "none",
    };

    if (edge === "top") {
      return {
        ...base,
        top: -4,
        left: 0,
        right: 0,
        height: 12,
        cursor: "ns-resize",
        background: dragging === "top" ? "rgba(103, 232, 249, 0.15)" : "transparent",
        borderRadius: "4px 4px 0 0",
      };
    }
    if (edge === "right") {
      return {
        ...base,
        top: 0,
        right: -4,
        bottom: 0,
        width: 12,
        cursor: "ew-resize",
        background: dragging === "right" ? "rgba(103, 232, 249, 0.15)" : "transparent",
        borderRadius: "0 4px 4px 0",
      };
    }
    // corner
    return {
      ...base,
      top: -4,
      right: -4,
      width: 20,
      height: 20,
      cursor: "nwse-resize",
      background: dragging === "corner" ? "rgba(103, 232, 249, 0.2)" : "transparent",
      borderRadius: "0 6px 0 0",
    };
  };

  // Visual indicator lines on edges
  const edgeLineStyle = (edge: "top" | "right"): React.CSSProperties => ({
    position: "absolute" as const,
    pointerEvents: "none" as const,
    zIndex: 99,
    ...(edge === "top" ? {
      top: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: 40,
      height: 2,
      borderRadius: 1,
      background: dragging === "top" ? "rgba(103, 232, 249, 0.6)" : "rgba(148, 163, 184, 0.25)",
    } : {
      right: 0,
      top: "50%",
      transform: "translateY(-50%)",
      width: 2,
      height: 40,
      borderRadius: 1,
      background: dragging === "right" ? "rgba(103, 232, 249, 0.6)" : "rgba(148, 163, 184, 0.25)",
    }),
  });

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        maxWidth: "95vw",
        maxHeight: "92vh",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Resize handles */}
      <div style={handleStyle("top")} onMouseDown={onDragStart("top")} onTouchStart={onDragStart("top")} />
      <div style={handleStyle("right")} onMouseDown={onDragStart("right")} onTouchStart={onDragStart("right")} />
      <div style={handleStyle("corner")} onMouseDown={onDragStart("corner")} onTouchStart={onDragStart("corner")} />

      {/* Visual edge indicators */}
      <div style={edgeLineStyle("top")} />
      <div style={edgeLineStyle("right")} />

      {/* Panel content */}
      <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
        {children}
      </div>
    </div>
  );
}
