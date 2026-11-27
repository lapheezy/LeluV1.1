/**
 * ==========================================================
 * LÉLU — V2 IN 3D (react-three-fiber, already in the app)
 *
 * Renders one of the ten architecture views (core/neural/multiverse/
 * Architecture3D) in WebGL. It draws what the layout placed and what the
 * event bus measured, nothing else:
 *
 *   node size   lines of code        wiring    static imports
 *   bars        git commits per day  glow      live events this session
 *
 * After each frame it writes what the GPU actually drew (draw calls,
 * triangles) onto its wrapper, so verification can prove a real 3D
 * render instead of trusting the DOM.
 * ==========================================================
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { archLayout, liveActivity, type ArchViewId, type Vec3 } from "../../../../core/neural/multiverse/Architecture3D";
import type { MvGraph } from "../../../../core/neural/multiverse/MultiverseTypes";
import AgentEventBus from "../../../../core/agent/AgentEvents";

const SCALE = 10;

function useLive() {
  const bus = AgentEventBus.getInstance();
  const [events, setEvents] = useState(() => bus.recent(2000).map((e) => ({ type: e.type })));
  useEffect(() => bus.subscribe((e) => setEvents((list) => [...list.slice(-1999), { type: e.type }])), [bus]);
  return useMemo(() => liveActivity(events), [events]);
}

/** Writes what the renderer drew after each frame onto the wrapper element. */
function RenderProbe({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const { gl } = useThree();
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current % 10 !== 1 || !target.current) return;
    target.current.dataset.glCalls = String(gl.info.render.calls);
    target.current.dataset.glTriangles = String(gl.info.render.triangles);
    target.current.dataset.glFrames = String(frames.current);
  });
  return null;
}

function curvePoints(kind: string, a: Vec3, b: Vec3, via: Vec3[] = []): THREE.Vector3[] {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  if (kind === "arc") {
    const mid = A.clone().add(B).multiplyScalar(0.5).multiplyScalar(0.45);
    return new THREE.QuadraticBezierCurve3(A, mid, B).getPoints(16);
  }
  if (kind === "trace") {
    const lift = 0.06;
    return [new THREE.Vector3(a[0], lift, a[2]), new THREE.Vector3(b[0], lift, a[2]), new THREE.Vector3(b[0], lift, b[2])];
  }
  if (kind === "tract" && via.length) return new THREE.CatmullRomCurve3([A, ...via.map((v) => new THREE.Vector3(...v)), B]).getPoints(24);
  return [A, B];
}

function Scene({ graph, view, selected, onSelect, live, colour, highlight, compactLabels = false }: { graph: MvGraph; view: ArchViewId; selected: string | null; onSelect: (id: string | null) => void; live: ReturnType<typeof liveActivity>; colour: Map<string, string>; highlight?: Set<string>; compactLabels?: boolean }) {
  const lay = useMemo(() => archLayout(view, graph, SCALE), [view, graph]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const maxLive = Math.max(1, ...Object.values(live.bySubsystem));

  // All wiring as one LineSegments (cheap), except tractography: real tubes.
  // V2 draws its import wiring; other aspects draw every relation they have.
  const imports = useMemo(() => graph.edges.filter((e) => (graph.aspect !== "v2" || e.kind === "imports") && lay.positions[e.from] && lay.positions[e.to]), [graph, lay]);
  const lines = useMemo(() => {
    if (lay.wiring === "none" || lay.wiring === "tract") return null;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (const e of imports) {
      const pts = curvePoints(lay.wiring, lay.positions[e.from], lay.positions[e.to]);
      const lit = selected && (e.from === selected || e.to === selected);
      c.set(lit ? "#fde68a" : colour.get(nodeById.get(e.from)?.group ?? "") ?? "#64748b");
      const fade = selected && !lit ? 0.12 : lit ? 1 : 0.45;
      for (let i = 0; i < pts.length - 1; i++) {
        pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        col.push(c.r * fade, c.g * fade, c.b * fade, c.r * fade, c.g * fade, c.b * fade);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }, [imports, lay, selected, colour, nodeById]);

  const tubes = useMemo(() => {
    if (lay.wiring !== "tract") return [];
    return imports.map((e) => {
      const fa = lay.positions[`function:${nodeById.get(e.from)?.group}`];
      const fb = lay.positions[`function:${nodeById.get(e.to)?.group}`];
      const via = fa && fb && fa !== fb ? [fa, fb] : [];
      const curve = new THREE.CatmullRomCurve3(curvePoints("tract", lay.positions[e.from], lay.positions[e.to], via));
      const radius = 0.015 + Math.min(0.12, Math.log2(1 + (e.weight ?? 1)) * 0.025);
      return { id: e.id, from: e.from, to: e.to, geo: new THREE.TubeGeometry(curve, 24, radius, 5, false), color: colour.get(nodeById.get(e.from)?.group ?? "") ?? "#94a3b8" };
    });
  }, [imports, lay, nodeById, colour]);

  const particles = useMemo(() => {
    if (!lay.particles?.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(lay.particles.flatMap((p) => p.at), 3));
    return geo;
  }, [lay]);

  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[SCALE * 2, SCALE * 2, SCALE * 2]} intensity={900} />
      <pointLight position={[-SCALE * 2, -SCALE, -SCALE]} intensity={300} color="#a78bfa" />
      {lay.shells.map((s, i) =>
        s.kind === "ellipsoid" ? (
          <mesh key={i} position={s.center} scale={s.radii}>
            <sphereGeometry args={[1, 48, 32]} />
            <meshPhysicalMaterial color="#93c5fd" transparent opacity={s.opacity} roughness={0.1} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ) : s.kind === "plane" ? (
          <group key={i} position={[0, s.y, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[s.size, s.size * 0.8]} />
              <meshBasicMaterial color={colour.get(s.label) ?? "#334155"} transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          </group>
        ) : s.kind === "board" ? (
          <mesh key={i} position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[s.size, s.size]} />
            <meshStandardMaterial color="#0b3d2e" roughness={0.8} />
          </mesh>
        ) : (
          <group key={i}>
            <line>
              <bufferGeometry attach="geometry" onUpdate={(g) => g.setFromPoints([new THREE.Vector3(...s.from), new THREE.Vector3(...s.to)])} />
              <lineBasicMaterial color="#94a3b8" />
            </line>
            {s.ticks.map((t) => (
              <Html key={t.label} position={t.at} center className="a3-tick">
                {t.label}
              </Html>
            ))}
          </group>
        ),
      )}
      {lines ? (
        <lineSegments geometry={lines}>
          <lineBasicMaterial vertexColors transparent opacity={0.85} />
        </lineSegments>
      ) : null}
      {tubes.map((t) => (
        <mesh key={t.id} geometry={t.geo}>
          <meshStandardMaterial color={selected && (t.from === selected || t.to === selected) ? "#fde68a" : t.color} transparent opacity={selected && t.from !== selected && t.to !== selected ? 0.12 : 0.55} />
        </mesh>
      ))}
      {particles ? (
        <points geometry={particles}>
          <pointsMaterial size={0.07} color="#e2e8f0" transparent opacity={0.7} />
        </points>
      ) : null}
      {lay.bars?.map((b, i) => (
        <mesh key={i} position={[b.at[0], (b.height * 0.35) / 2, b.at[2]]}>
          <boxGeometry args={[0.18, b.height * 0.35, 0.18]} />
          <meshStandardMaterial color={colour.get(nodeById.get(b.node)?.group ?? "") ?? "#94a3b8"} emissive="#fbbf24" emissiveIntensity={0.15} />
        </mesh>
      ))}
      {graph.nodes.map((n) => {
        const p = lay.positions[n.id];
        if (!p) return null;
        const hub = n.kind === "function" || n.kind === "executive";
        const lit = highlight?.has(n.id) ?? false;
        const liveCount = live.bySubsystem[n.id] ?? 0;
        const r = hub ? 0.32 : 0.1 + Math.log10(1 + (n.weight ?? 0)) * 0.07;
        const on = selected === n.id;
        const board = view === "circuit-board" && !hub;
        return (
          <group key={n.id} position={p}>
            <mesh
              userData={{ id: n.id }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(on ? null : n.id);
              }}
              position={board ? [0, r, 0] : [0, 0, 0]}
            >
              {board ? <boxGeometry args={[r * 3, r * 2, r * 3]} /> : hub ? <icosahedronGeometry args={[r, 1]} /> : <sphereGeometry args={[r, 20, 14]} />}
              <meshStandardMaterial
                color={colour.get(n.group) ?? "#94a3b8"}
                wireframe={hub}
                emissive={lit ? "#fbbf24" : liveCount ? "#fde68a" : on ? "#ffffff" : "#000000"}
                emissiveIntensity={lit ? 1.6 : liveCount ? 0.3 + (liveCount / maxLive) * 1.2 : on ? 0.5 : 0}
                transparent
                opacity={selected && !on ? 0.45 : 1}
              />
            </mesh>
            {(compactLabels ? on || lit : hub || on || lit) ? (
              <Html center distanceFactor={22} className={`a3-label${on ? " a3-on" : ""}`} position={[0, r + 0.35, 0]}>
                {n.label}
                {liveCount ? ` · ${liveCount} live` : ""}
              </Html>
            ) : null}
          </group>
        );
      })}
    </>
  );
}

export default function Architecture3DView({ graph, view, selected, onSelect, colour, motion, highlight, compact = false }: { graph: MvGraph; view: ArchViewId; selected: string | null; onSelect: (id: string | null) => void; colour: Map<string, string>; motion: boolean; highlight?: Set<string>; compact?: boolean }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const live = useLive();
  const lay = useMemo(() => archLayout(view, graph, SCALE), [view, graph]);
  const drawnNodes = graph.nodes.filter((n) => lay.positions[n.id]).length;
  const imports = graph.edges.filter((e) => e.kind === "imports").length;
  const unmapped = Object.keys(live.unmapped);
  return (
    <div
      ref={wrap}
      className="a3"
      data-arch-view={view}
      data-arch-nodes={drawnNodes}
      data-arch-wiring={lay.wiring}
      data-arch-edges={lay.wiring === "none" ? 0 : imports}
      data-arch-bars={lay.bars?.length ?? 0}
      data-arch-particles={lay.particles?.length ?? 0}
      data-live-total={live.total}
    >
      <Canvas camera={{ position: view === "circuit-board" ? [0, SCALE * 2.1, SCALE * 1.2] : view === "temporal-activation" ? [0, SCALE * 1.2, SCALE * 2.2] : [SCALE * 1.4, SCALE * 0.8, SCALE * 1.9], fov: 45 }} dpr={[1, 2]} frameloop={motion ? "always" : "demand"} onPointerMissed={() => onSelect(null)} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={["#05060f"]} />
        <Scene graph={graph} view={view} selected={selected} onSelect={onSelect} live={live} colour={colour} highlight={highlight} compactLabels={compact} />
        <OrbitControls makeDefault enableDamping autoRotate={motion && !selected} autoRotateSpeed={0.4} />
        <RenderProbe target={wrap} />
      </Canvas>
      <p className="a3-caption" hidden={compact}>
        {lay.caption}{" "}
        <span data-live-summary>
          {live.total
            ? `Live: ${live.total} events on the event bus this session, ${Object.values(live.bySubsystem).reduce((a, b) => a + b, 0)} mapped to subsystems${unmapped.length ? ` (unmapped types: ${unmapped.join(", ")})` : ""}.`
            : "Live: no events observed on the event bus this session, so nothing glows."}
        </span>
      </p>
    </div>
  );
}
