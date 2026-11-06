/**
 * LÉLU — Atelier 3D view: the direction's exported glTF, parsed by
 * three.js's own GLTFLoader (so what is shown is the file, not a second
 * drawing of the design), orbitable, rendered on demand.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Group } from "three";

export default function AtelierModelView({ gltf, label }: { gltf: Uint8Array; label: string }) {
  const [scene, setScene] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = useMemo(() => new TextDecoder().decode(gltf), [gltf]);
  useEffect(() => {
    let alive = true;
    new GLTFLoader().parse(text, "", (result) => { if (alive) setScene(result.scene); }, (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [text]);
  if (error) return <p className="lat-error">The glTF did not load in three.js: {error}</p>;
  return (
    <div className="lat-model" aria-label={`3D model of ${label}`} data-lelu-atelier-model>
      <Canvas frameloop="demand" camera={{ position: [0.25, 0.2, 0.25], fov: 40, near: 0.001, far: 50 }} dpr={[1, 1.5]}>
        <color attach="background" args={["#f4f1fb"]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[1, 2, 1.5]} intensity={1.4} />
        <directionalLight position={[-1.5, 0.5, -1]} intensity={0.5} />
        <Suspense fallback={null}>
          {scene ? (
            <Bounds fit clip observe margin={1.25}>
              <primitive object={scene} />
            </Bounds>
          ) : null}
        </Suspense>
        <gridHelper args={[1, 20, "#b9a8ef", "#e0d9f5"]} />
        <OrbitControls makeDefault enableDamping={false} />
      </Canvas>
      <span className="lat-model-hint">drag to orbit · scroll to zoom · from the exported glTF</span>
    </div>
  );
}
