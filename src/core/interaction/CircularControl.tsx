/**
 * ==========================================================
 * LÉLU — CIRCULAR CONTROL
 *
 * The one circular primary control used across the project.
 *
 *   tap                 → the control's primary action (or opens its menu)
 *   press and hold      → its radial menu expands; release leaves it open
 *   Enter / Space       → the menu (keyboard alternative to holding)
 *   right click / menu key → the menu
 *
 * A control without a menu is a plain circular button. There is no
 * second, environment-specific way to hold a control.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { createHoldGesture } from "./GestureController";
import { interactionState } from "./InteractionStateManager";
import { rectOf } from "./geometry";
import RadialMenu, { type RadialMenuDefinition } from "./RadialMenu";
import { INTERACTION_TOKENS } from "./tokens";
import "./interaction.css";

export interface CircularControlProps {
  label: string;
  icon: ReactNode;
  /** Primary action on tap. When omitted, a tap opens the menu. */
  onPress?: () => void;
  menu?: RadialMenuDefinition;
  size?: number;
  active?: boolean;
  disabled?: boolean;
  badge?: number | string;
  tone?: "default" | "accent" | "danger";
  testId?: string;
  className?: string;
  /** Render a visible caption under the control (spatial bar labels). */
  caption?: string;
  /** This control opens a menu managed elsewhere (e.g. a ContextMenu). */
  ariaHasPopup?: boolean;
  /** Expanded state when the menu is managed elsewhere. */
  ariaExpanded?: boolean;
  style?: CSSProperties;
}

export default function CircularControl({
  label,
  icon,
  onPress,
  menu,
  size = INTERACTION_TOKENS.size.control,
  active = false,
  disabled = false,
  badge,
  tone = "default",
  testId,
  className = "",
  caption,
  ariaHasPopup = false,
  ariaExpanded = false,
  style,
}: CircularControlProps) {
  const controlRef = useRef<HTMLButtonElement>(null);
  const suppressClick = useRef(false);
  const [anchor, setAnchor] = useState(() => ({ left: 0, top: 0, width: 0, height: 0 }));

  const snapshot = useSyncExternalStore(interactionState.subscribe, interactionState.getSnapshot, interactionState.getSnapshot);
  const open = Boolean(menu && snapshot?.kind === "radial" && snapshot.id === menu.id);

  const latest = useRef({ menu, open, controlRef });
  latest.current = { menu, open, controlRef };

  const openMenu = useCallback(() => {
    const element = controlRef.current;
    const definition = latest.current.menu;
    if (!element || !definition || disabled) return;
    const rect = rectOf(element);
    setAnchor(rect);
    interactionState.open({ id: definition.id, kind: "radial", anchor: rect, label: definition.label });
  }, [disabled]);

  const gesture = useMemo(
    () =>
      createHoldGesture({
        onHold: () => {
          suppressClick.current = true;
          openMenu();
        },
        onCancel: () => {
          suppressClick.current = false;
        },
      }),
    [openMenu],
  );

  // A control removed from the tree takes its menu with it.
  useEffect(
    () => () => {
      const id = latest.current.menu?.id;
      if (id) interactionState.close(id);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const element = controlRef.current;
    if (!element) return;
    const refresh = () => setAnchor(rectOf(element));
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
    };
  }, [open]);

  const handleClick = () => {
    if (disabled) return;
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (open) {
      interactionState.close(menu?.id);
      return;
    }
    if (onPress) onPress();
    else if (menu) openMenu();
  };

  return (
    <>
      <button
        ref={controlRef}
        type="button"
        className={`lelu-circular-control ${className}`.trim()}
        data-lelu-menu-anchor={menu?.id}
        data-tone={tone}
        data-active={active ? "true" : "false"}
        data-testid={testId}
        aria-label={label}
        aria-haspopup={menu || ariaHasPopup ? "menu" : undefined}
        aria-expanded={menu || ariaHasPopup ? (open || ariaExpanded ? "true" : "false") : undefined}
        aria-pressed={onPress && !menu ? (active ? "true" : "false") : undefined}
        disabled={disabled}
        title={menu ? `${label} — hold for actions` : label}
        style={{ width: size, height: size, ...style }}
        onPointerDown={gesture.onPointerDown}
        onPointerMove={gesture.onPointerMove}
        onPointerUp={gesture.onPointerUp}
        onPointerCancel={gesture.onPointerCancel}
        onKeyDown={gesture.onKeyDown}
        onContextMenu={gesture.onContextMenu}
        onClick={handleClick}
      >
        <span className="lelu-circular-control-icon" aria-hidden>
          {icon}
        </span>
        {badge ? <span className="lelu-circular-control-badge">{badge}</span> : null}
        {caption ? <span className="lelu-circular-control-caption">{caption}</span> : null}
      </button>
      {menu ? <RadialMenu menu={menu} anchor={anchor} open={open} /> : null}
    </>
  );
}
