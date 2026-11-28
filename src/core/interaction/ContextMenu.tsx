/**
 * ==========================================================
 * LÉLU — CONTEXT MENU
 *
 * The compact companion to the radial ring, for lists that are
 * genuinely lists (a window's controls, a transcript's actions).
 *
 * It shares the same state manager, the same edge-aware placement and
 * the same dismissal rules as RadialMenu. It is deliberately small: a
 * context menu must not become the toolbar the radial system replaced.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { interactionState } from "./InteractionStateManager";
import { currentViewport, placeContextMenu, type InteractionRect, type InteractionSize } from "./geometry";
import { INTERACTION_TOKENS } from "./tokens";

export interface ContextMenuItemSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  testId?: string;
}

export interface ContextMenuDefinition {
  id: string;
  label: string;
  items: ContextMenuItemSpec[];
  width?: number;
}

export default function ContextMenu({
  menu,
  anchor,
  open,
}: {
  menu: ContextMenuDefinition;
  anchor: InteractionRect;
  open: boolean;
}) {
  const [viewport, setViewport] = useState<InteractionSize>(() => currentViewport());
  const layerRef = useRef<HTMLDivElement>(null);
  const width = menu.width ?? 230;

  const placement = useMemo(
    () =>
      placeContextMenu(anchor, { width, height: menu.items.length * 44 + 56 }, viewport, INTERACTION_TOKENS.gap.edge),
    [anchor, viewport, width, menu.items.length],
  );

  useEffect(() => {
    if (!open) return;
    const refresh = () => setViewport(currentViewport());
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-lelu-context-menu]")) return;
      const control = target?.closest("[data-lelu-menu-anchor]");
      if (control?.getAttribute("data-lelu-menu-anchor") === menu.id) return;
      interactionState.close(menu.id);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, menu.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        interactionState.close(menu.id);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      const items = Array.from(layerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (current + 1) % items.length
              : current <= 0
                ? items.length - 1
                : current - 1;
      event.preventDefault();
      items[next]?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    const first = layerRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, menu.id]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="lelu-context-layer"
      data-lelu-context-menu={menu.id}
      data-menu-kind="context"
      ref={layerRef}
    >
      <div
        className="lelu-context-menu"
        role="menu"
        aria-label={menu.label}
        style={
          {
            left: placement.left,
            top: placement.top,
            width,
            maxHeight: placement.maxHeight,
          } as CSSProperties
        }
      >
        <div className="lelu-context-title">{menu.label}</div>
        {menu.items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="lelu-context-item"
            data-danger={item.danger ? "true" : "false"}
            data-active={item.active ? "true" : "false"}
            data-testid={item.testId}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              interactionState.close(menu.id);
            }}
          >
            {item.icon ? (
              <span className="lelu-context-icon" aria-hidden>
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
