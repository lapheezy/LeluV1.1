/**
 * ==========================================================
 * LÉLUVERSE
 * STAR FIELD
 *
 * Living celestial field surrounding the FULL cosmic
 * environment. Rendered as a single GPU point cloud laid out
 * as a layered spherical shell, so stars wrap the whole scene
 * — left, right, above, below, front, and behind the Core and
 * the workspace worlds. No side of the viewport is left dead.
 *
 * Layers:
 * - near shell (large, sparse, warm)
 * - mid shell (dense, varied color)
 * - far shell (tiny, cool tint)
 *
 * Connected to:
 * - Genesis universe state
 * - celestial energy
 * - cosmic evolution
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  ShaderMaterial,
  Vector3,
} from "three";

import { useGenesis } from "../../GenesisCore";

const STAR_COUNT = 2400;
const NEAR_COUNT = 320;
const MID_COUNT = 1100;

const vertexShader = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute vec3 aColor;

  uniform float uTime;

  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.72 + 0.5 * sin(uTime * aSpeed + aPhase);
    vTwinkle = twinkle;
    gl_PointSize = aSize * (380.0 / -mvPosition.z) * twinkle;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    float alpha = smoothstep(0.5, 0.06, dist);
    // Soft cross flare for the brightest stars
    float flare = 0.0;
    vec2 absC = abs(center);
    flare = smoothstep(0.5, 0.02, max(absC.x, absC.y)) * 0.22;
    vec3 color = vColor * (0.7 + vTwinkle * 0.45);
    gl_FragColor = vec4(color, alpha * (0.35 + vTwinkle * 0.65));
  }
`;

interface Star {
  position: Vector3;
  size: number;
  phase: number;
  speed: number;
  color: number[];
}

function randomStar(index: number): Star {
  // Layered spherical shell so the cosmos truly surrounds the scene: left,
  // right, above, below, in front, and behind the Core/workspaces. Each band
  // is a shell at a different radius; within a band, stars are spread
  // uniformly over the full sphere (no dead side, no flat sheet).
  const band = index < NEAR_COUNT
    ? 0 // near shell: sparse, large, warm
    : index < NEAR_COUNT + MID_COUNT
      ? 1 // mid shell: dense, varied
      : 2; // far shell: tiny, cool

  const minRadius = band === 0 ? 12 : band === 1 ? 22 : 46;
  const maxRadius = band === 0 ? 20 : band === 1 ? 42 : 74;
  const radius = minRadius + Math.random() * (maxRadius - minRadius);

  // Uniform direction on the unit sphere: y uniform in [-1, 1] with the
  // horizontal radius derived from it gives an even density everywhere.
  const theta = Math.random() * Math.PI * 2;
  const y = 1 - 2 * Math.random();
  const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
  const x = horizontal * Math.cos(theta);
  const z = horizontal * Math.sin(theta);

  const size = band === 0
    ? 0.055 + Math.random() * 0.09
    : band === 1
      ? 0.03 + Math.random() * 0.07
      : 0.035 + Math.random() * 0.045;

  const palette =
    band === 0
      ? [
        [1.0, 0.95, 0.82], // warm white
        [0.75, 0.88, 1.0], // cool white
        [1.0, 0.82, 0.62], // amber
      ]
      : band === 1
        ? [
          [1.0, 1.0, 1.0],
          [0.65, 0.86, 1.0],
          [0.82, 0.68, 1.0],
          [1.0, 0.9, 0.72],
          [0.62, 1.0, 0.95],
        ]
        : [
          [0.55, 0.7, 0.9],
          [0.7, 0.72, 0.9],
          [0.6, 0.85, 1.0],
        ];

  const color = palette[Math.floor(Math.random() * palette.length)];
  const brightness = 0.55 + Math.random() * 0.45;

  return {
    position: new Vector3(x * radius, y * radius, z * radius),
    size,
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 1.4,
    color: color.map((channel) => channel * brightness),
  };
}

export default function StarField() {
  const { getLiveUniverse } = useGenesis();
  const group = useRef<Group>(null);

  const { geometry, material } = useMemo(() => {
    const stars = Array.from({ length: STAR_COUNT }, (_, index) => randomStar(index));

    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const phases = new Float32Array(STAR_COUNT);
    const speeds = new Float32Array(STAR_COUNT);
    const colors = new Float32Array(STAR_COUNT * 3);

    stars.forEach((star, index) => {
      positions.set([star.position.x, star.position.y, star.position.z], index * 3);
      sizes[index] = star.size;
      phases[index] = star.phase;
      speeds[index] = star.speed;
      colors.set(star.color, index * 3);
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
    geometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
    geometry.setAttribute("aColor", new BufferAttribute(colors, 3));

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader,
      fragmentShader,
    });

    return { geometry, material };
  }, []);

  useFrame(({ clock }, delta) => {
    if (!group.current) return;

    const liveUniverse = getLiveUniverse();
    const cosmicEnergy = liveUniverse.celestial?.cosmicEnergy ?? 0;
    const stars = liveUniverse.celestial?.stars ?? 0;

    material.uniforms.uTime.value = clock.elapsedTime;

    group.current.rotation.y += delta * (0.004 + cosmicEnergy * 0.012 + stars * 0.01);
    group.current.rotation.x = Math.sin(clock.elapsedTime * 0.05) * 0.012;

    const scale = 1 + cosmicEnergy * 0.05 + stars * 0.04;
    group.current.scale.setScalar(scale);
  });

  return (
    <group ref={group} name="LivingStarField" renderOrder={1}>
      <points
        geometry={geometry}
        material={material}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}
