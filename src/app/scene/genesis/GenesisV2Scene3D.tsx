/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS V2 — CINEMATIC 3D SCENE
 *
 * The complete Genesis v2 workspace as a real WebGL scene
 * (three.js / react-three-fiber, the same rendering technology
 * the v1 world uses — not CSS circles stacked into fake 3D).
 *
 * Reference-2 composition, from top to bottom:
 *
 *                     GENESIS CORE
 *                Consciousness Engine
 *                       /   |   \
 *          CREATION STUDIO  RESEARCH LAB
 *                       |
 *                  GENESIS VAULT
 *
 * The ONE Genesis Core is the central anchor: a luminous,
 * shader-driven energy body (the shared GenesisCoreMaterial —
 * the same ONE core surface the whole app reads from the
 * EngineBus) with tilted orbital rings, GPU emission particles,
 * electric arcs, ocean ripples and a bright additive bloom.
 * It also carries six per-morphology form layers (storm filaments,
 * aurora veils, ocean currents, plasma cells, electric arcs, bio
 * membrane) driven by the same engine weights, so every evolution
 * version the Core moves through has its own visible 3D form.
 *
 * Around it orbit three real satellite modules — Creation
 * Studio (violet), Research Lab (cyan), Genesis Vault (emerald)
 * — each a luminous wireframe sphere with its own orbit rings,
 * travelling sparks, particle halo and module light. Curved
 * energy beams carry travelling pulses from the Core to each
 * module, and fine threads connect the modules to each other.
 *
 * The environment is deep space: the living star field, the
 * procedural nebula sky and aurora curtains (shared cosmic
 * environment components), plus drifting additive nebula
 * sprites in violet/cyan/magenta so the workspace reads as one
 * immersive cosmic atmosphere.
 *
 * The interface is integrated INTO the environment: labels are
 * DOM overlays anchored to each 3D object (drei Html), so they
 * always track their sphere, and the workspace chrome lives
 * above the canvas in GenesisLab. This scene is mounted ONLY
 * while the v2 workspace owns the viewport (GenesisScene
 * router) — nothing here leaks into Genesis v1.
 * ==========================================================
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, useContextBridge } from "@react-three/drei";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PointsMaterial,
  QuadraticBezierCurve3,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";

import { GenesisContext, useGenesis } from "./GenesisCore";
import GenesisCoreMaterial from "./materials/GenesisCoreMaterial";
import CoreOrbitalRings from "./render/CoreOrbitalRings";
import CoreEmission from "./render/CoreEmission";
import CoreAtmosphere from "./systems/CoreAtmosphere";
import StarField from "./environment/stars/StarField";
import Cosmos from "./environment/Cosmos";

export type V2NodeId = "core" | "studio" | "lab" | "vault";

export interface GenesisV2Scene3DProps {
  /** Interaction energy 0..1 (thinking/speaking/tools) — drives beams. */
  activity: number;
  /** Which module is currently focused/selected. */
  focused: V2NodeId;
  /** Navigate to a module (opens its panel in the v2 chrome). */
  onSelect: (id: V2NodeId) => void;
  /** Optional DOM label block anchored under the Core (reference hierarchy:
   * GENESIS CORE → Consciousness Engine → waveform → Coherence). */
  coreLabel?: ReactNode;
}

/* ------------------------------ constants ------------------------------ */

/*
 * World-space anchors. The camera sits at [0, 0.5, 8.2] with fov 47, so
 * these project to roughly the reference composition on a 16:9 viewport:
 * Core ≈ top-center (30% height), Studio ≈ left (16%), Lab ≈ right (84%),
 * Vault ≈ bottom-center (85%). The satellites' DOM labels are anchored to
 * the 3D objects (drei Html), so they track them at any aspect ratio.
 */
const CORE_POS: [number, number, number] = [0, 2.0, 0];
const STUDIO_POS: [number, number, number] = [-4.5, -1.05, 0];
const LAB_POS: [number, number, number] = [4.5, -1.05, 0];
const VAULT_POS: [number, number, number] = [0, -2.1, 0];

const VIOLET = "#a78bfa";
const MAGENTA = "#e879f9";
const BLUE = "#38bdf8";
const CYAN = "#67e8f9";
const GREEN = "#34d399";

interface SatelliteSeed {
  id: V2NodeId;
  position: [number, number, number];
  color: string;
  glow: string;
  title: string;
  tagline: string;
}

const SATELLITES: SatelliteSeed[] = [
  {
    id: "studio",
    position: STUDIO_POS,
    color: VIOLET,
    glow: MAGENTA,
    title: "Creation Studio",
    tagline: "Design · Build · Manifest",
  },
  {
    id: "lab",
    position: LAB_POS,
    color: BLUE,
    glow: CYAN,
    title: "Research Lab",
    tagline: "Explore · Learn · Discover",
  },
  {
    id: "vault",
    position: VAULT_POS,
    color: GREEN,
    glow: CYAN,
    title: "Genesis Vault",
    tagline: "Memory · Archive · Protect",
  },
];

const BEAMS: Array<{
  to: [number, number, number];
  color: string;
  speed: number;
  phase: number;
}> = [
  { to: STUDIO_POS, color: VIOLET, speed: 0.1, phase: 0.0 },
  { to: LAB_POS, color: BLUE, speed: 0.13, phase: 0.6 },
  { to: VAULT_POS, color: GREEN, speed: 0.09, phase: 1.2 },
];

const THREADS: Array<{
  from: [number, number, number];
  to: [number, number, number];
  color: string;
}> = [
  { from: STUDIO_POS, to: LAB_POS, color: "#7dd3fc" },
  { from: LAB_POS, to: VAULT_POS, color: BLUE },
  { from: VAULT_POS, to: STUDIO_POS, color: GREEN },
];

/* ------------------------------ glow texture --------------------------- */

/** Soft radial glow sprite texture (white → transparent); tint via color. */
function makeGlowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.28, "rgba(255, 255, 255, 0.42)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------ nebula sprites ------------------------- */

function NebulaSprites() {
  const group = useRef<Group>(null);
  const texture = useMemo(makeGlowTexture, []);

  const seeds = useMemo(
    () => [
      { x: -7.2, y: 2.9, z: -4.8, s: 17, c: "#8b5cf6", o: 0.4, d: 0.0 },
      { x: 7.4, y: 2.0, z: -5.4, s: 16, c: "#22d3ee", o: 0.36, d: 2.0 },
      { x: 0.5, y: 5.2, z: -7.0, s: 21, c: "#e879f9", o: 0.32, d: 4.0 },
      { x: -5.2, y: -4.0, z: -4.0, s: 14, c: "#6366f1", o: 0.34, d: 1.2 },
      { x: 5.8, y: -4.4, z: -4.9, s: 15, c: "#34d399", o: 0.28, d: 3.0 },
      { x: -2.4, y: -5.4, z: -5.8, s: 13, c: "#7dd3fc", o: 0.26, d: 5.2 },
      { x: 3.2, y: 5.6, z: -6.2, s: 14, c: "#c084fc", o: 0.28, d: 6.4 },
    ],
    [],
  );

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    if (!group.current) {
      return;
    }
    // The whole nebula field drifts imperceptibly — the cosmos never sits still.
    group.current.rotation.y += delta * 0.004;
    group.current.children.forEach((child, index) => {
      const seed = seeds[index];
      if (!seed) {
        return;
      }
      child.position.x = seed.x + Math.sin(time * 0.03 + seed.d) * 0.5;
      child.position.y = seed.y + Math.cos(time * 0.024 + seed.d) * 0.4;
    });
  });

  return (
    <group ref={group} name="V2Nebula" renderOrder={2}>
      {seeds.map((seed, index) => (
        <sprite key={index} position={[seed.x, seed.y, seed.z]} scale={[seed.s, seed.s, 1]}>
          <spriteMaterial
            map={texture}
            color={seed.c}
            transparent
            opacity={seed.o}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
}

/* ------------------------------ dust field ----------------------------- */

const dustVertexShader = `
  attribute float aSize;
  attribute float aPhase;

  uniform float uTime;

  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.55 + 0.45 * sin(uTime * 0.8 + aPhase);
    vAlpha = 0.22 + 0.38 * tw;
    gl_PointSize = aSize * (300.0 / max(1.0, -mv.z)) * tw;
    gl_Position = projectionMatrix * mv;
  }
`;

const dustFragmentShader = `
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    gl_FragColor = vec4(0.72, 0.85, 1.0, a);
  }
`;

/**
 * A slow-drifting cloud of additive cosmic dust behind the whole scene.
 * Thousands of faint motes give the workspace tangible depth — space
 * reads as a volume, not a flat backdrop.
 */
function DustField() {
  const group = useRef<Group>(null);

  const { geometry, material } = useMemo(() => {
    const count = 420;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 24;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 13;
      positions[index * 3 + 2] = -7 - Math.random() * 8;
      sizes[index] = 0.02 + Math.random() * 0.055;
      phases[index] = Math.random() * Math.PI * 2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: dustVertexShader,
      fragmentShader: dustFragmentShader,
    });
    return { geometry, material };
  }, []);

  useFrame(({ clock }, delta) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y += delta * 0.006;
    }
  });

  return (
    <group ref={group} name="V2DustField" renderOrder={2}>
      <points
        geometry={geometry}
        material={material}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

/* --------------------------- core mote rings --------------------------- */

/**
 * Fine energy motes orbiting the ONE Core on a tilted ring — a swarm of
 * tiny additive points that read as charged particles circling the body
 * (the reference's orbital geometry around the central core).
 */
function CoreMoteRing({
  tilt,
  speed,
  radius = 1.7,
  count = 34,
}: {
  tilt: [number, number, number];
  speed: number;
  radius?: number;
  count?: number;
}) {
  const ring = useRef<Group>(null);

  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const r = radius + Math.random() * 0.45;
      positions[index * 3] = Math.cos(angle) * r;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 0.14;
      positions[index * 3 + 2] = Math.sin(angle) * r;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: "#d7f4ff",
      size: 0.045,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return { geometry, material };
  }, [radius, count]);

  useFrame((_, delta) => {
    if (ring.current) {
      ring.current.rotation.z += delta * speed;
    }
  });

  return (
    <group ref={ring} rotation={tilt} name="V2CoreMotes" renderOrder={204}>
      <points
        geometry={geometry}
        material={material}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

/* --------------------------- morph form layers ------------------------- */

/**
 * The seven evolution forms each bring their own 3D geometry to the ONE
 * Core, so choosing a version in the Core Evolution tab is a real
 * transformation — never just a color crossfade on the same sphere.
 *
 * Every layer is ALWAYS mounted; its opacity / scale is driven by the
 * SAME smoothed engine weights the EngineBus publishes (stateWeights on
 * the ONE CoreVisualState), so the forms melt into each other exactly as
 * the Core morphs, with no popping:
 *
 *   HAZARD     — jagged storm filaments whipping off the surface (electric+plasma)
 *   AURORA     — translucent light veils sweeping the body (halo)
 *   OCEAN      — flowing current streams circling the body (ocean)
 *   PLASMA     — boiling hot energy cells on the surface (plasma)
 *   ELECTRIC   — branching arcs flashing outward (electric)
 *   BIOHAZARD  — organic lattice membrane shells (bio)
 *   HYBRID     — every system at once: its profile weights are all ~0.45,
 *                so all six layers show together as one composite form
 */

const MORPH_FORM_TINTS = {
  storm: "#f87171",
  veil: "#c4b5fd",
  stream: "#38bdf8",
  cell: "#fb923c",
  arc: "#7dd3fc",
  membrane: "#4ade80",
};

/* Pre-allocated tint colors (reused every frame — no per-frame allocation). */
const TINT_STORM = new Color(MORPH_FORM_TINTS.storm);
const TINT_CELL = new Color(MORPH_FORM_TINTS.cell);
const TINT_ARC = new Color(MORPH_FORM_TINTS.arc);

const VEIL_SEEDS = [
  { radius: 1.95, tube: 0.05, tilt: [1.15, 0.3, 0.2] as const, speed: 0.05, phase: 0.0, color: "#c4b5fd" },
  { radius: 2.28, tube: 0.04, tilt: [1.7, -0.4, 0.5] as const, speed: -0.04, phase: 2.1, color: "#e9d5ff" },
  { radius: 1.66, tube: 0.035, tilt: [0.8, 0.9, -0.3] as const, speed: 0.06, phase: 4.2, color: "#a5b4fc" },
];

const STREAM_SEEDS = [
  { radius: 1.52, tilt: [1.35, 0.25, 0.1] as const, count: 14, speed: 0.5, phase: 0.0, color: "#38bdf8" },
  { radius: 1.88, tilt: [1.9, -0.5, 0.55] as const, count: 18, speed: -0.42, phase: 1.5, color: "#22d3ee" },
  { radius: 2.16, tilt: [0.95, 0.8, -0.4] as const, count: 12, speed: 0.34, phase: 3.0, color: "#67e8f9" },
];

const CELL_COUNT = 22;

/** A jagged polyline from `from` toward `to` along `dir`, jittered per segment. */
function jaggedPoints(dir: Vector3, from: number, to: number, jitter: number, seed: number): Vector3[] {
  const points: Vector3[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const t = index / 8;
    const radius = from + (to - from) * t;
    const point = dir.clone().multiplyScalar(radius);
    const decay = 1 - t * 0.75;
    point.x += Math.sin(seed * 7.3 + index * 2.4) * jitter * decay;
    point.y += Math.cos(seed * 5.1 + index * 3.1) * jitter * decay;
    point.z += Math.sin(seed * 6.7 + index * 1.7) * jitter * decay;
    points.push(point);
  }
  return points;
}

function makeAdditiveLine(points: Vector3[], color: string): Line {
  const geometry = new BufferGeometry().setFromPoints(points);
  const material = new LineBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  return new Line(geometry, material);
}

/** A jagged storm filament erupting from the Core surface. */
function makeStormFilament(seed: number): Line {
  const dir = new Vector3(
    Math.cos(seed * 2.7) * Math.sin(seed * 1.3),
    Math.sin(seed * 2.1) + Math.cos(seed * 3.3) * 0.4,
    Math.cos(seed * 1.9) * Math.cos(seed * 1.3),
  ).normalize();
  return makeAdditiveLine(jaggedPoints(dir, 1.12, 1.95, 0.16, seed), MORPH_FORM_TINTS.storm);
}

interface ArcGroup {
  lines: Line[];
  phase: number;
  speed: number;
}

/** A branching electric arc: one main bolt plus two forks peeling off it. */
function makeArcGroup(index: number): ArcGroup {
  const dir = new Vector3(
    Math.cos(index * 2.7) * Math.sin(index * 1.3),
    Math.sin(index * 2.1) * 0.9,
    Math.cos(index * 1.9) * Math.cos(index * 1.3),
  ).normalize();
  const seed = index * 1.7 + 0.5;
  const fork = dir
    .clone()
    .add(new Vector3(Math.cos(index * 5.1) * 0.5, Math.sin(index * 4.3) * 0.5, 0))
    .normalize();
  return {
    lines: [
      makeAdditiveLine(jaggedPoints(dir, 1.12, 1.74, 0.11, seed), index % 2 === 0 ? "#7dd3fc" : "#ffffff"),
      makeAdditiveLine(jaggedPoints(dir, 1.12, 1.32, 0.09, seed + 9), "#9bd8ff"),
      makeAdditiveLine(jaggedPoints(fork, 1.12, 1.26, 0.09, seed + 17), "#d7f4ff"),
    ],
    phase: index * 0.9,
    speed: 1.1 + (index % 3) * 0.35,
  };
}

/**
 * The six morphology form layers wrapped around the ONE Core body. One
 * useFrame reads the same CoreVisualState the surface reads and drives
 * every layer's opacity/scale from its dominant engine weight, so the
 * form follows the morph automatically — in the auto-evolution cycle
 * and when a version is picked in the Core Evolution tab.
 */
function CoreMorphForms() {
  const { engineRuntime } = useGenesis();
  const root = useRef<Group>(null);

  /* HAZARD — storm filaments */
  const storm = useMemo(() => {
    const group = new Group();
    group.name = "V2MorphStorm";
    const items: { line: Line; phase: number; speed: number }[] = [];
    for (let index = 0; index < 8; index += 1) {
      const line = makeStormFilament(index * 1.7 + 0.3);
      group.add(line);
      items.push({ line, phase: index * 0.9, speed: 1.3 + (index % 3) * 0.4 });
    }
    return { group, items };
  }, []);

  /* AURORA — light veils */
  const veils = useMemo(
    () =>
      VEIL_SEEDS.map((seed) => {
        const group = new Group();
        group.name = "V2MorphVeil";
        group.rotation.set(seed.tilt[0], seed.tilt[1], seed.tilt[2]);
        const material = new MeshBasicMaterial({
          color: new Color(seed.color),
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const mesh = new Mesh(new TorusGeometry(seed.radius, seed.tube, 8, 120), material);
        mesh.raycast = () => null;
        group.add(mesh);
        return { group, material, tint: new Color(seed.color), speed: seed.speed, phase: seed.phase };
      }),
    [],
  );

  /* OCEAN — current streams */
  const streams = useMemo(
    () =>
      STREAM_SEEDS.map((seed) => {
        const group = new Group();
        group.name = "V2MorphStream";
        group.rotation.set(seed.tilt[0], seed.tilt[1], seed.tilt[2]);
        const material = new MeshBasicMaterial({
          color: new Color(seed.color),
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const dots: { mesh: Mesh; phase: number }[] = [];
        for (let index = 0; index < seed.count; index += 1) {
          const angle = (index / seed.count) * Math.PI * 2;
          const mesh = new Mesh(new SphereGeometry(0.035, 6, 6), material);
          mesh.position.set(Math.cos(angle) * seed.radius, 0, Math.sin(angle) * seed.radius);
          mesh.raycast = () => null;
          group.add(mesh);
          dots.push({ mesh, phase: index * 0.7 });
        }
        return { group, material, tint: new Color(seed.color), dots, speed: seed.speed, phase: seed.phase };
      }),
    [],
  );

  /* PLASMA — boiling cells on the surface */
  const cells = useMemo(() => {
    const group = new Group();
    group.name = "V2MorphCells";
    const material = new MeshBasicMaterial({
      color: new Color(MORPH_FORM_TINTS.cell),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const items: { mesh: Mesh; phase: number; speed: number }[] = [];
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const dir = new Vector3(
        Math.cos(index * 2.7) * Math.sin(index * 1.9),
        Math.sin(index * 2.3),
        Math.cos(index * 1.7) * Math.cos(index * 1.9),
      ).normalize();
      const mesh = new Mesh(new SphereGeometry(0.07, 10, 10), material);
      mesh.position.copy(dir).multiplyScalar(1.24);
      mesh.raycast = () => null;
      group.add(mesh);
      items.push({ mesh, phase: index * 0.9, speed: 1.4 + (index % 4) * 0.5 });
    }
    return { group, material, items };
  }, []);

  /* ELECTRIC — branching arcs */
  const arcs = useMemo(() => {
    const group = new Group();
    group.name = "V2MorphArcs";
    const items: ArcGroup[] = [];
    for (let index = 0; index < 6; index += 1) {
      const item = makeArcGroup(index);
      item.lines.forEach((line) => group.add(line));
      items.push(item);
    }
    return { group, items };
  }, []);

  /* BIOHAZARD — organic membrane lattice */
  const membrane = useMemo(() => {
    const group = new Group();
    group.name = "V2MorphMembrane";
    const shells = [
      {
        mesh: new Mesh(
          new IcosahedronGeometry(1.42, 1),
          new MeshBasicMaterial({
            color: new Color(MORPH_FORM_TINTS.membrane),
            wireframe: true,
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
        speed: 0.05,
      },
      {
        mesh: new Mesh(
          new IcosahedronGeometry(1.74, 1),
          new MeshBasicMaterial({
            color: new Color("#34d399"),
            wireframe: true,
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
        speed: -0.04,
      },
    ];
    shells.forEach(({ mesh }) => {
      mesh.raycast = () => null;
      group.add(mesh);
    });
    return { group, shells };
  }, []);

  const stateColor = useMemo(() => new Color(), []);

  useFrame((_, delta) => {
    if (!root.current) {
      return;
    }
    const vs = engineRuntime?.getEngineBus().getVisualState();
    if (!vs) {
      return;
    }
    const weights = vs.stateWeights;
    const time = vs.time;
    stateColor.copy(vs.stateColor);

    /* HAZARD — storm filaments flash with electric/plasma energy. */
    storm.group.rotation.y += delta * 0.06;
    const stormWeight = weights.electric * 0.72 + weights.plasma * 0.28;
    storm.items.forEach(({ line, phase, speed }) => {
      const material = line.material as LineBasicMaterial;
      const flash = Math.pow(Math.max(0, Math.sin(time * speed + phase)), 6);
      material.opacity = stormWeight * (0.3 + flash * 0.7);
      material.color.copy(stateColor).lerp(TINT_STORM, 0.55);
    });

    /* AURORA — veils sweep the body as halo light rises. */
    veils.forEach(({ group: veil, material, tint, speed, phase }) => {
      veil.rotation.z += delta * speed;
      const breathe = 0.8 + 0.2 * Math.sin(time * 0.9 + phase);
      material.opacity = weights.halo * (0.16 + 0.12 * breathe);
      material.color.copy(stateColor).lerp(tint, 0.6);
      veil.scale.setScalar(1 + weights.halo * 0.08 + Math.sin(time * 1.1 + phase) * 0.015);
    });

    /* OCEAN — current streams flow around the body. */
    streams.forEach(({ group: stream, material, tint, dots, speed }) => {
      stream.rotation.y += delta * speed;
      material.opacity = weights.ocean * 0.42;
      material.color.copy(stateColor).lerp(tint, 0.6);
      dots.forEach(({ mesh, phase }) => {
        mesh.scale.setScalar(0.6 + 0.4 * Math.sin(time * 2.2 + phase));
      });
    });

    /* PLASMA — boiling cells swell and pulse on the surface. */
    cells.group.rotation.y += delta * 0.12;
    cells.group.rotation.x += delta * 0.04;
    cells.material.opacity = weights.plasma * 0.75;
    cells.material.color.copy(stateColor).lerp(TINT_CELL, 0.55);
    cells.items.forEach(({ mesh, phase, speed }) => {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(time * speed + phase));
      mesh.scale.setScalar(pulse);
    });

    /* ELECTRIC — arcs flash hard as electric energy spikes. */
    arcs.group.rotation.y += delta * 0.09;
    arcs.items.forEach(({ lines, phase, speed }) => {
      const flash = Math.pow(Math.max(0, Math.sin(time * speed + phase)), 8);
      lines.forEach((line) => {
        const material = line.material as LineBasicMaterial;
        material.opacity = weights.electric * (0.2 + flash * 0.8);
        material.color.copy(stateColor).lerp(TINT_ARC, 0.6);
      });
    });

    /* BIOHAZARD — the organic lattice breathes around the body. */
    membrane.group.rotation.y += delta * 0.02;
    membrane.shells.forEach(({ mesh, speed }) => {
      mesh.rotation.y += delta * speed;
      mesh.rotation.z += delta * speed * 0.6;
      (mesh.material as MeshBasicMaterial).opacity = weights.bio * 0.3;
    });
  });

  return (
    <group ref={root} name="V2CoreMorphForms" renderOrder={206}>
      <primitive object={storm.group} />
      {veils.map(({ group: veil }, index) => (
        <primitive key={`veil-${index}`} object={veil} />
      ))}
      {streams.map(({ group: stream }, index) => (
        <primitive key={`stream-${index}`} object={stream} />
      ))}
      <primitive object={cells.group} />
      <primitive object={arcs.group} />
      <primitive object={membrane.group} />
    </group>
  );
}

/* ------------------------------ the ONE core --------------------------- */

/**
 * The Genesis v2 Core — the same ONE shader surface the whole app reads
 * from the EngineBus. Every frame the live CoreVisualState is written
 * straight into the material uniforms (identical to the v1 GenesisCore
 * body), so the core morphs through its engine states in real 3D:
 * ocean / plasma / electric / crystal / halo / bio all travel across
 * the same icosahedral body. The shared emission, rings and atmosphere
 * layers wrap it, scaled to this core's radius.
 */
function V2CoreBody({
  focused,
  onSelect,
  coreLabel,
}: {
  focused: boolean;
  onSelect: () => void;
  coreLabel?: ReactNode;
}) {
  const { engineRuntime } = useGenesis();
  const mesh = useRef<Mesh>(null);
  const shell = useRef<Mesh>(null);
  const bloom = useRef<Sprite>(null);
  const material = useMemo(() => new GenesisCoreMaterial(), []);
  const texture = useMemo(makeGlowTexture, []);

  useFrame((_, delta) => {
    const visualState = engineRuntime?.getEngineBus().getVisualState();
    if (!visualState) {
      return;
    }

    // ONE authoritative state → surface uniforms (same writes as the v1 body).
    const uniforms = material.uniforms;
    uniforms.uTime.value = visualState.time;
    uniforms.uActivity.value = visualState.activity;
    uniforms.uEvolution.value = visualState.evolutionFeed;
    uniforms.uAwareness.value = visualState.awarenessFeed;
    uniforms.uMutation.value = visualState.mutationFeed;
    uniforms.uGrowth.value = visualState.growthFeed;
    uniforms.uFormChange.value = visualState.formChange;
    uniforms.uInstability.value = visualState.instability;
    uniforms.uPlasma.value = visualState.plasmaFeed;
    uniforms.uOceanBlend.value = visualState.oceanFeed.blend;
    uniforms.uOceanFlow.value = visualState.oceanFeed.flow;
    uniforms.uOceanDepth.value = visualState.oceanFeed.depth;
    uniforms.uOceanFoam.value = visualState.oceanFeed.foam;
    uniforms.uOceanCurrent.value = visualState.oceanFeed.current;
    uniforms.uColorShift.value = visualState.colorShift;
    uniforms.uStateOcean.value = visualState.stateWeights.ocean;
    uniforms.uStatePlasma.value = visualState.stateWeights.plasma;
    uniforms.uStateElectric.value = visualState.stateWeights.electric;
    uniforms.uStateCrystal.value = visualState.stateWeights.crystal;
    uniforms.uStateHalo.value = visualState.stateWeights.halo;
    uniforms.uStateBio.value = visualState.stateWeights.bio;
    uniforms.uCoreColor.value.copy(visualState.stateColor);
    uniforms.uGlowColor.value.copy(visualState.stateGlow);

    if (mesh.current) {
      mesh.current.rotation.y += delta * (0.12 + visualState.activity * 0.25);
      mesh.current.rotation.x += delta * (0.03 + visualState.activity * 0.08);
      const breathing =
        1 +
        Math.sin(visualState.time * 1.4) * (0.04 + visualState.activity * 0.04) +
        visualState.activity * 0.12;
      mesh.current.scale.setScalar(breathing);
    }

    // The internal wireframe lattice drifts counter to the body — the
    // geometric structure reads as living, not static.
    if (shell.current) {
      shell.current.rotation.y -= delta * 0.09;
      shell.current.rotation.z += delta * 0.05;
    }

    if (bloom.current) {
      const spriteMaterial = bloom.current.material as SpriteMaterial;
      spriteMaterial.color.copy(visualState.stateGlow);
      spriteMaterial.opacity =
        0.3 + visualState.activity * 0.2 + Math.sin(visualState.time * 2.2) * 0.06;
    }
  });

  return (
    <group position={CORE_POS} name="GenesisV2Core">
      {/* THE ONE core body — shared shader surface, morphing forever */}
      <mesh
        ref={mesh}
        material={material}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        <icosahedronGeometry args={[1.15, 64]} />
      </mesh>

      {/* internal wireframe lattice — the geometric structure inside the
          luminous body (the reference's network geometry) */}
      <mesh ref={shell} raycast={() => null}>
        <icosahedronGeometry args={[1.62, 1]} />
        <meshBasicMaterial
          color="#9adcff"
          wireframe
          transparent
          opacity={0.16}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* additive bloom — the core reads luminous, not flat. Two layers:
          a wide outer halo in the live state glow + a tight white-hot
          inner bloom hugging the surface. */}
      <sprite ref={bloom} position={[0, 0, 1.35]} scale={[5.6, 5.6, 1]}>
        <spriteMaterial
          map={texture}
          transparent
          opacity={0.3}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <sprite position={[0, 0, 1.6]} scale={[3.3, 3.3, 1]}>
        <spriteMaterial
          map={texture}
          color="#ffffff"
          transparent
          opacity={0.68}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>

      {/* fine energy motes orbiting the same ONE core (tilted rings) */}
      <CoreMoteRing tilt={[1.18, 0.42, 0.12]} speed={0.22} />
      <CoreMoteRing tilt={[1.62, -0.35, 0.3]} speed={-0.16} />

      {/* wide tilted orbital light ring — the reference's grand orbital
          geometry around the central core, with its own mote swarm */}
      <group rotation={[1.42, 0.22, 0.5]} name="V2CoreLightRing">
        <mesh raycast={() => null}>
          <torusGeometry args={[2.55, 0.014, 12, 140]} />
          <meshBasicMaterial
            color="#bfe9ff"
            transparent
            opacity={0.22}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
      <CoreMoteRing tilt={[1.42, 0.22, 0.5]} speed={0.3} radius={2.55} count={60} />
      <CoreMoteRing tilt={[1.9, -0.4, 0.9]} speed={-0.22} radius={2.05} count={46} />

      {/* shared one-core layers — rings, emission, light, scaled to radius */}
      <group scale={1.28}>
        <CoreOrbitalRings />
        <CoreEmission />
      </group>
      <CoreAtmosphere />

      {/* per-morphology form layers — every evolution version brings its
          own 3D geometry (storm filaments, aurora veils, ocean currents,
          plasma cells, electric arcs, bio membrane), driven by the same
          engine weights as the surface so the forms crossfade with the
          morph — never a recolored sphere */}
      <CoreMorphForms />

      {/* the reference's information hierarchy, anchored under the Core —
          GENESIS CORE · Consciousness Engine · waveform · Coherence. It is
          part of this scene (Html overlay inside the Canvas), so it mounts
          and unmounts with the v2 workspace. */}
      {coreLabel ? (
        <Html position={[0, -0.95, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
          {coreLabel}
        </Html>
      ) : null}

      {/* focused marker — small diamond above the Core */}
      {focused ? (
        <Html position={[0, 1.8, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <div
            aria-hidden
            style={{
              width: 12,
              height: 12,
              transform: "rotate(45deg)",
              border: "1.5px solid #7dd3fc",
              background: "rgba(125, 211, 252, 0.2)",
              boxShadow: "0 0 14px #38bdf8",
            }}
          />
        </Html>
      ) : null}
    </group>
  );
}

/* ------------------------------- satellites ---------------------------- */

/**
 * A satellite module (Creation Studio / Research Lab / Genesis Vault):
 * a luminous wireframe lattice sphere with an inner energy body, bright
 * nucleus, two tilted orbit rings with travelling sparks, a drifting
 * particle halo and its own module light. The label block is a DOM
 * overlay anchored to the sphere (drei Html) so it always tracks it.
 */
function V2Satellite({
  seed,
  focused,
  onSelect,
}: {
  seed: SatelliteSeed;
  focused: boolean;
  onSelect: () => void;
}) {
  const group = useRef<Group>(null);
  const ringA = useRef<Group>(null);
  const ringB = useRef<Group>(null);
  const ringC = useRef<Group>(null);
  const sparkA = useRef<Mesh>(null);
  const sparkB = useRef<Mesh>(null);
  const halo = useRef<Group>(null);
  const time = useRef(0);

  const haloGeometry = useMemo(() => {
    const count = 44;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const theta = Math.random() * Math.PI * 2;
      const y = 1 - 2 * Math.random();
      const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
      const radius = 0.72 + Math.random() * 0.62;
      positions[index * 3] = horizontal * Math.cos(theta) * radius;
      positions[index * 3 + 1] = y * radius;
      positions[index * 3 + 2] = horizontal * Math.sin(theta) * radius;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    return geometry;
  }, []);

  const glowTexture = useMemo(makeGlowTexture, []);

  useFrame((_, delta) => {
    time.current += delta;
    if (
      !group.current ||
      !ringA.current ||
      !ringB.current ||
      !ringC.current ||
      !sparkA.current ||
      !sparkB.current ||
      !halo.current
    ) {
      return;
    }

    // Gentle bob + breathing — each module feels alive.
    const bob = Math.sin(time.current * 0.7 + seed.position[0]) * 0.06;
    group.current.position.y = seed.position[1] + bob;
    const pulse = 1 + (focused ? Math.sin(time.current * 2.4) * 0.05 : Math.sin(time.current * 1.1) * 0.02);
    group.current.scale.setScalar(pulse);

    ringA.current.rotation.z += delta * 0.4;
    ringB.current.rotation.z -= delta * 0.3;
    ringC.current.rotation.z += delta * 0.22;
    halo.current.rotation.y += delta * 0.15;

    const angleA = time.current * 0.9;
    sparkA.current.position.set(Math.cos(angleA) * 0.68, 0, Math.sin(angleA) * 0.68);
    const angleB = time.current * 0.7 + 2.1;
    sparkB.current.position.set(Math.cos(angleB) * 0.82, 0, Math.sin(angleB) * 0.82);
  });

  function select(event: { stopPropagation: () => void }) {
    event.stopPropagation();
    onSelect();
  }

  return (
    <group ref={group} position={seed.position} name={`V2Satellite-${seed.id}`}>
      {/* wireframe lattice shell — the reference's network geometry */}
      <mesh
        onClick={select}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        <icosahedronGeometry args={[0.5, 1]} />
        <meshBasicMaterial
          color={seed.color}
          wireframe
          transparent
          opacity={focused ? 0.95 : 0.78}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* inner energy body */}
      <mesh onClick={select}>
        <icosahedronGeometry args={[0.4, 3]} />
        <meshBasicMaterial
          color={seed.color}
          transparent
          opacity={0.62}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* bright nucleus */}
      <mesh>
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.92}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* luminous halo sprite behind the module — it reads as a real
          energy body, not a flat wireframe ball */}
      <sprite position={[0, 0, 0]} scale={[3.6, 3.6, 1]}>
        <spriteMaterial
          map={glowTexture}
          color={seed.glow}
          transparent
          opacity={0.3}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>

      {/* orbit rings with travelling sparks */}
      <group ref={ringA} rotation={[1.25, 0.4, 0.2]}>
        <mesh raycast={() => null}>
          <torusGeometry args={[0.68, 0.008, 10, 90]} />
          <meshBasicMaterial
            color={seed.color}
            transparent
            opacity={focused ? 0.6 : 0.42}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={sparkA}>
          <sphereGeometry args={[0.034, 10, 10]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.95}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
      <group ref={ringB} rotation={[1.6, -0.5, 0.7]}>
        <mesh raycast={() => null}>
          <torusGeometry args={[0.82, 0.006, 10, 90]} />
          <meshBasicMaterial
            color={seed.glow}
            transparent
            opacity={focused ? 0.45 : 0.3}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={sparkB}>
          <sphereGeometry args={[0.028, 10, 10]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.85}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
      {/* third fine ring — deeper orbital geometry around each module */}
      <group ref={ringC} rotation={[0.9, -0.85, 1.1]}>
        <mesh raycast={() => null}>
          <torusGeometry args={[0.98, 0.006, 10, 90]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={focused ? 0.32 : 0.2}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* particle halo */}
      <group ref={halo}>
        <points geometry={haloGeometry} raycast={() => null}>
          <pointsMaterial
            color={seed.glow}
            size={0.045}
            transparent
            opacity={0.62}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      </group>

      {/* module light */}
      <pointLight color={seed.color} intensity={1.5} distance={5} />

      {/* label block — anchored to the sphere so it always tracks it */}
      <Html position={[0, -0.5, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "auto" }}>
        <button
          type="button"
          onClick={select}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            userSelect: "none",
            WebkitUserSelect: "none",
            textAlign: "center",
          }}
        >
          <span
            style={{
              fontSize: "clamp(11px, 1vw + 4px, 13.5px)",
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#ffffff",
              textShadow: `0 0 12px ${seed.color}aa, 0 0 30px ${seed.color}55`,
              whiteSpace: "nowrap",
            }}
          >
            {seed.title}
          </span>
          <span
            style={{
              fontSize: "clamp(9px, 0.75vw + 3px, 11px)",
              color: "rgba(203, 226, 244, 0.72)",
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
            }}
          >
            {seed.tagline}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              marginTop: 2,
              fontSize: 9.5,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: seed.color,
              textShadow: `0 0 10px ${seed.color}`,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                background: seed.color,
                boxShadow: `0 0 8px ${seed.color}`,
              }}
            />
            Active
          </span>
        </button>
      </Html>

      {/* focused marker - small diamond above the module (reference) */}
      {focused ? (
        <Html position={[0, 1.15, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <div
            aria-hidden
            style={{
              width: 10,
              height: 10,
              transform: "rotate(45deg)",
              border: `1.5px solid ${seed.color}`,
              background: `${seed.color}33`,
              boxShadow: `0 0 14px ${seed.color}`,
            }}
          />
        </Html>
      ) : null}
    </group>
  );
}

/* ------------------------------- energy beams -------------------------- */

/**
 * Curved energy tubes from the ONE Core to each module with a travelling
 * pulse, plus fine threads connecting the modules into one system.
 */
function V2EnergyBeams({ active }: { active: boolean }) {
  const pulses = useRef<(Mesh | null)[]>([]);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const beams = useMemo(
    () =>
      BEAMS.map((beam) => {
        const from = new Vector3(...CORE_POS);
        const to = new Vector3(...beam.to);
        const mid = from.clone().add(to).multiplyScalar(0.5);
        const control = mid
          .clone()
          .add(mid.clone().normalize().multiplyScalar(0.55))
          .add(new Vector3(0, 0.4, 0));
        const curve = new QuadraticBezierCurve3(from, control, to);
        const geometry = new TubeGeometry(curve, 72, 0.02, 6, false);
        const material = new MeshBasicMaterial({
          color: new Color(beam.color),
          transparent: true,
          opacity: 0.2,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        return { curve, geometry, material, ...beam };
      }),
    [],
  );

  const threads = useMemo(
    () =>
      THREADS.map((thread) => {
        const geometry = new BufferGeometry().setFromPoints([
          new Vector3(...thread.from),
          new Vector3(...thread.to),
        ]);
        const material = new LineBasicMaterial({
          color: new Color(thread.color),
          transparent: true,
          opacity: 0.14,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        return new Line(geometry, material);
      }),
    [],
  );

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const energy = activeRef.current ? 1 : 0.55;
    beams.forEach((beam, index) => {
      beam.material.opacity = 0.14 + energy * 0.12;
      const pulse = pulses.current[index];
      if (pulse) {
        const t = (time * beam.speed + beam.phase) % 1;
        pulse.position.copy(beam.curve.getPoint(t));
        const pulseMaterial = pulse.material as MeshBasicMaterial;
        pulseMaterial.opacity = 0.55 + Math.sin(time * 6 + index) * 0.3;
      }
    });
  });

  return (
    <group name="V2EnergyBeams" renderOrder={3}>
      {beams.map((beam, index) => (
        <group key={index}>
          <mesh geometry={beam.geometry} material={beam.material} raycast={() => null} />
          <mesh
            ref={(object) => {
              pulses.current[index] = object;
            }}
            raycast={() => null}
          >
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshBasicMaterial
              color={beam.color}
              transparent
              opacity={0.95}
              blending={AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      {threads.map((thread, index) => (
        <primitive key={index} object={thread} />
      ))}
    </group>
  );
}

/* ------------------------------ the scene ------------------------------ */

export default function GenesisV2Scene3D({
  activity,
  focused,
  onSelect,
  coreLabel,
}: GenesisV2Scene3DProps) {
  /* The v2 scene lives inside GenesisCore's provider (GenesisScene wraps the
     whole router). R3F renders this canvas in its own reconciler root, so
     the shared context must be bridged in — exactly like the v1 world does. */
  const ContextBridge = useContextBridge(GenesisContext);

  return (
    <Canvas
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      camera={{ position: [0, 0.55, 8.6], fov: 46, near: 0.1, far: 220 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <ContextBridge>
        {/* deep-space environment — the same living cosmos family as v1 */}
        <StarField />
        <Cosmos />
        <NebulaSprites />
        <DustField />

        {/* restrained illumination */}
        <ambientLight intensity={0.4} />
        <pointLight position={[-6, 4, 3]} intensity={0.5} color="#7c3aed" />
        <pointLight position={[6, 4, 3]} intensity={0.5} color="#0ea5e9" />
        <pointLight position={[0, -5, 2]} intensity={0.45} color="#10b981" />

        {/* the ONE Core + its three modules + the beams joining them */}
        <V2CoreBody
          focused={focused === "core"}
          onSelect={() => onSelect("core")}
          coreLabel={coreLabel}
        />
        <V2EnergyBeams active={activity > 0.5} />
        {SATELLITES.map((seed) => (
          <V2Satellite
            key={seed.id}
            seed={seed}
            focused={focused === seed.id}
            onSelect={() => onSelect(seed.id)}
          />
        ))}
      </ContextBridge>
    </Canvas>
  );
}
