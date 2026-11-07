/**
 * ==========================================================
 * LÉLU — PORTAL CLICK TRACE (development diagnostic)
 *
 * Mission 5.4B left one question open: does the renderer hand
 * the click to the wrong portal, or is the measurement clicking
 * at coordinates from a different frame? Geometry cannot answer
 * that; only what the REAL handler received can.
 *
 * Every portal click therefore records, in the same frame it was
 * delivered: where the pointer was, what the raycast intersected
 * (with distances), which object and which portal id the event
 * carried, the camera's full pose, the viewport, the projected
 * centre of the object that was hit, and the runtime's scene and
 * transition at that instant.
 *
 * Development only: nothing is recorded in a production build,
 * and the buffer is a fixed-size ring so a stuck pointer cannot
 * grow memory.
 * ==========================================================
 */

export interface PortalClickTrace {
  /** performance.now() when the handler ran — the frame's timestamp. */
  t: number;
  client: { x: number; y: number };
  ndc: { x: number; y: number };
  /** What the event object itself carried, not what the test expected. */
  delivered: { portalId: string | null; destination: string | null; object: string };
  hitDistance: number | null;
  hitPoint: [number, number, number] | null;
  intersections: Array<{ name: string; portalId: string | null; distance: number }>;
  camera: {
    position: number[];
    quaternion: number[];
    projection: number[];
  };
  viewport: { width: number; height: number; dpr: number };
  /** Where the hit object's own centre projects, in client coordinates. */
  projectedCentre: { x: number; y: number } | null;
  /** Camera settlement as measured by the frame probe at click time. */
  settle: unknown;
  scene: string | null;
  transition: string | null;
  travelDestination: string | null;
}

const MAX_TRACES = 240;

export function traceEnabled(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

function buffer(): PortalClickTrace[] {
  const host = window as unknown as { __leluPortalEvents?: PortalClickTrace[] };
  if (!host.__leluPortalEvents) host.__leluPortalEvents = [];
  return host.__leluPortalEvents;
}

/** Record one delivered click. Read-only: it never mutates the scene. */
export function recordPortalClick(trace: PortalClickTrace): void {
  if (typeof window === "undefined" || !traceEnabled()) return;
  const list = buffer();
  list.push(trace);
  if (list.length > MAX_TRACES) list.splice(0, list.length - MAX_TRACES);
}
