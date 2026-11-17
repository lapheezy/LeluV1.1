/**
 * LÉLU — Spatial Studio 3D viewer: the GLB the server produced, parsed by
 * three.js's GLTFLoader (vertex colours included), with orbit controls,
 * named camera views, wireframe and a measured triangle count.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Box3, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from "three";
import { Btn, text } from "./spatialUi";

export type CameraView = "three-quarter" | "front" | "back" | "left" | "right" | "top";
const VIEWS: CameraView[] = ["three-quarter", "front", "back", "left", "right", "top"];
const DIR: Record<CameraView, [number, number, number]> = {
  "three-quarter": [0.75, 0.45, 1],
  front: [0, 0.05, 1],
  back: [0, 0.05, -1],
  left: [-1, 0.05, 0],
  right: [1, 0.05, 0],
  top: [0, 1, 0.001],
};

function Framer({ object, view }: { object: Object3D; view: CameraView }) {
  const { camera, controls } = useThree() as unknown as { camera: { position: Vector3; lookAt: (v: Vector3) => void; near: number; far: number; updateProjectionMatrix: () => void }; controls: { target: Vector3; update: () => void } | null };
  useEffect(() => {
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length() || 1;
    const d = new Vector3(...DIR[view]).normalize().multiplyScalar(size * 1.25);
    camera.position.copy(center.clone().add(d));
    camera.near = size / 200;
    camera.far = size * 50;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  }, [object, view, camera, controls]);
  return null;
}

export default function SpatialViewer({ url, height = 360 }: { url: string; height?: number }) {
  const [scene, setScene] = useState<Object3D | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CameraView>("three-quarter");
  const [wire, setWire] = useState(false);

  useEffect(() => {
    let alive = true;
    setScene(null);
    setError(null);
    (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const bytes = await res.arrayBuffer();
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => new GLTFLoader().parse(bytes, "", resolve, reject));
      if (alive) setScene(gltf.scene);
    })().catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    scene?.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) (mat as MeshStandardMaterial).wireframe = wire;
    });
  }, [scene, wire]);

  const triangles = useMemo(() => {
    let n = 0;
    scene?.traverse((o) => {
      const g = (o as Mesh).geometry;
      if (g) n += g.index ? g.index.count / 3 : (g.getAttribute("position")?.count ?? 0) / 3;
    });
    return Math.round(n);
  }, [scene]);

  return (
    <div data-spatial-viewer data-loaded={scene ? "true" : "false"} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {VIEWS.map((v) => (
          <Btn key={v} data={`camera-${v}`} kind={view === v ? "primary" : "normal"} onClick={() => setView(v)}>
            {v}
          </Btn>
        ))}
        <Btn data="wireframe" kind={wire ? "primary" : "normal"} onClick={() => setWire((w) => !w)}>
          wireframe
        </Btn>
        <span style={{ marginLeft: "auto", fontSize: 11, color: text.dim }}>{scene ? `${triangles.toLocaleString()} triangles · drag to orbit` : ""}</span>
      </div>
      <div style={{ height, borderRadius: 10, overflow: "hidden", background: "#0b0716", position: "relative" }}>
        {error ? (
          <p role="alert" style={{ color: text.bad, padding: 12, fontSize: 12 }}>
            three.js could not open the model: {error}
          </p>
        ) : !scene ? (
          <p role="status" style={{ color: text.dim, padding: 12, fontSize: 12 }}>
            Loading the GLB…
          </p>
        ) : (
          <Canvas frameloop="demand" dpr={[1, 1.75]} camera={{ position: [2, 1.5, 2.5], fov: 40 }} gl={{ preserveDrawingBuffer: true }}>
            <color attach="background" args={["#0b0716"]} />
            <ambientLight intensity={0.85} />
            <directionalLight position={[3, 5, 4]} intensity={1.5} />
            <directionalLight position={[-4, 2, -3]} intensity={0.55} />
            <Suspense fallback={null}>
              <primitive object={scene} />
            </Suspense>
            <OrbitControls makeDefault enableDamping={false} />
            <Framer object={scene} view={view} />
          </Canvas>
        )}
      </div>
    </div>
  );
}
