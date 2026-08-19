/**
 * ==========================================================
 * LÉLUVERSE
 * COSMIC BACKDROP
 *
 * Procedural deep-space environment that fills the entire
 * viewport. One inverted sphere with a layered noise shader:
 * - deep-space gradient (no flat black band)
 * - drifting nebula bands
 * - cosmic dust motes
 * - violet horizon glow near the bottom
 *
 * Color responds to the live Genesis evolution state so the
 * background breathes with the core instead of staying flat.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, BackSide, Group, ShaderMaterial } from "three";

import { useGenesis } from "../GenesisCore";

const vertexShader = `
  varying vec3 vDir;

  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uActivity;
  uniform float uHue;

  varying vec3 vDir;

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

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; octave += 1) {
      value += noise(p) * amplitude;
      p = p * 2.03 + vec2(11.7, 5.3);
      amplitude *= 0.5;
    }
    return value;
  }

  vec3 hue(float h) {
    vec3 k = vec3(1.0, 2.0 / 3.0, 1.0 / 3.0);
    vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0);
    return clamp(p - 1.0, 0.0, 1.0);
  }

  void main() {
    vec2 dir = vDir.xz;
    // Slow, huge drift so the background always moves.
    vec2 flow = vec2(uTime * 0.012, -uTime * 0.008);

    // Deep-space vertical gradient — bottom slightly violet, top deep indigo.
    float height = vDir.y * 0.5 + 0.5;
    vec3 base = mix(vec3(0.008, 0.012, 0.045), vec3(0.02, 0.008, 0.06), height);
    base += vec3(0.012, 0.006, 0.02) * pow(1.0 - height, 2.0);

    // Layered nebula bands wrapping around the sky — separate octave flows
    // per band so cyan, violet and emerald formations drift independently.
    float bands = fbm(dir * 1.15 + flow);
    float bands2 = fbm(dir * 2.6 - flow * 1.4 + vec2(31.0, 7.0));
    float bands3 = fbm(dir * 1.8 + flow * 0.7 + vec2(57.0, 19.0));
    float cloud = smoothstep(0.4, 0.96, bands * 0.55 + bands2 * 0.3 + bands3 * 0.15);

    vec3 nebulaColor = mix(
      vec3(0.10, 0.18, 0.42),
      hue(uHue) * vec3(0.55, 0.85, 1.0),
      uActivity,
    );
    // Violet/magenta veils.
    nebulaColor = mix(nebulaColor, vec3(0.48, 0.16, 0.72), bands2 * 0.5);
    // Emerald accents.
    nebulaColor = mix(nebulaColor, vec3(0.05, 0.42, 0.42), bands3 * 0.35 * (0.4 + uActivity * 0.6));
    // Warm pink horizon wisps near the bottom.
    float low = smoothstep(0.55, 0.95, 1.0 - height);
    nebulaColor = mix(nebulaColor, vec3(0.55, 0.20, 0.42), low * bands2 * 0.45);

    vec3 color = base + nebulaColor * cloud * (0.6 + uActivity * 0.65);

    // Cosmic dust — fine motes scattered through the sky.
    float dust = fbm(dir * 7.0 + flow * 2.0);
    color += vec3(0.16, 0.20, 0.30) * smoothstep(0.62, 0.92, dust) * 0.14;

    // Faint horizon wash so the bottom edge of the view never reads dead.
    float horizon = smoothstep(0.15, 0.55, 1.0 - abs(vDir.y));
    color += vec3(0.05, 0.10, 0.22) * horizon * (0.3 + uActivity * 0.5);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export default function CosmicBackdrop() {
  const { getLiveUniverse } = useGenesis();
  const group = useRef<Group>(null);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uActivity: { value: 0.25 },
          uHue: { value: 0.58 },
        },
        vertexShader,
        fragmentShader,
      }),
    [],
  );

  useFrame(({ clock }) => {
    if (!group.current) return;

    const liveUniverse = getLiveUniverse();
    const celestial = liveUniverse.celestial;
    const evolution = liveUniverse.evolutionSystem;
    const activity = Math.min(
      1,
      0.2 +
        (celestial.cosmicEnergy + celestial.stars + celestial.planets) * 0.3 +
        evolution.emergence * 0.25,
    );

    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uActivity.value = activity;
    material.uniforms.uHue.value = 0.58 + evolution.colorShift * 0.9;

    group.current.rotation.y = clock.elapsedTime * 0.004;
  });

  return (
    <group ref={group} name="CosmicBackdrop" renderOrder={0}>
      <mesh material={material} renderOrder={0} raycast={() => null} frustumCulled={false}>
        <sphereGeometry args={[85, 48, 32]} />
      </mesh>
    </group>
  );
}
