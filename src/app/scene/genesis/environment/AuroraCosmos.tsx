/**
 * ==========================================================
 * LÉLUVERSE
 * AURORA COSMOS
 *
 * Procedural polar-light curtains flowing through the larger
 * cosmic environment. The field is made from curved,
 * translucent strips with a shared animated shader rather than
 * flat strips, so the aurora has depth, turbulence, and edge
 * fade. Curtains are wrapped AROUND the whole environment at
 * varied azimuths and two depth tiers, each facing the core,
 * so the light reads as atmospheric energy flowing through the
 * 360° cosmos rather than an isolated object on one side.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useGenesis } from "../GenesisCore";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  ShaderMaterial,
} from "three";

interface RibbonSeed {
  width: number;
  height: number;
  z: number;
  phase: number;
  speed: number;
  hue: number;
  tilt: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  baseRotX: number;
  baseRotY: number;
}

interface AuroraRibbon {
  geometry: BufferGeometry;
  material: ShaderMaterial;
  seed: RibbonSeed;
}

const RIBBON_COUNT = 14;
const RIBBON_SEGMENTS = 36;
const RIBBON_ROWS = 12;

const vertexShader = `
  uniform float uTime;
  uniform float uActivity;
  uniform float uPhase;

  varying vec2 vUv;
  varying float vCurtain;

  void main() {
    vUv = uv;
    vec3 p = position;
    float wave = sin(p.x * 0.72 + uTime * 0.48 + uPhase) * 0.24;
    wave += sin(p.x * 1.85 - uTime * 0.22 + uPhase * 1.7) * 0.09;
    p.z += wave * (0.8 + uActivity * 1.4);
    p.y += sin(p.x * 0.48 + uTime * 0.3 + uPhase) * 0.12 * (1.0 + uActivity);
    vCurtain = 0.5 + 0.5 * sin(p.x * 2.4 - p.y * 0.7 + uTime * 0.9 + uPhase);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uActivity;
  uniform float uHue;

  varying vec2 vUv;
  varying float vCurtain;

  vec3 hue(float h) {
    vec3 k = vec3(1.0, 2.0 / 3.0, 1.0 / 3.0);
    vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0);
    return clamp(p - 1.0, 0.0, 1.0);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float edge = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.68, vUv.y);
    float curtain = smoothstep(0.18, 0.82, vCurtain);
    float turbulence = noise(vec2(vUv.x * 7.0, vUv.y * 4.0 + uTime * 0.18));
    float filament = pow(max(0.0, sin(vUv.x * 22.0 + turbulence * 5.0 - uTime * 1.4)), 5.0);
    float alpha = edge * (0.10 + curtain * 0.24 + filament * 0.22) * (0.55 + uActivity * 0.7);
    vec3 color = hue(fract(uHue + uTime * 0.012 + vUv.x * 0.18));
    color = mix(color, vec3(0.35, 0.95, 1.0), 0.28);
    gl_FragColor = vec4(color * (0.5 + curtain * 0.65), alpha);
  }
`;

function createRibbonGeometry(seed: RibbonSeed): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= RIBBON_ROWS; row += 1) {
    const v = row / RIBBON_ROWS;
    const y = (v - 0.5) * seed.height;

    for (let segment = 0; segment <= RIBBON_SEGMENTS; segment += 1) {
      const u = segment / RIBBON_SEGMENTS;
      const x = (u - 0.5) * seed.width;
      const z = seed.z + Math.sin(u * Math.PI * 2.0 + seed.phase) * 0.4;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  const columns = RIBBON_SEGMENTS + 1;
  for (let row = 0; row < RIBBON_ROWS; row += 1) {
    for (let segment = 0; segment < RIBBON_SEGMENTS; segment += 1) {
      const a = row * columns + segment;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createRibbon(seed: RibbonSeed): AuroraRibbon {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.45 },
      uPhase: { value: seed.phase },
      uHue: { value: seed.hue },
    },
    vertexShader,
    fragmentShader,
  });

  return {
    geometry: createRibbonGeometry(seed),
    material,
    seed,
  };
}

export default function AuroraCosmos() {
  const { getLiveUniverse } = useGenesis();
  const root = useRef<Group>(null);

  const ribbons = useMemo<AuroraRibbon[]>(() => {
    return Array.from({ length: RIBBON_COUNT }, (_, index) => {
      // Curtains wrap the whole environment: evenly spaced azimuths around
      // the core, alternating between an inner veil (closer to the worlds)
      // and an outer veil (toward the deep field). Each ribbon faces the
      // core so the light reads as atmospheric energy moving around the
      // scene instead of one cluster beside it.
      const azimuth = (index / RIBBON_COUNT) * Math.PI * 2 + 0.4;
      const tier = index % 2;
      const radius = tier === 0
        ? 9.5 + (index % 3) * 2.4
        : 18 + (index % 4) * 3.6;
      const height = 1.4 + (index % 4) * 1.35 + tier * 1.8;
      const seed: RibbonSeed = {
        width: tier === 0 ? 16 + (index % 4) * 4 : 26 + (index % 3) * 6,
        height: 5.0 + (index % 3) * 1.2,
        z: -(1.2 + (index % 3) * 0.7),
        phase: index * 1.47,
        speed: 0.16 + (index % 4) * 0.03,
        hue: 0.42 + index * 0.045,
        tilt: ((index % 5) - 2) * 0.09,
        baseX: Math.cos(azimuth) * radius,
        baseY: height,
        baseZ: Math.sin(azimuth) * radius,
        baseRotX: 0.38 + tier * 0.16 + (index % 2) * 0.08,
        baseRotY: azimuth + Math.PI,
      };
      return createRibbon(seed);
    });
  }, []);

  useFrame(({ clock }, delta) => {
    if (!root.current) {
      return;
    }

    const liveUniverse = getLiveUniverse();
    const cosmicEnergy = liveUniverse.celestial.cosmicEnergy;
    const celestialActivity =
      (liveUniverse.celestial.stars +
        liveUniverse.celestial.constellations +
        liveUniverse.celestial.planets +
        liveUniverse.astrology.transit +
        liveUniverse.ocean.stormSurge) / 5;
    const activity = Math.min(
      1,
      0.2 + cosmicEnergy * 0.35 + celestialActivity * 0.5,
    );

    root.current.rotation.y += delta * (0.004 + activity * 0.012);
    root.current.rotation.x = Math.sin(clock.elapsedTime * 0.08) * 0.025;

    ribbons.forEach(({ material, seed }, index) => {
      material.uniforms.uTime.value = clock.elapsedTime * seed.speed;
      material.uniforms.uActivity.value = activity;
      material.uniforms.uHue.value =
        seed.hue + liveUniverse.evolutionSystem.colorShift * 0.22;

      const child = root.current?.children[index];
      if (child) {
        child.rotation.set(
          seed.baseRotX + Math.sin(clock.elapsedTime * 0.09 + seed.phase) * 0.02,
          seed.baseRotY + Math.sin(clock.elapsedTime * 0.05 + seed.phase) * 0.012,
          seed.tilt + Math.sin(clock.elapsedTime * 0.12 + seed.phase) * 0.025,
        );
        child.position.set(
          seed.baseX + Math.sin(clock.elapsedTime * 0.06 + seed.phase) * 0.5,
          seed.baseY + Math.cos(clock.elapsedTime * 0.05 + seed.phase) * 0.24,
          seed.baseZ + Math.cos(clock.elapsedTime * 0.06 + seed.phase * 1.3) * 0.5,
        );
        child.scale.set(1 + activity * 0.08, 1 + activity * 0.06, 1);
      }
    });
  });

  return (
    <group ref={root} name="AuroraCosmos" renderOrder={5}>
      {ribbons.map(({ geometry, material }, index) => (
        <mesh
          key={index}
          geometry={geometry}
          material={material}
          renderOrder={5}
        />
      ))}
    </group>
  );
}
