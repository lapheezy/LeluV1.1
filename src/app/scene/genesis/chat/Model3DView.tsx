/**
 * LÉLU — a 3D file the user attached (GLB, GLTF, STL, OBJ), shown where the
 * question is. three.js and the format's own loader parse the uploaded bytes,
 * so what is on screen is the user's file, not a second drawing of it.
 *
 * Nothing here loads until such a file exists in the conversation: the
 * loaders are imported in the effect, not at module load.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import { Download, Maximize2, Minimize2, TriangleAlert } from "lucide-react";
import { Mesh, MeshStandardMaterial, type Object3D } from "three";

export type ModelFormat = "glb" | "gltf" | "stl" | "obj";

/** An uploaded 3D file, kept as its own bytes (the original is never rewritten). */
export interface ModelAttachment {
  name: string;
  format: ModelFormat;
  /** data: URL of the file exactly as uploaded. */
  src: string;
  size: number;
}

export function modelFormatOf(name: string): ModelFormat | null {
  const match = /\.(glb|gltf|stl|obj)$/i.exec(name);
  return match ? (match[1].toLowerCase() as ModelFormat) : null;
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function countTriangles(object: Object3D): number {
  let total = 0;
  object.traverse((child) => {
    const mesh = child as Mesh;
    const index = mesh.geometry?.index;
    if (!mesh.geometry) return;
    total += index ? index.count / 3 : (mesh.geometry.getAttribute("position")?.count ?? 0) / 3;
  });
  return Math.round(total);
}

/** Parse the uploaded bytes with the loader for its own format. */
async function loadModel(model: ModelAttachment): Promise<Object3D> {
  const response = await fetch(model.src);
  if (!response.ok) throw new Error(`the file could not be read back (HTTP ${response.status})`);
  if (model.format === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    return new OBJLoader().parse(await response.text());
  }
  const bytes = await response.arrayBuffer();
  if (model.format === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geometry = new STLLoader().parse(bytes);
    geometry.computeVertexNormals();
    return new Mesh(geometry, new MeshStandardMaterial({ color: "#c9b8ff", metalness: 0.25, roughness: 0.45 }));
  }
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  return await new Promise<Object3D>((resolve, reject) => {
    const ready = (gltf: { scene: Object3D }) => resolve(gltf.scene);
    const failed = (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)));
    // .glb is binary; a .gltf is JSON (its textures/buffers must be embedded).
    if (model.format === "glb") loader.parse(bytes, "", ready, failed);
    else loader.parse(new TextDecoder().decode(bytes), "", ready, failed);
  });
}

export default function Model3DView({ model }: { model: ModelAttachment }) {
  const [scene, setScene] = useState<Object3D | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    setScene(null);
    setError(null);
    // A file too large to keep in the conversation is stored by name only.
    if (!model.src) {
      setError("its bytes were too large to keep with the message — it is attached by name only");
      return () => { alive = false; };
    }
    loadModel(model)
      .then((object) => {
        if (alive) setScene(object);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      alive = false;
    };
  }, [model]);

  const triangles = useMemo(() => (scene ? countTriangles(scene) : 0), [scene]);

  return (
    <figure
      className={`lelu-cc-model${expanded ? " is-expanded" : ""}`}
      aria-label={`3D file ${model.name}`}
      data-lelu-model={model.format}
      data-lelu-model-expanded={expanded ? "" : undefined}
    >
      <header>
        <span className="lelu-cc-model-kind" aria-hidden>{model.format.toUpperCase()}</span>
        <strong title={model.name}>{model.name}</strong>
        <span className="lelu-cc-model-meta">
          {formatBytes(model.size)}
          {triangles ? ` · ${triangles.toLocaleString()} triangles` : ""}
        </span>
        <a className="lelu-cc-model-btn" href={model.src} download={model.name} title="Download the file exactly as uploaded">
          <Download size={13} aria-hidden /> Original
        </a>
        <button
          type="button"
          className="lelu-cc-model-btn"
          data-lelu-model-expand
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />} {expanded ? "Collapse" : "Expand"}
        </button>
      </header>
      <div className="lelu-cc-model-stage">
        {error ? (
          <p className="lelu-cc-model-error" role="alert">
            <TriangleAlert size={14} aria-hidden /> three.js could not open this {model.format.toUpperCase()}: {error}
            {model.format === "gltf" ? " (a .gltf needs its buffers and textures embedded, or upload the .glb)" : ""}
          </p>
        ) : !scene ? (
          <p className="lelu-cc-model-note" role="status">Opening the {model.format.toUpperCase()} in three.js…</p>
        ) : (
          <Canvas frameloop="demand" dpr={[1, 1.75]} camera={{ position: [2.2, 1.6, 2.6], fov: 45, near: 0.001, far: 500 }}>
            <color attach="background" args={["#0b0716"]} />
            <ambientLight intensity={0.9} />
            <directionalLight position={[3, 5, 4]} intensity={1.6} />
            <directionalLight position={[-4, 2, -3]} intensity={0.6} />
            <Suspense fallback={null}>
              <Bounds fit clip observe margin={1.3}>
                <primitive object={scene} />
              </Bounds>
            </Suspense>
            <OrbitControls makeDefault enableDamping={false} />
          </Canvas>
        )}
      </div>
      {!error ? <p className="lelu-cc-model-note">drag to orbit · scroll to zoom · right-drag to pan</p> : null}
    </figure>
  );
}
