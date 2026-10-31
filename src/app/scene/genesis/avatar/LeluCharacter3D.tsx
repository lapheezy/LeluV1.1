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
 *
 * Exposes what she is doing on the canvas element (data-ready,
 * data-frames, data-activity, data-face-controls) so tests and
 * assistive tooling can read it.
 * ==========================================================
 */

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LeluFraming } from "../../../../core/avatar/LeluRig";
import type { LeluModel } from "../../../../core/avatar/LeluModelSource";
import LeluBody, { type LeluBodyInfo } from "./LeluBody";
import type { LeluActivity } from "./leluActivity";

const HEIGHT = 2;
const FOV = 26;

/** Keeps the camera framing her for the current canvas shape. */
function Framer({ framing, info }: { framing: LeluFraming; info: LeluBodyInfo | null }) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3());
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const headY = info?.headY ?? HEIGHT * 0.9;
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

export default function LeluCharacter3D({
  model,
  framing,
  activity,
  style,
  testId,
}: {
  model: LeluModel;
  framing: LeluFraming;
  activity: LeluActivity;
  style?: CSSProperties;
  testId: string;
}) {
  const [info, setInfo] = useState<LeluBodyInfo | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const frames = useRef(0);
  const lastReport = useRef(0);

  const onFrame = useCallback(() => {
    frames.current += 1;
    const now = performance.now();
    const el = holder.current;
    if (!el || now - lastReport.current < 250) return;
    lastReport.current = now;
    el.dataset.frames = String(frames.current);
  }, []);

  return (
    <div
      ref={holder}
      data-testid={testId}
      data-renderer="3d"
      data-model={model.key}
      data-framing={framing}
      data-activity={activity}
      data-ready={info ? "true" : "false"}
      data-face-controls={info ? info.capabilities.face.join(",") : ""}
      data-bones={info ? info.capabilities.bones.join(",") : ""}
      role="img"
      aria-label="LÉLU"
      style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none", ...style }}
    >
      <Canvas
        gl={{ alpha: true, antialias: true, powerPreference: "low-power", preserveDrawingBuffer: false }}
        dpr={[1, 1.75]}
        camera={{ fov: FOV, position: [0, 1, 6] }}
        style={{ width: "100%", height: "100%", pointerEvents: "none", background: "transparent" }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <hemisphereLight args={["#fff1f8", "#2a1840", 0.9]} />
        <directionalLight position={[1.5, 3, 4]} intensity={1.6} color="#fff4ea" />
        <directionalLight position={[-2.5, 1.5, -2]} intensity={0.7} color="#f0abfc" />
        <Framer framing={framing} info={info} />
        <LeluBody glb={model.glb} clips={model.clips} activity={activity} height={HEIGHT} onReady={setInfo} onFrame={onFrame} />
      </Canvas>
    </div>
  );
}
