/**
 * ==========================================================
 * LÉLU — SPATIAL LAYER
 *
 * Draws the authoritative spatial graph inside the EXISTING
 * React-Three-Fiber canvas. No second renderer, no second scene
 * tree: the Core, satellites, Cosmos and the avatar stay exactly
 * where they are — these objects are siblings in the same tree.
 *
 * Every mesh reads from SpatialSceneGraph through
 * useSyncExternalStore, so a commit is the only thing that can
 * move it. Vertex positions come from `spatialMeshModel()` —
 * the same projection the tests assert.
 *
 * The layer also publishes `window.__leluSpatialProbe`, a
 * read-only diagnostic that reports WORLD positions read back
 * from the live three.js objects. It exposes nothing that is not
 * already on screen, and acceptance evidence uses it to prove a
 * move reached the rendered scene, not just the store.
 * ==========================================================
 */

import { useEffect, useSyncExternalStore } from "react";
import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Vector3, type Scene } from "three";

import SpatialSceneGraph from "../../../../core/spatial/SpatialSceneGraph";
import SpatialPresence from "../../../../core/spatial/SpatialPresence";
import {
  spatialLinkModels,
  spatialMeshModel,
  type SpatialLinkModel,
  type SpatialMeshModel,
} from "../../../../core/spatial/SpatialRenderModel";
import type { SpatialPrimitiveKind } from "../../../../core/spatial/SpatialTypes";

const graph = SpatialSceneGraph.getInstance();
const presence = SpatialPresence.getInstance();

const subscribeGraph = (listener: () => void): (() => void) => graph.subscribe(listener);
const getGraphSnapshot = () => graph.snapshot();
const subscribePresence = (listener: () => void): (() => void) => presence.subscribe(listener);
const getPresenceSnapshot = () => presence.getSnapshot();

/**
 * The live three.js scene, captured while the layer renders. The
 * probe reads through this, so its answer is what the renderer
 * actually produced rather than what the graph intended.
 */
let liveScene: Scene | null = null;

interface SpatialProbeObject {
  id: string;
  name: string;
  rendered: boolean;
  worldPosition?: [number, number, number];
  visible?: boolean;
  color?: string;
}

interface SpatialProbeResult {
  revision: number;
  presence: ReturnType<typeof presence.get>;
  objects: SpatialProbeObject[];
}

function installSpatialProbe(): void {
  if (typeof window === "undefined") return;
  const host = window as unknown as { __leluSpatialProbe?: () => SpatialProbeResult };
  host.__leluSpatialProbe = () => {
    const snapshot = graph.snapshot();
    const position = new Vector3();
    const objects = snapshot.objects.map((object) => {
      const node = liveScene?.getObjectByName(`spatial:${object.id}`);
      if (!node) {
        return { id: object.id, name: object.name, rendered: false };
      }
      node.getWorldPosition(position);
      const material = (node as unknown as { material?: { color?: { getHexString(): string } } })
        .material;
      return {
        id: object.id,
        name: object.name,
        rendered: true,
        worldPosition: [
          Math.round(position.x * 1000) / 1000,
          Math.round(position.y * 1000) / 1000,
          Math.round(position.z * 1000) / 1000,
        ] as [number, number, number],
        visible: node.visible,
        color: material?.color ? `#${material.color.getHexString()}` : undefined,
      };
    });
    return { revision: graph.getRevision(), presence: presence.get(), objects };
  };
}

installSpatialProbe();

function SceneCapture() {
  const scene = useThree((state) => state.scene);
  liveScene = scene;
  return null;
}

function geometryFor(kind: SpatialPrimitiveKind) {
  switch (kind) {
    case "box":
      return <boxGeometry args={[1, 1, 1]} />;
    case "sphere":
      return <sphereGeometry args={[0.6, 32, 24]} />;
    case "cylinder":
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
    case "cone":
      return <coneGeometry args={[0.6, 1, 32]} />;
    case "torus":
      return <torusGeometry args={[0.5, 0.18, 20, 40]} />;
    case "plane":
      return <planeGeometry args={[1.4, 1.4]} />;
  }
}

function SpatialMesh({
  model,
  revision,
  attention,
}: {
  model: SpatialMeshModel;
  revision: number;
  attention: boolean;
}) {
  return (
    <mesh
      name={`spatial:${model.id}`}
      position={model.position}
      rotation={model.rotation}
      scale={model.scale}
      visible={model.visible}
      userData={{
        spatialId: model.id,
        spatialName: model.name,
        spatialRevision: revision,
      }}
    >
      {geometryFor(model.kind)}
      <meshStandardMaterial
        color={model.color}
        emissive={model.emissive}
        emissiveIntensity={model.emissiveIntensity + (attention ? 0.65 : 0)}
        metalness={model.metalness}
        roughness={model.roughness}
        transparent={model.transparent}
        opacity={model.opacity}
        wireframe={model.wireframe}
      />
    </mesh>
  );
}

function SpatialLink({ link }: { link: SpatialLinkModel }) {
  return (
    <Line
      points={[link.from, link.to]}
      color={link.color}
      lineWidth={1.4}
      transparent
      opacity={0.85}
      dashed={link.kind === "orbits"}
      dashSize={0.12}
      gapSize={0.08}
    />
  );
}

export default function SpatialLayer() {
  const snapshot = useSyncExternalStore(subscribeGraph, getGraphSnapshot);
  const presenceState = useSyncExternalStore(subscribePresence, getPresenceSnapshot);
  const links = spatialLinkModels(snapshot.objects, snapshot.relationships);

  useEffect(() => {
    // The probe is installed at module scope; this only makes sure a
    // remount after a hot update re-publishes it.
    installSpatialProbe();
  }, []);

  return (
    <group name="SpatialObjects">
      <SceneCapture />
      {snapshot.objects.map((object) => (
        <SpatialMesh
          key={object.id}
          model={spatialMeshModel(object)}
          revision={snapshot.revision}
          attention={presenceState.attention?.id === object.id}
        />
      ))}
      {links.map((link) => (
        <SpatialLink key={link.id} link={link} />
      ))}
    </group>
  );
}
