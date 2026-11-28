/**
 * ==========================================================
 * LÉLU — WORLD STAGE (WP21)
 *
 * Mounts a world: one WebGL canvas for the 3D layers, the SVG/canvas 2D
 * overlay above it, and the world's panel treatment exported as CSS
 * variables so thread panels and the composer take on the world's frame.
 *
 * Performance (WP08): quality "auto" measures the first seconds of frames
 * and picks low / medium / high (particle counts, device pixel ratio);
 * rendering stops entirely while the stage is off-screen, the tab is
 * hidden or `paused` is set (a covering view), and reduced-motion freezes
 * every moving layer. What was reduced is reported on the element.
 * ==========================================================
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { layersOf, type Quality, type WorldConfig } from "../../../core/worlds/WorldSchema";
import { WorldScene } from "./World3D";
import { World2D } from "./World2D";
import "./world.css";

const TIER_SCALE: Record<Exclude<Quality, "auto">, number> = { low: 0.35, medium: 0.65, high: 1 };
const TIER_DPR: Record<Exclude<Quality, "auto">, [number, number]> = { low: [0.75, 1], medium: [1, 1.25], high: [1, 2] };

function FrameMeter({ onMeasured }: { onMeasured: (msPerFrame: number) => void }) {
  const acc = useRef({ t: 0, n: 0, done: false, skip: 20 });
  useFrame((_, dt) => {
    const a = acc.current;
    if (a.done) return;
    if (a.skip-- > 0) return; // shader compilation and warm-up
    a.t += dt;
    a.n++;
    if (a.t > 2.5) {
      a.done = true;
      onMeasured((a.t / a.n) * 1000);
    }
  });
  return null;
}

export default function WorldStage({ world, paused = false, interactive = true, className }: { world: WorldConfig; paused?: boolean; interactive?: boolean; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [hidden, setHidden] = useState(typeof document !== "undefined" && document.hidden);
  const [measured, setMeasured] = useState<number | null>(null);
  const reduced = useMemo(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    const vis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  // A new composition re-measures (a city costs more than a starfield).
  const signature = world.layers.filter((l) => l.enabled && (l.slot === "foundation" || l.slot === "atmosphere" || l.slot === "objects3d")).map((l) => l.id).join("|");
  useEffect(() => setMeasured(null), [signature, world.quality]);

  const tier: Exclude<Quality, "auto"> = world.quality !== "auto" ? world.quality : measured === null ? "medium" : measured < 22 ? "high" : measured < 45 ? "medium" : "low";
  const stopped = paused || !visible || hidden;
  const motion = reduced ? 0 : world.motion;
  const show3d = world.mode !== "2d";
  const show2d = world.mode !== "3d";
  const frame = layersOf(world, "spatialUI")[0];
  const motionLayer = layersOf(world, "motion")[0];
  const vars = {
    "--w-tint": String(frame?.params.tint ?? "#1a0b3a"),
    "--w-edge": String(frame?.params.edge ?? world.palette.glow),
    "--w-glow": String(frame?.params.glow ?? world.palette.accent),
    "--w-ink": world.palette.ink,
    "--w-sky0": world.palette.sky[0],
    "--w-sky1": world.palette.sky[1],
    "--w-sky2": world.palette.sky[2],
  } as React.CSSProperties;

  return (
    <div
      ref={root}
      className={`ws ${className ?? ""}`}
      style={vars}
      data-world={world.id}
      data-world-families={world.families.join(" ")}
      data-world-mode={world.mode}
      data-world-layers={world.layers.filter((l) => l.enabled).length}
      data-world-tier={tier}
      data-world-quality={world.quality}
      data-world-ms={measured === null ? "" : measured.toFixed(1)}
      data-world-running={stopped ? "false" : "true"}
      data-world-reduced={reduced ? "true" : "false"}
      data-ink={frame?.params.ink ? "true" : "false"}
    >
      {show3d ? (
        <Canvas
          className="ws-canvas"
          dpr={TIER_DPR[tier]}
          frameloop={stopped ? "never" : motion === 0 ? "demand" : "always"}
          camera={{ position: [0, world.camera.height, world.camera.distance], fov: 55, near: 0.5, far: 1200 }}
          gl={{ antialias: tier !== "low", powerPreference: "high-performance" }}
        >
          <Suspense fallback={null}>
            <WorldScene world={world} budget={{ scale: TIER_SCALE[tier] * world.density, motion }} />
          </Suspense>
          {interactive ? <OrbitControls makeDefault enablePan={false} enableZoom minDistance={8} maxDistance={90} maxPolarAngle={Math.PI * 0.53} target={[0, 4, -16]} autoRotate={world.camera.auto && motion > 0} autoRotateSpeed={0.25 * (Number(motionLayer?.params.parallax ?? 0.5) + 0.2)} /> : null}
          {world.quality === "auto" && measured === null && !stopped ? <FrameMeter onMeasured={setMeasured} /> : null}
        </Canvas>
      ) : (
        <div className="ws-flat" />
      )}
      {show2d ? <World2D world={world} paused={stopped || motion === 0} /> : null}
      {world.place ? (
        <div className="ws-place" data-world-place={world.place.location}>
          <b>
            {world.place.location} · {world.place.era}
          </b>
          <small>{world.place.confidence}</small>
        </div>
      ) : null}
    </div>
  );
}
