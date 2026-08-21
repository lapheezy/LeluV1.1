/**
 * ==========================================================
 * LÉLUVERSE RESIZABLE PANEL
 *
 * A panel that can be resized by dragging, collapsed to a
 * small Cotton Candy Cosmos cloud orb, and expanded back.
 *
 * Every major panel uses this: Agent Tab, Agent Council,
 * Chat, Browser, Memory Garden, etc.
 * ==========================================================
 */

import { useState, useCallback, useRef, useEffect, type ReactNode, type CSSProperties } from "react";

interface ResizablePanelProps {
  /** Panel title */
  title: string;
  /** Panel content */
  children: ReactNode;
  /** Initial width in pixels */
  initialWidth: number;
  /** Whether the panel is initially expanded */
  initiallyExpanded?: boolean;
  /** Position: left, right, or bottom */
  position: "left" | "right" | "bottom";
  /** Min width/height */
  minSize?: number;
  /** Max width/height */
  maxSize?: number;
  /** Direction of resize */
  resizeDirection: "horizontal" | "vertical";
  /** Hue for cloud orb color */
  hue?: number;
  /** Callback when expanded state changes */
  onExpandChange?: (expanded: boolean) => void;
  /** Callback when size changes */
  onSizeChange?: (size: number) => void;
  /** Persistence key for KvStore */
  persistKey?: string;
  /** Z-index */
  zIndex?: number;
}

export default function ResizablePanel({
  title,
  children,
  initialWidth,
  initiallyExpanded = true,
  position,
  minSize = 120,
  maxSize = 600,
  resizeDirection,
  hue = 200,
  onExpandChange,
  onSizeChange,
  persistKey,
  zIndex = 20,
}: ResizablePanelProps) {
  const [expanded, setExpanded] = useState(() => {
    if (persistKey) {
      try {
        const stored = localStorage.getItem(`${persistKey}.expanded`);
        if (stored !== null) return stored === "true";
      } catch { /* persistence must never break */ }
    }
    return initiallyExpanded;
  });

  const [size, setSize] = useState(() => {
    if (persistKey) {
      try {
        const stored = localStorage.getItem(`${persistKey}.size`);
        if (stored !== null) return Number(stored) || initialWidth;
      } catch { /* persistence must never break */ }
    }
    return initialWidth;
  });

  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startPos: number; startSize: number } | null>(null);

  // Persist state
  useEffect(() => {
    if (persistKey) {
      try {
        localStorage.setItem(`${persistKey}.expanded`, String(expanded));
        localStorage.setItem(`${persistKey}.size`, String(size));
      } catch { /* persistence must never break */ }
    }
  }, [persistKey, expanded, size]);

  // Handle drag resize — works with both mouse and touch pointer events
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    dragRef.current = {
      startPos: resizeDirection === "horizontal" ? e.clientX : e.clientY,
      startSize: size,
    };

    // Capture the pointer so touch events continue outside the handle
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    const handleMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      const delta = resizeDirection === "horizontal"
        ? (position === "right" ? dragRef.current.startPos - event.clientX : event.clientX - dragRef.current.startPos)
        : dragRef.current.startPos - event.clientY;
      const newSize = Math.max(minSize, Math.min(maxSize, dragRef.current.startSize + delta));
      setSize(newSize);
      onSizeChange?.(newSize);
    };

    const handleUp = () => {
      setDragging(false);
      dragRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, [resizeDirection, position, size, minSize, maxSize, onSizeChange]);

  const toggleExpanded = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    onExpandChange?.(next);
  }, [expanded, onExpandChange]);

  const panelStyle: CSSProperties = position === "bottom"
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: expanded ? size : 0,
        maxHeight: expanded ? size : 0,
        zIndex,
        pointerEvents: expanded ? "auto" : "none",
        transition: dragging ? "none" : "max-height 0.3s ease, height 0.3s ease",
        overflow: "hidden",
      }
    : {
        position: "fixed",
        top: 0,
        bottom: 0,
        [position]: 0,
        width: expanded ? size : 0,
        maxWidth: expanded ? size : 0,
        zIndex,
        pointerEvents: expanded ? "auto" : "none",
        transition: dragging ? "none" : "max-width 0.3s ease, width 0.3s ease",
        overflow: "hidden",
      };

  return (
    <>
      {/* Collapsed cloud orb */}
      {!expanded && (
        <button
          type="button"
          onClick={toggleExpanded}
          title={`Expand ${title}`}
          aria-label={`Expand ${title}`}
          style={{
            position: "fixed",
            [position === "bottom" ? "bottom" : position]: 8,
            [position === "bottom" ? (position === "bottom" ? "left" : "right") : "top"]: position === "bottom" ? 8 : 60,
            zIndex: zIndex + 1,
            pointerEvents: "auto",
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: `1px solid hsla(${hue}, 60%, 70%, 0.35)`,
            background: `radial-gradient(circle at 35% 35%, hsla(${hue}, 70%, 60%, 0.2), hsla(${hue + 30}, 50%, 40%, 0.15))`,
            boxShadow: `0 4px 16px hsla(${hue}, 70%, 50%, 0.15), inset 0 1px 0 rgba(255,255,255,0.1)`,
            cursor: "pointer",
            color: `hsl(${hue}, 70%, 85%)`,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            transition: "transform 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          {title[0]}
        </button>
      )}

      {/* Expanded panel */}
      <div style={panelStyle}>
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: position === "bottom" ? "column" : (position === "right" ? "row-reverse" : "row"),
            background: "linear-gradient(165deg, rgba(255, 182, 215, 0.06), rgba(147, 197, 253, 0.05), rgba(192, 132, 252, 0.06), rgba(2, 8, 30, 0.95))",
            borderRight: position === "left" ? "1px solid rgba(255,255,255,0.08)" : undefined,
            borderLeft: position === "right" ? "1px solid rgba(255,255,255,0.08)" : undefined,
            borderTop: position === "bottom" ? "1px solid rgba(255,255,255,0.08)" : undefined,
          }}
        >
          {/* Resize handle — wider touch target for mobile */}
          <div
            onPointerDown={handlePointerDown}
            style={{
              [resizeDirection === "horizontal" ? "minWidth" : "minHeight"]: 12,
              [resizeDirection === "horizontal" ? "width" : "height"]: "100%",
              cursor: resizeDirection === "horizontal" ? "col-resize" : "row-resize",
              background: dragging
                ? `rgba(${hue}, 0.3)`
                : "rgba(255,255,255,0.04)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s ease",
              touchAction: "none",
            }}
            onMouseEnter={(e) => {
              if (!dragging) e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
            onMouseLeave={(e) => {
              if (!dragging) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            }}
          >
            {/* Handle grip dots */}
            <div style={{
              [resizeDirection === "horizontal" ? "width" : "height"]: 2,
              [resizeDirection === "horizontal" ? "height" : "width"]: 20,
              display: "flex",
              flexDirection: resizeDirection === "horizontal" ? "column" : "row",
              gap: 3,
              alignItems: "center",
              justifyContent: "center",
            }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 2,
                    height: 2,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.2)",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Panel content */}
          <div
            className="genesis-scroll"
            style={{
              flex: 1,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Panel header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: `hsl(${hue}, 60%, 75%)`,
                fontWeight: 600,
              }}>
                {title}
              </span>
              <button
                type="button"
                onClick={toggleExpanded}
                title={`Collapse ${title}`}
                aria-label={`Collapse ${title}`}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                }}
              >
                {position === "left" ? "«" : position === "right" ? "»" : "v"}
              </button>
            </div>

            {/* Children */}
            <div style={{ flex: 1, overflow: "auto" }} className="genesis-scroll">
              {children}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
