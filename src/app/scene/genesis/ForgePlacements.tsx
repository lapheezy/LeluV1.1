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
 * ==========================================================
 */

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import ForgeClient, { FORGE_CHANGED_EVENT, type CosmosPlacement } from "../../../core/forge/ForgeClient";

function PlacedModel({ placement }: { placement: CosmosPlacement }) {
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

  useFrame((_, delta) => {
    mixer.current?.update(delta);
    if (spinning && turn.current) turn.current.rotation.y += delta * 0.6;
  });

  return (
    <group name={`ForgePlacement:${placement.id}`} position={placement.position} rotation={[0, placement.rotationY, 0]}>
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

export default function ForgePlacements() {
  const [placements, setPlacements] = useState<CosmosPlacement[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      ForgeClient.placements()
        .then(({ placements }) => {
          if (alive) setPlacements(placements);
        })
        .catch((error) => console.info("[Forge placements] unavailable", error instanceof Error ? error.message : error));
    void load();
    window.addEventListener(FORGE_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(FORGE_CHANGED_EVENT, load);
    };
  }, []);

  return (
    <group name="ForgePlacements">
      {placements.map((placement) => (
        <PlacedModel key={placement.id} placement={placement} />
      ))}
    </group>
  );
}
