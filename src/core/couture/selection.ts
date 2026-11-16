/**
 * ==========================================================
 * LÉLU — CREATIVE SELECTION AND FOCUS
 *
 * Which creation is selected, and a request to frame one on
 * screen. This lives in core, not in the scene, because it has
 * two callers with equal standing: a person tapping the object
 * in the Cosmos, and LÉLU operating the same object through her
 * tools. The scene renders it; the store owns identity; this
 * module owns only the pointer to "the one being worked on".
 *
 * It is deliberately tiny: no object state, no second store, no
 * transform. Selection never modifies the object.
 * ==========================================================
 */

export interface CreativeSelection {
  objectId: string;
  componentId?: string;
}

let selection: CreativeSelection | null = null;
const selectionListeners = new Set<(selection: CreativeSelection | null) => void>();

export function getCreativeSelection(): CreativeSelection | null {
  return selection;
}

export function selectCreativeObject(next: CreativeSelection | null): void {
  if (selection?.objectId === next?.objectId && selection?.componentId === next?.componentId) return;
  selection = next;
  for (const listener of selectionListeners) listener(next);
}

export function subscribeCreativeSelection(listener: (selection: CreativeSelection | null) => void): () => void {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

/**
 * A request to frame an object.
 *
 * The caller knows WHICH object; only the 3D layer knows where its geometry
 * actually is, so it fulfils the request and drives the existing camera bus.
 * Keeping the request in core lets both the dock and a tool ask for it.
 */
const focusListeners = new Set<(objectId: string) => void>();

export function requestCreativeFocus(objectId: string): void {
  for (const listener of focusListeners) listener(objectId);
}

export function subscribeCreativeFocus(listener: (objectId: string) => void): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/** True when at least one scene surface is listening for focus requests. */
export function hasCreativeFocusListener(): boolean {
  return focusListeners.size > 0;
}
