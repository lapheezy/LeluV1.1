/**
 * ==========================================================
 * LÉLUVERSE
 * PINCH ZOOM CONTAINER
 *
 * Touch-first content zoom using two-finger pinch gestures.
 * Designed for iPhone Safari where native pinch-to-zoom is
 * often disabled by viewport meta tags. Works on all touch
 * devices and falls back to scroll-wheel zoom on desktop.
 *
 *   - Two-finger pinch outward → zoom in (up to 3×)
 *   - Two-finger pinch inward  → zoom out (down to 0.5×)
 *   - Double-tap               → toggle between 1× and 2×
 *   - Two-finger drag          → pan the zoomed content
 *   - Scroll wheel + Ctrl      → desktop zoom fallback
 *
 * The scale transform is applied to the inner content wrapper;
 * the outer container stays at 1× and clips overflow so the
 * zoomed content doesn't leak outside the panel bounds.
 * ==========================================================
 */

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface PinchZoomContainerProps {
  children: ReactNode;
  /** Minimum allowed scale. Default 0.5. */
  minScale?: number;
  /** Maximum allowed scale. Default 3. */
  maxScale?: number;
  /** CSS class name for the outer wrapper. */
  className?: string;
  /** Inline styles for the outer wrapper. */
  style?: CSSProperties;
  /** Whether zoom is enabled. Default true. */
  enabled?: boolean;
}

interface TouchState {
  pointerId: number;
  x: number;
  y: number;
}

interface PinchState {
  /** Distance between the two pointers at the start of the pinch. */
  startDistance: number;
  /** Scale at the start of the pinch. */
  startScale: number;
}

interface PanState {
  /** Pointer that initiated the pan (single finger or the centroid of two). */
  startX: number;
  startY: number;
  /** Translation offset at the start of the pan. */
  originX: number;
  originY: number;
}

export default function PinchZoomContainer({
  children,
  minScale = 0.5,
  maxScale = 3,
  className,
  style,
  enabled = true,
}: PinchZoomContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Gesture tracking refs (mutable to avoid re-render on every pointer move)
  const touchesRef = useRef<Map<number, TouchState>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const lastTapRef = useRef(0);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  // Keep refs in sync
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const clampScale = useCallback(
    (s: number) => Math.min(maxScale, Math.max(minScale, s)),
    [maxScale, minScale],
  );

  /** Distance between two touch points. */
  function touchDistance(a: TouchState, b: TouchState): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Centroid of two touch points. */
  function touchCentroid(a: TouchState, b: TouchState): { x: number; y: number } {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /* -----------------------------------------------------------
   * Pointer events — track individual touches
   * ----------------------------------------------------------- */

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled) return;

      const el = containerRef.current;
      if (!el) return;

      // Record this pointer
      const rect = el.getBoundingClientRect();
      touchesRef.current.set(event.pointerId, {
        pointerId: event.pointerId,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });

      // Capture the pointer so we get move/up even if it leaves the element
      el.setPointerCapture(event.pointerId);

      const activeTouches = Array.from(touchesRef.current.values());

      if (activeTouches.length === 2) {
        // Two fingers → start pinch
        const [a, b] = activeTouches;
        pinchRef.current = {
          startDistance: touchDistance(a, b),
          startScale: scaleRef.current,
        };
        // Also start pan from centroid
        const centroid = touchCentroid(a, b);
        panRef.current = {
          startX: centroid.x,
          startY: centroid.y,
          originX: offsetRef.current.x,
          originY: offsetRef.current.y,
        };
      } else if (activeTouches.length === 1) {
        // Single finger → check for double-tap or start pan
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          // Double tap → toggle zoom
          lastTapRef.current = 0;
          const targetScale = scaleRef.current >= 1.8 ? 1 : 2;
          setScale(clampScale(targetScale));
          if (targetScale === 1) {
            setOffset({ x: 0, y: 0 });
          }
        } else {
          lastTapRef.current = now;
          // Start single-finger pan (only when zoomed in)
          if (scaleRef.current > 1.05) {
            panRef.current = {
              startX: activeTouches[0].x,
              startY: activeTouches[0].y,
              originX: offsetRef.current.x,
              originY: offsetRef.current.y,
            };
          }
        }
      }
    },
    [enabled, clampScale],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled) return;

      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const current: TouchState = {
        pointerId: event.pointerId,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      touchesRef.current.set(event.pointerId, current);

      const activeTouches = Array.from(touchesRef.current.values());

      if (activeTouches.length === 2 && pinchRef.current) {
        // Pinch gesture
        const [a, b] = activeTouches;
        const distance = touchDistance(a, b);
        const ratio = distance / pinchRef.current.startDistance;
        const newScale = clampScale(pinchRef.current.startScale * ratio);
        setScale(newScale);

        // Pan from centroid during pinch
        if (panRef.current) {
          const centroid = touchCentroid(a, b);
          setOffset({
            x: panRef.current.originX + (centroid.x - panRef.current.startX),
            y: panRef.current.originY + (centroid.y - panRef.current.startY),
          });
        }
      } else if (activeTouches.length === 1 && panRef.current && scaleRef.current > 1.05) {
        // Single-finger pan when zoomed
        setOffset({
          x: panRef.current.originX + (current.x - panRef.current.startX),
          y: panRef.current.originY + (current.y - panRef.current.startY),
        });
      }
    },
    [enabled, clampScale],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      touchesRef.current.delete(event.pointerId);

      if (touchesRef.current.size < 2) {
        pinchRef.current = null;
      }
      if (touchesRef.current.size === 0) {
        panRef.current = null;
      }
    },
    [],
  );

  /* -----------------------------------------------------------
   * Scroll-wheel zoom fallback (desktop)
   * ----------------------------------------------------------- */

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    function handleWheel(event: WheelEvent) {
      // Ctrl+scroll = zoom (desktop trackpad / mouse wheel)
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = -event.deltaY * 0.005;
        setScale((prev) => clampScale(prev + delta));
      }
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [enabled, clampScale]);

  /* -----------------------------------------------------------
   * Reset zoom when scale returns to 1
   * ----------------------------------------------------------- */
  useEffect(() => {
    if (scale <= 1.01 && scale >= 0.99) {
      setOffset({ x: 0, y: 0 });
    }
  }, [scale]);

  if (!enabled) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        ...style,
        overflow: "hidden",
        touchAction: "none",
        position: "relative",
        cursor: scale > 1.05 ? "grab" : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        style={{
          transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
          transformOrigin: "top left",
          width: `${100 / scale}%`,
          minHeight: "100%",
          transition: pinchRef.current ? "none" : "transform 0.15s ease",
          willChange: "transform",
        }}
      >
        {children}
      </div>

      {/* Zoom indicator — shows current zoom level during pinch */}
      {scale > 1.05 || scale < 0.95 ? (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(8, 16, 38, 0.75)",
            border: "1px solid rgba(148, 163, 184, 0.25)",
            borderRadius: 8,
            padding: "3px 8px",
            color: "rgba(200, 220, 240, 0.9)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            pointerEvents: "none",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            zIndex: 1,
          }}
        >
          {Math.round(scale * 100)}%
        </div>
      ) : null}
    </div>
  );
}
