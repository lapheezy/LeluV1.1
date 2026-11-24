/**
 * ==========================================================
 * LÉLU — RADIAL MENU (one implementation, used everywhere)
 *
 * A control keeps its ordinary tap. Holding it opens a ring of contextual
 * actions around it; sliding toward one and releasing selects it; releasing
 * where you pressed (or sliding far away) cancels. This is the interaction
 * the Spatial Bar, the chat composer and every module window share, so a
 * person learns it once.
 *
 *   tap                 → the control's own action (onTap), unchanged; or,
 *                          when it has none, the menu opens and stays open
 *   hold (≥ holdMs)     → ring opens around the finger; slide; release
 *   right-click /
 *   keyboard (↑ ↓, Menu
 *   key, Shift+F10)     → ring opens and stays open; arrows move, Enter
 *                          selects, Escape closes and returns focus
 *
 * Touch-native: pointer events with pointer capture, `touch-action: none`
 * on the trigger, the iOS long-press callout and Android's context menu
 * suppressed, a light haptic tick where the platform has one. Layout is
 * radialGeometry: the ring fans into the open part of the screen and every
 * item stays on screen.
 *
 * The trigger is rendered by the caller (render prop) so each host keeps its
 * own markup, data attributes and accessible name.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { within } from "../../../core/ui/Layers";
import { layoutRadial, pickRadialItem, type Point, type RadialLayout } from "./radialGeometry";
import "./radial.css";

export interface RadialItem {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Shown as the current state (e.g. the scene you are in). */
  active?: boolean;
}

export interface RadialTriggerProps {
  ref: (element: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onClick: (event: { preventDefault: () => void; stopPropagation: () => void }) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "data-radial-trigger": string;
  "data-radial-open": "hold" | "sticky" | "closed";
  style: CSSProperties;
}

export interface RadialMenuProps {
  /** Stable id: names the menu in the DOM and in tests. */
  id: string;
  /** What the menu is, for assistive technology ("Spatial destinations"). */
  label: string;
  items: RadialItem[];
  /** The control's ordinary tap. Omit it and a tap opens the menu instead. */
  onTap?: () => void;
  /** How long a press must last to open the ring. */
  holdMs?: number;
  children: (trigger: RadialTriggerProps) => ReactNode;
}

type OpenState = { mode: "hold" | "sticky"; anchor: Point; layout: RadialLayout } | null;

/** Movement (px) that turns a press into a drag/scroll rather than a hold or tap. */
const SLOP = 10;

function viewportSize(): { width: number; height: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    width: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1024),
    height: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 768),
  };
}

function coarsePointer(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
}

function tick(): void {
  try {
    (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(8);
  } catch {
    /* no haptics here */
  }
}

export default function RadialMenu({ id, label, items, onTap, holdMs = 320, children }: RadialMenuProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const press = useRef<{ pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [open, setOpen] = useState<OpenState>(null);
  const [highlight, setHighlight] = useState(-1);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const itemSize = coarsePointer() ? 56 : 46;

  const openAt = useCallback(
    (mode: "hold" | "sticky") => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const anchor = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const layout = layoutRadial({
        count: itemsRef.current.length,
        anchor,
        viewport: viewportSize(),
        itemSize,
        radius: Math.max(r.width, r.height) / 2 + itemSize / 2 + 26,
        maxRadius: 170,
        margin: 12,
      });
      setHighlight(mode === "sticky" ? Math.max(0, itemsRef.current.findIndex((item) => !item.disabled)) : -1);
      setOpen({ mode, anchor, layout });
      tick();
    },
    [itemSize],
  );

  const close = useCallback((refocus = false) => {
    setOpen(null);
    setHighlight(-1);
    if (refocus) triggerRef.current?.focus?.();
  }, []);

  const select = useCallback(
    (index: number) => {
      const item = itemsRef.current[index];
      close(false);
      if (item && !item.disabled) item.onSelect();
    },
    [close],
  );

  const clearPress = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
  };

  // Sticky menu: keyboard focus follows the highlighted item.
  useEffect(() => {
    if (open?.mode === "sticky" && highlight >= 0) itemRefs.current[highlight]?.focus();
  }, [open, highlight]);

  // Sticky menu closes on Escape, on scroll/resize (its geometry is stale), and on outside press.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    const onViewport = () => close(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onViewport);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onViewport);
    };
  }, [open, close]);

  useEffect(() => () => clearPress(), []);

  const moveHighlight = (delta: number) => {
    const list = itemsRef.current;
    if (list.length === 0) return;
    let next = highlight;
    for (let step = 0; step < list.length; step += 1) {
      next = (next + delta + list.length) % list.length;
      if (!list[next].disabled) break;
    }
    setHighlight(next);
  };

  const trigger: RadialTriggerProps = {
    ref: (element) => {
      triggerRef.current = element;
    },
    onPointerDown: (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (open?.mode === "sticky") return; // the next click closes it (see onClick)
      clearPress();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const record = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: null as ReturnType<typeof setTimeout> | null, moved: false };
      record.timer = setTimeout(() => {
        if (press.current === record && !record.moved) openAt("hold");
      }, holdMs);
      press.current = record;
    },
    onPointerMove: (event) => {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (open?.mode === "hold") {
        const next = pickRadialItem(open.layout, open.anchor, { x: event.clientX, y: event.clientY });
        const usable = next >= 0 && !itemsRef.current[next]?.disabled ? next : -1;
        if (usable !== highlight) {
          setHighlight(usable);
          if (usable >= 0) tick();
        }
        return;
      }
      if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) > SLOP) {
        current.moved = true;
        if (current.timer) clearTimeout(current.timer);
        current.timer = null;
      }
    },
    onPointerUp: (event) => {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const wasMoved = current.moved;
      clearPress();
      if (open?.mode === "hold") {
        suppressClick.current = true;
        if (highlight >= 0) select(highlight);
        else close(false);
        return;
      }
      if (wasMoved) {
        suppressClick.current = true;
        return;
      }
      // A tap runs on the native click that follows, NOT here. Acting on
      // pointerup changed the layout under the finger (the Spatial hub's list
      // opened and pushed the hub up), and the browser's compatibility click
      // then landed on whatever slid beneath it — measured on a phone: a tap
      // on the hub opened the Jewelry workspace card behind it.
    },
    onPointerCancel: () => {
      clearPress();
      if (open?.mode === "hold") close(false);
    },
    onClick: (event) => {
      // Pointer taps were handled on pointerup; this is the keyboard / AT click.
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (open) {
        close(true);
        return;
      }
      if (onTap) onTap();
      else openAt("sticky");
    },
    onKeyDown: (event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        openAt("sticky");
      }
    },
    onContextMenu: (event) => {
      // Long-press on iOS/Android and right-click on desktop: never the
      // browser's own menu over this control.
      event.preventDefault();
      if (!open && !press.current) openAt("sticky");
    },
    "aria-haspopup": "menu",
    "aria-expanded": open !== null,
    "data-radial-trigger": id,
    "data-radial-open": open ? open.mode : "closed",
    style: { touchAction: "none", WebkitTouchCallout: "none", userSelect: "none", WebkitUserSelect: "none" } as CSSProperties,
  };

  const menu = useMemo(() => {
    if (!open || typeof document === "undefined") return null;
    const { anchor, layout, mode } = open;
    const current = highlight >= 0 ? items[highlight] : null;
    const labelAbove = anchor.y > 120;
    return createPortal(
      <div
        className="lrm-layer"
        data-radial-menu={id}
        data-radial-mode={mode}
        style={
          {
            zIndex: within("modal", 40),
            pointerEvents: mode === "sticky" ? "auto" : "none",
            "--lrm-ax": `${anchor.x}px`,
            "--lrm-ay": `${anchor.y}px`,
            "--lrm-r": `${Math.round(layout.radius + itemSize * 1.2)}px`,
          } as CSSProperties
        }
        onPointerDown={(event) => {
          if (mode === "sticky" && event.target === event.currentTarget) close(false);
        }}
      >
        <div className="lrm-halo" style={{ left: anchor.x, top: anchor.y, width: layout.radius * 2 + itemSize * 1.4, height: layout.radius * 2 + itemSize * 1.4 }} aria-hidden />
        <div
          role="menu"
          aria-label={label}
          className="lrm-ring"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              moveHighlight(1);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              moveHighlight(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              setHighlight(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setHighlight(items.length - 1);
            } else if (event.key === "Tab") {
              close(true);
            }
          }}
        >
          {items.map((item, index) => {
            const place = layout.items[index];
            if (!place) return null;
            return (
              <button
                key={item.id}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                className="lrm-item"
                data-radial-item={item.id}
                data-highlighted={index === highlight ? "true" : "false"}
                data-active={item.active ? "true" : "false"}
                disabled={item.disabled}
                aria-label={item.label}
                title={item.label}
                tabIndex={mode === "sticky" && index === highlight ? 0 : -1}
                style={
                  {
                    width: itemSize,
                    height: itemSize,
                    left: place.x - itemSize / 2,
                    top: place.y - itemSize / 2,
                    "--lrm-from-x": `${anchor.x - place.x}px`,
                    "--lrm-from-y": `${anchor.y - place.y}px`,
                    "--lrm-delay": `${index * 10}ms`,
                  } as CSSProperties
                }
                onPointerEnter={() => mode === "sticky" && !item.disabled && setHighlight(index)}
                onClick={() => select(index)}
              >
                {item.icon}
              </button>
            );
          })}
        </div>
        <div
          className="lrm-caption"
          aria-live="polite"
          style={{ left: anchor.x, top: labelAbove ? anchor.y - layout.radius - itemSize / 2 - 34 : anchor.y + layout.radius + itemSize / 2 + 10 }}
        >
          {current ? current.label : mode === "hold" ? "Slide to choose · release here to cancel" : label}
        </div>
      </div>,
      document.body,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, highlight, items, itemSize, id, label, close, select]);

  return (
    <>
      {children(trigger)}
      {menu}
    </>
  );
}
