import {
  Color,
  FrontSide,
  NormalBlending,
  ShaderMaterial,
} from "three";

import type { EngineWeights } from "../engines/EngineBus";

/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CORE MATERIAL — ONE MORPHING CORE
 *
 * The single surface of the ONE Core. Every engine state the
 * simulation owns (ocean, plasma, electric, crystal, halo,
 * bio) is expressed on THIS surface, weighted by the EngineBus
 * channels, so the Core morphs through its states instead of
 * wearing separate shells around it.
 *
 * Each engine is a VISIBLE INTERNAL SYSTEM of the one body:
 *   - ocean    → deep fluid gradients, flowing currents, caustics
 *   - plasma   → hot luminous cells that boil and travel
 *   - electric → bright filaments that cross the surface
 *   - bio      → cellular membranes + organic veins
 *   - crystal/halo → faceted mantle + fresnel rim accents
 *
 * The vertex displacement is deliberately SMOOTH — a living
 * undulation with subtle secondary morphology — so evolution is
 * carried by color, gradients and internal movement, not by
 * spike deformation.
 * ==========================================================
 */

/** State palette — one hue per engine state of the Core. */
export const CORE_STATE_PALETTE = {
  ocean: new Color("#29d6c6"),
  plasma: new Color("#ff7a1a"),
  electric: new Color("#59d7ff"),
  crystal: new Color("#bfefff"),
  halo: new Color("#c9b8ff"),
  bio: new Color("#4ade80"),
} as const;

export interface CoreStateWeights {
  ocean: number;
  plasma: number;
  electric: number;
  crystal: number;
  halo: number;
  bio: number;
}

/** Universe inputs used to derive the organic (bio) engine channel. */
export interface CoreStateInputs {
  life: number;
  mutation: number;
  emergence: number;
}

/**
 * ONE authoritative derivation of the Core's engine-state weights.
 *
 * The EngineBus channels (smoothed over time) are the single source of
 * truth for which engine state the Core is in; the bio channel falls
 * back to the same universe derivation until the bus has run. Surface,
 * emission, and atmosphere all read from here, so the ONE Core can
 * never wear two different states at once.
 */
export function deriveCoreStateWeights(
  engineWeights: EngineWeights | undefined,
  inputs: CoreStateInputs,
): CoreStateWeights {
  return {
    ocean: engineWeights?.ocean ?? 0,
    plasma: engineWeights?.plasma ?? 1,
    electric: engineWeights?.electric ?? 0,
    crystal: engineWeights?.crystal ?? 0,
    halo: engineWeights?.halo ?? 1,
    bio:
      engineWeights?.bio ??
      Math.min(
        1,
        inputs.life * 0.45 +
          inputs.mutation * 0.35 +
          inputs.emergence * 0.2,
      ),
  };
}

/**
 * Blend the engine-state palette by the live EngineBus weights into
 * `target`. This is the ONE authoritative Core color — surface, glow,
 * emission particles and arcs all read from it.
 */
export function blendCoreStateColorInto(
  target: Color,
  weights: CoreStateWeights,
): void {
  const total =
    weights.ocean +
    weights.plasma +
    weights.electric +
    weights.crystal +
    weights.halo +
    weights.bio;
  const norm = Math.max(0.0001, total);

  target
    .copy(CORE_STATE_PALETTE.ocean)
    .multiplyScalar(weights.ocean / norm)
    .add(CORE_STATE_PALETTE.plasma.clone().multiplyScalar(weights.plasma / norm))
    .add(CORE_STATE_PALETTE.electric.clone().multiplyScalar(weights.electric / norm))
    .add(CORE_STATE_PALETTE.crystal.clone().multiplyScalar(weights.crystal / norm))
    .add(CORE_STATE_PALETTE.halo.clone().multiplyScalar(weights.halo / norm))
    .add(CORE_STATE_PALETTE.bio.clone().multiplyScalar(weights.bio / norm));
}

/**
 * The core's single material surface. Keep all visual inputs here so the
 * renderer can feed one living surface instead of stacking opaque shells.
 */
export default class GenesisCoreMaterial extends ShaderMaterial {
  constructor() {
    super({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: FrontSide,
      blending: NormalBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uActivity: { value: 0 },
        uEvolution: { value: 0 },
        uMutation: { value: 0 },
        uAwareness: { value: 0 },
        uGrowth: { value: 0 },
        uFormChange: { value: 0 },
        uInstability: { value: 0 },
        uPlasma: { value: 0.35 },
        uOceanBlend: { value: 0.25 },
        uOceanFlow: { value: 0.5 },
        uOceanDepth: { value: 0.5 },
        uOceanFoam: { value: 0.2 },
        uOceanCurrent: { value: 0.5 },
        uColorShift: { value: 0 },
        uCoreColor: { value: new Color("#009CFF") },
        uGlowColor: { value: new Color("#4BD9FF") },
        // Engine-state channels — the same EngineBus weights drive the
        // surface, the particles, the arcs and the rings.
        uStateOcean: { value: 0 },
        uStatePlasma: { value: 1 },
        uStateElectric: { value: 0 },
        uStateCrystal: { value: 0 },
        uStateHalo: { value: 1 },
        uStateBio: { value: 0 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uActivity;
        uniform float uEvolution;
        uniform float uMutation;
        uniform float uGrowth;
        uniform float uFormChange;
        uniform float uPlasma;
        uniform float uInstability;
        uniform float uOceanDepth;
        uniform float uOceanCurrent;
        uniform float uOceanFlow;
        uniform float uStateOcean;
        uniform float uStatePlasma;
        uniform float uStateElectric;
        uniform float uStateCrystal;
        uniform float uStateBio;

        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying float vField;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        float noise(vec3 p) {
          vec3 cell = floor(p);
          vec3 local = fract(p);
          local = local * local * (3.0 - 2.0 * local);
          float a = mix(hash(cell), hash(cell + vec3(1.0, 0.0, 0.0)), local.x);
          float b = mix(hash(cell + vec3(0.0, 1.0, 0.0)), hash(cell + vec3(1.0, 1.0, 0.0)), local.x);
          float c = mix(hash(cell + vec3(0.0, 0.0, 1.0)), hash(cell + vec3(1.0, 0.0, 1.0)), local.x);
          float d = mix(hash(cell + vec3(0.0, 1.0, 1.0)), hash(cell + vec3(1.0, 1.0, 1.0)), local.x);
          return mix(mix(a, b, local.y), mix(c, d, local.y), local.z);
        }

        void main() {
          vec3 p = position;
          float t = uTime;

          // Baseline living flow field.
          float flow = noise(position * 3.2 + vec3(t * 0.08, t * 0.12, -t * 0.06));
          float ribbon = 0.5 + 0.5 * sin(position.y * 18.0 + position.x * 7.0 + t * (2.4 + uPlasma * 1.8));
          float turbulence = 0.5 + 0.5 * sin(position.z * 28.0 - position.x * 13.0 + t * (3.2 + uInstability * 2.0));
          float field = mix(mix(flow, ribbon, 0.46), turbulence, 0.24 + uFormChange * 0.22);
          vField = field;

          // OCEAN — smooth fluid undulation rolling over the surface.
          float oceanWave =
            sin(position.x * 6.0 + t * (2.2 + uOceanCurrent * 2.0)) *
            sin(position.y * 5.0 - t * 1.7 + uOceanFlow * 3.0);
          oceanWave += sin(position.z * 7.0 + t * 1.5) * 0.6;

          // PLASMA — hot turbulent swell.
          float plasmaSwell = 0.5 + 0.5 * noise(position * 4.5 + vec3(t * 0.35, -t * 0.25, t * 0.4));

          // ELECTRIC — faint surface crackle (one accent of the morph, not its face).
          float crackle = sin(position.x * 25.0 + t * 8.0) * sin(position.y * 18.0 - t * 6.0);
          crackle += sin(position.z * 30.0 + t * 12.0) * 0.5;

          // CRYSTAL — facet pulse.
          float crystal = sin(t * 2.0 + position.y * 8.0) * 0.032 + sin(t * 0.8 + position.x * 4.0) * 0.018;

          // BIO — organic growth bumps.
          float bio = 0.5 + 0.5 * noise(position * 6.0 + vec3(t * 0.1, -t * 0.07, t * 0.05));

          float stateMorph = clamp(uStateOcean + uStatePlasma + uStateElectric + uStateCrystal + uStateBio, 0.0, 1.25);

          // Living undulation — smooth fluid motion is the base of every state,
          // so the Core stays ONE rounded body that swells with its energy
          // instead of a spike-deforming ball. Spikes are only a subtle accent.
          float response = 0.03 + uActivity * 0.05 + uEvolution * 0.04 + uMutation * 0.04 + uFormChange * 0.05;
          float undulation =
            field * response * (0.55 + stateMorph * 0.55) +
            oceanWave * 0.05 * uStateOcean +
            plasmaSwell * 0.045 * uStatePlasma;

          // Secondary morphology — electric crackle and bio bumps stay subtle.
          float spike = crackle * 0.018 * uStateElectric * (0.4 + uActivity * 0.5);
          float bumps = bio * 0.035 * uStateBio;

          float displacement = undulation + spike + bumps + crystal * 0.45 * uStateCrystal;

          p += normal * displacement;
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uActivity;
        uniform float uEvolution;
        uniform float uMutation;
        uniform float uAwareness;
        uniform float uGrowth;
        uniform float uFormChange;
        uniform float uInstability;
        uniform float uPlasma;
        uniform float uOceanFlow;
        uniform float uOceanFoam;
        uniform float uOceanCurrent;
        uniform float uColorShift;
        uniform float uStateOcean;
        uniform float uStatePlasma;
        uniform float uStateElectric;
        uniform float uStateCrystal;
        uniform float uStateHalo;
        uniform float uStateBio;
        uniform vec3 uCoreColor;
        uniform vec3 uGlowColor;

        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying float vField;

        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }

        float noise(vec3 p) {
          vec3 cell = floor(p);
          vec3 local = fract(p);
          local = local * local * (3.0 - 2.0 * local);
          float a = hash(cell);
          float b = hash(cell + vec3(1.0, 0.0, 0.0));
          float c = hash(cell + vec3(0.0, 1.0, 0.0));
          float d = hash(cell + vec3(1.0, 1.0, 0.0));
          float e = hash(cell + vec3(0.0, 0.0, 1.0));
          float f = hash(cell + vec3(1.0, 0.0, 1.0));
          float g = hash(cell + vec3(0.0, 1.0, 1.0));
          float h = hash(cell + vec3(1.0, 1.0, 1.0));
          float xy0 = mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
          float xy1 = mix(mix(e, f, local.x), mix(g, h, local.x), local.y);
          return mix(xy0, xy1, local.z);
        }

        float fbm(vec3 p) {
          float v = 0.0;
          float a = 0.55;
          for (int i = 0; i < 3; i++) {
            v += a * noise(p);
            p = p * 2.02 + vec3(11.3, 7.7, 5.1);
            a *= 0.55;
          }
          return v;
        }

        float ridged(vec3 p) {
          float v = 0.0;
          float a = 0.6;
          for (int i = 0; i < 3; i++) {
            float n = 1.0 - abs(2.0 * noise(p) - 1.0);
            v += a * n * n;
            p = p * 2.03 + vec3(13.1, 3.7, 9.2);
            a *= 0.5;
          }
          return v;
        }

        // Cheap cellular distance field — bio membranes and organic forms.
        float cells(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          float d1 = 8.0;
          float d2 = 8.0;
          for (int x = -1; x <= 1; x++)
          for (int y = -1; y <= 1; y++)
          for (int z = -1; z <= 1; z++) {
            vec3 o = vec3(float(x), float(y), float(z));
            vec3 r = o + hash(i + o) - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; }
            else if (d < d2) { d2 = d; }
          }
          return sqrt(d1);
        }

        vec3 hue(float h) {
          vec3 k = vec3(1.0, 2.0 / 3.0, 1.0 / 3.0);
          vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0);
          return clamp(p - 1.0, 0.0, 1.0);
        }

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.4);
          float t = uTime;
          vec3 p = vPosition;

          float activity = clamp(
            uActivity + uAwareness * 0.25 + uEvolution * 0.25 + uGrowth * 0.15 + uFormChange * 0.2,
            0.0, 1.0
          );

          // ---- OCEAN: deep fluid gradients + flowing currents + caustics ----
          vec3 oceanFlow = vec3(t * 0.12, -t * 0.09, t * 0.06);
          float oceanField = fbm(p * 1.6 + oceanFlow);
          float oceanRidged = ridged(p * 2.1 - oceanFlow * 1.3);
          float current = 0.5 + 0.5 * sin(p.x * 3.0 + p.y * 1.5 - p.z * 2.2 + t * (0.5 + uOceanCurrent * 1.5));
          float caustic = smoothstep(0.32, 0.95, oceanRidged);
          vec3 oceanDeep = vec3(0.01, 0.14, 0.32);
          vec3 oceanMid = vec3(0.02, 0.42, 0.58);
          vec3 oceanLight = vec3(0.4, 0.95, 1.0);
          vec3 oceanColor = mix(oceanDeep, oceanMid, clamp(oceanField * 0.6 + current * 0.4, 0.0, 1.0));
          oceanColor = mix(oceanColor, oceanLight, caustic * (0.3 + uOceanFoam * 0.35));

          // ---- PLASMA: hot luminous regions that boil and travel ----
          vec3 plasmaFlow = vec3(-t * 0.2, t * 0.14, t * 0.09);
          float plasmaCell = fbm(p * 2.4 + plasmaFlow);
          float plasmaHeat = pow(clamp(plasmaCell * 1.35 - 0.35, 0.0, 1.0), 2.2);
          float plasmaBoil = ridged(p * 4.0 - plasmaFlow * 2.0);
          vec3 plasmaDeep = vec3(0.5, 0.05, 0.02);
          vec3 plasmaCore = vec3(1.0, 0.42, 0.08);
          vec3 plasmaHot = vec3(1.0, 0.94, 0.6);
          vec3 plasmaColor = mix(plasmaDeep, plasmaCore, plasmaHeat);
          plasmaColor = mix(plasmaColor, plasmaHot, pow(plasmaBoil, 2.0) * (0.5 + plasmaHeat * 0.6));

          // ---- ELECTRIC: bright filaments crossing the surface ----
          vec3 electricFlow = vec3(t * 0.4, -t * 0.3, t * 0.5);
          float filament = noise(p * 7.0 + electricFlow);
          float filament2 = noise(p * 9.0 - electricFlow * 1.6 + vec3(7.0, 3.0, 0.0));
          float arc = smoothstep(0.6, 1.0, max(filament, filament2));
          float flicker = step(0.5, noise(p * 3.0 + vec3(t * 5.0, t * 3.0, 0.0)));
          arc *= flicker;
          vec3 electricColor = mix(vec3(0.35, 0.75, 1.0), vec3(1.0), arc);
          float electricGlow = arc * (0.5 + activity * 1.1);

          // ---- BIO: cellular membranes + organic veins ----
          float cellDist = cells(p * 1.8 + vec3(t * 0.05, -t * 0.04, t * 0.03));
          float membrane = 1.0 - smoothstep(0.05, 0.22, cellDist);
          float vein = smoothstep(0.7, 1.0, ridged(p * 3.0 + vec3(t * 0.08, -t * 0.06, t * 0.1)));
          float organic = 0.5 + 0.5 * sin(p.x * 4.0 + p.y * 3.0 - t * 1.1);
          vec3 bioDeep = vec3(0.02, 0.26, 0.1);
          vec3 bioToxic = vec3(0.25, 0.88, 0.32);
          vec3 bioViolet = vec3(0.55, 0.2, 0.6);
          vec3 bioColor = mix(bioDeep, bioToxic, clamp(organic * 0.7 + membrane * 0.3, 0.0, 1.0));
          bioColor = mix(bioColor, bioViolet, membrane * (0.35 + uMutation * 0.5));

          // ---- CRYSTAL: faceted mantle ----
          float crystal = abs(sin(p.y * 20.0 + t * 2.5)) + abs(sin(p.x * 14.0 - t)) * 0.5;
          crystal /= 1.5;

          // ---- BASE: the state-blended living color ----
          float stateEnergy = clamp(uStateOcean + uStatePlasma + uStateElectric + uStateCrystal + uStateBio, 0.0, 1.5);
          vec3 base = mix(uCoreColor, uGlowColor, 0.2 + 0.2 * noise(p * 2.0 + vec3(t * 0.1)));
          vec3 color = base * (0.6 + stateEnergy * 0.45);

          // OCEAN layer — the surface itself becomes fluid.
          color = mix(color, oceanColor, uStateOcean * 0.85);
          color += oceanLight * caustic * 0.5 * uStateOcean * (0.3 + activity * 0.7);

          // PLASMA layer — hot regions move through the same surface.
          color = mix(color, plasmaColor, uStatePlasma * 0.85);
          color += plasmaHot * plasmaHeat * 0.85 * uStatePlasma;

          // ELECTRIC layer — filaments travel across the body.
          color = mix(color, electricColor, arc * uStateElectric * 0.9);
          color += vec3(0.45, 0.92, 1.0) * electricGlow * uStateElectric;

          // BIO layer — organic membranes and veins emerge from the core.
          color = mix(color, bioColor, clamp(membrane * 0.55 + vein * 0.45, 0.0, 1.0) * uStateBio);
          color += bioToxic * (vein * 0.55 + membrane * 0.35) * uStateBio * (0.4 + uMutation * 0.6);

          // CRYSTAL + HALO accents on the same surface.
          color = mix(color, vec3(1.0) * (0.55 + crystal * 1.1), uStateCrystal * 0.4);
          color += uGlowColor * fresnel * 0.5 * uStateCrystal;
          color += uGlowColor * fresnel * (0.14 + activity * 0.18);
          color += uCoreColor * pow(fresnel, 1.5) * 0.24 * uStateHalo;
          color += vec3(1.0) * pow(fresnel, 2.2) * (0.05 + uEvolution * 0.18) * (0.4 + uStateHalo * 0.6);

          // Spectral evolution shimmer — keeps hue drifting between states.
          vec3 spectral = hue(fract(uColorShift * 1.6 + t * 0.08 + vField * 0.25));
          color = mix(color, spectral, clamp(0.04 + uColorShift * 0.25 + uEvolution * 0.05, 0.03, 0.22));

          // Breathing light — the same heartbeat every layer shares.
          color *= 0.84 + 0.16 * sin(t * 2.2 + vField * 6.0) * (0.5 + activity * 0.5) + activity * 0.08;

          // Gentle HDR compression, then a saturation lift so blended states
          // stay vivid instead of washing toward white.
          color = color / (1.0 + max(color, vec3(0.0)) * 0.45);
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(vec3(lum), color, 1.22);
          color = clamp(color, vec3(0.02), vec3(1.0));

          float alpha = clamp(0.88 + fresnel * 0.08 + activity * 0.05 - uInstability * 0.05, 0.74, 0.97);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
  }
}
