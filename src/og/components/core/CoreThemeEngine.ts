// Seasonal + time-of-day palette engine. Slowly evolves the Core's palette
// like the sky itself. Purely visual — no side effects.

export type CorePalette = {
  name: string;
  nucleus: [number, number, number]; // hsl
  plasmaA: [number, number, number];
  plasmaB: [number, number, number];
  ring: [number, number, number];
  aura: [number, number, number];
};

const SEASONS: Record<string, CorePalette> = {
  "summer-corona": {
    name: "Summer Corona",
    nucleus: [42, 100, 72],
    plasmaA: [22, 95, 60],
    plasmaB: [340, 85, 62],
    ring: [30, 100, 68],
    aura: [18, 90, 55],
  },
  "autumn-ember": {
    name: "Autumn Ember",
    nucleus: [28, 90, 60],
    plasmaA: [10, 78, 48],
    plasmaB: [285, 60, 45],
    ring: [20, 88, 58],
    aura: [5, 78, 40],
  },
  "winter-nebula": {
    name: "Winter Nebula",
    nucleus: [200, 90, 72],
    plasmaA: [230, 88, 60],
    plasmaB: [280, 78, 55],
    ring: [190, 92, 66],
    aura: [250, 80, 40],
  },
  "spring-aurora": {
    name: "Spring Aurora",
    nucleus: [150, 82, 70],
    plasmaA: [180, 78, 58],
    plasmaB: [330, 78, 68],
    ring: [160, 82, 62],
    aura: [300, 70, 45],
  },
  "midnight-galaxy": {
    name: "Midnight Galaxy",
    nucleus: [270, 90, 72],
    plasmaA: [260, 80, 55],
    plasmaB: [200, 85, 55],
    ring: [285, 88, 65],
    aura: [250, 85, 30],
  },
};

function seasonForDate(d: Date): keyof typeof SEASONS {
  const m = d.getMonth();
  const hour = d.getHours();
  // Late night skews galactic regardless of season
  if (hour >= 23 || hour <= 4) return "midnight-galaxy";
  if (m <= 1 || m === 11) return "winter-nebula";
  if (m <= 4) return "spring-aurora";
  if (m <= 8) return "summer-corona";
  return "autumn-ember";
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpTriple(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function getCurrentPalette(now = new Date(), pinned?: string): CorePalette {
  const base =
    pinned && SEASONS[pinned]
      ? SEASONS[pinned]
      : SEASONS[seasonForDate(now)];
  // Nudge lightness by time of day so the Core breathes with the sky.
  const hour = now.getHours() + now.getMinutes() / 60;
  const dayness = Math.max(0, Math.cos(((hour - 13) / 24) * Math.PI * 2)); // peak at 1pm
  const shift = (v: [number, number, number]): [number, number, number] => [
    v[0],
    v[1],
    Math.max(20, Math.min(85, v[2] + (dayness - 0.5) * 8)),
  ];
  return {
    ...base,
    nucleus: shift(base.nucleus),
    plasmaA: shift(base.plasmaA),
    plasmaB: shift(base.plasmaB),
    ring: shift(base.ring),
    aura: shift(base.aura),
  };
}

export function hsl([h, s, l]: [number, number, number], a = 1) {
  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${a})`;
}

export function blendPalettes(a: CorePalette, b: CorePalette, t: number): CorePalette {
  return {
    name: t < 0.5 ? a.name : b.name,
    nucleus: lerpTriple(a.nucleus, b.nucleus, t),
    plasmaA: lerpTriple(a.plasmaA, b.plasmaA, t),
    plasmaB: lerpTriple(a.plasmaB, b.plasmaB, t),
    ring: lerpTriple(a.ring, b.ring, t),
    aura: lerpTriple(a.aura, b.aura, t),
  };
}

export const SEASON_KEYS = Object.keys(SEASONS) as (keyof typeof SEASONS)[];