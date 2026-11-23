/**
 * ==========================================================
 * LÉLU — HER 3D BODY, FRAMED FOR A SURFACE
 *
 * The approved Forge model (LeluModelSource) rendered by the shared
 * LeluBody in a transparent view: the companion over chat and the
 * workspaces, and anywhere else LeluCharacter is used. Nothing here
 * is a separate character — model, controller and drivers are the
 * ones the Cosmos world uses.
 *
 *   framing "full" — all of her, hair to feet
 *   framing "face" — head and shoulders
 *   form "embodied" | "hologram" — as she is, or projected (holoMaterial)
 *
 * Exposes what she is doing on the canvas element (data-ready,
 * data-frames, data-activity, data-face-controls) so tests and
 * assistive tooling can read it.
 * ==========================================================
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { REDUCED_FRAME_MS, useSceneRenderMode } from "../SceneRenderBudget";
import RenderContextGuard from "../render/RenderContextGuard";
import * as THREE from "three";
import type { LeluForm, LeluFraming } from "../../../../core/avatar/LeluRig";
import type { LeluModel } from "../../../../core/avatar/LeluModelSource";
import LeluBody, { type LeluBodyInfo } from "./LeluBody";
import type { LeluActivity } from "./leluActivity";

const HEIGHT = 2;
const FOV = 26;

/** Keeps the camera framing her for the current canvas shape. */
function Framer({ framing, info }: { framing: LeluFraming; info: LeluBodyInfo | null }) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3());
  const applied = useRef("");
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const headY = info?.headY ?? HEIGHT * 0.9;
    /*
     * Framing changes when the canvas is resized or she arrives — not every
     * frame. This used to rebuild the camera position, the look-at and the
     * projection matrix on every rendered frame: a matrix recompute plus a
     * uniform upload to say what it already said. The signature check skips
     * the whole thing when nothing that affects framing has moved.
     */
    const signature = `${framing}:${size.width}x${size.height}:${headY.toFixed(3)}`;
    if (applied.current === signature) return;
    applied.current = signature;
    // What must be in view: all of her, or her head and shoulders.
    const viewHeight = framing === "face" ? HEIGHT * 0.34 : HEIGHT * 1.06;
    const viewWidth = framing === "face" ? HEIGHT * 0.3 : HEIGHT * 0.5;
    const centerY = framing === "face" ? headY - HEIGHT * 0.05 : HEIGHT / 2;
    const half = THREE.MathUtils.degToRad(FOV / 2);
    const forHeight = viewHeight / 2 / Math.tan(half);
    const forWidth = viewWidth / 2 / (Math.tan(half) * aspect);
    const distance = Math.max(forHeight, forWidth);
    target.current.set(0, centerY, 0);
    cam.position.set(0, centerY, distance);
    cam.lookAt(target.current);
    cam.near = 0.05;
    cam.far = distance * 4;
    cam.updateProjectionMatrix();
  });
  return null;
}

/**
 * Renders at most `fps` frames a second, and none while the page is hidden.
 * An overlay over chat does not need 60: the rest of the main thread
 * belongs to the conversation (typing, voice turn detection).
 */
function FrameCap({ fps, paused = false }: { fps: number; paused?: boolean }) {
  const { invalidate } = useThree();
  /*
   * The scene budget pauses the COSMOS when a surface covers it (the Chat
   * Universe in workspace mode, a phone sheet). She is not behind those
   * surfaces — she is drawn above them, beside the work — so pausing her
   * with the Cosmos froze her mid-pose on every such screen while she was
   * still in view (M15.3: measured 0 frames/s on Chat, Browser, Studio and
   * Code on a phone). A covered Cosmos now lowers her rate to the reduced
   * budget (~12 fps) instead of stopping her; typing does the same. She
   * stops only when her own presence pauses her (not in view: a world
   * where she stands in the scene) or the page is hidden.
   */
  const mode = useSceneRenderMode();
  useEffect(() => {
    if (paused) return;
    const interval = mode === "full" ? 1000 / fps : Math.max(1000 / fps, REDUCED_FRAME_MS);
    const timer = setInterval(() => {
      if (!document.hidden) invalidate();
    }, interval);
    return () => clearInterval(timer);
  }, [fps, invalidate, mode, paused]);
  return null;
}

/**
 * When she rests (paused), her canvas keeps showing its last frame; one new
 * frame is drawn on the canvas itself when she starts resting and whenever
 * her presentation or her canvas size changes while she rests. No readback:
 * the previous version captured the canvas with toDataURL into an <img>,
 * a synchronous GPU readback plus PNG encode measured at ~1.6 s per screen
 * switch on a phone size (M15.3 WP02).
 */
function RestFrame({ paused, look }: { paused: boolean; look: string }) {
  const { advance, size } = useThree();
  useEffect(() => {
    if (!paused) return;
    // A frame later: after this render's effects (form, framing, size) apply.
    const frame = requestAnimationFrame(() => {
      const now = performance.now();
      advance(now);
      advance(now + 16);
    });
    return () => cancelAnimationFrame(frame);
  }, [paused, advance, look, size.width, size.height]);
  return null;
}

export default function LeluCharacter3D({
  model,
  framing,
  form = "embodied",
  activity,
  style,
  testId,
  fps = 24,
  paused = false,
}: {
  model: LeluModel;
  /** Frame cap: 24 is plenty for an overlay, and half the cost of 30 on a
   *  software renderer where the Cosmos canvas is drawing at the same time. */
  fps?: number;
  /** Draw nothing, keep everything (canvas, model, state). */
  paused?: boolean;
  framing: LeluFraming;
  /** Her form: as she is, or projected. The same model either way. */
  form?: LeluForm;
  activity: LeluActivity;
  style?: CSSProperties;
  testId: string;
}) {
  const [info, setInfo] = useState<LeluBodyInfo | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const frames = useRef(0);
  const lastReport = useRef(0);

  const onFrame = useCallback((_time: number, playing: string | null) => {
    frames.current += 1;
    const now = performance.now();
    const el = holder.current;
    if (!el || now - lastReport.current < 250) return;
    lastReport.current = now;
    el.dataset.frames = String(frames.current);
    el.dataset.playing = playing ?? "";
  }, []);

  return (
    <div
      ref={holder}
      data-testid={testId}
      data-renderer="3d"
      data-model={model.key}
      data-framing={framing}
      data-form={form}
      data-activity={activity}
      data-ready={info ? "true" : "false"}
      data-face-controls={info ? info.capabilities.face.join(",") : ""}
      data-clips={info ? info.clips.join(",") : ""}
      data-bones={info ? info.capabilities.bones.join(",") : ""}
      role="img"
      aria-label="LÉLU"
      style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none", ...style }}
    >
      <Canvas
        frameloop={paused ? "never" : "demand"}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power", preserveDrawingBuffer: false }}
        /* She is an overlay over a live 3D world: at 1.4 the silhouette is
           indistinguishable and the buffer is ~45% smaller than 1.75. */
        dpr={[1, 1.4]}
        camera={{ fov: FOV, position: [0, 1, 6] }}
        style={{ width: "100%", height: "100%", pointerEvents: "none", background: "transparent" }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <hemisphereLight args={["#fff1f8", "#2a1840", 0.9]} />
        <directionalLight position={[1.5, 3, 4]} intensity={1.6} color="#fff4ea" />
        <directionalLight position={[-2.5, 1.5, -2]} intensity={0.7} color="#f0abfc" />
        <RenderContextGuard id="lelu-avatar" kind="avatar" />
        <FrameCap fps={fps} paused={paused} />
        <RestFrame paused={paused} look={`${framing}:${form}`} />
        <Framer framing={framing} info={info} />
        <LeluBody glb={model.glb} clips={model.clips} activity={activity} height={HEIGHT} onReady={setInfo} onFrame={onFrame} life={framing === "full"} faceOnly={framing === "face"} holo={form === "hologram" ? 1 : 0} listening={!paused} holoInstant={paused} />
      </Canvas>
    </div>
  );
}
