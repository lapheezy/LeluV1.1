/**
 * ==========================================================
 * LÉLUVERSE — COSMIC FIELD
 *
 * The environment's large-scale cosmic phenomena (constellation
 * rings, electromagnetic and biofield auras, galaxy bands,
 * nebula clouds, cosmic storms, energy particles, glyph orbits,
 * the human-design network and emergent creations). It is part
 * of the ENVIRONMENT, not the Core: it deliberately owns no
 * engines and no state — every layer samples the canonical
 * universe snapshot and the ONE CoreVisualState on the render
 * frame, so it always coordinates with the same living system
 * as the Genesis Core.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector3,
} from "three";

import { useGenesis } from "../GenesisCore";

interface ParticleSeed {
  radius: number;
  angle: number;
  height: number;
  speed: number;
  phase: number;
  size: number;
}

interface LightningSeed {
  line: Line;
  phase: number;
  speed: number;
}

const RING_COUNT = 12;
const PARTICLE_COUNT = 40;
const LIGHTNING_COUNT = 4;

/*
 * The cosmic field lives in the ENVIRONMENT, not wrapped around the
 * Core. The atmospheric ring bands (electromagnetic, biofield aura,
 * galaxy, storms, nebula) are DECENTRALIZED: each ring group is offset
 * to a different part of the cosmos with its own depth tier, so the
 * bands sweep through the space among the stars like large-scale
 * cosmic phenomena instead of concentric rings centered on the Core.
 * The node systems (constellations, particles, glyphs, human design,
 * creations, lightning) orbit at a clear distance (NODE_SCALE) so
 * nothing forms a shell or cage around the Genesis Core and the
 * workspace worlds sit naturally inside the larger field.
 */
const AURORA_RING_SCALE = 5.6;
const NODE_SCALE = 4.4;

const NEBULA_SEEDS = [
  { color: "#5964ff", position: [-2.15, 1.1, -3.2] as [number, number, number], rotation: 1 },
  { color: "#27d7ff", position: [1.9, -0.9, -3.5] as [number, number, number], rotation: -0.35 },
  { color: "#df72ff", position: [0.8, 1.65, -3.8] as [number, number, number], rotation: 0.55 },
];

const nebulaVertexShader = `
  varying vec3 vPosition;
  varying vec3 vNormal;

  void main() {
    vPosition = position;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const nebulaFragmentShader = `
  uniform float uTime;
  uniform float uActivity;
  uniform float uPhase;
  uniform vec3 uColor;

  varying vec3 vPosition;
  varying vec3 vNormal;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(17.13, 59.41, 13.17))) * 43758.5453);
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

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vPosition);
    float rim = pow(1.0 - abs(dot(normalize(vNormal), viewDirection)), 1.8);
    float cloud = noise(vPosition * 2.8 + vec3(uTime * 0.08, -uTime * 0.05, uPhase));
    cloud += noise(vPosition * 6.0 - vec3(uTime * 0.12, uPhase, 0.0)) * 0.45;
    cloud = smoothstep(0.32, 0.92, cloud);
    float alpha = (cloud * 0.18 + rim * 0.22) * (0.45 + uActivity * 0.9);
    vec3 color = uColor * (0.45 + cloud * 0.8 + rim * 0.35);
    gl_FragColor = vec4(color, alpha);
  }
`;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function createLightning(): LightningSeed[] {
  return Array.from({ length: LIGHTNING_COUNT }, (_, index) => {
    const points: number[] = [];
    // Bolts float in the environment at a clear distance from the Core —
    // never radiating out of the Core's origin (that read as a cage).
    const direction = new Vector3(
      Math.cos(index * 2.7) * 0.8 + Math.sin(index) * 0.4,
      Math.sin(index * 1.9) * 0.8,
      Math.sin(index * 2.1) * 0.8,
    ).normalize();
    const start = direction.clone().multiplyScalar(5.4 + (index % 3) * 0.9);
    const end = direction.clone().multiplyScalar(9.5 + (index % 3) * 1.2);

    for (let segment = 0; segment <= 10; segment += 1) {
      const t = segment / 10;
      const point = new Vector3().lerpVectors(start, end, t);
      point.x += Math.sin(segment * 4.1 + index) * 0.12 * (1 - t);
      point.y += Math.cos(segment * 3.2 + index) * 0.12 * (1 - t);
      point.z += Math.sin(segment * 2.8 + index) * 0.08;
      points.push(point.x, point.y, point.z);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));

    return {
      line: new Line(
        geometry,
        new LineBasicMaterial({
          color: new Color(index % 2 === 0 ? "#7df9ff" : "#e3a7ff"),
          transparent: true,
          opacity: 0.5,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      phase: index * 0.8,
      speed: 1.4 + (index % 3) * 0.45,
    };
  });
}

export default function CosmicField() {
  const { universe, getLiveUniverse, engineRuntime } = useGenesis();
  const field = useRef<Group>(null);
  const constellation = useRef<Group>(null);
  const electromagnetic = useRef<Group>(null);
  const biofield = useRef<Group>(null);
  const galaxy = useRef<Group>(null);
  const nebula = useRef<Group>(null);
  const storms = useRef<Group>(null);
  const particles = useRef<Group>(null);
  const lightning = useRef<Group>(null);
  const glyphOrbit = useRef<Group>(null);
  const humanDesign = useRef<Group>(null);
  const creations = useRef<Group>(null);
  const time = useRef(0);

  const ringSeeds = useMemo(
    () => Array.from({ length: RING_COUNT }, (_, index) => ({
      radius: 1.45 + index * 0.09,
      tilt: (index % 4) * 0.28,
      speed: 0.05 + (index % 3) * 0.035,
    })),
    [],
  );

  const particleSeeds = useMemo<ParticleSeed[]>(
    () => Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
      radius: (1.52 + (index % 14) * 0.065) * NODE_SCALE,
      angle: index * 2.39996,
      height: ((index % 11) - 5) * 0.075,
      speed: 0.18 + (index % 7) * 0.045,
      phase: index * 0.47,
      size: 0.014 + (index % 4) * 0.005,
    })),
    [],
  );

  const lightningSeeds = useMemo(createLightning, []);
  const initialCosmic = universe.celestial.cosmicEnergy;
  const nebulaMaterials = useMemo(
    () => NEBULA_SEEDS.map(({ color }, index) => new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uActivity: { value: 0.35 },
        uPhase: { value: index * 1.8 },
        uColor: { value: new Color(color) },
      },
      vertexShader: nebulaVertexShader,
      fragmentShader: nebulaFragmentShader,
    })),
    [],
  );

  useFrame((_, delta) => {
    if (!field.current) return;

    time.current += delta;
    const live = getLiveUniverse();
    const evolution = live.evolutionSystem;
    const astrology = live.astrology;
    const celestial = live.celestial;
    const ocean = live.ocean;
    const cosmic = clamp((celestial.cosmicEnergy + celestial.stars + celestial.planets + astrology.transit) / 4);
    const storm = clamp(ocean.stormSurge + ocean.tsunami * 0.8 + evolution.instability * 0.35);
    const emergence = clamp(evolution.emergence + live.reality * 0.18);

    // ONE activity from the ONE CoreVisualState — this cosmic field is
    // part of the same living system as the Core, not an independent
    // controller with its own activity formula.
    const visualState = engineRuntime?.getEngineBus().getVisualState();
    const activity = visualState
      ? visualState.activity
      : clamp(0.22 + live.energy * 0.2 + emergence * 0.3 + cosmic * 0.28 + storm * 0.18);

    field.current.rotation.y += delta * (0.018 + activity * 0.07);
    field.current.rotation.x = Math.sin(time.current * 0.16) * 0.045;

    if (constellation.current) {
      constellation.current.rotation.y -= delta * (0.04 + astrology.zodiac * 0.14);
      constellation.current.rotation.z = Math.sin(time.current * 0.22) * (0.035 + astrology.alignment * 0.08);
    }
    if (electromagnetic.current) {
      electromagnetic.current.rotation.y += delta * (0.1 + astrology.planetaryEnergy * 0.28);
      electromagnetic.current.rotation.x = Math.sin(time.current * 0.52) * (0.07 + ocean.current * 0.12);
    }
    if (biofield.current) {
      biofield.current.rotation.z = Math.cos(time.current * 0.2) * 0.09;
      biofield.current.scale.setScalar(1 + Math.sin(time.current * (0.8 + emergence)) * 0.035 + activity * 0.08);
    }
    if (galaxy.current) {
      galaxy.current.rotation.y += delta * (0.06 + cosmic * 0.2);
      galaxy.current.rotation.z -= delta * (0.028 + cosmic * 0.04);
      galaxy.current.scale.setScalar(1 + cosmic * 0.22);
    }
    if (nebula.current) {
      nebula.current.rotation.z += delta * (0.012 + cosmic * 0.035);
      nebula.current.position.x = Math.sin(time.current * 0.08) * 0.28;
      nebula.current.position.y = Math.cos(time.current * 0.06) * 0.2;
      nebulaMaterials.forEach((material, index) => {
        material.uniforms.uTime.value = time.current;
        material.uniforms.uActivity.value = activity;
        material.uniforms.uPhase.value = index * 1.8 + cosmic * 0.7;
      });
    }
    if (storms.current) {
      storms.current.rotation.y -= delta * (0.16 + storm * 0.8);
      storms.current.rotation.z = Math.sin(time.current * 0.8) * storm * 0.18;
      storms.current.scale.setScalar(1 + storm * 0.3);
    }
    if (glyphOrbit.current) {
      glyphOrbit.current.rotation.y -= delta * (0.1 + astrology.transit * 0.24);
      glyphOrbit.current.rotation.x = Math.sin(time.current * 0.38) * 0.12;
    }
    if (humanDesign.current) {
      humanDesign.current.rotation.z += delta * (0.04 + live.intelligence * 0.1);
      humanDesign.current.scale.setScalar(1 + live.consciousness * 0.1 + Math.sin(time.current * 1.2) * 0.025);
    }
    if (creations.current) {
      creations.current.rotation.y += delta * (0.18 + emergence * 0.35);
      creations.current.position.y = Math.sin(time.current * 0.58) * 0.11;
      creations.current.scale.setScalar(0.88 + emergence * 0.34 + Math.sin(time.current * 1.6) * 0.045);
    }
    if (particles.current) {
      particles.current.children.forEach((child, index) => {
        const seed = particleSeeds[index];
        if (!seed) return;
        const angle = seed.angle + time.current * seed.speed * (1 + activity);
        const radius = seed.radius + Math.sin(time.current * 0.9 + seed.phase) * (0.035 + emergence * 0.045);
        child.position.set(Math.cos(angle) * radius, seed.height + Math.sin(angle * 2 + seed.phase) * 0.12, Math.sin(angle) * radius);
        child.scale.setScalar(0.8 + activity * 0.8 + Math.sin(time.current * 2 + seed.phase) * 0.18);
      });
    }
    if (lightning.current) {
      lightning.current.children.forEach((child, index) => {
        const seed = lightningSeeds[index];
        if (!seed) return;
        const material = (child as Line).material as LineBasicMaterial;
        const flash = Math.pow(Math.max(0, Math.sin(time.current * seed.speed + seed.phase)), 7);
        material.opacity = 0.16 + flash * (0.42 + storm * 0.72);
      });
    }

    field.current.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      const material = mesh.material as MeshBasicMaterial;
      const baseOpacity = mesh.userData.baseOpacity as number | undefined;
      if (!material || baseOpacity === undefined) return;
      material.opacity = baseOpacity * (0.78 + activity * 0.95);
    });
  });

  return (
    <group ref={field} name="ActiveCosmicVisualField" renderOrder={4}>
      <group ref={constellation} name="AstrologyConstellations">
        {ringSeeds.slice(0, 2).map((seed, index) => (
          <mesh key={`zodiac-${index}`} rotation={[seed.tilt, index * 0.31, index * 0.52]} userData={{ baseOpacity: 0.2 }}>
            <torusGeometry args={[(seed.radius + 0.28) * NODE_SCALE, 0.006, 8, 112]} />
            <meshBasicMaterial color={index % 2 === 0 ? "#ffd778" : "#8bdcff"} transparent opacity={0.2} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
        {Array.from({ length: 8 }, (_, index) => {
          const angle = index * Math.PI / 6;
          return (
            <mesh key={`zodiac-node-${index}`} position={[Math.cos(angle) * 1.9 * NODE_SCALE, Math.sin(index * 1.7) * 0.15 * NODE_SCALE, Math.sin(angle) * 1.9 * NODE_SCALE]} userData={{ baseOpacity: 0.82 }}>
              <sphereGeometry args={[0.034 + initialCosmic * 0.024, 10, 10]} />
              <meshBasicMaterial color="#ffe8a3" transparent opacity={0.82} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          );
        })}
      </group>

      <group ref={electromagnetic} name="ElectromagneticField" position={[-4.5, 1.6, -3.5]}>
        {ringSeeds.slice(0, 2).map((seed, index) => (
          <mesh key={`emf-${index}`} rotation={[Math.PI / 2 + seed.tilt, 0, index * 0.2]} userData={{ baseOpacity: 0.18 }}>
            <torusGeometry args={[seed.radius * AURORA_RING_SCALE, 0.009, 12, 144]} />
            <meshBasicMaterial color={index % 3 === 0 ? "#4ce8ff" : "#87a8ff"} transparent opacity={0.18} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <group ref={biofield} name="BiofieldAura" position={[5.2, -1.4, -4.5]}>
        {[1].map((index) => (
          <mesh key={`aura-${index}`} rotation={[index * 0.55, index * 0.35, index * 0.8]} userData={{ baseOpacity: 0.16 - index * 0.025 }}>
            <torusGeometry args={[(1.88 + index * 0.17) * AURORA_RING_SCALE, 0.02, 18, 144]} />
            <meshBasicMaterial color={index % 2 === 0 ? "#7dffd6" : "#82cfff"} transparent opacity={0.16 - index * 0.025} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <group ref={galaxy} name="GalaxyFractalField" position={[-2.6, -3.6, -7.5]}>
        {[1].map((index) => (
          <mesh key={`galaxy-ring-${index}`} rotation={[index * 0.62, index * 0.33, index * 0.8]} userData={{ baseOpacity: 0.15 - index * 0.022 }}>
            <torusGeometry args={[(2.08 + index * 0.15) * AURORA_RING_SCALE, 0.024 - index * 0.003, 16, 176]} />
            <meshBasicMaterial color={index % 2 === 0 ? "#76bfff" : "#d9a7ff"} transparent opacity={0.15 - index * 0.022} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <group ref={nebula} name="NebulaField" position={[0, 0, -11]}>
        {NEBULA_SEEDS.map(({ position, rotation }, index) => (
          <mesh key={`nebula-${index}`} position={[position[0] * 2.6, position[1] * 2.6, position[2] * 2.6]} rotation={[0, 0, rotation]} scale={1 + initialCosmic * 0.2} userData={{ baseOpacity: 0.12 }}>
            <sphereGeometry args={[2.75, 48, 32]} />
            <primitive object={nebulaMaterials[index]} attach="material" />
          </mesh>
        ))}
      </group>

      <group ref={storms} name="CosmicStorms" position={[3.4, 3.2, -9]}>
        {[1].map((index) => (
          <mesh key={`storm-${index}`} rotation={[Math.PI / 2, index * 0.7, index * 0.4]} userData={{ baseOpacity: 0.2 }}>
            <torusGeometry args={[(2.24 + index * 0.18) * AURORA_RING_SCALE, 0.024, 16, 144]} />
            <meshBasicMaterial color={index === 1 ? "#ff9fdf" : "#6beaff"} transparent opacity={0.2} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <group ref={lightning} name="CosmicLightning">
        {lightningSeeds.map((seed, index) => <primitive key={`bolt-${index}`} object={seed.line} />)}
      </group>

      <group ref={particles} name="EnergyParticles">
        {particleSeeds.map((seed, index) => (
          <mesh key={`particle-${index}`} position={[Math.cos(seed.angle) * seed.radius, seed.height, Math.sin(seed.angle) * seed.radius]} userData={{ baseOpacity: 0.42 }}>
            <sphereGeometry args={[seed.size, 7, 7]} />
            <meshBasicMaterial color={index % 5 === 0 ? "#ffe49a" : "#9eeaff"} transparent opacity={0.42} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <group ref={glyphOrbit} name="GlyphOrbit" rotation={[0.8, 0.2, 0.4]}>
        {Array.from({ length: 6 }, (_, index) => {
          const angle = index * Math.PI / 8;
          return (
            <mesh key={`glyph-${index}`} position={[Math.cos(angle) * 2.46 * NODE_SCALE, Math.sin(index * 2.1) * 0.14 * NODE_SCALE, Math.sin(angle) * 2.46 * NODE_SCALE]} rotation={[0, -angle, Math.PI / 4]} userData={{ baseOpacity: 0.42 }}>
              <octahedronGeometry args={[0.075, 1]} />
              <meshBasicMaterial color={index % 2 === 0 ? "#f5fbff" : "#d5a7ff"} transparent opacity={0.42} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          );
        })}
      </group>

      <group ref={humanDesign} name="HumanDesignNetwork" rotation={[0.2, 0.4, 0.1]}>
        {Array.from({ length: 6 }, (_, index) => {
          const angle = index * Math.PI * 2 / 9;
          return (
            <mesh key={`design-node-${index}`} position={[Math.cos(angle) * 1.42 * NODE_SCALE, Math.sin(index * 1.4) * 0.32 * NODE_SCALE, Math.sin(angle) * 1.42 * NODE_SCALE]} userData={{ baseOpacity: 0.62 }}>
              <sphereGeometry args={[0.035, 10, 10]} />
              <meshBasicMaterial color="#ffb6e8" transparent opacity={0.62} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          );
        })}
      </group>

      <group ref={creations} name="EmergentCreations">
        {Array.from({ length: 6 }, (_, index) => {
          const angle = index * Math.PI / 4;
          return (
            <mesh key={`creation-${index}`} position={[Math.cos(angle) * (1.12 + (index % 2) * 0.18) * NODE_SCALE, Math.sin(index * 1.8) * 0.22 * NODE_SCALE, Math.sin(angle) * (1.12 + (index % 2) * 0.18) * NODE_SCALE]} rotation={[index * 0.35, angle, index * 0.18]} userData={{ baseOpacity: 0.58 }}>
              <coneGeometry args={[0.075 + (index % 3) * 0.02, 0.32 + (index % 2) * 0.18, 5]} />
              <meshBasicMaterial color={index % 2 === 0 ? "#a7fff0" : "#ffc878"} transparent opacity={0.58} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
