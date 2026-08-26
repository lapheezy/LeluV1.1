/**
 * ==========================================================
 * LÉLU — PROCEDURAL 3D AVATAR PREVIEW
 *
 * A live Three.js view of the procedural avatar authored from
 * the SAVED AvatarProfile by the procedural 3D authoring
 * pipeline. It runs the same model builder and presence
 * animation the render engine uses — the preview and the
 * offline snapshots are the SAME pipeline, never two versions.
 *
 * Mode is driven by the REAL presence state (dialogue phase +
 * voice phase), so the figure visibly listens, thinks and
 * speaks with LÉLU.
 * ==========================================================
 */

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  buildAvatarModel,
  tickAvatar,
  type AvatarPresenceMode,
  type AvatarParts,
} from "../../../core/creative/Procedural3DPipeline";
import type { AvatarProfile } from "../../../core/avatar/AvatarProfile";

interface AvatarFigureProps {
  profile: AvatarProfile;
  mode: AvatarPresenceMode;
}

function AvatarFigure({ profile, mode }: AvatarFigureProps) {
  const parts = useMemo<AvatarParts>(() => buildAvatarModel(profile), [profile]);
  const groupRef = useRef<THREE.Group | null>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    // Gentle continuous turntable so the figure is always visible.
    group.rotation.y += 0.0016;
    tickAvatar(parts, mode, clock.getElapsedTime());
  });

  return <primitive object={parts.group} ref={groupRef} />;
}

export default function ProceduralAvatarPreview({
  profile,
  mode,
  height = 320,
  autoRotate = true,
}: {
  profile: AvatarProfile;
  mode: AvatarPresenceMode;
  height?: number;
  autoRotate?: boolean;
}) {
  return (
    <Canvas
      camera={{ position: [0, 1.9, 4.6], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      style={{
        width: "100%",
        height,
        borderRadius: 12,
        background:
          "radial-gradient(ellipse 70% 55% at 50% 38%, #1a1030 0%, #0a0718 55%, #050410 100%)",
        border: "1px solid rgba(212, 169, 78, 0.3)",
        boxShadow: "0 10px 34px rgba(0,0,0,0.55), inset 0 0 60px rgba(103,232,249,0.05)",
      }}
    >
      <ambientLight intensity={0.9} color="#2a2436" />
      <directionalLight position={[2.6, 4.2, 3.2]} intensity={2.0} color="#ffd9a0" />
      <directionalLight position={[-3.2, 2.2, -2.4]} intensity={0.9} color="#67e8f9" />
      <directionalLight position={[0, 1.2, -2.8]} intensity={0.35} color="#d4a94e" />
      <AvatarFigure profile={profile} mode={mode} />
      <OrbitControls
        enablePan={false}
        minDistance={2.6}
        maxDistance={8.5}
        minPolarAngle={Math.PI / 5.5}
        maxPolarAngle={Math.PI / 1.9}
        autoRotate={autoRotate}
        autoRotateSpeed={0.9}
      />
    </Canvas>
  );
}
