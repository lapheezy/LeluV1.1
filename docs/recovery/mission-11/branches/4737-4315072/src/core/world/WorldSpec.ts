/**
 * ==========================================================
 * LÉLU — WORLD SPEC
 *
 * The one description of a LÉLUVERSE environment.
 *
 * A room is planned as data before anything is built: a spec says
 * what the space IS (shape, materials, objects, lights, where you
 * may walk). Three consumers read that same spec, so they can
 * never disagree about the room:
 *
 *   RoomBuilder        → geometry in the app (three.js)
 *   LocalBlenderAdapter→ bpy script, for a headless Blender host
 *   WorldMemory        → the saved room and its revisions
 *
 * Everything here is pure and deterministic: the same request and
 * the same seed produce byte-identical specs, which is what makes
 * a generated room reproducible and testable at all.
 * ==========================================================
 */

export type Vec3 = [number, number, number];

export const WORLD_THEMES = ["cosmic-palace", "engineering-lab", "observatory", "garden"] as const;
export type WorldTheme = (typeof WORLD_THEMES)[number];

export type WorldMaterial = {
  id: string;
  name: string;
  /** Linear RGB, 0–1. */
  color: Vec3;
  metalness: number;
  roughness: number;
  emissive?: Vec3;
  /** 1 = opaque. Glass/membrane materials sit below. */
  opacity?: number;
};

export type WorldPrimitiveKind = "box" | "cylinder" | "sphere" | "torus" | "cone" | "ring";

export type WorldRole =
  | "floor"
  | "ceiling"
  | "pillar"
  | "ring"
  | "dais"
  | "seat"
  | "table"
  | "crystal"
  | "plant"
  | "light-fixture"
  | "workstation"
  | "screen"
  | "chamber"
  | "prop";

export type WorldInteractionKind = "sit" | "inspect" | "use" | "read";

export type WorldInteraction = {
  kind: WorldInteractionKind;
  /** What the user is offered, in LÉLU's voice. */
  prompt: string;
};

export type WorldNode = {
  id: string;
  name: string;
  role: WorldRole;
  primitive: WorldPrimitiveKind;
  position: Vec3;
  /** Radians. Rooms are radially symmetric, so this is the only rotation. */
  rotationY: number;
  scale: Vec3;
  material: string;
  interaction?: WorldInteraction;
};

export type WorldLightKind = "ambient" | "hemisphere" | "directional" | "point" | "spot";

export type WorldLight = {
  id: string;
  kind: WorldLightKind;
  color: Vec3;
  intensity: number;
  position: Vec3;
  target?: Vec3;
  distance?: number;
};

export type WorldNav = {
  shape: "circular" | "rectangular";
  /** Walkable radius for a circular room. */
  radius: number;
  halfWidth: number;
  halfDepth: number;
  /** Where the avatar stands on entry, in room space (x, z). */
  spawn: [number, number];
  eyeHeight: number;
  walkSpeed: number;
};

export type WorldSpec = {
  version: 1;
  id: string;
  name: string;
  theme: WorldTheme;
  seed: number;
  createdAt: number;
  /** Named colours the room leans on — shared with the avatar lighting. */
  palette: string[];
  materials: WorldMaterial[];
  nodes: WorldNode[];
  lights: WorldLight[];
  nav: WorldNav;
};

/* ------------------------------------------------------------------ */
/* deterministic randomness                                            */
/* ------------------------------------------------------------------ */

/** mulberry32 — small, fast, and stable across engines. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (random: () => number, min: number, max: number) => min + random() * (max - min);

/* ------------------------------------------------------------------ */
/* materials                                                          */
/* ------------------------------------------------------------------ */

const MATERIAL_LIBRARY: Record<string, WorldMaterial[]> = {
  "cosmic-palace": [
    { id: "marble", name: "Black marble", color: [0.05, 0.04, 0.07], metalness: 0.35, roughness: 0.12 },
    { id: "gold", name: "Brushed gold", color: [0.83, 0.66, 0.32], metalness: 0.95, roughness: 0.22 },
    { id: "violet", name: "Violet light", color: [0.55, 0.28, 0.85], metalness: 0.2, roughness: 0.4, emissive: [0.35, 0.12, 0.65] },
    { id: "rose", name: "Rose glass", color: [0.95, 0.45, 0.72], metalness: 0.1, roughness: 0.25, emissive: [0.6, 0.16, 0.4] },
    { id: "starlight", name: "Star field", color: [0.09, 0.12, 0.22], metalness: 0.1, roughness: 0.9, emissive: [0.16, 0.12, 0.34] },
    { id: "flora", name: "Bioluminescent flora", color: [0.16, 0.5, 0.36], metalness: 0.05, roughness: 0.7, emissive: [0.08, 0.42, 0.3] },
  ],
  "engineering-lab": [
    { id: "marble", name: "Polished concrete", color: [0.12, 0.13, 0.16], metalness: 0.2, roughness: 0.35 },
    { id: "gold", name: "Brass fittings", color: [0.76, 0.6, 0.3], metalness: 0.9, roughness: 0.3 },
    { id: "violet", name: "Status violet", color: [0.4, 0.25, 0.75], metalness: 0.3, roughness: 0.35, emissive: [0.28, 0.12, 0.6] },
    { id: "rose", name: "Warning rose", color: [0.92, 0.4, 0.55], metalness: 0.2, roughness: 0.4, emissive: [0.55, 0.15, 0.28] },
    { id: "starlight", name: "Cold steel", color: [0.55, 0.6, 0.7], metalness: 0.85, roughness: 0.28 },
    { id: "flora", name: "Specimen green", color: [0.18, 0.45, 0.3], metalness: 0.05, roughness: 0.8, emissive: [0.06, 0.3, 0.18] },
  ],
  observatory: [
    { id: "marble", name: "Obsidian floor", color: [0.04, 0.05, 0.09], metalness: 0.4, roughness: 0.14 },
    { id: "gold", name: "Instrument gold", color: [0.8, 0.68, 0.35], metalness: 0.92, roughness: 0.24 },
    { id: "violet", name: "Nebula violet", color: [0.45, 0.3, 0.8], metalness: 0.15, roughness: 0.5, emissive: [0.3, 0.16, 0.6] },
    { id: "rose", name: "Aurora rose", color: [0.9, 0.5, 0.7], metalness: 0.1, roughness: 0.35, emissive: [0.5, 0.2, 0.4] },
    { id: "starlight", name: "Deep sky", color: [0.06, 0.08, 0.18], metalness: 0.05, roughness: 0.95, emissive: [0.12, 0.14, 0.32] },
    { id: "flora", name: "Night bloom", color: [0.2, 0.42, 0.4], metalness: 0.05, roughness: 0.75, emissive: [0.1, 0.34, 0.3] },
  ],
  garden: [
    { id: "marble", name: "Warm stone", color: [0.28, 0.25, 0.22], metalness: 0.1, roughness: 0.55 },
    { id: "gold", name: "Sun brass", color: [0.85, 0.69, 0.36], metalness: 0.8, roughness: 0.3 },
    { id: "violet", name: "Wisteria", color: [0.6, 0.42, 0.85], metalness: 0.05, roughness: 0.6, emissive: [0.28, 0.16, 0.5] },
    { id: "rose", name: "Blossom", color: [0.95, 0.6, 0.72], metalness: 0.05, roughness: 0.55, emissive: [0.4, 0.2, 0.3] },
    { id: "starlight", name: "Dusk sky", color: [0.14, 0.16, 0.26], metalness: 0.05, roughness: 0.9, emissive: [0.18, 0.18, 0.34] },
    { id: "flora", name: "Foliage", color: [0.2, 0.5, 0.28], metalness: 0.05, roughness: 0.8, emissive: [0.08, 0.3, 0.14] },
  ],
};

/** Material palette for a theme (fresh copies — a spec owns its materials). */
export function materialsFor(theme: WorldTheme): WorldMaterial[] {
  return (MATERIAL_LIBRARY[theme] ?? MATERIAL_LIBRARY["cosmic-palace"]).map((material) => ({
    ...material,
    color: [...material.color] as Vec3,
    ...(material.emissive ? { emissive: [...material.emissive] as Vec3 } : {}),
  }));
}

const THEME_PALETTE: Record<WorldTheme, string[]> = {
  "cosmic-palace": ["#0b0714", "#8a4fd8", "#e271a8", "#d4a85a", "#3a2a63"],
  "engineering-lab": ["#11141c", "#6b4fd8", "#e2637f", "#b39257", "#2a3040"],
  observatory: ["#05070f", "#6f4fd8", "#d76fa8", "#c9ab63", "#1c2440"],
  garden: ["#201d18", "#9a7fd8", "#e89aae", "#d9ae63", "#2f3b28"],
};

/* ------------------------------------------------------------------ */
/* presets                                                            */
/* ------------------------------------------------------------------ */

const node = (
  id: string,
  name: string,
  role: WorldRole,
  primitive: WorldPrimitiveKind,
  position: Vec3,
  scale: Vec3,
  material: string,
  extra: { rotationY?: number; interaction?: WorldInteraction } = {},
): WorldNode => ({
  id,
  name,
  role,
  primitive,
  position,
  rotationY: extra.rotationY ?? 0,
  scale,
  material,
  ...(extra.interaction ? { interaction: extra.interaction } : {}),
});

/**
 * The cosmic room from the approved reference: a circular hall under a
 * star ceiling, violet/gold light, crystal formations on the perimeter,
 * curved seating around a central dais, botanical ring, illuminated
 * architectural rings overhead.
 */
export function cosmicPalace(seed = 1, now = 0): WorldSpec {
  const random = seededRandom(seed);
  const radius = 11;
  const nodes: WorldNode[] = [
    node("floor", "Marble floor", "floor", "cylinder", [0, -0.15, 0], [radius, 0.3, radius], "marble"),
    node("ceiling", "Cosmic ceiling", "ceiling", "sphere", [0, 9, 0], [radius * 1.05, 7.5, radius * 1.05], "starlight"),
    node("dais", "Central dais", "dais", "cylinder", [0, 0.18, 0], [2.4, 0.36, 2.4], "gold", {
      interaction: { kind: "use", prompt: "Stand on the dais and speak" },
    }),
  ];

  // 12 perimeter pillars, gold caps.
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    nodes.push(
      node(`pillar-${index}`, `Pillar ${index + 1}`, "pillar", "cylinder", [Math.cos(angle) * 10.4, 3.4, Math.sin(angle) * 10.4], [0.34, 6.8, 0.34], "marble", { rotationY: angle }),
    );
    nodes.push(
      node(`pillar-cap-${index}`, `Pillar crown ${index + 1}`, "ring", "torus", [Math.cos(angle) * 10.4, 6.9, Math.sin(angle) * 10.4], [0.6, 0.28, 0.6], "gold", { rotationY: angle }),
    );
  }

  // Three illuminated architectural rings overhead.
  [4.6, 6.1, 7.4].forEach((height, index) => {
    nodes.push(
      node(`ring-${index}`, `Illuminated ring ${index + 1}`, "ring", "torus", [0, height, 0], [8.6 - index * 1.1, 0.18, 8.6 - index * 1.1], index === 1 ? "rose" : "violet", {
        rotationY: (index / 3) * Math.PI,
      }),
    );
  });

  // Crystal formations, seeded so a room is reproducible.
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2 + range(random, -0.12, 0.12);
    const distance = range(random, 8.1, 9.4);
    const height = range(random, 1.1, 2.4);
    nodes.push(
      node(`crystal-${index}`, `Crystal ${index + 1}`, "crystal", "cone", [Math.cos(angle) * distance, height / 2, Math.sin(angle) * distance], [range(random, 0.4, 0.75), height, range(random, 0.4, 0.75)], index % 3 === 0 ? "rose" : "violet", {
        rotationY: angle,
        interaction: { kind: "inspect", prompt: "Inspect the crystal" },
      }),
    );
  }

  // Curved seating arc facing the dais.
  for (let index = 0; index < 7; index += 1) {
    const angle = -0.9 + (index / 6) * 1.8;
    nodes.push(
      node(`seat-${index}`, `Curved seat ${index + 1}`, "seat", "box", [Math.sin(angle) * 6.2, 0.45, Math.cos(angle) * 6.2], [1.9, 0.9, 0.8], "violet", {
        rotationY: angle,
        interaction: { kind: "sit", prompt: "Sit" },
      }),
    );
  }

  // Two low tables and a botanical ring.
  [ -1.9, 1.9 ].forEach((x, index) => {
    nodes.push(
      node(`table-${index}`, `Low table ${index + 1}`, "table", "cylinder", [x, 0.4, 4.4], [0.9, 0.2, 0.9], "gold", {
        interaction: { kind: "inspect", prompt: "Look at the table" },
      }),
    );
  });
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2 + 0.31;
    nodes.push(
      node(`plant-${index}`, `Planter ${index + 1}`, "plant", "sphere", [Math.cos(angle) * 9.7, 0.55, Math.sin(angle) * 9.7], [0.62, 0.55, 0.62], "flora"),
    );
  }

  const lights: WorldLight[] = [
    { id: "ambient", kind: "ambient", color: [0.24, 0.2, 0.36], intensity: 0.55, position: [0, 6, 0] },
    { id: "hemi", kind: "hemisphere", color: [0.6, 0.4, 0.9], intensity: 0.7, position: [0, 10, 0] },
    { id: "violet-glow", kind: "point", color: [0.6, 0.32, 1], intensity: 22, position: [-6, 4.5, -4], distance: 16 },
    { id: "rose-glow", kind: "point", color: [1, 0.45, 0.7], intensity: 16, position: [5.5, 3.6, 4.5], distance: 14 },
    { id: "gold-key", kind: "directional", color: [1, 0.86, 0.62], intensity: 1.1, position: [4, 12, 6], target: [0, 0, 0] },
  ];

  return {
    version: 1,
    id: `world-cosmic-${seed}`,
    name: "Cosmic Palace",
    theme: "cosmic-palace",
    seed,
    createdAt: now,
    palette: [...THEME_PALETTE["cosmic-palace"]],
    materials: materialsFor("cosmic-palace"),
    nodes,
    lights,
    nav: { shape: "circular", radius: 9.4, halfWidth: 9.4, halfDepth: 9.4, spawn: [0, 7], eyeHeight: 1.62, walkSpeed: 2.8 },
  };
}

function labRoom(seed: number, now: number): WorldSpec {
  const nodes: WorldNode[] = [
    node("floor", "Lab floor", "floor", "box", [0, -0.15, 0], [16, 0.3, 16], "marble"),
    node("ceiling", "Service ceiling", "ceiling", "box", [0, 5.2, 0], [16, 0.3, 16], "starlight"),
    node("dais", "Test platform", "dais", "cylinder", [0, 0.2, 0], [2.1, 0.4, 2.1], "starlight", {
      interaction: { kind: "use", prompt: "Run something on the platform" },
    }),
  ];
  // Four walls with a doorway gap on +z.
  const walls: Array<[number, number, number, number]> = [
    [0, 2.6, -8, 0],
    [-8, 2.6, 0, Math.PI / 2],
    [8, 2.6, 0, Math.PI / 2],
  ];
  walls.forEach(([x, y, z, rotationY], index) => {
    nodes.push(node(`wall-${index}`, `Wall ${index + 1}`, "pillar", "box", [x, y, z], [16, 5.2, 0.3], "marble", { rotationY }));
  });
  // Two workstation benches with screens.
  [-4.6, 4.6].forEach((x, index) => {
    nodes.push(
      node(`workstation-${index}`, `Workbench ${index + 1}`, "workstation", "box", [x, 0.9, -5.4], [3.4, 0.16, 1.2], "gold", {
        interaction: { kind: "use", prompt: "Work at the bench" },
      }),
    );
    nodes.push(
      node(`screen-${index}`, `Visualisation screen ${index + 1}`, "screen", "box", [x, 2.2, -7.5], [3, 1.7, 0.12], "violet", {
        interaction: { kind: "read", prompt: "Read the screen" },
      }),
    );
  });
  nodes.push(node("chamber", "Simulation chamber", "chamber", "cylinder", [0, 1.9, -3.2], [1.8, 3.8, 1.8], "rose", {
    interaction: { kind: "use", prompt: "Enter the simulation" },
  }));
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    nodes.push(node(`crystal-${index}`, `Sample ${index + 1}`, "crystal", "cone", [Math.cos(angle) * 6.4, 0.7, Math.sin(angle) * 5.2], [0.35, 1.4, 0.35], "violet"));
  }
  const lights: WorldLight[] = [
    { id: "ambient", kind: "ambient", color: [0.2, 0.22, 0.3], intensity: 0.6, position: [0, 4, 0] },
    { id: "hemi", kind: "hemisphere", color: [0.5, 0.55, 0.8], intensity: 0.5, position: [0, 6, 0] },
    { id: "work", kind: "point", color: [0.8, 0.9, 1], intensity: 18, position: [0, 4.2, -5], distance: 14 },
    { id: "accent", kind: "point", color: [0.7, 0.35, 1], intensity: 12, position: [-5, 3, 3], distance: 12 },
    { id: "key", kind: "directional", color: [1, 0.94, 0.86], intensity: 0.9, position: [5, 9, 7], target: [0, 0, 0] },
  ];
  return {
    version: 1,
    id: `world-lab-${seed}`,
    name: "Engineering Laboratory",
    theme: "engineering-lab",
    seed,
    createdAt: now,
    palette: [...THEME_PALETTE["engineering-lab"]],
    materials: materialsFor("engineering-lab"),
    nodes,
    lights,
    nav: { shape: "rectangular", radius: 9, halfWidth: 7.4, halfDepth: 7.4, spawn: [0, 5.6], eyeHeight: 1.62, walkSpeed: 3 },
  };
}

function gardenRoom(seed: number, now: number): WorldSpec {
  const random = seededRandom(seed);
  const nodes: WorldNode[] = [
    node("floor", "Moss floor", "floor", "cylinder", [0, -0.15, 0], [10, 0.3, 10], "flora"),
    node("dais", "Stone dais", "dais", "cylinder", [0, 0.15, 0], [1.8, 0.3, 1.8], "marble", {
      interaction: { kind: "use", prompt: "Stand on the dais" },
    }),
  ];
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    const distance = range(random, 5, 8.6);
    nodes.push(
      node(`tree-${index}`, `Tree ${index + 1}`, "plant", "cone", [Math.cos(angle) * distance, range(random, 1.4, 2.4), Math.sin(angle) * distance], [range(random, 0.7, 1.3), range(random, 2.6, 4.4), range(random, 0.7, 1.3)], "flora"),
    );
  }
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + 0.2;
    nodes.push(
      node(`blossom-${index}`, `Blossom ${index + 1}`, "prop", "sphere", [Math.cos(angle) * 4.6, 0.5, Math.sin(angle) * 4.6], [0.5, 0.5, 0.5], "rose"),
    );
  }
  const lights: WorldLight[] = [
    { id: "ambient", kind: "ambient", color: [0.3, 0.3, 0.24], intensity: 0.7, position: [0, 5, 0] },
    { id: "sun", kind: "directional", color: [1, 0.9, 0.7], intensity: 1.4, position: [6, 10, 4], target: [0, 0, 0] },
    { id: "violet", kind: "point", color: [0.7, 0.5, 1], intensity: 8, position: [-4, 2.4, -3], distance: 10 },
  ];
  return {
    version: 1,
    id: `world-garden-${seed}`,
    name: "Memory Garden",
    theme: "garden",
    seed,
    createdAt: now,
    palette: [...THEME_PALETTE.garden],
    materials: materialsFor("garden"),
    nodes,
    lights,
    nav: { shape: "circular", radius: 9.2, halfWidth: 9.2, halfDepth: 9.2, spawn: [0, 5.4], eyeHeight: 1.62, walkSpeed: 2.4 },
  };
}

function observatoryRoom(seed: number, now: number): WorldSpec {
  const base = cosmicPalace(seed, now);
  return {
    ...base,
    id: `world-observatory-${seed}`,
    name: "Observatory",
    theme: "observatory",
    palette: [...THEME_PALETTE.observatory],
    materials: materialsFor("observatory"),
    nodes: base.nodes.filter((entry) => entry.role !== "seat"),
    lights: [
      ...base.lights,
      { id: "scope", kind: "spot", color: [0.8, 0.9, 1], intensity: 16, position: [0, 8.5, 0], target: [0, 0, 0], distance: 20 },
    ],
  };
}

/** Every theme's preset, seeded and timestamped the same way. */
export function presetFor(theme: WorldTheme, seed = 1, now = 0): WorldSpec {
  switch (theme) {
    case "engineering-lab":
      return labRoom(seed, now);
    case "garden":
      return gardenRoom(seed, now);
    case "observatory":
      return observatoryRoom(seed, now);
    case "cosmic-palace":
    default:
      return cosmicPalace(seed, now);
  }
}

/* ------------------------------------------------------------------ */
/* request → plan                                                     */
/* ------------------------------------------------------------------ */

const THEME_KEYWORDS: Array<{ theme: WorldTheme; words: RegExp }> = [
  { theme: "engineering-lab", words: /lab|laboratory|workshop|workbench|simulation|engineering|sandbox|factory/i },
  { theme: "garden", words: /garden|forest|flora|botanic|greenhouse|meadow|park\b/i },
  { theme: "observatory", words: /observatory|telescope|stargaz|planetarium|astronom/i },
  { theme: "cosmic-palace", words: /cosmic|palace|throne|nebula|temple|shrine|sanctum/i },
];

export function themeFor(request: string): WorldTheme {
  for (const entry of THEME_KEYWORDS) {
    if (entry.words.test(request)) return entry.theme;
  }
  return "cosmic-palace";
}

function sentenceCase(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Untitled room";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** "Create an engineering laboratory" → "Engineering laboratory". */
export function nameFromRequest(request: string, theme: WorldTheme): string {
  const cleaned = request
    .replace(/^\s*(please\s+)?(can you\s+|could you\s+)?/i, "")
    .replace(/^\s*(create|build|make|generate|design|construct|add|open)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .replace(/\b(room|space|environment|level|scene)\b/gi, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
  if (cleaned.length >= 3 && cleaned.length <= 48) return sentenceCase(cleaned);
  return sentenceCase(presetFor(theme).name);
}

export type WorldPlan = {
  spec: WorldSpec;
  /** Human-readable record of what the planner did, for chat transparency. */
  changes: string[];
};

/**
 * Turn a request into a spec. Deterministic: the same request + seed always
 * yields the same room, so a saved room and a regenerated one agree.
 *
 * This is deliberately a planner, not an LLM call — the LLM's job upstream is
 * to decide *what* to ask for; this decides *how* it is built, and it must be
 * reproducible and testable.
 */
export function planWorld(
  request: string,
  options: { seed?: number; now?: number; base?: WorldSpec } = {},
): WorldPlan {
  const seed = options.seed ?? 1;
  const now = options.now ?? 0;
  const theme = options.base?.theme ?? themeFor(request);
  const spec = options.base ? cloneSpec(options.base) : presetFor(theme, seed, now);
  const changes: string[] = [];

  if (!options.base) {
    changes.push(`Chose the ${theme} layout`);
  }
  const name = nameFromRequest(request, theme);
  if (name !== spec.name) {
    changes.push(`Named it “${name}”`);
    spec.name = name;
  }

  /* ---- additions the request asks for ---- */
  const additions: Array<{ test: RegExp; add: (target: WorldSpec) => string }> = [
    {
      test: /simulation chamber|simulator|holodeck/i,
      add: (target) => {
        if (target.nodes.some((entry) => entry.role === "chamber")) return "Simulation chamber already present";
        target.nodes.push(
          node(`chamber-${target.nodes.length}`, "Simulation chamber", "chamber", "cylinder", [3.6, 1.9, -2.4], [1.5, 3.8, 1.5], "rose", {
            interaction: { kind: "use", prompt: "Enter the simulation" },
          }),
        );
        return "Added a simulation chamber";
      },
    },
    {
      test: /visuali[sz]ation wall|display wall|screens?\b/i,
      add: (target) => {
        const count = target.nodes.filter((entry) => entry.role === "screen").length;
        target.nodes.push(
          node(`screen-${count}`, `Visualisation wall ${count + 1}`, "screen", "box", [0, 2.4, -6.8], [6, 2.4, 0.12], "violet", {
            interaction: { kind: "read", prompt: "Read the wall" },
          }),
        );
        return "Added a visualisation wall";
      },
    },
    {
      test: /workbench|bench|workstation|desk/i,
      add: (target) => {
        const count = target.nodes.filter((entry) => entry.role === "workstation").length;
        target.nodes.push(
          node(`workstation-${count}`, `Workbench ${count + 1}`, "workstation", "box", [-3.6, 0.9, -4.6], [3, 0.16, 1.1], "gold", {
            interaction: { kind: "use", prompt: "Work at the bench" },
          }),
        );
        return "Added a workbench";
      },
    },
    {
      test: /crystal/i,
      add: (target) => {
        const count = target.nodes.filter((entry) => entry.role === "crystal").length;
        for (let index = 0; index < 4; index += 1) {
          const angle = (index / 4) * Math.PI * 2;
          target.nodes.push(
            node(`crystal-extra-${count + index}`, `Crystal ${count + index + 1}`, "crystal", "cone", [Math.cos(angle) * 3.2, 0.8, Math.sin(angle) * 3.2], [0.4, 1.6, 0.4], "violet", {
              interaction: { kind: "inspect", prompt: "Inspect the crystal" },
            }),
          );
        }
        return "Added crystal formations";
      },
    },
    {
      test: /seat|chair|sofa|couch|gather/i,
      add: (target) => {
        if (target.nodes.some((entry) => entry.role === "seat")) return "Seating already present";
        for (let index = 0; index < 6; index += 1) {
          const angle = (index / 6) * Math.PI * 2;
          target.nodes.push(
            node(`seat-extra-${index}`, `Seat ${index + 1}`, "seat", "box", [Math.cos(angle) * 5.4, 0.45, Math.sin(angle) * 5.4], [1.7, 0.9, 0.8], "violet", {
              rotationY: angle,
              interaction: { kind: "sit", prompt: "Sit" },
            }),
          );
        }
        return "Added curved seating";
      },
    },
    {
      test: /plant|tree|garden|flora|green/i,
      add: (target) => {
        if (target.nodes.filter((entry) => entry.role === "plant").length >= 6) return "Botanical ring already present";
        for (let index = 0; index < 6; index += 1) {
          const angle = (index / 6) * Math.PI * 2;
          target.nodes.push(
            node(`plant-extra-${index}`, `Planter ${index + 1}`, "plant", "sphere", [Math.cos(angle) * 7.2, 0.6, Math.sin(angle) * 7.2], [0.6, 0.6, 0.6], "flora"),
          );
        }
        return "Added botanicals";
      },
    },
  ];

  for (const addition of additions) {
    if (addition.test.test(request)) changes.push(addition.add(spec));
  }

  /* ---- resizing: "expand … by N", "bigger", "smaller" ---- */
  const expand = request.match(/expand[^.]*?\bby\s+(\d+(?:\.\d+)?)\s*(m|meters?|metres?)?/i);
  if (expand) {
    const metres = Number(expand[1]);
    resizeRoom(spec, metres);
    changes.push(`Expanded the room by ${metres}m`);
  } else if (/\bexpand\b|\bbigger\b|\blarger\b/i.test(request)) {
    resizeRoom(spec, 2);
    changes.push("Expanded the room by 2m");
  } else if (/\bshrink\b|\bsmaller\b|\btighter\b/i.test(request)) {
    resizeRoom(spec, -1.5);
    changes.push("Shrank the room by 1.5m");
  }

  /* ---- moving an existing object ---- */
  const move = request.match(/move\s+(?:the\s+)?([a-z0-9 ]{3,32}?)\s+(?:to\s+(?:the\s+)?)?(left|right|centre|center|back|front)/i);
  if (move) {
    const wanted = move[1].trim().toLowerCase();
    const target = spec.nodes.find((entry) => entry.name.toLowerCase().includes(wanted) || entry.role === wanted);
    if (target) {
      const [x, y, z] = target.position;
      const radius = Math.max(3, Math.hypot(x, z));
      const angle = Math.atan2(z, x);
      const shift = move[2].toLowerCase();
      const delta = shift === "left" ? -0.6 : shift === "right" ? 0.6 : shift === "front" ? 0.6 : shift === "back" ? -0.6 : 0;
      target.position = [Math.cos(angle + delta) * radius, y, Math.sin(angle + delta) * radius];
      changes.push(`Moved ${target.name.toLowerCase()} ${shift}`);
    } else {
      changes.push(`Could not find “${move[1].trim()}” to move`);
    }
  }

  /* ---- removals ---- */
  const remove = request.match(/remove\s+(?:the\s+)?([a-z0-9 ]{3,32})/i);
  if (remove) {
    const wanted = remove[1].trim().toLowerCase();
    const before = spec.nodes.length;
    spec.nodes = spec.nodes.filter(
      (entry) => !(entry.name.toLowerCase().includes(wanted) || entry.role === wanted) || entry.role === "floor" || entry.role === "ceiling",
    );
    const removed = before - spec.nodes.length;
    changes.push(removed > 0 ? `Removed ${removed} object${removed === 1 ? "" : "s"}` : `Nothing matched “${wanted}”`);
  }

  spec.seed = seed;
  spec.createdAt = now;
  return { spec, changes };
}

/** Grow (or shrink) a room, keeping the walkable area and objects inside it. */
export function resizeRoom(spec: WorldSpec, metres: number): WorldSpec {
  const grow = (value: number) => Math.max(2, value + metres);
  spec.nav.radius = grow(spec.nav.radius);
  spec.nav.halfWidth = grow(spec.nav.halfWidth);
  spec.nav.halfDepth = grow(spec.nav.halfDepth);
  for (const entry of spec.nodes) {
    if (entry.role === "floor" || entry.role === "ceiling") {
      entry.scale = [Math.max(2, entry.scale[0] + metres), entry.scale[1], Math.max(2, entry.scale[2] + metres)];
      continue;
    }
    const [x, y, z] = entry.position;
    const distance = Math.hypot(x, z);
    if (distance < 0.001) continue;
    const scale = Math.max(0.2, (spec.nav.radius - 0.6) / Math.max(0.001, distance + (spec.nav.radius - 0.6 - distance)));
    entry.position = [x * (1 + metres / Math.max(4, distance * 2)), y, z * (1 + metres / Math.max(4, distance * 2))];
    void scale;
  }
  const [sx, sz] = spec.nav.spawn;
  const spawnDistance = Math.hypot(sx, sz) || 1;
  const clamped = Math.max(1, Math.min(spawnDistance, spec.nav.radius - 0.8));
  spec.nav.spawn = [(sx / spawnDistance) * clamped, (sz / spawnDistance) * clamped];
  return spec;
}

export function cloneSpec(spec: WorldSpec): WorldSpec {
  return {
    ...spec,
    palette: [...spec.palette],
    materials: spec.materials.map((material) => ({ ...material, color: [...material.color] as Vec3, ...(material.emissive ? { emissive: [...material.emissive] as Vec3 } : {}) })),
    nodes: spec.nodes.map((entry) => ({ ...entry, position: [...entry.position] as Vec3, scale: [...entry.scale] as Vec3, ...(entry.interaction ? { interaction: { ...entry.interaction } } : {}) })),
    lights: spec.lights.map((light) => ({ ...light, color: [...light.color] as Vec3, position: [...light.position] as Vec3, ...(light.target ? { target: [...light.target] as Vec3 } : {}) })),
    nav: { ...spec.nav, spawn: [...spec.nav.spawn] as [number, number] },
  };
}

/* ------------------------------------------------------------------ */
/* validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Structural problems that would make a room unbuildable. Returns an empty
 * array for a valid spec — callers must not "repair" silently.
 */
export function validateWorld(spec: WorldSpec): string[] {
  const problems: string[] = [];
  const materialIds = new Set(spec.materials.map((material) => material.id));
  const seen = new Set<string>();
  for (const entry of spec.nodes) {
    if (seen.has(entry.id)) problems.push(`Duplicate node id “${entry.id}”`);
    seen.add(entry.id);
    if (!materialIds.has(entry.material)) problems.push(`Node “${entry.id}” uses unknown material “${entry.material}”`);
    if (entry.scale.some((value) => !Number.isFinite(value) || value <= 0)) problems.push(`Node “${entry.id}” has a non-positive scale`);
    if (entry.position.some((value) => !Number.isFinite(value))) problems.push(`Node “${entry.id}” has a non-finite position`);
  }
  if (!spec.nodes.some((entry) => entry.role === "floor")) problems.push("The room has no floor");
  if (spec.lights.length === 0) problems.push("The room has no lights");
  const [spawnX, spawnZ] = spec.nav.spawn;
  if (spec.nav.shape === "circular" && Math.hypot(spawnX, spawnZ) > spec.nav.radius) {
    problems.push("The spawn point is outside the walkable area");
  }
  if (!Number.isFinite(spec.nav.eyeHeight) || spec.nav.eyeHeight <= 0) problems.push("The eye height is not a positive number");
  return problems;
}
