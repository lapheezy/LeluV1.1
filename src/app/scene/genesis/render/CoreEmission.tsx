/**
 * ==========================================================
 * LÉLUVERSE
 * CORE EMISSION — ENERGY LEAVING THE ONE CORE
 *
 * Every energy effect that leaves the Core lives here, and only
 * here. Nothing renders as a separate object around the Core:
 *
 * - a GPU particle field emitted from the Core surface
 *   (ocean droplets / plasma sparks / electric ions / bio spores)
 * - electric arcs that break out of the surface
 * - expanding ocean wave rings that ripple outward from the Core
 *
 * All of it is colored and driven by the SAME EngineBus weights
 * as the Core surface, so the emission always reads as energy
 * originating from ONE Core and propagating into the cosmos.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  ShaderMaterial,
  Vector3,
} from "three";

import { useGenesis } from "../GenesisCore";

const PARTICLE_COUNT = 420;
const ARC_COUNT = 14;
const RING_COUNT = 2;

const particleVertexShader = `
  attribute vec3 aDir;
  attribute float aStart;
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aSize;
  attribute float aTint;

  uniform float uTime;
  uniform float uActivity;
  uniform float uSpread;

  varying float vAlpha;
  varying float vTint;

  void main() {
    float t = fract(uTime * aSpeed + aPhase);
    float radius = mix(aStart, aStart + 1.3 + uSpread * 1.7, t);
    vec3 p = aDir * radius;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = aSize * (280.0 / max(1.0, -mv.z)) * (1.0 - t * 0.55);
    vAlpha = (1.0 - t) * (0.32 + uActivity * 0.5);
    vTint = aTint;
    gl_PointSize = size;
    gl_Position = projectionMatrix * mv;
  }
`;

const particleFragmentShader = `
  uniform vec3 uStateColor;
  uniform vec3 uStateGlow;

  varying float vAlpha;
  varying float vTint;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float alpha = smoothstep(0.5, 0.04, d) * vAlpha;
    vec3 color = mix(uStateColor, uStateGlow, 0.35 + vTint * 0.5);
    color += uStateGlow * smoothstep(0.5, 0.15, d) * 0.35;
    gl_FragColor = vec4(color, alpha);
  }
`;

function createParticleSystem(): {
  geometry: BufferGeometry;
  material: ShaderMaterial;
} {
  const dirs = new Float32Array(PARTICLE_COUNT * 3);
  const starts = new Float32Array(PARTICLE_COUNT);
  const speeds = new Float32Array(PARTICLE_COUNT);
  const phases = new Float32Array(PARTICLE_COUNT);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const tints = new Float32Array(PARTICLE_COUNT);

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    // Uniform direction on the unit sphere, so emission spreads in every
    // direction from the Core surface.
    const theta = Math.random() * Math.PI * 2;
    const y = 1 - 2 * Math.random();
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    dirs[index * 3] = horizontal * Math.cos(theta);
    dirs[index * 3 + 1] = y;
    dirs[index * 3 + 2] = horizontal * Math.sin(theta);
    starts[index] = 0.95 + Math.random() * 0.3;
    speeds[index] = 0.1 + Math.random() * 0.22;
    phases[index] = Math.random();
    sizes[index] = 0.03 + Math.random() * 0.05;
    tints[index] = Math.random();
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("aDir", new BufferAttribute(dirs, 3));
  geometry.setAttribute("aStart", new BufferAttribute(starts, 1));
  geometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
  geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aTint", new BufferAttribute(tints, 1));

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.4 },
      uSpread: { value: 0.5 },
      uStateColor: { value: new Color("#4BD9FF") },
      uStateGlow: { value: new Color("#aef3ff") },
    },
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
  });

  return { geometry, material };
}

function createArc(index: number): {
  line: Line;
  phase: number;
  speed: number;
} {
  const direction = new Vector3(
    Math.cos(index * 2.7) * 0.8,
    Math.sin(index * 1.9) * 0.8,
    Math.sin(index * 2.1) * 0.8,
  ).normalize();
  const end = direction.clone().multiplyScalar(1.7 + (index % 3) * 0.5);
  const points: number[] = [];

  for (let segment = 0; segment <= 8; segment += 1) {
    const t = segment / 8;
    const point = direction.clone().multiplyScalar(0.95 + t * (end.length() - 0.95));
    point.x += Math.sin(segment * 3.1 + index * 1.3) * 0.1 * (1 - t);
    point.y += Math.cos(segment * 2.4 + index) * 0.1 * (1 - t);
    point.z += Math.sin(segment * 2.7 + index * 0.6) * 0.08;
    points.push(point.x, point.y, point.z);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(points), 3),
  );

  return {
    line: new Line(
      geometry,
      new LineBasicMaterial({
        color: new Color("#7df9ff"),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
    phase: index * 0.9,
    speed: 1.2 + (index % 3) * 0.4,
  };
}

function createRingGeometry(): BufferGeometry {
  const points: number[] = [];
  const segments = 64;
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(Math.cos(angle), 0, Math.sin(angle));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(points), 3),
  );
  return geometry;
}

export default function CoreEmission() {
  const { engineRuntime } = useGenesis();

  const root = useRef<Group>(null);
  const particlesRef = useRef<{ geometry: BufferGeometry; material: ShaderMaterial } | null>(null);

  const particles = useMemo(createParticleSystem, []);
  const arcs = useMemo(
    () => Array.from({ length: ARC_COUNT }, (_, index) => createArc(index)),
    [],
  );
  const rings = useMemo(
    () =>
      Array.from({ length: RING_COUNT }, (_, index) => {
        const line = new Line(
          createRingGeometry(),
          new LineBasicMaterial({
            color: new Color("#3adbd0"),
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        line.position.y = (index - 1) * 0.28;
        return {
          line,
          phase: index / RING_COUNT,
          speed: 0.16 + index * 0.05,
        };
      }),
    [],
  );

  const white = useMemo(() => new Color("#ffffff"), []);

  useFrame((_, delta) => {
    if (!root.current) {
      return;
    }

    // The ONE visual state — same derivation, same colors, same pulse
    // as the Core surface. This emission is energy leaving that Core.
    const vs = engineRuntime?.getEngineBus().getVisualState();
    if (!vs) {
      return;
    }

    const { stateWeights, stateColor, stateGlow, activity, time } = vs;

    if (particlesRef.current) {
      const material = particlesRef.current.material;
      material.uniforms.uTime.value = time;
      material.uniforms.uActivity.value = activity;
      material.uniforms.uSpread.value =
        stateWeights.electric * 0.65 +
        stateWeights.plasma * 0.5 +
        stateWeights.ocean * 0.3;
      material.uniforms.uStateColor.value.copy(stateColor);
      material.uniforms.uStateGlow.value.copy(stateGlow);
    }

    arcs.forEach((arc) => {
      const material = arc.line.material as LineBasicMaterial;
      const flash = Math.pow(
        Math.max(0, Math.sin(time * arc.speed + arc.phase)),
        6,
      );
      material.opacity =
        stateWeights.electric * (0.35 + flash * 0.65) +
        stateWeights.plasma * flash * 0.15;
      material.color.copy(stateColor).lerp(white, 0.65);
      arc.line.rotation.y += delta * 0.1;
    });

    rings.forEach((ring) => {
      const t = (time * ring.speed + ring.phase) % 1;
      ring.line.scale.setScalar(0.95 + t * 1.9);
      const material = ring.line.material as LineBasicMaterial;
      material.opacity =
        stateWeights.ocean * (1 - t) * 0.5 * (0.4 + activity * 0.6);
      material.color.copy(stateColor).lerp(white, 0.55);
    });
  });

  return (
    <group ref={root} name="CoreEmission" renderOrder={210}>
      <points
        ref={(object) => {
          particlesRef.current = object
            ? { geometry: particles.geometry, material: particles.material }
            : null;
        }}
        geometry={particles.geometry}
        material={particles.material}
        frustumCulled={false}
        raycast={() => null}
      />

      {arcs.map((arc, index) => (
        <primitive key={`arc-${index}`} object={arc.line} />
      ))}

      {rings.map((ring, index) => (
        <primitive key={`ring-${index}`} object={ring.line} />
      ))}
    </group>
  );
}
