/**
 * ==========================================================
 * LÉLUVERSE — PROCEDURAL PLANET TEXTURES
 *
 * Generates Earth-like textures using Canvas2D + noise.
 * Creates ocean, land, clouds, and night-side city lights.
 * ==========================================================
 */

// ── Seeded RNG ──
function mulberry32(a: number) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Simple value noise ──
function createNoise(seed: number) {
  const rng = mulberry32(seed);
  const size = 256;
  const perm: number[] = [];
  for (let i = 0; i < size; i++) perm[i] = i;
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  // Duplicate
  for (let i = 0; i < size; i++) perm[size + i] = perm[i];

  function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a: number, b: number, t: number) { return a + t * (b - a); }
  function grad(hash: number, x: number, y: number) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }

  return function noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v,
    );
  };
}

// ── Fractal Brownian Motion ──
function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 6): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise(x * frequency, y * frequency);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

// ── Generate Earth Surface Texture ──
export function generateEarthSurface(size = 512): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const noise = createNoise(42);
  const noise2 = createNoise(137);
  const noise3 = createNoise(256);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Latitude/longitude to spherical
      const lat = (v - 0.5) * Math.PI;
      const lon = (u - 0.5) * 2 * Math.PI;

      // Noise-based elevation
      const nx = Math.cos(lon) * Math.cos(lat);
      const ny = Math.sin(lat);

      const continent = fbm(noise, nx * 2 + 0.5, ny * 2 + 0.5, 6);
      const detail = fbm(noise2, nx * 8 + 0.3, ny * 8 + 0.3, 4);
      const moisture = fbm(noise3, nx * 3 + 1, ny * 3 + 1, 4);

      // Polar ice
      const polarFactor = Math.abs(Math.sin(lat));
      const isPolar = polarFactor > 0.92;
      const isIce = polarFactor > 0.88;

      // Color based on elevation + moisture
      let r: number, g: number, b: number;

      if (isPolar) {
        // Snow/ice
        r = 230 + detail * 25;
        g = 235 + detail * 20;
        b = 240 + detail * 15;
      } else if (continent > 0.05) {
        // Land
        const elev = continent + detail * 0.15;
        if (elev > 0.25) {
          // Mountains
          r = 140 + elev * 60;
          g = 120 + elev * 40;
          b = 90 + elev * 30;
        } else if (moisture > 0.1) {
          // Forest
          r = 30 + elev * 40;
          g = 80 + elev * 60 + moisture * 30;
          b = 20 + elev * 20;
        } else if (moisture < -0.1) {
          // Desert
          r = 180 + elev * 40;
          g = 160 + elev * 30;
          b = 100 + elev * 20;
        } else {
          // Plains
          r = 60 + elev * 50;
          g = 100 + elev * 50 + moisture * 20;
          b = 30 + elev * 30;
        }
        if (isIce) {
          // Tundra blend
          const blend = (polarFactor - 0.88) / 0.04;
          r = r * (1 - blend) + 200 * blend;
          g = g * (1 - blend) + 210 * blend;
          b = b * (1 - blend) + 220 * blend;
        }
      } else {
        // Ocean
        const depth = -continent;
        if (depth > 0.15) {
          // Deep ocean
          r = 5 + depth * 15;
          g = 25 + depth * 20;
          b = 80 + depth * 30;
        } else {
          // Shallow ocean / coastal
          r = 15 + depth * 20;
          g = 60 + depth * 40;
          b = 120 + depth * 40;
        }
      }

      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

// ── Generate Cloud Texture ──
export function generateCloudTexture(size = 512): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const noise = createNoise(777);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const lat = (v - 0.5) * Math.PI;
      const lon = (u - 0.5) * 2 * Math.PI;
      const nx = Math.cos(lon) * Math.cos(lat);
      const ny = Math.sin(lat);

      const cloud = fbm(noise, nx * 4 + 0.7, ny * 4 + 0.7, 5);
      const density = Math.max(0, cloud * 1.5 - 0.2);

      // Reduce clouds near poles
      const polarFactor = Math.abs(Math.sin(lat));
      const polarReduction = polarFactor > 0.85 ? (1 - (polarFactor - 0.85) / 0.15) : 1;

      const alpha = Math.min(1, density * polarReduction);
      const brightness = Math.round(220 + density * 35);

      ctx.fillStyle = `rgba(${brightness},${brightness + 5},${brightness + 10},${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

// ── Generate Night Side City Lights ──
export function generateCityLightsTexture(size = 512): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const noise = createNoise(999);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const lat = (v - 0.5) * Math.PI;
      const lon = (u - 0.5) * 2 * Math.PI;
      const nx = Math.cos(lon) * Math.cos(lat);
      const ny = Math.sin(lat);

      // Cities appear on land, not ocean
      const continent = fbm(noise, nx * 2 + 0.5, ny * 2 + 0.5, 6);
      if (continent < 0.05) continue;

      // City density based on latitude (fewer near poles)
      const latFactor = 1 - Math.abs(Math.sin(lat)) * 0.8;

      // City noise
      const cityNoise = fbm(noise, nx * 12 + 2, ny * 12 + 2, 3);
      if (cityNoise < 0.3) continue;

      const brightness = Math.round(80 + cityNoise * 175);
      const alpha = latFactor * cityNoise * 0.8;

      ctx.fillStyle = `rgba(${brightness},${Math.round(brightness * 0.9)},${Math.round(brightness * 0.6)},${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

// ── Canvas to Three.js Texture ──
export function canvasToTexture(canvas: HTMLCanvasElement): HTMLCanvasElement {
  return canvas;
}
