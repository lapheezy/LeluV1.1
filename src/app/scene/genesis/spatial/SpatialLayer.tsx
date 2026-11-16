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
 * The layer also registers the READ-ONLY live-scene provider the
 * adapter, camera applier and verifier read: real three.js nodes,
 * real world/local positions, real materials, and the real
 * camera. It exposes nothing that is not already on screen.
 * ==========================================================
 */

import { useEffect, useSyncExternalStore } from "react";
import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Vector3, type Camera, type Mesh, type Object3D, type Scene } from "three";

import SpatialSceneGraph from "../../../../core/spatial/SpatialSceneGraph";
import SpatialPresence from "../../../../core/spatial/SpatialPresence";
import {
  registerLiveSceneProvider,
  type LiveCameraState,
  type LiveSceneNode,
} from "../../../../core/spatial/SpatialLiveScene";
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
 * The live three.js scene, captured while the layer renders. Reads go
 * through this, so answers describe what the renderer actually produced
 * rather than what the graph intended.
 */
let liveScene: Scene | null = null;
let liveCamera: Camera | null = null;

const worldPosition = new Vector3();
const worldDirection = new Vector3();

function radiusOf(object: Object3D): number | undefined {
  const mesh = object as Mesh;
  if (!mesh.geometry) return undefined;
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const radius = mesh.geometry.boundingSphere?.radius;
  if (!radius) return undefined;
  const scale = Math.max(object.scale.x, object.scale.y, object.scale.z);
  return radius * (Number.isFinite(scale) && scale > 0 ? scale : 1);
}

function colourOf(object: Object3D): string | undefined {
  const material = (object as Mesh).material as
    | { color?: { getHexString(): string } }
    | { color?: { getHexString(): string } }[]
    | undefined;
  const single = Array.isArray(material) ? material[0] : material;
  return single?.color ? `#${single.color.getHexString()}` : undefined;
}

function toNode(object: Object3D): LiveSceneNode | null {
  if (!object.name) return null;
  object.getWorldPosition(worldPosition);
  return {
    id: object.name,
    name: object.name,
    label: (object.userData as { spatialName?: string })?.spatialName,
    worldPosition: [worldPosition.x, worldPosition.y, worldPosition.z],
    localPosition: [object.position.x, object.position.y, object.position.z],
    visible: object.visible,
    color: colourOf(object),
    radius: radiusOf(object),
    geometry: (object as Mesh).geometry?.type,
    parentName: object.parent?.name || null,
  };
}

function listLiveNodes(): LiveSceneNode[] {
  if (!liveScene) return [];
  const nodes: LiveSceneNode[] = [];
  liveScene.traverse((object) => {
    const node = toNode(object);
    if (node) nodes.push(node);
  });
  return nodes;
}

function findLiveNode(reference: string): LiveSceneNode | null {
  if (!liveScene) return null;
  const candidates = [reference, `spatial:${reference}`];
  for (const name of candidates) {
    const object = liveScene.getObjectByName(name);
    if (object) return toNode(object);
  }
  const lower = reference.toLowerCase();
  let match: LiveSceneNode | null = null;
  liveScene.traverse((object) => {
    if (match || !object.name) return;
    if (object.name.toLowerCase() === lower) match = toNode(object);
  });
  return match;
}

function cameraState(): LiveCameraState | null {
  if (!liveCamera) return null;
  const camera = liveCamera as unknown as {
    position: Vector3;
    fov?: number;
    aspect?: number;
    near: number;
    far: number;
  };
  liveCamera.getWorldDirection(worldDirection);
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    direction: [worldDirection.x, worldDirection.y, worldDirection.z],
    fov: camera.fov ?? 46,
    aspect: camera.aspect ?? 1.7,
    near: camera.near,
    far: camera.far,
    updatedAt: Date.now(),
  };
}

interface SpatialProbeObject {
  id: string;
  name: string;
  rendered: boolean;
  worldPosition?: [number, number, number];
  localPosition?: [number, number, number];
  visible?: boolean;
  color?: string;
}

interface SpatialProbeResult {
  revision: number;
  presence: ReturnType<typeof presence.get>;
  camera: LiveCameraState | null;
  nodes: number;
  objects: SpatialProbeObject[];
}

function installSpatialProbe(): void {
  if (typeof window === "undefined") return;
  const host = window as unknown as {
    __leluSpatialProbe?: () => SpatialProbeResult;
    __leluSpatialNodes?: () => string[];
  };
  host.__leluSpatialProbe = () => {
    const snapshot = graph.snapshot();
    const objects = snapshot.objects.map((object) => {
      const node = findLiveNode(`spatial:${object.id}`);
      if (!node) return { id: object.id, name: object.name, rendered: false };
      return {
        id: object.id,
        name: object.name,
        rendered: true,
        worldPosition: node.worldPosition,
        localPosition: node.localPosition,
        visible: node.visible,
        color: node.color,
      };
    });
    return {
      revision: graph.getRevision(),
      presence: presence.get(),
      camera: cameraState(),
      nodes: listLiveNodes().length,
      objects,
    };
  };
  host.__leluSpatialNodes = () => listLiveNodes().map((node) => node.name);
}

installSpatialProbe();

function SceneCapture() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  liveScene = scene;
  liveCamera = camera;

  useEffect(() => {
    const unregister = registerLiveSceneProvider({
      listNodes: listLiveNodes,
      findNode: findLiveNode,
      camera: cameraState,
    });
    installSpatialProbe();
    return unregister;
  }, []);

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
