/**
 * ==========================================================
 * LÉLU — SPATIAL REVEAL INTENT
 *
 * A creation committed by chat is not visible while chat owns the
 * screen: on a phone the router unmounts the v1 world, and on a desktop
 * the Chat Universe either pauses the canvas or paints over it. The
 * scene cannot fix that (it draws nothing when it is not mounted) and
 * the interface cannot know a scene commit happened (it never touches
 * the grap).
 *
 * This is the one signal between them: "an object the user just made
 * needs to be seen". It carries identity only — no rendering, no camera,
 * no surface policy. The interface decides WHEN to show the world (when
 * chat closes, instead of the home dashboard) and frames the object with
 * the existing camera intent.
 *
 * Nothing here persists across a reload: the spatial graph is the
 * in-memory authority for this session, and the reveal is about the
 * object that was just created.
 * ==========================================================
 */

export interface SpatialRevealRequest {
  /** The committed object ids, in commit order. */
  objectIds: string[];
  /** Their names, which is how the camera intent resolves a target. */
  objectNames: string[];
  requestedAt: number;
}

type Listener = (request: SpatialRevealRequest) => void;

export default class SpatialRevealIntent {
  private static instance: SpatialRevealIntent | null = null;

  private readonly listeners = new Set<Listener>();
  private latest: SpatialRevealRequest | null = null;

  public static getInstance(): SpatialRevealIntent {
    if (!SpatialRevealIntent.instance) {
      SpatialRevealIntent.instance = new SpatialRevealIntent();
    }
    return SpatialRevealIntent.instance;
  }

  /**
   * Record a commit that should be seen. Called by the intent bus after
   * its own verification passed, so a rolled-back commit never asks for
   * the world to be shown.
   */
  public request(objectIds: readonly string[], objectNames: readonly string[]): void {
    const ids = [...new Set(objectIds.filter((id) => typeof id === "string" && id.length > 0))];
    const names = [...new Set(objectNames.filter((name) => typeof name === "string" && name.length > 0))];
    if (ids.length === 0 || names.length === 0) return;
    this.latest = { objectIds: ids, objectNames: names, requestedAt: Date.now() };
    for (const listener of this.listeners) listener(this.latest);
  }

  /** The most recent reveal the interface should honour. */
  public latestRequest(): SpatialRevealRequest | null {
    return this.latest;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public resetForTests(): void {
    this.latest = null;
    this.listeners.clear();
  }
}
