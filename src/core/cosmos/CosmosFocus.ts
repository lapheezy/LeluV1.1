/**
 * ==========================================================
 * LÉLU — COSMOS FOCUS
 *
 * What is selected in the cosmos right now: a destination
 * (galaxy / planet / room) or a spatial object.
 *
 * The 3D scene and the workspace panel both read and write
 * this, so tapping a ring in space opens the same inspection
 * the list opens, and selecting a room in the panel highlights
 * it in space. It holds a reference only — never a copy of the
 * thing selected, so it cannot drift from the record.
 * ==========================================================
 */

export type FocusKind = "node" | "object";

export interface FocusTarget {
  kind: FocusKind;
  id: string;
}

type Listener = (target: FocusTarget | null) => void;

export default class CosmosFocus {
  private static instance: CosmosFocus | null = null;

  private target: FocusTarget | null = null;
  private listeners = new Set<Listener>();

  static getInstance(): CosmosFocus {
    if (!CosmosFocus.instance) CosmosFocus.instance = new CosmosFocus();
    return CosmosFocus.instance;
  }

  static reset(): void {
    CosmosFocus.instance = null;
  }

  get(): FocusTarget | null {
    return this.target ? { ...this.target } : null;
  }

  /** Select a destination or an object. Selecting the same id is a no-op. */
  set(target: FocusTarget | null): void {
    if (target && this.target && target.kind === this.target.kind && target.id === this.target.id) return;
    if (!target && !this.target) return;
    this.target = target ? { ...target } : null;
    this.notify();
  }

  clear(): void {
    this.set(null);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const current = this.get();
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch (error) {
        console.error("[CosmosFocus] listener failed:", error);
      }
    }
  }
}
