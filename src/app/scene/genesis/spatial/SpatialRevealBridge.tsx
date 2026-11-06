/**
 * ==========================================================
 * LÉLU — SPATIAL REVEAL BRIDGE
 *
 * Chat creates an object; the world that contains it is not on screen.
 * This bridge is the transition between the two surfaces, and it adds no
 * second renderer and no second camera:
 *
 *   1. A verified spatial commit asks for a reveal (SpatialRevealIntent).
 *   2. The world — not the home dashboard — becomes the surface chat
 *      closes onto: `HomeStore.immersive` hides CosmosHome, so the live
 *      v1 scene is what is left when chat goes away. Chat itself is NOT
 *      closed here: a conversation in progress keeps its composer.
 *   3. Once the world is genuinely on screen (no chat panel, no Chat
 *      Universe overlay, world rendered), the created object is framed
 *      through the EXISTING camera intent, so the object is not merely
 *      mounted somewhere off screen.
 *
 * The Home navigation still returns to the dashboard (goHome clears
 * immersive), and reopening chat resumes the same scene: the graph is the
 * authority and the canvas re-reads it.
 * ==========================================================
 */

import { useEffect, useRef, useState } from "react";

import SpatialIntentBus from "../../../../core/spatial/SpatialIntentBus";
import {
  beginSpatialCameraTakeover,
  endSpatialCameraTakeover,
} from "../GenesisCameraIntent";
import SpatialRevealIntent, { type SpatialRevealRequest } from "../../../../core/spatial/SpatialRevealIntent";
import { useGenesis } from "../GenesisCore";
import HomeStore from "../home/homeStore";
import { useSurface } from "../surface/useSurface";

const POLL_MS = 140;
const FRAME_BUDGET_MS = 15_000;
const ATTEMPTS = 3;
const RETRY_MS = 750;
/** A deliberate three-quarter view: front, slightly above, slightly right. */
const REVEAL_DIRECTION: [number, number, number] = [0.55, 0.35, 1];
const REVEAL_PADDING = 1.25;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ProbeObject {
  name?: string;
  rendered?: boolean;
  visible?: boolean;
}

function probeObjects(): ProbeObject[] {
  if (typeof window === "undefined") return [];
  const host = window as unknown as { __leluSpatialProbe?: () => { objects?: ProbeObject[] } | null };
  return host.__leluSpatialProbe?.()?.objects ?? [];
}

/**
 * The Chat Universe paints over the world and pauses the canvas without
 * changing `activePanel`, so its own root attribute is the honest signal
 * that the world is not actually being looked at.
 */
function chatUniverseOpen(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.leluUniverse === "open";
}

/**
 * The object must be in the live scene to be framed, but it does not have
 * to be visible right now: framing an object the user just hid keeps the
 * camera where the same object was framed before, so hiding and showing
 * it are comparable views of one scene rather than two camera jumps.
 */
/** Did the camera bus report that the rig did not arrive where it was sent? */
function needsRetry(result: { ok: boolean; verification?: { layers: { camera: string; framing: string } } }): boolean {
  if (!result.ok) return true;
  const layers = result.verification?.layers;
  return layers ? layers.camera === "fail" || layers.framing === "fail" : false;
}

function renderedTarget(request: SpatialRevealRequest): string | null {
  const objects = probeObjects();
  return (
    request.objectNames.find((name) => objects.some((object) => object.name === name && object.rendered)) ?? null
  );
}

export default function SpatialRevealBridge() {
  const { state } = useGenesis();
  const surface = useSurface();
  const [requestRevision, setRequestRevision] = useState(0);
  const [overlayRevision, setOverlayRevision] = useState(0);
  const framed = useRef<string | null>(null);

  useEffect(
    () =>
      SpatialRevealIntent.getInstance().subscribe(() => {
        // From this point, closing chat returns to the world the object is
        // in, not to the home dashboard that covers it.
        HomeStore.setImmersive(true);
        setRequestRevision((revision) => revision + 1);
      }),
    [],
  );

  // The Universe overlay mounts/unmounts without a React dependency the
  // bridge can read; observe its root attribute instead.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    let open = root.dataset.leluUniverse === "open";
    const observer = new MutationObserver(() => {
      const next = root.dataset.leluUniverse === "open";
      if (next === open) return;
      open = next;
      // Chat closed onto the world, not the dashboard. Only while a
      // chat-created object is waiting to be seen: an explicit Home visit
      // (which clears immersive itself) is never overridden here.
      if (!next && SpatialRevealIntent.getInstance().latestRequest()) {
        HomeStore.setImmersive(true);
      }
      // Going back into chat ends the held reveal view: the camera belongs to
      // the user again, and the next reveal will frame afresh.
      if (next) endSpatialCameraTakeover();
      setOverlayRevision((revision) => revision + 1);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-lelu-universe"] });
    return () => observer.disconnect();
  }, []);

  // The non-Universe chat (desktop window) closes by clearing activePanel;
  // that is the same transition and must land on the world as well.
  const previousPanel = useRef(state.activePanel);
  useEffect(() => {
    const previous = previousPanel.current;
    previousPanel.current = state.activePanel;
    if (
      previous !== "none" &&
      state.activePanel === "none" &&
      SpatialRevealIntent.getInstance().latestRequest()
    ) {
      HomeStore.setImmersive(true);
    }
  }, [state.activePanel]);

  const worldReady =
    !state.minimized &&
    state.activePanel === "none" &&
    state.activeScene !== "genesisv2" &&
    surface.cosmosRendered &&
    !chatUniverseOpen();

  // A new world appearance gets its own framing (the canvas remounts at
  // its default pose on a phone, and the object must be back in view).
  useEffect(() => {
    if (!worldReady) framed.current = null;
  }, [worldReady]);

  useEffect(() => {
    if (!worldReady) return;
    const request = SpatialRevealIntent.getInstance().latestRequest();
    if (!request) return;
    const key = `${request.requestedAt}:${overlayRevision}`;
    if (framed.current === key) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();

    const step = async () => {
      if (cancelled) return;
      const target = renderedTarget(request);
      if (target) {
        framed.current = key;
        let result = await SpatialIntentBus.getInstance().apply({
          op: "camera.focus",
          targets: [target],
          padding: REVEAL_PADDING,
          direction: REVEAL_DIRECTION,
        });
        // The world mounts as the reveal runs, so the first flight can be
        // dispatched before OrbitControls exists (dropped) or be overtaken by
        // an autonomous view. Re-issue until the measured camera is at the
        // requested pose, then hold the view so it survives the capture.
        for (let attempt = 1; attempt < ATTEMPTS && needsRetry(result); attempt += 1) {
          await pause(RETRY_MS);
          if (cancelled) return;
          result = await SpatialIntentBus.getInstance().apply({
            op: "camera.focus",
            targets: [target],
            padding: REVEAL_PADDING,
            direction: REVEAL_DIRECTION,
          });
        }
        beginSpatialCameraTakeover();
        // Read-only diagnostic, like __leluSpatialProbe: what the reveal asked
        // for and what the camera bus answered, for acceptance evidence.
        (window as unknown as { __leluReveal?: unknown }).__leluReveal = {
          target,
          requestedAt: request.requestedAt,
          ok: result.ok,
          message: result.message,
          camera: result.camera ?? null,
          at: Date.now(),
        };
        return;
      }
      if (Date.now() - started > FRAME_BUDGET_MS) return;
      timer = setTimeout(() => void step(), POLL_MS);
    };
    void step();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [worldReady, requestRevision, overlayRevision]);

  return null;
}
