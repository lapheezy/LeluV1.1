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
import { sampleCosmosAtmosphere } from "../cosmos/CosmosAtmosphere";

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
  uniform float uCoreColors;
  uniform float uSunset;
  uniform float uStatic;
  uniform float uStorm;
  uniform float uHurricane;
  uniform float uLightning;

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

    // Atmospheric phase grading over the same persistent sky. These values
    // change how the universe is experienced; they never alter its objects.
    vec3 coreAtmosphere = vec3(0.04, 0.36, 0.82) + hue(0.88) * 0.18;
    vec3 sunsetAtmosphere = mix(vec3(0.95, 0.12, 0.08), vec3(0.86, 0.2, 0.58), height);
    vec3 stormAtmosphere = mix(vec3(0.012, 0.035, 0.085), vec3(0.16, 0.035, 0.22), height);
    color += coreAtmosphere * cloud * uCoreColors * 0.45;
    color += sunsetAtmosphere * cloud * uSunset * 0.32;
    color = mix(color, color * 0.42 + stormAtmosphere * 0.36, uStorm * 0.46);

    // A rotating atmospheric spiral and temporary signal interference are
    // layered over the sky shell, never substituted for the star field.
    float radius = length(dir);
    float angle = atan(dir.y, dir.x);
    float spiral = smoothstep(0.18, 0.85, 0.5 + 0.5 * sin(angle * 5.0 - uTime * 0.18 + radius * 13.0));
    color += vec3(0.1, 0.18, 0.38) * spiral * uHurricane * 0.32;
    float scanline = 0.5 + 0.5 * sin(vDir.y * 180.0 + uTime * 2.4);
    float signalNoise = hash(dir * 320.0 + uTime * 0.5);
    color += vec3(0.18, 0.65, 0.9) * (scanline * 0.5 + signalNoise * 0.5) * uStatic * 0.07;
    color += vec3(0.72, 0.84, 1.0) * pow(max(0.0, sin(uTime * 7.0 + angle * 3.0)), 14.0) * uLightning * 0.22;

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
          uCoreColors: { value: 0 },
          uSunset: { value: 0 },
          uStatic: { value: 0 },
          uStorm: { value: 0 },
          uHurricane: { value: 0 },
          uLightning: { value: 0 },
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

    const atmosphere = sampleCosmosAtmosphere(clock.elapsedTime);
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uActivity.value = Math.min(1, activity * 0.6 + atmosphere.intensity * 0.7);
    material.uniforms.uHue.value = 0.58 + evolution.colorShift * 0.9 + atmosphere.hueShift;
    material.uniforms.uCoreColors.value = atmosphere.coreColors;
    material.uniforms.uSunset.value = atmosphere.sunset;
    material.uniforms.uStatic.value = atmosphere.static;
    material.uniforms.uStorm.value = atmosphere.storm;
    material.uniforms.uHurricane.value = atmosphere.hurricane;
    material.uniforms.uLightning.value = atmosphere.lightning;

    group.current.rotation.y = clock.elapsedTime * 0.004;
  });

  return (
    <group ref={group} name="CosmicBackdrop" renderOrder={0}>
      <mesh material={material} renderOrder={0} raycast={() => null} frustumCulled={false}>
        <sphereGeometry args={[600, 48, 32]} />
      </mesh>
    </group>
  );
}
