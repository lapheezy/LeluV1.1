/**
 * ==========================================================
 * LÉLU — WORLD 2D ADAPTER (WP21 · WP02)
 *
 * The authored 2D language of a world, drawn as SVG above the 3D scene:
 * vector, crisp at any size, each pack an independent layer with its own
 * opacity and stacking. All geometry is generated here (seeded), so it is
 * original and reproducible.
 * ==========================================================
 */

import { memo, useEffect, useMemo, useRef } from "react";
import { contours } from "d3-contour";
import { geoPath } from "d3-geo";
import { layersOf, type WorldConfig, type WorldLayer } from "../../../core/worlds/WorldSchema";
import { fbm, rng, terrainHeight } from "../../../core/worlds/noise";

const W = 1600, H = 1000;
const str = (l: WorldLayer, k: string, d: string) => (typeof l.params[k] === "string" ? (l.params[k] as string) : d);
const num = (l: WorldLayer, k: string, d: number) => (typeof l.params[k] === "number" ? (l.params[k] as number) : d);

const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];

function ZodiacWheel({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#f5c46b");
  const cx = W * 0.5, cy = H * 0.46, R = 430;
  return (
    <g className="w2-spin-slow" style={{ transformOrigin: `${cx}px ${cy}px` }} stroke={c} fill="none">
      {[1, 0.9, 0.74, 0.58, 0.3].map((k, i) => (
        <circle key={i} cx={cx} cy={cy} r={R * k} strokeWidth={i === 0 ? 2.5 : 1.2} strokeOpacity={i === 4 ? 0.5 : 0.9} />
      ))}
      {Array.from({ length: 360 }, (_, i) => {
        const a = (i / 360) * Math.PI * 2, long = i % 30 === 0, mid = i % 5 === 0;
        const r1 = R, r2 = R * (long ? 0.9 : mid ? 0.96 : 0.98);
        return <line key={i} x1={cx + Math.cos(a) * r1} y1={cy + Math.sin(a) * r1} x2={cx + Math.cos(a) * r2} y2={cy + Math.sin(a) * r2} strokeWidth={long ? 2 : 0.8} />;
      })}
      {ZODIAC.map((g, i) => {
        const a = ((i + 0.5) / 12) * Math.PI * 2;
        const rr = R * 0.82;
        return (
          <g key={g}>
            <line x1={cx + Math.cos((i / 12) * Math.PI * 2) * R * 0.74} y1={cy + Math.sin((i / 12) * Math.PI * 2) * R * 0.74} x2={cx + Math.cos((i / 12) * Math.PI * 2) * R * 0.3} y2={cy + Math.sin((i / 12) * Math.PI * 2) * R * 0.3} strokeWidth={0.8} strokeOpacity={0.6} />
            <text x={cx + Math.cos(a) * rr} y={cy + Math.sin(a) * rr} fill={c} stroke="none" fontSize={44} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: "'Segoe UI Symbol','Noto Sans Symbols','DejaVu Sans',serif" }}>
              {g}
              {"︎"}
            </text>
          </g>
        );
      })}
      {/* aspect lines across the inner chart */}
      {[[0, 4], [4, 8], [8, 0], [2, 7], [5, 10], [1, 9]].map(([a, b], i) => {
        const p = (k: number) => [cx + Math.cos((k / 12) * Math.PI * 2 + 0.26) * R * 0.3, cy + Math.sin((k / 12) * Math.PI * 2 + 0.26) * R * 0.3];
        const [x1, y1] = p(a), [x2, y2] = p(b);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1} strokeOpacity={0.7} />;
      })}
      <circle cx={cx} cy={cy} r={22} fill={c} fillOpacity={0.25} />
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return <line key={i} x1={cx + Math.cos(a) * 26} y1={cy + Math.sin(a) * 26} x2={cx + Math.cos(a) * (i % 2 ? 44 : 60)} y2={cy + Math.sin(a) * (i % 2 ? 44 : 60)} strokeWidth={2} />;
      })}
    </g>
  );
}

function Constellations({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#e9d5ff");
  const groups = useMemo(() => {
    const r = rng(101);
    return Array.from({ length: 7 }, () => {
      const x0 = r() * W, y0 = r() * H * 0.7;
      const pts: Array<[number, number]> = [[x0, y0]];
      for (let i = 0; i < 4 + Math.floor(r() * 4); i++) {
        const [x, y] = pts[pts.length - 1];
        pts.push([x + (r() - 0.4) * 140, y + (r() - 0.5) * 110]);
      }
      return pts;
    });
  }, []);
  return (
    <g>
      {groups.map((pts, i) => (
        <g key={i}>
          <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={c} strokeWidth={1} strokeOpacity={0.5} strokeDasharray="2 5" />
          {pts.map(([x, y], j) => (
            <g key={j} className="w2-twinkle" style={{ animationDelay: `${(i * 7 + j) % 5}s` }}>
              <circle cx={x} cy={y} r={j === 0 ? 4 : 2.6} fill={c} />
              <circle cx={x} cy={y} r={11} fill={c} fillOpacity={0.12} />
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}

function Contours({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#d9f99d");
  const paths = useMemo(() => {
    const nx = 160, ny = 100;
    const values = new Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = terrainHeight((i - nx / 2) * 1.6, -j * 1.8 + 20, 9) + fbm(i * 0.05, j * 0.05, 3, 9) * 2;
    const gen = contours().size([nx, ny]).thresholds(18);
    const path = geoPath();
    return gen(values).map((m, i) => ({ d: path(m) ?? "", major: i % 4 === 0 }));
  }, []);
  return (
    <g transform={`scale(${W / 160} ${H / 100})`} fill="none" stroke={c}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} strokeWidth={p.major ? 0.22 : 0.1} strokeOpacity={p.major ? 0.9 : 0.55} vectorEffect="non-scaling-stroke" style={{ strokeWidth: p.major ? 1.6 : 0.8 }} />
      ))}
    </g>
  );
}

function Isobars({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#bae6fd");
  const cx = W * 0.62, cy = H * 0.42;
  const rings = useMemo(
    () =>
      Array.from({ length: 11 }, (_, k) => {
        const R = 40 + k * 62;
        const pts = Array.from({ length: 72 }, (_, i) => {
          const a = (i / 72) * Math.PI * 2;
          const rr = R * (1 + (fbm(Math.cos(a) * 1.5 + k * 0.2, Math.sin(a) * 1.5, 3, 4) - 0.5) * 0.5) * (1 + Math.cos(a) * 0.18);
          return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.75];
        });
        return { d: `M${pts.map((p) => p.join(",")).join("L")}Z`, label: 1000 - (10 - k) * 4, p: pts[18] };
      }),
    [cx, cy],
  );
  return (
    <g fill="none" stroke={c}>
      {rings.map((r, i) => (
        <g key={i}>
          <path d={r.d} strokeWidth={1.4} strokeOpacity={0.8} />
          <text x={r.p[0]} y={r.p[1]} fill={c} stroke="none" fontSize={15} textAnchor="middle" style={{ fontFamily: "ui-monospace, monospace" }}>
            {r.label}
          </text>
        </g>
      ))}
      <text x={cx} y={cy + 14} fill={c} stroke="none" fontSize={54} fontWeight={800} textAnchor="middle">
        L
      </text>
      {/* a cold front: line with triangles */}
      <path d={`M${W * 0.18},${H * 0.2} Q${W * 0.38},${H * 0.45} ${W * 0.3},${H * 0.92}`} stroke="#60a5fa" strokeWidth={3} />
      {Array.from({ length: 7 }, (_, i) => {
        const t = (i + 0.5) / 7;
        const x = (1 - t) ** 2 * W * 0.18 + 2 * (1 - t) * t * W * 0.38 + t * t * W * 0.3;
        const y = (1 - t) ** 2 * H * 0.2 + 2 * (1 - t) * t * H * 0.45 + t * t * H * 0.92;
        return <path key={i} d={`M${x - 10},${y} L${x + 14},${y - 4} L${x},${y + 16}Z`} fill="#60a5fa" stroke="none" />;
      })}
    </g>
  );
}

/** Lotus-and-bud frieze: alternating open lotus and bud between banded registers. */
function Frieze({ l }: { l: WorldLayer }) {
  const gold = str(l, "color", "#e8b04a"), blue = str(l, "blue", "#1d4ed8");
  const band = (y: number, flip: boolean) => {
    const unit = 64;
    const items = Math.ceil(W / unit) + 1;
    return (
      <g transform={flip ? `translate(0 ${y}) scale(1 -1)` : `translate(0 ${y})`}>
        <rect x={0} y={-6} width={W} height={6} fill={gold} />
        {Array.from({ length: Math.ceil(W / 24) }, (_, i) => (
          <rect key={i} x={i * 24} y={0} width={12} height={8} fill={i % 2 ? blue : "#b91c1c"} />
        ))}
        <rect x={0} y={8} width={W} height={3} fill={gold} />
        {Array.from({ length: items }, (_, i) => {
          const x = i * unit + unit / 2;
          return i % 2 === 0 ? (
            <g key={i} transform={`translate(${x} 11)`}>
              <path d="M0,0 L-4,34 L4,34Z" fill={gold} />
              <path d="M0,34 C-22,30 -26,52 -20,64 C-12,52 -6,46 0,44 C6,46 12,52 20,64 C26,52 22,30 0,34Z" fill={blue} stroke={gold} strokeWidth={1.5} />
              <path d="M0,40 C-6,50 -6,60 0,70 C6,60 6,50 0,40Z" fill={gold} />
            </g>
          ) : (
            <g key={i} transform={`translate(${x} 11)`}>
              <path d="M0,0 L-3,28 L3,28Z" fill={gold} />
              <path d="M0,28 C-11,32 -11,50 0,58 C11,50 11,32 0,28Z" fill="#0f766e" stroke={gold} strokeWidth={1.5} />
            </g>
          );
        })}
        {Array.from({ length: items }, (_, i) => (
          <path key={i} d={`M${i * unit},84 Q${i * unit + unit / 2},72 ${(i + 1) * unit},84`} fill="none" stroke={gold} strokeWidth={2} />
        ))}
      </g>
    );
  };
  return (
    <g>
      {band(0, false)}
      {band(H, true)}
    </g>
  );
}

function Halftone({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#111827"), s = num(l, "size", 7);
  return (
    <g>
      <defs>
        <pattern id={`ht-${l.id}`} width={s * 2} height={s * 2} patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
          <circle cx={s} cy={s} r={s * 0.55} fill={c} />
        </pattern>
        <radialGradient id={`htm-${l.id}`} cx="80%" cy="15%" r="90%">
          <stop offset="0" stopColor="#fff" stopOpacity={0} />
          <stop offset="0.55" stopColor="#fff" stopOpacity={0.15} />
          <stop offset="1" stopColor="#fff" stopOpacity={1} />
        </radialGradient>
        <mask id={`htk-${l.id}`}>
          <rect width={W} height={H} fill={`url(#htm-${l.id})`} />
        </mask>
      </defs>
      <rect width={W} height={H} fill={`url(#ht-${l.id})`} mask={`url(#htk-${l.id})`} />
    </g>
  );
}

function ComicBurst({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#facc15"), ink = str(l, "ink", "#111827");
  const star = (cx: number, cy: number, r: number, spikes: number, seed: number) => {
    const rr = rng(seed);
    const pts = Array.from({ length: spikes * 2 }, (_, i) => {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const k = i % 2 ? 0.55 + rr() * 0.1 : 1 + rr() * 0.25;
      return `${cx + Math.cos(a) * r * k},${cy + Math.sin(a) * r * k * 0.8}`;
    });
    return pts.join(" ");
  };
  return (
    <g>
      {Array.from({ length: 40 }, (_, i) => {
        const a = (i / 40) * Math.PI * 2;
        return <line key={i} x1={W * 0.18 + Math.cos(a) * 140} y1={H * 0.25 + Math.sin(a) * 110} x2={W * 0.18 + Math.cos(a) * 420} y2={H * 0.25 + Math.sin(a) * 330} stroke={ink} strokeWidth={i % 3 ? 2 : 5} strokeOpacity={0.55} />;
      })}
      <polygon points={star(W * 0.18, H * 0.25, 130, 14, 4)} fill={c} stroke={ink} strokeWidth={7} strokeLinejoin="round" />
      <polygon points={star(W * 0.86, H * 0.72, 90, 11, 9)} fill="#f472b6" stroke={ink} strokeWidth={6} strokeLinejoin="round" />
      <polygon points={star(W * 0.9, H * 0.16, 60, 9, 12)} fill="#22d3ee" stroke={ink} strokeWidth={5} strokeLinejoin="round" />
    </g>
  );
}

/** Hand-drawn ink icons: every stroke is jittered so no two are alike. */
function Doodle({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#1f1b16");
  const shapes = useMemo(() => {
    const r = rng(55);
    const wob = (pts: Array<[number, number]>, amt = 2.2) => {
      const p = pts.map(([x, y]) => [x + (r() - 0.5) * amt, y + (r() - 0.5) * amt]);
      return `M${p[0][0]},${p[0][1]}` + p.slice(1).map((q, i) => ` Q${(p[i][0] + q[0]) / 2 + (r() - 0.5) * amt},${(p[i][1] + q[1]) / 2 + (r() - 0.5) * amt} ${q[0]},${q[1]}`).join("");
    };
    const icon = (kind: number, s: number): string[] => {
      switch (kind) {
        case 0: // star
          return [wob(Array.from({ length: 11 }, (_, i) => { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const k = i % 2 ? 0.45 : 1; return [Math.cos(a) * s * k, Math.sin(a) * s * k] as [number, number]; }))];
        case 1: // spiral
          return [wob(Array.from({ length: 40 }, (_, i) => { const a = i * 0.45; const k = (i / 40) * s; return [Math.cos(a) * k, Math.sin(a) * k] as [number, number]; }), 1.2)];
        case 2: // arrow
          return [wob([[-s, s * 0.4], [-s * 0.2, -s * 0.1], [s * 0.3, s * 0.2], [s, -s * 0.5]]), wob([[s * 0.55, -s * 0.55], [s, -s * 0.5], [s * 0.9, -s * 0.05]])];
        case 3: // cloud
          return [wob(Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; const k = 1 + 0.25 * Math.sin(a * 5); return [Math.cos(a) * s * k, Math.sin(a) * s * 0.6 * k] as [number, number]; }))];
        case 4: // ringed planet
          return [wob(Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return [Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6] as [number, number]; })), wob(Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return [Math.cos(a) * s * 1.2, Math.sin(a) * s * 0.3] as [number, number]; }))];
        case 5: // lightning
          return [wob([[-s * 0.2, -s], [s * 0.3, -s * 0.1], [-s * 0.1, -s * 0.05], [s * 0.2, s]], 1.5)];
        case 6: // heart
          return [wob(Array.from({ length: 30 }, (_, i) => { const t = (i / 29) * Math.PI * 2; return [16 * Math.sin(t) ** 3 * s / 17, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * s / 17] as [number, number]; }))];
        case 7: // eye
          return [wob([[-s, 0], [0, -s * 0.55], [s, 0], [0, s * 0.55], [-s, 0]]), wob(Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return [Math.cos(a) * s * 0.25, Math.sin(a) * s * 0.25] as [number, number]; }))];
        default: // squiggle
          return [wob(Array.from({ length: 12 }, (_, i) => [(i / 11 - 0.5) * s * 2, Math.sin(i * 1.4) * s * 0.3] as [number, number]))];
      }
    };
    const out: Array<{ x: number; y: number; rot: number; paths: string[]; w: number }> = [];
    const count = Math.round(70 * num(l, "density", 1));
    for (let i = 0; i < count; i++) {
      const s = 18 + r() * 34;
      out.push({ x: r() * W, y: r() * H, rot: (r() - 0.5) * 50, paths: icon(Math.floor(r() * 9), s), w: 2 + r() * 1.8 });
    }
    return out;
  }, [l]);
  return (
    <g fill="none" stroke={c} strokeLinecap="round" strokeLinejoin="round">
      {shapes.map((s, i) => (
        <g key={i} transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} className={i % 5 === 0 ? "w2-wiggle" : undefined}>
          {s.paths.map((d, j) => (
            <path key={j} d={d} strokeWidth={s.w} />
          ))}
        </g>
      ))}
    </g>
  );
}

function Circuit({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#38bdf8");
  const traces = useMemo(() => {
    const r = rng(66);
    return Array.from({ length: 46 }, () => {
      let x = Math.round((r() * W) / 20) * 20, y = Math.round((r() * H) / 20) * 20;
      const pts: Array<[number, number]> = [[x, y]];
      for (let k = 0; k < 4; k++) {
        if (k % 2 === 0) x += (r() > 0.5 ? 1 : -1) * (40 + Math.round(r() * 8) * 20);
        else y += (r() > 0.5 ? 1 : -1) * (40 + Math.round(r() * 6) * 20);
        pts.push([x, y]);
      }
      return pts;
    });
  }, []);
  return (
    <g fill="none" stroke={c}>
      {traces.map((pts, i) => (
        <g key={i}>
          <polyline points={pts.map((p) => p.join(",")).join(" ")} strokeWidth={2} strokeOpacity={0.7} />
          <circle cx={pts[0][0]} cy={pts[0][1]} r={5} fill={c} fillOpacity={0.6} />
          <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={6} strokeWidth={2} />
          <circle r={3} fill="#fff">
            <animateMotion dur={`${3 + (i % 5)}s`} repeatCount="indefinite" path={`M${pts.map((p) => p.join(",")).join("L")}`} />
          </circle>
        </g>
      ))}
    </g>
  );
}

function HudRings({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#67e8f9");
  const cx = W / 2, cy = H * 0.5;
  return (
    <g fill="none" stroke={c}>
      {[380, 330, 270, 200].map((r, i) => (
        <circle key={r} cx={cx} cy={cy} r={r} strokeWidth={i === 0 ? 2 : 1.2} strokeDasharray={i % 2 ? "4 10" : i === 2 ? "80 20 10 20" : undefined} className={i % 2 ? "w2-spin" : "w2-spin-rev"} style={{ transformOrigin: `${cx}px ${cy}px`, animationDuration: `${30 + i * 12}s` }} strokeOpacity={0.8} />
      ))}
      {Array.from({ length: 120 }, (_, i) => {
        const a = (i / 120) * Math.PI * 2;
        return <line key={i} x1={cx + Math.cos(a) * 380} y1={cy + Math.sin(a) * 380} x2={cx + Math.cos(a) * (i % 10 ? 372 : 360)} y2={cy + Math.sin(a) * (i % 10 ? 372 : 360)} strokeWidth={1.2} />;
      })}
      {/* side gauges */}
      {[[W * 0.12, H * 0.3, 0.72], [W * 0.88, H * 0.3, 0.41], [W * 0.12, H * 0.74, 0.58], [W * 0.88, H * 0.74, 0.86]].map(([x, y, v], i) => {
        const r = 64;
        const a0 = Math.PI * 0.75, a1 = a0 + Math.PI * 1.5 * v;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={r} strokeOpacity={0.35} strokeWidth={6} />
            <path d={`M${x + Math.cos(a0) * r},${y + Math.sin(a0) * r} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x + Math.cos(a1) * r},${y + Math.sin(a1) * r}`} strokeWidth={6} strokeLinecap="round" />
            <text x={x} y={y + 8} fill={c} stroke="none" fontSize={24} textAnchor="middle" style={{ fontFamily: "ui-monospace, monospace" }}>
              {Math.round(v * 100)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function FlowerOfLife({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#f5c46b");
  const cx = W / 2, cy = H / 2, r = 90;
  const centres: Array<[number, number]> = [[0, 0]];
  for (let ring = 1; ring <= 2; ring++)
    for (let k = 0; k < 6; k++)
      for (let s = 0; s < ring; s++) {
        const a = (k / 6) * Math.PI * 2, b = ((k + 2) / 6) * Math.PI * 2;
        centres.push([Math.cos(a) * r * ring + Math.cos(b) * r * s, Math.sin(a) * r * ring + Math.sin(b) * r * s]);
      }
  return (
    <g fill="none" stroke={c} className="w2-spin-slow" style={{ transformOrigin: `${cx}px ${cy}px` }}>
      {centres.map(([x, y], i) => (
        <circle key={i} cx={cx + x} cy={cy + y} r={r} strokeWidth={1.6} strokeOpacity={0.85} />
      ))}
      <circle cx={cx} cy={cy} r={r * 3} strokeWidth={2.4} />
      <circle cx={cx} cy={cy} r={r * 3.12} strokeWidth={1} />
    </g>
  );
}

function Kaleidoscope({ l }: { l: WorldLayer }) {
  const c = str(l, "color", "#e879f9"), folds = Math.max(4, Math.round(num(l, "folds", 10)));
  const cx = W / 2, cy = H / 2;
  const wedge = useMemo(() => {
    const r = rng(19);
    return Array.from({ length: 14 }, () => ({ x: 40 + r() * 460, y: r() * 120, s: 8 + r() * 40, k: Math.floor(r() * 3), h: Math.floor(r() * 360) }));
  }, []);
  return (
    <g className="w2-spin" style={{ transformOrigin: `${cx}px ${cy}px`, animationDuration: "120s" }}>
      {Array.from({ length: folds }, (_, f) => (
        <g key={f} transform={`translate(${cx} ${cy}) rotate(${(360 / folds) * f}) ${f % 2 ? "scale(1 -1)" : ""}`}>
          {wedge.map((s, i) =>
            s.k === 0 ? (
              <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="none" stroke={c} strokeWidth={2} />
            ) : s.k === 1 ? (
              <rect key={i} x={s.x} y={s.y} width={s.s} height={s.s} fill={`hsl(${s.h} 90% 65% / .35)`} transform={`rotate(45 ${s.x} ${s.y})`} />
            ) : (
              <path key={i} d={`M${s.x},${s.y} l${s.s},${s.s / 2} l-${s.s},${s.s / 2}z`} fill={`hsl(${s.h} 90% 70% / .3)`} stroke={c} strokeWidth={1} />
            ),
          )}
        </g>
      ))}
    </g>
  );
}

/** Falling columns of an original glyph set (canvas: hundreds of glyphs per frame). */
function GlyphRain({ l, paused }: { l: WorldLayer; paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const color = str(l, "color", "#22c55e"), cols = Math.round(num(l, "columns", 48));
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d")!;
    const glyphs = "⟁⟐⟒⟟⌬⌖⍜⍟⎔⏃⏚⏁◬◭◮⧫⧖⧗ϟ".split("");
    const r = rng(2);
    const drops = Array.from({ length: cols }, () => r() * -40);
    let raf = 0, last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 70) return;
      last = t;
      const w = (cv.width = cv.clientWidth), h = (cv.height = cv.clientHeight);
      const cw = w / cols, size = Math.max(12, cw * 0.8);
      g.font = `${size}px ui-monospace, monospace`;
      drops.forEach((d, i) => {
        for (let k = 0; k < 22; k++) {
          const y = (d - k) * size;
          if (y < -size || y > h + size) continue;
          g.fillStyle = k === 0 ? "#eafff0" : color;
          g.globalAlpha = k === 0 ? 1 : Math.max(0, 1 - k / 22) * 0.85;
          g.fillText(glyphs[(i * 7 + Math.floor(d) + k * 3) % glyphs.length], i * cw, y);
        }
        drops[i] = d * size > h + 22 * size ? r() * -10 : d + 0.35 + (i % 3) * 0.1;
      });
    };
    if (!paused) raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [color, cols, paused]);
  return <canvas ref={ref} className="w2-canvas" />;
}

const PACKS: Record<string, (p: { l: WorldLayer }) => React.ReactElement> = {
  "zodiac-wheel": ZodiacWheel,
  constellations: Constellations,
  contours: Contours,
  isobars: Isobars,
  frieze: Frieze,
  halftone: Halftone,
  "comic-burst": ComicBurst,
  doodle: Doodle,
  circuit: Circuit,
  "hud-rings": HudRings,
  "flower-of-life": FlowerOfLife,
  kaleidoscope: Kaleidoscope,
};

function World2DImpl({ world, paused }: { world: WorldConfig; paused: boolean }) {
  const layers = layersOf(world, "graphics2d");
  return (
    <div className="w2" data-world-2d={layers.map((l) => l.kind).join(" ")} data-paused={paused ? "true" : "false"}>
      {layers.map((l) => {
        if (l.kind === "glyph-rain")
          return (
            <div key={l.id} className="w2-layer" style={{ opacity: l.opacity }} data-layer={l.id}>
              <GlyphRain l={l} paused={paused} />
            </div>
          );
        const Pack = PACKS[l.kind];
        if (!Pack) return null;
        const t = l.transform;
        return (
          <svg key={l.id} className="w2-layer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={{ opacity: l.opacity, transform: `translate(${t.x}%, ${t.y}%) scale(${t.scale}) rotate(${t.rotation}deg)` }} data-layer={l.id} aria-hidden>
            <Pack l={l} />
          </svg>
        );
      })}
    </div>
  );
}

export const World2D = memo(World2DImpl);
