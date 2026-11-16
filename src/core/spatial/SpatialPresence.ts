/**
 * ==========================================================
 * LÉLU — SPATIAL PRESENCE
 *
 * The avatar's spatial channel, driven ONLY by verified scene
 * commits. `record()` is called by SpatialIntentBus after the
 * commit succeeded AND its post-condition was re-read from the
 * scene — never before, never from the UI.
 *
 * That ordering is the whole point: an avatar can never report
 * an action that did not occur, because there is no code path
 * that writes presence on a refusal. The test suite asserts
 * that a refused delete leaves lastAction untouched.
 *
 * This is not a second presence system. AvatarPresenceBridge
 * stays the authority for dialogue state (idle / thinking /
 * speaking / listening); this adds only where attention is and
 * what was just built.
 * ==========================================================
 */

import type { SpatialOperationId } from "./SpatialTypes";

export type SpatialTraversal = "idle" | "moving" | "inspecting" | "constructing";

export interface SpatialPresenceState {
  traversal: SpatialTraversal;
  attention: { kind: "object"; id: string; name: string } | null;
  /** e.g. `object.create → "Cube 1"`. Empty until a real commit. */
  lastAction: string;
  lastActionAt: number;
  /** Scene revision this state was derived from. */
  revision: number;
}

const EMPTY: SpatialPresenceState = {
  traversal: "idle",
  attention: null,
  lastAction: "",
  lastActionAt: 0,
  revision: 0,
};

export default class SpatialPresence {
  private static instance: SpatialPresence | null = null;

  private current: SpatialPresenceState = { ...EMPTY };
  private cached: SpatialPresenceState | null = null;
  private readonly listeners = new Set<(state: SpatialPresenceState) => void>();

  public static getInstance(): SpatialPresence {
    if (!SpatialPresence.instance) {
      SpatialPresence.instance = new SpatialPresence();
    }
    return SpatialPresence.instance;
  }

  public get(): SpatialPresenceState {
    return this.getSnapshot();
  }

  public getSnapshot(): SpatialPresenceState {
    if (!this.cached) this.cached = { ...this.current };
    return this.cached;
  }

  public subscribe(listener: (state: SpatialPresenceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Record a committed, verified action. Called by the intent bus
   * only — a caller that has not committed anything has no event
   * to hand it.
   */
  public record(input: {
    op: SpatialOperationId;
    traversal: SpatialTraversal;
    objectId?: string;
    objectName?: string;
    revision: number;
  }): SpatialPresenceState {
    this.current = {
      traversal: input.traversal,
      attention:
        input.objectId && input.objectName
          ? { kind: "object", id: input.objectId, name: input.objectName }
          : this.current.attention,
      lastAction: input.objectName ? `${input.op} → "${input.objectName}"` : input.op,
      lastActionAt: Date.now(),
      revision: input.revision,
    };
    this.cached = null;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("[Lélu Spatial] presence listener threw (contained)", error);
      }
    }
    return snapshot;
  }

  /** Test seam. */
  public resetForTests(): void {
    this.current = { ...EMPTY };
    this.cached = null;
  }
}
