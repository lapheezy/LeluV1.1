/**
 * LÉLU — the spatial stage: a conversation as a 3D environment.
 *
 * Built on the infrastructure the app already has (three + react-three-fiber
 * + drei, the same RenderContextGuard every canvas registers through) — no
 * new 3D dependency. Each section is a glass card on an orbit around the
 * conversation's title; each image is a textured panel on an inner ring;
 * questions are bright beacons. Drag to orbit, pinch/scroll to zoom, tap a
 * card to fly to it. Pixel ratio is capped and the canvas exists only while
 * this stage is open.
 */

import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, Html, OrbitControls, Stars, useTexture } from "@react-three/drei";
import * as THREE from "three";
import RenderContextGuard from "../../render/RenderContextGuard";
import { stripMarkdown, type StageConversation, type StageMedia } from "./conversationModel";

interface Placed {
  id: string;
  title: string;
  text: string;
  position: [number, number, number];
  kind: "section" | "question";
}

function layout(model: StageConversation): { cards: Placed[]; media: Array<StageMedia & { position: [number, number, number]; rotationY: number }> } {
  const items: Placed[] = [];
  for (const t of model.turns) {
    if (t.question) items.push({ id: `q${t.index}`, title: stripMarkdown(t.question).slice(0, 90), text: "", position: [0, 0, 0], kind: "question" });
    for (const s of t.sections) items.push({ id: s.id, title: s.heading, text: stripMarkdown(s.text).slice(0, 220), position: [0, 0, 0], kind: "section" });
  }
  const n = Math.max(1, items.length);
  const radius = Math.max(5.5, n * 0.9);
  items.forEach((item, i) => {
    const a = (i / n) * Math.PI * 2;
    item.position = [Math.cos(a) * radius, Math.sin(i * 1.3) * 1.4, Math.sin(a) * radius];
  });
  const m = Math.max(1, model.media.length);
  const media = model.media.map((md, i) => {
    const a = (i / m) * Math.PI * 2 + 0.4;
    const r = radius * 0.55;
    return { ...md, position: [Math.cos(a) * r, 2.6 + Math.sin(i) * 0.6, Math.sin(a) * r] as [number, number, number], rotationY: -a + Math.PI / 2 };
  });
  return { cards: items, media };
}

function MediaPanel({ src, position, rotationY }: { src: string; position: [number, number, number]; rotationY: number }) {
  const texture = useTexture(src);
  texture.colorSpace = THREE.SRGBColorSpace;
  const img = texture.image as { width?: number; height?: number } | undefined;
  const aspect = img?.width && img?.height ? img.width / img.height : 16 / 9;
  return (
    <Float speed={1.4} rotationIntensity={0.15} floatIntensity={0.6}>
      <mesh position={position} rotation={[0, rotationY, 0]}>
        <planeGeometry args={[2.6 * aspect, 2.6]} />
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </Float>
  );
}

function Flyer({ target }: { target: THREE.Vector3 | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useFrame(() => {
    if (!target || !controls) return;
    controls.target.lerp(target, 0.08);
    const desired = target.clone().add(new THREE.Vector3(0, 1.2, 0)).multiplyScalar(1).add(target.clone().normalize().multiplyScalar(5));
    camera.position.lerp(desired, 0.05);
    controls.update();
  });
  return null;
}

function Core({ title }: { title: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.25;
  });
  return (
    <group>
      <mesh ref={ref}>
        <icosahedronGeometry args={[1.25, 2]} />
        <meshStandardMaterial color="#a855f7" emissive="#6d28d9" emissiveIntensity={0.9} wireframe />
      </mesh>
      <pointLight color="#c084fc" intensity={30} distance={30} />
      <Html center position={[0, -2.1, 0]} className="lsp-core-label">{title}</Html>
    </group>
  );
}

export default function SpatialStage({ model }: { model: StageConversation }) {
  const { cards, media } = useMemo(() => layout(model), [model]);
  // Cards are DOM in 3D: on a narrow screen they are drawn smaller so the orbit still reads.
  const narrow = typeof window !== "undefined" && (window.visualViewport?.width ?? window.innerWidth) < 640;
  const [focus, setFocus] = useState<string | null>(null);
  const target = useMemo(() => {
    const c = cards.find((x) => x.id === focus);
    return c ? new THREE.Vector3(...c.position) : null;
  }, [cards, focus]);
  return (
    <div className="lsp" data-lelu-stage-view="spatial" data-cards={cards.length} data-media={media.length}>
      <Canvas dpr={[1, 1.75]} camera={{ position: [0, 4, narrow ? 18 : 14], fov: narrow ? 65 : 55 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <RenderContextGuard id="chat-spatial-stage" kind="effect" />
        <color attach="background" args={["#05030f"]} />
        <fog attach="fog" args={["#05030f", 14, 42]} />
        <ambientLight intensity={0.5} />
        <Stars radius={60} depth={30} count={2200} factor={3} fade speed={0.6} />
        <Core title={model.title} />
        {cards.map((c) => (
          <Float key={c.id} speed={1.1} rotationIntensity={0.08} floatIntensity={0.5}>
            <group position={c.position}>
              <mesh>
                <sphereGeometry args={[c.kind === "question" ? 0.22 : 0.12, 16, 16]} />
                <meshBasicMaterial color={c.kind === "question" ? "#f0abfc" : "#7dd3fc"} />
              </mesh>
              <Html center distanceFactor={narrow ? 5 : 9} occlude={false} zIndexRange={[20, 0]}>
                <button type="button" className="lsp-card" data-kind={c.kind} data-on={focus === c.id} onClick={() => setFocus(focus === c.id ? null : c.id)}>
                  <span>{c.kind === "question" ? "Question" : "Section"}</span>
                  <strong>{c.title}</strong>
                  {c.text ? <p>{c.text}</p> : null}
                </button>
              </Html>
            </group>
          </Float>
        ))}
        <Suspense fallback={null}>
          {media.map((m) => <MediaPanel key={m.id} src={m.src} position={m.position} rotationY={m.rotationY} />)}
        </Suspense>
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={40} autoRotate={!focus} autoRotateSpeed={0.35} />
        <Flyer target={target} />
      </Canvas>
      <div className="lsp-hud">
        <span>{cards.length} ideas · {media.length} images</span>
        <span>Drag to orbit · scroll/pinch to zoom · tap a card to fly to it</span>
        {focus ? <button type="button" className="lst-chip" onClick={() => setFocus(null)}>Release</button> : null}
      </div>
    </div>
  );
}
