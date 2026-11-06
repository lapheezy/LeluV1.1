/**
 * ==========================================================
 * LÉLU — SPATIAL LIVE SCENE (read-only bridge)
 *
 * The spatial core must not import React or three.js, but it
 * still has to answer questions about what the renderer really
 * produced. This module is the seam: the R3F layer registers a
 * provider that reads the LIVE three.js scene, and the adapter,
 * camera applier and verifier read through it.
 *
 * Nothing here can mutate the scene: the provider interface has
 * only read methods, and unregistering it returns the core to a
 * truthful "no renderer attached" state instead of a fake one.
 * ==========================================================
 */

export interface LiveSceneNode {
  /** Stable identity: `spatial:<id>` for authored objects, else the object name. */
  id: string;
  /** three.js object name, e.g. `spatial:spatial-box-1` or `Core`. */
  name: string;
  label?: string;
  /** Read from the live object's matrix (world space). */
  worldPosition: [number, number, number];
  /** Read from object.position (parent space) — parent rotation does not distort it. */
  localPosition: [number, number, number];
  visible: boolean;
  color?: string;
  /** Rough bounding radius in world units, when the geometry allows it. */
  radius?: number;
  geometry?: string;
  parentName?: string | null;
}

export interface LiveCameraState {
  position: [number, number, number];
  /** Normalised world direction the camera is looking along. */
  direction: [number, number, number];
  fov: number;
  aspect: number;
  near: number;
  far: number;
  updatedAt: number;
}

export interface LiveSceneProvider {
  listNodes(): LiveSceneNode[];
  findNode(reference: string): LiveSceneNode | null;
  camera(): LiveCameraState | null;
}

let provider: LiveSceneProvider | null = null;

export function registerLiveSceneProvider(next: LiveSceneProvider): () => void {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

export function getLiveSceneProvider(): LiveSceneProvider | null {
  return provider;
}

export function hasLiveScene(): boolean {
  return provider !== null;
}

export function liveNodes(): LiveSceneNode[] {
  return provider ? provider.listNodes() : [];
}

export function liveNode(reference: string): LiveSceneNode | null {
  return provider ? provider.findNode(reference) : null;
}

export function liveCamera(): LiveCameraState | null {
  return provider ? provider.camera() : null;
}

/** Test seam. */
export function resetLiveSceneProvider(): void {
  provider = null;
}
