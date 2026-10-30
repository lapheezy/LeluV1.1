/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS V2 — FORGE PLACEMENTS
 *
 * Finished 3D Forge assets that LÉLU (or the person) placed
 * in the Cosmos, rendered inside the same Gen V2 canvas as
 * her presence. The list lives on the server
 * (/api/forge/placements), so what she placed is still there
 * after a refresh or a restart. Each model is fitted to its
 * placement height with its feet on the placement point and
 * plays its own clips if it has any. Click one to have it
 * turn for inspection; click again to stop.
 *
 * An ATTACHED placement (a worn or held accessory) follows a
 * bone of LÉLU's rendered rig every frame — position and
 * orientation, not scale — so it moves with her walk, idle
 * and gestures, with a little inertial sway for hanging
 * pieces. Without a rigged model on screen it waits hidden.
 * ==========================================================
 */

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import ForgeClient, { type CosmosPlacement } from "../../../core/forge/ForgeClient";
import { attachmentPose, findBone } from "../../../core/forge/Attachment";

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpParentQuat = new THREE.Quaternion();

/** False once the bone's model has been removed from the scene (a look or version swap). */
function inScene(object: THREE.Object3D, scene: THREE.Object3D): boolean {
  let o: THREE.Object3D = object;
  while (o.parent) o = o.parent;
  return o === scene;
}

export function PlacedModel({ placement }: { placement: CosmosPlacement }) {
  const scene = useThree((state) => state.scene);
  const root = useRef<THREE.Group>(null);
  const bone = useRef<THREE.Object3D | null>(null);
  const lastBonePos = useRef<THREE.Vector3 | null>(null);
  const sway = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const attach = placement.attach ?? null;
  const [object, setObject] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [hovered, setHovered] = useState(false);
  const turn = useRef<THREE.Group>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    let disposed = false;
    new GLTFLoader()
      .loadAsync(ForgeClient.assetUrl(placement.file))
      .then((gltf) => {
        if (disposed) return;
        const scene = gltf.scene;
        const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
        if (!isFinite(size.y) || size.y <= 0) throw new Error("model has an empty bounding box");
        scene.scale.setScalar(placement.height / size.y);
        const box = new THREE.Box3().setFromObject(scene);
        const center = box.getCenter(new THREE.Vector3());
        scene.position.set(-center.x, -box.min.y, -center.z);
        const holder = new THREE.Group();
        holder.add(scene);
        if (gltf.animations.length) {
          mixer.current = new THREE.AnimationMixer(scene);
          mixer.current.clipAction(gltf.animations[0]).play();
        }
        setObject(holder);
      })
      .catch((e: unknown) => {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      disposed = true;
      mixer.current?.stopAllAction();
      mixer.current = null;
    };
  }, [placement.file, placement.height]);

  // Moved to another bone (or detached): follow the new one from scratch.
  useEffect(() => {
    bone.current = null;
    lastBonePos.current = null;
  }, [attach?.bone, attach?.character]);

  useFrame((_, delta) => {
    mixer.current?.update(delta);
    if (spinning && turn.current) turn.current.rotation.y += delta * 0.6;
    const group = root.current;
    if (!attach || !group) return;

    // Re-find the bone if the character model was swapped (new look, new version).
    if (!bone.current || !inScene(bone.current, scene)) {
      bone.current = findBone(scene.getObjectByName("V2Lelu"), attach.bone);
      lastBonePos.current = null;
    }
    const b = bone.current;
    // A wearable that is taken off (hood down) stays loaded but is not shown.
    group.visible = Boolean(b && object) && placement.worn !== false;
    if (!b) return;

    attachmentPose(b, attach, null, tmpPos, tmpQuat);

    // Inertial sway: a damped spring driven by how fast the bone moved.
    const s2 = sway.current;
    const dt = Math.min(delta, 0.05);
    if (lastBonePos.current && dt > 0) {
      const vx = (tmpPos.x - lastBonePos.current.x) / dt;
      const vz = (tmpPos.z - lastBonePos.current.z) / dt;
      s2.vx += (-vx * 0.35 - s2.x * 60) * dt - s2.vx * 8 * dt;
      s2.vz += (vz * 0.35 - s2.z * 60) * dt - s2.vz * 8 * dt;
      s2.x = THREE.MathUtils.clamp(s2.x + s2.vx * dt, -0.5, 0.5);
      s2.z = THREE.MathUtils.clamp(s2.z + s2.vz * dt, -0.5, 0.5);
    }
    (lastBonePos.current ??= new THREE.Vector3()).copy(tmpPos);

    // World pose → the placement group's parent space (sway used the world position).
    if (group.parent) {
      group.parent.updateWorldMatrix(true, false);
      group.parent.worldToLocal(tmpPos);
      tmpQuat.premultiply(group.parent.getWorldQuaternion(tmpParentQuat).invert());
    }
    group.position.copy(tmpPos);
    group.quaternion.copy(tmpQuat);
    if (turn.current && !spinning) turn.current.rotation.set(s2.z, turn.current.rotation.y, s2.x);
  });

  return (
    <group
      ref={root}
      name={`ForgePlacement:${placement.id}`}
      position={attach ? undefined : placement.position}
      rotation={attach ? undefined : [0, placement.rotationY, 0]}
      visible={!attach}
    >
      <group
        ref={turn}
        onClick={(e) => {
          e.stopPropagation();
          setSpinning((s) => !s);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        {object ? <primitive object={object} /> : null}
      </group>
      {error ? (
        <Html center position={[0, 0.4, 0]}>
          <div style={{ color: "#f87171", fontSize: 11, whiteSpace: "nowrap" }}>{placement.label}: {error}</div>
        </Html>
      ) : hovered && object ? (
        <Html center position={[0, placement.height + 0.25, 0]}>
          <div style={{ color: "#e9d5ff", fontSize: 11, whiteSpace: "nowrap", pointerEvents: "none" }}>
            {placement.label} · {spinning ? "click to stop" : "click to turn"}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

