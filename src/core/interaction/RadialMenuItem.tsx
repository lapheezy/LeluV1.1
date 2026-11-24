/**
 * ==========================================================
 * LÉLU — RADIAL MENU ITEM
 *
 * One circular option. Positioned by the ring, never by a layout list,
 * and always at least a 48px touch target.
 * ==========================================================
 */

import type { CSSProperties, ReactNode } from "react";

export interface RadialMenuItemSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Runs when chosen. A parent with `children` opens the nested ring instead. */
  onSelect?: () => void;
  children?: RadialMenuItemSpec[];
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "accent" | "danger";
  /** Optional line shown under the label in the centre caption. */
  hint?: string;
  testId?: string;
}

export default function RadialMenuItem({
  item,
  x,
  y,
  index,
  onChoose,
}: {
  item: RadialMenuItemSpec;
  x: number;
  y: number;
  index: number;
  onChoose: (item: RadialMenuItemSpec) => void;
}) {
  const style = {
    left: `calc(50% + ${x}px)`,
    top: `calc(50% + ${y}px)`,
    "--lelu-item-index": index,
  } as CSSProperties;

  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="lelu-radial-item"
      data-tone={item.tone ?? "default"}
      data-active={item.active ? "true" : "false"}
      data-nested={item.children?.length ? "true" : "false"}
      data-testid={item.testId}
      disabled={item.disabled}
      aria-label={item.label}
      title={item.label}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        if (!item.disabled) onChoose(item);
      }}
    >
      <span className="lelu-radial-item-icon" aria-hidden>
        {item.icon}
      </span>
      <span className="lelu-radial-item-label">{item.label}</span>
    </button>
  );
}
