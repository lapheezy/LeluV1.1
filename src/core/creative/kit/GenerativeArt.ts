/**
 * ==========================================================
 * LÉLU — CREATIVE KIT: GENERATIVE ART
 *
 * Procedural artwork computed directly — no model, no network,
 * no image API. A program is { style, seed, palette, size,
 * density, … } and the output is an SVG string: resolution-
 * independent, editable in any vector tool, rasterised to PNG
 * in the browser (Canvas) on export.
 *
 * Styles were chosen to cover distinct visual families rather
 * than variations of one: flow fields, circle packing,
 * ridgelines, constellations, Truchet tiles, branching trees,
 * mosaics, orbital spirographs.
 *
 * Evaluated and not used: p5.js (LGPL-2.1, ~1 MB, needs a DOM
 * canvas for every sketch). This engine is pure TypeScript, so
 * it also runs in a Worker, on the server and in tests.
 * ==========================================================
 */

import { clamp, fbm, noise2D, rng, seedFrom } from "./Rng";

export const GENERATIVE_STYLES = ["flowfield", "circlepack", "ridgelines", "constellation", "truchet", "tree", "mosaic", "orbits"] as const;
export type GenerativeStyle = (typeof GENERATIVE_STYLES)[number];

export const PALETTES: Record<string, { background: string; colors: string[] }> = {
  lelu: { background: "#120e24", colors: ["#d4a94e", "#b98cff", "#f4f0ff", "#7c5cff", "#e879c9"] },
  aurora: { background: "#06131f", colors: ["#2fb8ac", "#7cf5c8", "#4ea5e9", "#a78bfa", "#e0fbfc"] },
  ember: { background: "#1a0b07", colors: ["#e4572e", "#f2a541", "#ffd166", "#9e2a2b", "#fff1e6"] },
  ocean: { background: "#03111f", colors: ["#0b6e99", "#22d3ee", "#a5f3fc", "#155e75", "#e0f2fe"] },
  forest: { background: "#0d1a12", colors: ["#2d6a4f", "#52b788", "#95d5b2", "#d8f3dc", "#8fb339"] },
  noir: { background: "#f5f3ee", colors: ["#111111", "#3a3a3a", "#6b6b6b", "#a0a0a0", "#c4302b"] },
  pastel: { background: "#fbf7f2", colors: ["#f4acb7", "#9d8189", "#ffcad4", "#a0c4ff", "#caffbf"] },
  neon: { background: "#08010f", colors: ["#ff00e5", "#00f0ff", "#faff00", "#7c3aed", "#ff5f1f"] },
};

export interface GenerativeProgram {
  style: GenerativeStyle;
  seed: number;
  width: number;
  height: number;
  /** A PALETTES key, or explicit colours. */
  palette: string;
  colors?: string[];
  background?: string;
  /** 0.1 – 3: how much is drawn. */
  density: number;
  /** Stroke width multiplier, 0.2 – 4. */
  stroke: number;
  /** Optional caption drawn bottom-left. */
  caption?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;

/** Accept a loose request (from a model, a user or the offline compiler) and return a complete program or a reason. */
export function normalizeGenerative(input: unknown): GenerativeProgram | string {
  const v = isObj(input) ? input : {};
  const style = String(v.style ?? "flowfield").toLowerCase().replace(/[^a-z]/g, "") as GenerativeStyle;
  if (!GENERATIVE_STYLES.includes(style)) return `style must be one of ${GENERATIVE_STYLES.join(", ")}`;
  const seed = typeof v.seed === "number" && Number.isFinite(v.seed) ? Math.abs(Math.floor(v.seed)) : seedFrom(String(v.seed ?? v.caption ?? style));
  const width = clamp(Math.round(Number(v.width) || 1200), 64, 4096);
  const height = clamp(Math.round(Number(v.height) || 800), 64, 4096);
  const palette = typeof v.palette === "string" && PALETTES[v.palette.toLowerCase()] ? v.palette.toLowerCase() : "lelu";
  const colors = Array.isArray(v.colors) ? v.colors.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, 12) : undefined;
  const background = typeof v.background === "string" && HEX.test(v.background) ? v.background : undefined;
  return {
    style, seed, width, height, palette,
    colors: colors && colors.length ? colors : undefined,
    background,
    density: clamp(Number(v.density) || 1, 0.1, 3),
    stroke: clamp(Number(v.stroke) || 1, 0.2, 4),
    caption: typeof v.caption === "string" && v.caption.trim() ? v.caption.trim().slice(0, 120) : undefined,
  };
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface GenerativeResult {
  svg: string;
  /** Number of drawn primitives (paths, circles, lines…). */
  elements: number;
}

/** Render a program to SVG. Deterministic: the same program gives byte-identical output. */
export function renderGenerative(program: GenerativeProgram): GenerativeResult {
  const { width: W, height: H, seed, density, stroke } = program;
  const pal = PALETTES[program.palette] ?? PALETTES.lelu;
  const colors = program.colors ?? pal.colors;
  const bg = program.background ?? pal.background;
  const random = rng(seed);
  const pick = () => colors[Math.floor(random() * colors.length)];
  const noise = noise2D(seed ^ 0x9e3779b9);
  const parts: string[] = [];
  const min = Math.min(W, H);

  switch (program.style) {
    case "flowfield": {
      const count = Math.round(420 * density);
      const steps = 70;
      const scale = 0.0025 * (1200 / min);
      for (let p = 0; p < count; p += 1) {
        let x = random() * W;
        let y = random() * H;
        const pts: string[] = [`${f(x)},${f(y)}`];
        for (let s = 0; s < steps; s += 1) {
          const angle = fbm(noise, x * scale, y * scale, 3) * Math.PI * 4;
          x += Math.cos(angle) * (min / 220);
          y += Math.sin(angle) * (min / 220);
          if (x < 0 || y < 0 || x > W || y > H) break;
          pts.push(`${f(x)},${f(y)}`);
        }
        if (pts.length < 4) continue;
        parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${pick()}" stroke-width="${f((0.6 + random() * 1.6) * stroke)}" stroke-linecap="round" stroke-opacity="${f(0.45 + random() * 0.5)}"/>`);
      }
      break;
    }
    case "circlepack": {
      const circles: Array<[number, number, number]> = [];
      const attempts = Math.round(5000 * density);
      const maxR = min / 7;
      for (let i = 0; i < attempts && circles.length < 900 * density; i += 1) {
        const x = random() * W;
        const y = random() * H;
        let r = maxR;
        for (const [cx, cy, cr] of circles) {
          r = Math.min(r, Math.hypot(cx - x, cy - y) - cr - 2);
          if (r < 2) break;
        }
        r = Math.min(r, x, y, W - x, H - y);
        if (r < 2) continue;
        circles.push([x, y, r]);
      }
      for (const [x, y, r] of circles) {
        const filled = random() < 0.55;
        const c = pick();
        parts.push(filled
          ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${c}" fill-opacity="${f(0.55 + random() * 0.45)}"/>`
          : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="none" stroke="${c}" stroke-width="${f(1.5 * stroke)}"/>`);
      }
      break;
    }
    case "ridgelines": {
      const lines = Math.round(46 * density);
      const margin = min * 0.12;
      const gap = (H - margin * 2) / lines;
      for (let l = 0; l < lines; l += 1) {
        const baseY = margin + l * gap;
        const pts: string[] = [];
        for (let x = margin; x <= W - margin; x += 4) {
          const centre = 1 - Math.abs((x - W / 2) / (W / 2 - margin));
          const lift = Math.max(0, fbm(noise, x * 0.01, l * 0.35, 4) + 0.15) * centre * centre * gap * 9;
          pts.push(`${f(x)},${f(baseY - lift)}`);
        }
        parts.push(`<polyline points="${pts.join(" ")}" fill="${bg}" stroke="${colors[l % colors.length]}" stroke-width="${f(1.4 * stroke)}" stroke-linejoin="round"/>`);
      }
      break;
    }
    case "constellation": {
      const n = Math.round(160 * density);
      const pts = Array.from({ length: n }, () => [random() * W, random() * H] as [number, number]);
      const reach = min / 7;
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
          if (d < reach) parts.push(`<line x1="${f(pts[i][0])}" y1="${f(pts[i][1])}" x2="${f(pts[j][0])}" y2="${f(pts[j][1])}" stroke="${colors[(i + j) % colors.length]}" stroke-opacity="${f(1 - d / reach)}" stroke-width="${f(0.8 * stroke)}"/>`);
        }
      }
      for (const [x, y] of pts) {
        const r = 1 + random() * 3.2;
        parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${pick()}"/>`);
      }
      break;
    }
    case "truchet": {
      const cells = Math.round(18 * density);
      const size = Math.max(W, H) / cells;
      for (let gx = 0; gx * size < W; gx += 1) {
        for (let gy = 0; gy * size < H; gy += 1) {
          const x = gx * size;
          const y = gy * size;
          const flip = random() < 0.5;
          const c = colors[(gx + gy) % colors.length];
          const h = size / 2;
          const d = flip
            ? `M${f(x + h)},${f(y)} A${f(h)},${f(h)} 0 0 1 ${f(x)},${f(y + h)} M${f(x + size)},${f(y + h)} A${f(h)},${f(h)} 0 0 0 ${f(x + h)},${f(y + size)}`
            : `M${f(x + h)},${f(y)} A${f(h)},${f(h)} 0 0 0 ${f(x + size)},${f(y + h)} M${f(x)},${f(y + h)} A${f(h)},${f(h)} 0 0 1 ${f(x + h)},${f(y + size)}`;
          parts.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${f(size * 0.16 * stroke)}" stroke-linecap="round"/>`);
        }
      }
      break;
    }
    case "tree": {
      const maxDepth = clamp(Math.round(9 + density * 1.5), 6, 13);
      const branch = (x: number, y: number, len: number, angle: number, depth: number) => {
        if (depth > maxDepth || len < 2 || parts.length > 6000) return;
        const x2 = x + Math.cos(angle) * len;
        const y2 = y + Math.sin(angle) * len;
        const c = colors[Math.min(colors.length - 1, Math.floor((depth / maxDepth) * colors.length))];
        parts.push(`<line x1="${f(x)}" y1="${f(y)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${c}" stroke-width="${f(Math.max(0.6, (maxDepth - depth + 1) * 1.2 * stroke))}" stroke-linecap="round"/>`);
        const kids = random() < 0.2 ? 3 : 2;
        for (let k = 0; k < kids; k += 1) {
          const spread = 0.25 + random() * 0.45;
          const turn = (k - (kids - 1) / 2) * spread * 2 + (random() - 0.5) * 0.2;
          branch(x2, y2, len * (0.68 + random() * 0.12), angle + turn, depth + 1);
        }
        if (depth >= maxDepth - 1 && random() < 0.6) parts.push(`<circle cx="${f(x2)}" cy="${f(y2)}" r="${f(2 + random() * 3)}" fill="${pick()}" fill-opacity="0.85"/>`);
      };
      branch(W / 2, H * 0.96, H * 0.22, -Math.PI / 2, 1);
      break;
    }
    case "mosaic": {
      const cells = Math.round(14 * density);
      const size = Math.max(W, H) / cells;
      const jitter = (gx: number, gy: number): [number, number] => {
        const r = rng(seed + gx * 7919 + gy * 104729);
        return [gx * size + (r() - 0.5) * size * 0.7, gy * size + (r() - 0.5) * size * 0.7];
      };
      for (let gx = 0; gx * size <= W + size; gx += 1) {
        for (let gy = 0; gy * size <= H + size; gy += 1) {
          const a = jitter(gx, gy);
          const b = jitter(gx + 1, gy);
          const c = jitter(gx + 1, gy + 1);
          const d = jitter(gx, gy + 1);
          const tri = random() < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
          for (const t of tri) {
            const shade = fbm(noise, t[0][0] * 0.003, t[0][1] * 0.003);
            const color = colors[Math.floor(clamp((shade + 0.6) / 1.2, 0, 0.999) * colors.length)];
            parts.push(`<polygon points="${t.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="${color}" stroke="${bg}" stroke-width="${f(1.2 * stroke)}"/>`);
          }
        }
      }
      break;
    }
    case "orbits": {
      const rings = Math.round(26 * density);
      const cx = W / 2;
      const cy = H / 2;
      for (let r = 0; r < rings; r += 1) {
        const R = (min * 0.46 * (r + 1)) / rings;
        const lobes = 3 + Math.floor(random() * 7);
        const wobble = R * (0.04 + random() * 0.1);
        const phase = random() * Math.PI * 2;
        const pts: string[] = [];
        for (let i = 0; i <= 240; i += 1) {
          const t = (i / 240) * Math.PI * 2;
          const rr = R + Math.sin(t * lobes + phase) * wobble;
          pts.push(`${f(cx + Math.cos(t) * rr)},${f(cy + Math.sin(t) * rr)}`);
        }
        parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${colors[r % colors.length]}" stroke-width="${f(1.3 * stroke)}" stroke-opacity="${f(0.55 + random() * 0.45)}"/>`);
      }
      break;
    }
  }

  const caption = program.caption
    ? `<text x="${f(min * 0.04)}" y="${f(H - min * 0.04)}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${f(min * 0.028)}" fill="${colors[0]}" fill-opacity="0.9">${esc(program.caption)}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-lelu-generative="${program.style}" data-seed="${seed}"><rect width="${W}" height="${H}" fill="${bg}"/>${parts.join("")}${caption}</svg>`;
  return { svg, elements: parts.length };
}
