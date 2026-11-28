/**
 * ==========================================================
 * LÉLU — INTERACTION STATE MANAGER
 *
 * One owner for which circular menu is open. A menu is opened by a
 * control, and only one can be open at a time — opening another closes
 * the first. This is what stops two environments (or one environment's
 * duplicated control) from showing two radial menus at once.
 *
 * The manager is a tiny external store so React components can read it
 * with useSyncExternalStore and non-React gestures can drive it.
 * ==========================================================
 */

import type { InteractionRect } from "./geometry";

export type InteractionMenuKind = "radial" | "context";

export interface OpenInteractionMenu {
  /** Stable id, e.g. "spatial-home" or "chat-window:<id>". */
  id: string;
  kind: InteractionMenuKind;
  /** Where the control was when it opened. */
  anchor: InteractionRect;
  /** Optional menu-level label, for diagnostics and tests. */
  label?: string;
  /** Set when this menu was opened from another menu (nested radial). */
  parentId?: string;
}

export type InteractionStateListener = () => void;

export class InteractionStateManager {
  private current: OpenInteractionMenu | null = null;
  private readonly listeners = new Set<InteractionStateListener>();

  getSnapshot = (): OpenInteractionMenu | null => this.current;

  subscribe = (listener: InteractionStateListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  open(menu: OpenInteractionMenu): void {
    if (this.current?.id === menu.id) {
      // Same menu: refresh its anchor (window moved, scroll, resize).
      this.current = { ...menu, parentId: this.current.parentId ?? menu.parentId };
      this.emit();
      return;
    }
    this.current = menu;
    this.emit();
  }

  close(id?: string): void {
    if (!this.current) return;
    if (id && this.current.id !== id) return;
    this.current = null;
    this.emit();
  }

  toggle(menu: OpenInteractionMenu): void {
    if (this.current?.id === menu.id) this.close(menu.id);
    else this.open(menu);
  }

  isOpen(id: string): boolean {
    return this.current?.id === id;
  }

  /** The currently open menu id, or null. */
  get openId(): string | null {
    return this.current?.id ?? null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The one instance the whole interface shares. */
export const interactionState = new InteractionStateManager();
