import { useEffect, useMemo, useRef } from "react";
import { useCoreStateStore } from "./CoreStateBus";
import { getCurrentPalette, hsl, type CorePalette } from "./CoreThemeEngine";

type Particle = {
  a: number; // angle
  r: number; // radius factor 0..1
  s: number; // speed
  z: number; // depth 0..1
  hue: number;
};

export function Core({
  size = 260,
  onTap,
  onLongPress,
  pinnedSeason,
}: {
  size?: number;
  onTap?: () => void;
  onLongPress?: () => void;
  pinnedSeason?: string;
}) {
  const active = useCoreStateStore((s) => s.active);
  const pulses = useCoreStateStore((s) => s.pulses);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const paletteRef = useRef<CorePalette>(getCurrentPalette(new Date(), pinnedSeason));
  const particlesRef = useRef<Particle[]>([]);
  const pressTimer = useRef<number | null>(null);
  const tRef = useRef(0);

  // seed particles
  useMemo(() => {
    const arr: Particle[] = [];
    for (let i = 0; i < 90; i++) {
      arr.push({
        a: Math.random() * Math.PI * 2,
        r: 0.35 + Math.random() * 0.6,
        s: 0.15 + Math.random() * 0.5,
        z: Math.random(),
        hue: Math.random(),
      });
    }
    particlesRef.current = arr;
  }, []);

  // slowly re-evaluate palette every minute so the season/time-of-day drifts live
  useEffect(() => {
    const id = window.setInterval(() => {
      paletteRef.current = getCurrentPalette(new Date(), pinnedSeason);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [pinnedSeason]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      const p = paletteRef.current;
      const w = size;
      const h = size;
      const cx = w / 2;
      const cy = h / 2;
      tRef.current += 1;
      const t = tRef.current;

      // state modifiers
      const isThinking = active.has("thinking");
      const isListening = active.has("listening");
      const isSpeaking = active.has("speaking");
      const isResearch = active.has("research");
      const isError = active.has("error");
      const speedMul = isThinking ? 2.4 : isListening ? 0.5 : 1;
      const breath = 1 + Math.sin(t * 0.015) * (isListening ? 0.02 : 0.05);
      const nucleusR = (w * 0.18) * breath * (isListening ? 0.9 : 1);
      const outerR = w * 0.46;

      ctx.clearRect(0, 0, w, h);

      // outer aura bloom
      const auraGrad = ctx.createRadialGradient(cx, cy, nucleusR, cx, cy, outerR * 1.3);
      auraGrad.addColorStop(0, hsl(p.aura, isError ? 0.15 : 0.35));
      auraGrad.addColorStop(0.6, hsl(p.plasmaB, 0.18));
      auraGrad.addColorStop(1, hsl(p.aura, 0));
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR * 1.3, 0, Math.PI * 2);
      ctx.fill();

      // plasma flow — layered radial gradients rotating over time
      const rot = (t * 0.003 * speedMul) % (Math.PI * 2);
      for (let i = 0; i < 3; i++) {
        const ang = rot + (i * Math.PI * 2) / 3;
        const ox = cx + Math.cos(ang) * nucleusR * 0.3;
        const oy = cy + Math.sin(ang) * nucleusR * 0.3;
        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, outerR * 0.9);
        const c1 = i === 0 ? p.plasmaA : i === 1 ? p.plasmaB : p.nucleus;
        g.addColorStop(0, hsl(c1, 0.55));
        g.addColorStop(0.5, hsl(c1, 0.15));
        g.addColorStop(1, hsl(c1, 0));
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // orbital particle ring
      if (!reduced) {
        const parts = particlesRef.current;
        for (const pt of parts) {
          pt.a += pt.s * 0.008 * speedMul;
          const rr = outerR * (0.62 + pt.r * 0.32) + Math.sin(t * 0.02 + pt.z * 6) * 4;
          const x = cx + Math.cos(pt.a) * rr;
          const y = cy + Math.sin(pt.a) * rr * 0.85;
          const hue = pt.hue < 0.5 ? p.ring : p.plasmaB;
          const alpha = 0.35 + pt.z * 0.5;
          ctx.fillStyle = hsl(hue, alpha);
          ctx.beginPath();
          ctx.arc(x, y, 0.7 + pt.z * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // research radar sweep
      if (isResearch) {
        const sweepA = (t * 0.03) % (Math.PI * 2);
        ctx.strokeStyle = hsl(p.ring, 0.55);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR * 0.72, sweepA, sweepA + 0.6);
        ctx.stroke();
      }

      // speaking ripples
      if (isSpeaking) {
        for (let i = 0; i < 3; i++) {
          const phase = ((t * 0.02 + i * 0.33) % 1);
          ctx.strokeStyle = hsl(p.ring, (1 - phase) * 0.35);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, nucleusR + phase * outerR * 0.9, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // pulses (memory-write/notification bursts)
      for (const pulse of pulses) {
        const age = (Date.now() - pulse.at) / 1600;
        if (age > 1) continue;
        const color =
          pulse.kind === "memory-write" ? p.nucleus :
          pulse.kind === "memory-read" ? p.plasmaA :
          pulse.kind === "notification" ? p.ring : p.plasmaB;
        ctx.strokeStyle = hsl(color, (1 - age) * 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, nucleusR + age * outerR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // nucleus
      const nGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleusR);
      nGrad.addColorStop(0, hsl(p.nucleus, 0.95));
      nGrad.addColorStop(0.6, hsl(p.plasmaA, 0.6));
      nGrad.addColorStop(1, hsl(p.plasmaB, 0));
      ctx.fillStyle = nGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusR, 0, Math.PI * 2);
      ctx.fill();

      // error tint
      if (isError) {
        ctx.fillStyle = "rgba(220,60,60,0.12)";
        ctx.beginPath();
        ctx.arc(cx, cy, outerR * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [size, active, pulses]);

  const start = () => {
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      onLongPress?.();
    }, 480);
  };
  const end = (fire: boolean) => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      if (fire) onTap?.();
    }
  };

  return (
    <button
      type="button"
      aria-label="Lélu Core"
      onPointerDown={start}
      onPointerUp={() => end(true)}
      onPointerLeave={() => end(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        onLongPress?.();
      }}
      className="relative grid place-items-center rounded-full outline-none focus-visible:outline-none transition-transform duration-500 hover:scale-[1.03] active:scale-[0.98]"
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="rounded-full"
      />
    </button>
  );
}