/**
 * ==========================================================
 * LÉLU — HER, ALIVE, ON ANY SURFACE
 *
 * A transparent canvas with her rig (LeluRig) drawn at this moment of the
 * shared animation state (LeluAnimation): no card, no frame, no
 * background — what is behind the canvas shows around her. Used by the
 * companion overlay and the Avatar panel; the Cosmos scene draws the same
 * rig in 3D space (LeluRigPresence).
 *
 *   framing "full" — all of her, hair to feet
 *   framing "face" — head and shoulders, dissolving at the edges
 *   form "embodied" | "hologram" — the same her, as she is or projected
 *
 * Without WebGL she is shown as her still cut-out — still her, never a
 * substitute figure.
 * ==========================================================
 */

import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import LeluModelSource, { type LeluModelState } from "../../../../core/avatar/LeluModelSource";
import LeluAnimation from "../../../../core/avatar/LeluAnimation";
import LeluRigRenderer from "../../../../core/avatar/LeluRigRenderer";
import { loadLook, lookUrl, viewFor, type LeluForm, type LeluFraming, type LeluLookId, type LoadedLook } from "../../../../core/avatar/LeluRig";
import { useLeluActivity } from "./leluActivity";
import { useLeluCharacter } from "./useLeluCharacter";

const ATTENTIVE = new Set(["IDLE", "LISTENING", "SPEAKING", "PRESENTING", "COMPLETED"]);

// three.js loads with her body, not with the chat.
const LeluCharacter3D = lazy(() => import("./LeluCharacter3D"));

function useLeluModel(): LeluModelState {
  const [state, setState] = useState<LeluModelState>(() => LeluModelSource.get());
  useEffect(() => LeluModelSource.subscribe(setState), []);
  return state;
}

function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * LÉLU on any surface. Her approved 3D model (the same one the Cosmos
 * world shows, through the same LeluBody) whenever it exists; the 2D
 * look rig only where there is no 3D model to show (no Forge server,
 * nothing approved yet) or no WebGL.
 */
export default function LeluCharacter(props: {
  framing: LeluFraming;
  form?: LeluForm;
  look?: LeluLookId;
  fps?: number;
  style?: CSSProperties;
  testId?: string;
}) {
  const model = useLeluModel();
  const activity = useLeluActivity();
  const [webgl] = useState(webglAvailable);
  const testId = props.testId ?? "lelu-character";
  if (model.status === "loading" && webgl) {
    // Her model is on its way: show nothing rather than a different her.
    return <div data-testid={testId} data-renderer="loading" style={{ width: "100%", height: "100%", pointerEvents: "none" }} />;
  }
  if (model.status === "ready" && webgl) {
    return (
      <Suspense fallback={<div data-testid={testId} data-renderer="loading" style={{ width: "100%", height: "100%" }} />}>
        <LeluCharacter3D model={model.model} framing={props.framing} activity={activity} style={props.style} testId={testId} fps={props.fps ?? 30} />
      </Suspense>
    );
  }
  return <LeluCharacter2D {...props} />;
}

function LeluCharacter2D({
  framing,
  form,
  look,
  fps = 30,
  style,
  testId = "lelu-character",
}: {
  framing: LeluFraming;
  form?: LeluForm;
  look?: LeluLookId;
  /** Frame cap: 30 is plenty for an overlay; the panel may ask for 60. */
  fps?: number;
  style?: CSSProperties;
  testId?: string;
}) {
  const character = useLeluCharacter();
  const lookId = look ?? character.look;
  const formId = form ?? character.form;
  const activity = useLeluActivity();
  useEffect(() => {
    LeluAnimation.getInstance().setActivity(activity);
  }, [activity]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const settings = useRef({ framing, formId, fps });
  settings.current = { framing, formId, fps };
  const [fallback, setFallback] = useState(false);
  const [loaded, setLoaded] = useState<LoadedLook | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One renderer per canvas for as long as the canvas lives: a new look
  // swaps its texture. Disposing loses the canvas's WebGL context, so a
  // renderer re-created on the same canvas would find no context at all.
  const rendererRef = useRef<{ canvas: HTMLCanvasElement; renderer: LeluRigRenderer } | null>(null);
  useEffect(
    () => () => {
      rendererRef.current?.renderer.dispose();
      rendererRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadLook(lookId).then(
      (value) => {
        if (!cancelled) setLoaded(value);
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lookId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    let renderer: LeluRigRenderer;
    if (rendererRef.current?.canvas === canvas) {
      renderer = rendererRef.current.renderer;
    } else {
      rendererRef.current?.renderer.dispose();
      rendererRef.current = null;
      try {
        renderer = new LeluRigRenderer(canvas);
      } catch (reason) {
        console.warn("[LeluCharacter] showing her still image:", reason);
        setFallback(true);
        return;
      }
      rendererRef.current = { canvas, renderer };
    }
    renderer.setLook(loaded);
    const animation = LeluAnimation.getInstance();
    const detach = animation.attach();
    const gaze = { x: 0, y: 0 };
    let holo = settings.current.formId === "hologram" ? 1 : 0;
    let frame = 0;
    let last = 0;
    let lastReport = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const { fps: cap, framing: currentFraming, formId: currentForm } = settings.current;
      if (document.hidden || now - last < 1000 / cap - 2) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / cap;
      last = now;
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
      const params = animation.frame(now);

      // She looks at you: toward the pointer, from where her face is on screen.
      const pointer = animation.getPointer(now);
      let gx = params.gazeX;
      let gy = params.gazeY;
      if (pointer && ATTENTIVE.has(animation.getActivity())) {
        const box = canvas.getBoundingClientRect();
        const view = viewFor(loaded.rig, currentFraming, box.width / Math.max(1, box.height));
        const faceX = box.left + ((loaded.rig.face[0] - view[0]) / (view[2] - view[0])) * box.width;
        const faceY = box.top + ((loaded.rig.face[1] - view[1]) / (view[3] - view[1])) * box.height;
        gx = Math.max(-1, Math.min(1, (pointer.x - faceX) / 260));
        gy = Math.max(-1, Math.min(1, (pointer.y - faceY) / 360));
      }
      const k = 1 - Math.exp(-14 * dt);
      gaze.x += (gx - gaze.x) * k;
      gaze.y += (gy - gaze.y) * k;
      // Embodied ↔ hologram: a short dissolve, not a cut.
      holo += ((currentForm === "hologram" ? 1 : 0) - holo) * (1 - Math.exp(-6 * dt));

      renderer.draw(
        { ...params, gazeX: gaze.x, gazeY: gaze.y, yaw: params.yaw * 0.5 + gaze.x * 0.25 },
        { framing: currentFraming, holo, time: now / 1000 },
      );
      // What she is doing, readable from outside (tests, assistive tech): 4×/s.
      if (now - lastReport > 250) {
        lastReport = now;
        canvas.dataset.mouth = params.open.toFixed(2);
        canvas.dataset.blink = params.blinkL.toFixed(2);
        canvas.dataset.speaking = params.speaking ? "true" : "false";
        canvas.dataset.holo = holo.toFixed(2);
        canvas.dataset.frames = String(Number(canvas.dataset.frames ?? 0) + 1);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      detach();
    };
  }, [loaded]);

  const common: CSSProperties = { display: "block", width: "100%", height: "100%", pointerEvents: "none", ...style };
  if (fallback || error) {
    return (
      <img
        data-testid={testId}
        data-look={lookId}
        data-renderer="2d"
        data-fallback={error ? "missing" : "no-webgl"}
        src={lookUrl(lookId, "body.webp")}
        alt="LÉLU"
        draggable={false}
        style={{ ...common, objectFit: "contain", objectPosition: framing === "face" ? "center top" : "center bottom" }}
      />
    );
  }
  return (
    <canvas
      ref={canvasRef}
      data-testid={testId}
      data-look={lookId}
      data-renderer="2d"
      data-form={formId}
      data-framing={framing}
      data-ready={loaded ? "true" : "false"}
      role="img"
      aria-label={`LÉLU, ${formId === "hologram" ? "as a hologram" : "embodied"}`}
      style={common}
    />
  );
}
