/**
 * ==========================================================
 * LÉLU — RADIAL MENU
 *
 * A portalled, edge-aware circle of circular options.
 *
 * Behaviour, as specified for the whole project:
 *   press and hold a CircularControl   → the ring expands while held
 *   release the control                → the ring STAYS open
 *   tap an option                      → it executes, then the ring closes
 *   tap outside / Escape               → dismiss
 *
 * It supports nested rings to ANY depth: an option with `children` opens
 * the next ring in place, with a back control that zooms out exactly one
 * level and returns the root at the top of the path. A ring always opens
 * at its root, so a navigation never starts halfway down. Options can be
 * reached with the keyboard (Tab, Arrow keys, Home/End, Enter).
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { interactionState } from "./InteractionStateManager";
import { currentViewport, placeRadial, radialOptionPositions, type InteractionRect, type InteractionSize } from "./geometry";
import RadialMenuItem, { type RadialMenuItemSpec } from "./RadialMenuItem";
import { INTERACTION_TOKENS } from "./tokens";

export interface RadialMenuDefinition {
  id: string;
  label: string;
  items: RadialMenuItemSpec[];
  preferredRadius?: number;
  optionSize?: number;
}

interface Branch {
  title: string;
  items: RadialMenuItemSpec[];
}

export default function RadialMenu({
  menu,
  anchor,
  open,
}: {
  menu: RadialMenuDefinition;
  anchor: InteractionRect;
  open: boolean;
}) {
  const [viewport, setViewport] = useState<InteractionSize>(() => currentViewport());
  /*
   * The zoom path. A stack, not a single slot: a workspace holds projects,
   * a project holds conversations, and each level must be one step back
   * without losing the level below it.
   */
  const [path, setPath] = useState<Branch[]>([]);
  const nested = path.length > 0;
  const branch: Branch = nested ? path[path.length - 1] : { title: menu.label, items: menu.items };
  const parentTitle = path.length > 1 ? path[path.length - 2].title : menu.label;
  const layerRef = useRef<HTMLDivElement>(null);

  const optionSize = menu.optionSize ?? INTERACTION_TOKENS.size.option;
  const placement = useMemo(
    () =>
      placeRadial(anchor, viewport, {
        itemCount: branch.items.length,
        optionSize,
        preferredRadius: menu.preferredRadius ?? INTERACTION_TOKENS.radius.preferred,
        padding: INTERACTION_TOKENS.gap.edge,
      }),
    [anchor, viewport, branch.items.length, optionSize, menu.preferredRadius],
  );

  const positions = useMemo(
    () => radialOptionPositions(branch.items.length, placement.radius),
    [branch.items.length, placement.radius],
  );

  useEffect(() => {
    /*
     * A ring always opens at its ROOT.
     *
     * This used to reset only when a *different* menu opened, so closing the
     * dial while inside “Work” and touching it again dropped you straight back
     * into Work with no indication of where you were — the hierarchy looked
     * broken because the parent step had been skipped. Reopening is a new
     * navigation, and every navigation starts at the top.
     */
    if (open) {
      setPath([]);
      /*
       * Re-read the screen when the ring opens.
       *
       * The viewport was only sampled on mount and on resize WHILE the ring
       * was open, so a ring opened after the window changed size was placed
       * for the old one: at 320×740 the bottom options landed 34 px below the
       * fold and could not be reached. Opening is a fresh measurement.
       */
      setViewport(currentViewport());
    }
  }, [menu.id, open]);

  useEffect(() => {
    if (!open) return;
    const onViewport = () => setViewport(currentViewport());
    window.addEventListener("resize", onViewport);
    window.visualViewport?.addEventListener("resize", onViewport);
    window.visualViewport?.addEventListener("scroll", onViewport);
    return () => {
      window.removeEventListener("resize", onViewport);
      window.visualViewport?.removeEventListener("resize", onViewport);
      window.visualViewport?.removeEventListener("scroll", onViewport);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-lelu-radial-menu]")) return;
      const control = target?.closest("[data-lelu-menu-anchor]");
      if (control?.getAttribute("data-lelu-menu-anchor") === menu.id) return;
      interactionState.close(menu.id);
    };
    // capture: dismiss before the page underneath handles the tap
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, menu.id]);

  const close = useCallback(() => interactionState.close(menu.id), [menu.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") return;
      const items = Array.from(layerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = current;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else return;
      event.preventDefault();
      items[next]?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const first = layerRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus({ preventScroll: true });
  }, [open, path.length]);

  if (!open || typeof document === "undefined") return null;

  const choose = (item: RadialMenuItemSpec) => {
    if (item.children?.length) {
      /* Zoom in — one level, keeping the path that got us here. */
      setPath((current) => [...current, { title: item.label, items: item.children ?? [] }]);
      return;
    }
    item.onSelect?.();
    close();
  };

  const captionTop = Math.max(
    INTERACTION_TOKENS.gap.edge,
    Math.min(
      viewport.height - 44,
      placement.centerY - placement.radius - optionSize / 2 - 38,
    ),
  );

  return createPortal(
    <div
      className="lelu-radial-layer"
      data-lelu-radial-menu={menu.id}
      data-menu-kind="radial"
      ref={layerRef}
    >
      <div
        className="lelu-radial-caption"
        style={{ left: placement.centerX, top: captionTop } as CSSProperties}
      >
        {/*
         * Dismissal lives at the top of the caption, never at the ring's
         * centre. The centre is exactly where the finger was when the ring
         * opened, so a close control there ate the release: hold, let go, and
         * the menu closed itself on the same tap. Outside tap and Escape
         * remain the other ways out.
         */}
        <button
          type="button"
          className="lelu-radial-dismiss"
          aria-label={`Close ${branch.title}`}
          onClick={close}
        >
          ×
        </button>
        {nested ? (
          <button
            type="button"
            className="lelu-radial-back"
            aria-label={`Back to ${parentTitle}`}
            onClick={() => setPath((current) => current.slice(0, -1))}
          >
            ‹ {parentTitle}
          </button>
        ) : null}
        <strong>{branch.title}</strong>
        <span>release, then choose</span>
      </div>

      <div
        className="lelu-radial-hub"
        aria-hidden="true"
        style={{ left: placement.centerX, top: placement.centerY } as CSSProperties}
      >
        <span className="lelu-radial-hub-dot" />
      </div>

      <div
        className="lelu-radial-ring"
        aria-hidden="true"
        style={
          {
            left: placement.centerX,
            top: placement.centerY,
            width: placement.radius * 2 + optionSize,
            height: placement.radius * 2 + optionSize,
          } as CSSProperties
        }
      />

      <div
        className="lelu-radial-items"
        role="menu"
        aria-label={branch.title}
        style={{ left: placement.centerX, top: placement.centerY } as CSSProperties}
      >
        {branch.items.map((item, index) => {
          const position = positions[index] ?? { x: 0, y: 0 };
          return (
            <RadialMenuItem
              key={item.id}
              item={item}
              index={index}
              x={position.x}
              y={position.y}
              onChoose={choose}
            />
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
