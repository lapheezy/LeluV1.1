/**
 * ==========================================================
 * LÉLU — CREATIVE OBJECTS IN THE LIVE COSMOS
 *
 * The actual garment, sleeve, pendant, stone and chair geometry,
 * drawn inside the EXISTING Genesis v2 canvas as siblings of the
 * Core. There is no second scene, camera or renderer here: this
 * component only reads the creative object store and projects it
 * through the one conversion in `sceneTransform`.
 *
 * Selection and manipulation use raycasts against these meshes.
 * While a drag is in progress the camera rig stands down
 * (`creativeGesture`), so a finger moves either the object or the
 * camera, never both.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { meshToScene } from "../../../../core/couture/geometry";
import CreativeObjects, { transformAt, type CreativeObject, type CreativePart } from "../../../../core/couture/objects";
import { findMetal, STONE_MATERIALS } from "../../../../core/couture/product";
import {
  creativePositionToScene,
  creativeRotationToSceneQuat,
  creativeScaleToScene,
  scenePositionToCreative,
} from "../../../../core/couture/sceneTransform";
import { findMaterial } from "../../../../core/couture/textiles";
import {
  beginCreativeGesture,
  endCreativeGesture,
  getCreativeSelection,
  getCreativeTool,
  selectCreativeObject,
  setCreativeCamera,
  subscribeCreativeSelection,
  subscribeCreativeTool,
} from "./creativeGesture";
import { reportCreativeFrame } from "./creativeProbe";

interface MaterialLook {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
}

function materialFor(part: CreativePart): MaterialLook {
  const textile = findMaterial(part.materialId);
  if (textile) {
    return {
      color: textile.visual.baseColor,
      roughness: textile.visual.roughness,
      metalness: textile.visual.metallic,
      opacity: Math.max(0.12, textile.visual.opacity * (1 - textile.visual.transmission * 0.9)),
    };
  }
  const metal = findMetal(part.materialId);
  if (metal) return { color: metal.colour, roughness: metal.roughness, metalness: 1, opacity: 1 };
  const gem = STONE_MATERIALS.find((s) => s.id === part.materialId);
  if (gem) return { color: gem.colour, roughness: 0.06, metalness: 0.05, opacity: 1 };
  return { color: part.color, roughness: 0.55, metalness: 0, opacity: part.opacity };
}

/** One BufferGeometry per part, rebuilt only when the object's revision changes. */
function usePartGeometries(object: CreativeObject): Map<string, THREE.BufferGeometry> {
  return useMemo(() => {
    const map = new Map<string, THREE.BufferGeometry>();
    for (const part of object.parts) {
      const scene = meshToScene(part.mesh);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(Float32Array.from(scene.positions), 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(Float32Array.from(scene.normals ?? []), 3));
      geometry.setIndex(scene.indices);
      geometry.computeBoundingSphere();
      map.set(part.id, geometry);
    }
    return map;
    // Geometry is immutable within a revision.
  }, [object.id, object.revision]);
}

interface DragState {
  objectId: string;
  mode: "move" | "rotate" | "scale";
  startX: number;
  startY: number;
  startPosition: [number, number, number];
  startRotation: [number, number, number];
  startScale: number;
  distance: number;
}

interface Preview {
  objectId: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
  rotation: [number, number, number];
}

function CreativePartMesh({ object, part, geometry, selectedComponent, objectSelected }: {
  object: CreativeObject;
  part: CreativePart;
  geometry: THREE.BufferGeometry;
  selectedComponent: boolean;
  objectSelected: boolean;
}) {
  const look = useMemo(() => materialFor(part), [part.id, part.materialId, part.color, part.opacity]);
  const highlight = selectedComponent ? 0.45 : objectSelected ? 0.16 : 0;
  return (
    <mesh
      geometry={geometry}
      name={`creative:${object.id}:${part.id}`}
      userData={{ creativeId: object.id, creativeComponentId: part.componentId, creativePartId: part.id }}
      frustumCulled
    >
      <meshStandardMaterial
        color={look.color}
        roughness={look.roughness}
        metalness={look.metalness}
        emissive="#38bdf8"
        emissiveIntensity={highlight}
        transparent={look.opacity < 0.98}
        opacity={look.opacity}
        side={part.thin ? THREE.DoubleSide : THREE.FrontSide}
        depthWrite={look.opacity > 0.8}
      />
    </mesh>
  );
}

function CreativeObjectGroup({ object, preview, objectSelected, selectedComponent }: {
  object: CreativeObject;
  preview: Preview | null;
  objectSelected: boolean;
  selectedComponent?: string;
}) {
  const geometries = usePartGeometries(object);
  useEffect(() => {
    const map = geometries;
    return () => {
      for (const geometry of map.values()) geometry.dispose();
    };
  }, [geometries]);

  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const node = group.current;
    if (!node) return;
    if (preview) {
      node.position.copy(preview.position);
      node.quaternion.copy(preview.quaternion);
      node.scale.setScalar(preview.scale);
      return;
    }
    if (object.motion.kind === "none" || object.motion.paused) {
      const rest = creativePositionToScene(object.transform.position);
      const q = creativeRotationToSceneQuat(object.transform.rotation);
      node.position.set(rest[0], rest[1], rest[2]);
      node.quaternion.set(q.x, q.y, q.z, q.w);
      node.scale.setScalar(creativeScaleToScene(object.transform.scale));
      return;
    }
    const sampled = transformAt(object, performance.now() / 1000);
    const position = creativePositionToScene(sampled.position);
    const q = creativeRotationToSceneQuat(sampled.rotation);
    node.position.set(position[0], position[1], position[2]);
    node.quaternion.set(q.x, q.y, q.z, q.w);
    node.scale.setScalar(creativeScaleToScene(sampled.scale));
  });

  const rest = creativePositionToScene(object.transform.position);
  const restQ = creativeRotationToSceneQuat(object.transform.rotation);

  return (
    <group
      ref={group}
      name={`creative-object:${object.id}`}
      position={rest}
      quaternion={[restQ.x, restQ.y, restQ.z, restQ.w]}
      scale={creativeScaleToScene(object.transform.scale)}
      visible={object.visible && !object.archived}
    >
      {object.parts.map((part) => {
        const geometry = geometries.get(part.id);
        if (!geometry) return null;
        return (
          <CreativePartMesh
            key={part.id}
            object={object}
            part={part}
            geometry={geometry}
            objectSelected={objectSelected}
            selectedComponent={Boolean(selectedComponent && selectedComponent === part.componentId)}
          />
        );
      })}
    </group>
  );
}

export default function CreativeObjects3D() {
  const store = CreativeObjects.getInstance();
  const { camera, gl, invalidate, scene, frameloop } = useThree();
  const root = useRef<THREE.Group>(null);
  const raycaster = useRef(new THREE.Raycaster());
  const pointerNdc = useRef(new THREE.Vector2());
  const drag = useRef<DragState | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const [objects, setObjects] = useState<CreativeObject[]>(() => store.list({ location: "cosmos" }));
  const [selection, setSelection] = useState(getCreativeSelection());
  const [tool, setTool] = useState(getCreativeTool());
  const [, render] = useState(0);

  // A read-only probe for acceptance evidence: how many canonical objects and
  // part meshes this layer actually drew, and the frame time over the last
  // second. It never writes to the store.
  useFrame((_, delta) => {
    reportCreativeFrame(delta * 1000);
  });

  useEffect(() => {
    setCreativeCamera(camera as unknown as Parameters<typeof setCreativeCamera>[0]);
    return () => setCreativeCamera(null);
  }, [camera]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __leluCreativeMeshes?: number }).__leluCreativeMeshes = objects.reduce((sum, object) => sum + object.parts.length, 0);
    }
    // Mark the canvas this layer lives in, so acceptance can tell which of the
    // scene's canvases is drawing the creations.
    gl.domElement.dataset.leluCreative = "ready";
    gl.domElement.dataset.leluCreativeCamera = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
    (window as unknown as { __leluCreativeDebug?: unknown }).__leluCreativeDebug = {
      frameloop,
      sceneChildren: scene.children.map((child) => child.name || child.type),
      objectCount: objects.length,
      positions: objects.map((object) => object.transform.position),
    };
  }, [objects, gl, camera, scene, frameloop]);

  // The Cosmos paints on demand. A creative change is a reason to paint: the
  // store, the selection and a drag each ask the existing renderer for the
  // next frame instead of running a second loop.
  useEffect(() => {
    invalidate();
  }, [objects, selection, invalidate]);

  useEffect(() => {
    const update = () => setObjects(store.list({ location: "cosmos" }));
    update();
    const unsubscribeStore = store.subscribe(update);
    const unsubscribeSelection = subscribeCreativeSelection(setSelection);
    const unsubscribeTool = subscribeCreativeTool(setTool);
    return () => {
      unsubscribeStore();
      unsubscribeSelection();
      unsubscribeTool();
    };
  }, [store]);

  const pick = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    pointerNdc.current.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.current.setFromCamera(pointerNdc.current, camera);
    if (!root.current) return null;
    const hits = raycaster.current.intersectObject(root.current, true);
    for (const hit of hits) {
      const data = hit.object.userData as { creativeId?: string; creativeComponentId?: string };
      if (data?.creativeId) return { objectId: data.creativeId, componentId: data.creativeComponentId };
    }
    return null;
  }, [camera, gl]);

  /**
   * Capture-phase pointer down: the camera rig's own listener runs after this
   * one, so it sees the gesture lock and never starts an orbit.
   */
  useEffect(() => {
    const element = gl.domElement;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      const hit = pick(event.clientX, event.clientY);
      if (!hit) {
        selectCreativeObject(null);
        return;
      }
      const target = store.get(hit.objectId);
      if (!target || target.locked) return;
      selectCreativeObject(hit);
      setSelection({ objectId: hit.objectId, componentId: hit.componentId });
      const mode = getCreativeTool();
      if (mode === "select") return;

      const scenePosition = creativePositionToScene(target.transform.position);
      const q = creativeRotationToSceneQuat(target.transform.rotation);
      beginCreativeGesture();
      event.preventDefault();
      event.stopPropagation();
      drag.current = {
        objectId: target.id,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        startPosition: scenePosition,
        startRotation: [...target.transform.rotation] as [number, number, number],
        startScale: creativeScaleToScene(target.transform.scale),
        distance: camera.position.distanceTo(new THREE.Vector3(scenePosition[0], scenePosition[1], scenePosition[2])),
      };
      previewRef.current = {
        objectId: target.id,
        position: new THREE.Vector3(...scenePosition),
        quaternion: new THREE.Quaternion(q.x, q.y, q.z, q.w),
        scale: creativeScaleToScene(target.transform.scale),
        rotation: [...target.transform.rotation] as [number, number, number],
      };
      render((n) => n + 1);
    };
    element.addEventListener("pointerdown", onDown, { capture: true });
    return () => element.removeEventListener("pointerdown", onDown, { capture: true });
  }, [camera, gl, pick, store]);

  /** The drag: window-level, so a finger leaving the mesh keeps control. */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      const preview = previewRef.current;
      if (!state || !preview) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      event.preventDefault();
      if (state.mode === "move") {
        const fov = (camera as THREE.PerspectiveCamera).fov ?? 46;
        const worldPerPixel = (2 * Math.tan((fov * Math.PI) / 360) * state.distance) / Math.max(1, gl.domElement.clientHeight);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        preview.position
          .set(state.startPosition[0], state.startPosition[1], state.startPosition[2])
          .addScaledVector(right, dx * worldPerPixel)
          .addScaledVector(up, -dy * worldPerPixel);
      } else if (state.mode === "rotate") {
        preview.rotation = [state.startRotation[0], state.startRotation[1], state.startRotation[2] + dx * 0.6];
        const q = creativeRotationToSceneQuat(preview.rotation);
        preview.quaternion.set(q.x, q.y, q.z, q.w);
      } else {
        preview.scale = state.startScale * Math.max(0.2, Math.min(6, 1 + dy / 220));
      }
      invalidate();
      render((n) => n + 1);
    };

    const finish = () => {
      const state = drag.current;
      const preview = previewRef.current;
      drag.current = null;
      previewRef.current = null;
      if (state && preview) {
        const position = scenePositionToCreative([preview.position.x, preview.position.y, preview.position.z]);
        store.setTransform(state.objectId, {
          ...(state.mode === "move" ? { position } : {}),
          ...(state.mode === "rotate" ? { rotation: preview.rotation.map((n) => Number(n.toFixed(2))) as [number, number, number] } : {}),
          ...(state.mode === "scale" ? { scale: [preview.scale, preview.scale, preview.scale] } : {}),
        });
      }
      endCreativeGesture();
      render((n) => n + 1);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [camera, gl, store, invalidate]);

  return (
    <group ref={root} name="CreativeObjects" userData={{ creativeTool: tool }}>
      {objects.map((object) => {
        const preview = previewRef.current?.objectId === object.id ? previewRef.current : null;
        const objectSelected = Boolean(preview) || selection?.objectId === object.id;
        return (
          <CreativeObjectGroup
            key={`${object.id}:${object.revision}`}
            object={object}
            preview={preview}
            objectSelected={objectSelected}
            selectedComponent={selection?.objectId === object.id ? selection?.componentId : undefined}
          />
        );
      })}
    </group>
  );
}
