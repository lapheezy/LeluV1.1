/**
 * ==========================================================
 * LÉLU — HER HOLOGRAPHIC FORM, ON HER OWN 3D MODEL
 *
 * The same her, projected: not another character and not a tint. Her own
 * approved model keeps its geometry, skeleton, clips and face controls;
 * its materials gain one extra stage, blended by `uHolo` (0 = as she is,
 * 1 = fully projected):
 *
 *   - colour becomes light: her own luminance mapped onto a cyan ramp, so
 *     her face, hair and outfit stay readable as HER;
 *   - a Fresnel edge glow outlines her silhouette;
 *   - scanlines travel up her body, with a faint flicker;
 *   - rare horizontal glitch bands displace a slice of her (vertex stage);
 *   - she becomes translucent (brighter parts more solid).
 *
 * This is the 3D twin of the design the 2D rig shader always had
 * (LeluRig: luminance ramp, edge glow, band offsets), which only the
 * never-mounted 2D renderer could draw. The 3D path (LeluBody) now uses it.
 *
 * Patched once per material (onBeforeCompile, one extra program per
 * material, cached by key). At uHolo = 0 every added term is multiplied
 * away, and her materials go back to opaque.
 * ==========================================================
 */

import * as THREE from "three";

export interface HoloUniforms {
  uHolo: { value: number };
  uHoloTime: { value: number };
}

const PATCHED = "__leluHolo";

const VERTEX = /* glsl */ `
#include <project_vertex>
if (uHolo > 0.0) {
  // A rare slice of her slips sideways, like a projection losing lock.
  float row = floor((gl_Position.y / max(gl_Position.w, 0.0001)) * 24.0 + uHoloTime * 2.5);
  float glitch = step(0.96, fract(sin(row * 12.9898) * 43758.5453));
  gl_Position.x += glitch * uHolo * 0.018 * gl_Position.w * sin(uHoloTime * 40.0);
}
`;

const FRAGMENT = /* glsl */ `
#include <dithering_fragment>
if (uHolo > 0.0) {
  vec3 base = gl_FragColor.rgb;
  float lum = clamp(dot(base, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = pow(1.0 - clamp(abs(dot(normalize(normal), viewDir)), 0.0, 1.0), 2.2);
  // Scanlines travelling up her body, and a slow flicker.
  float scan = 0.72 + 0.28 * sin(gl_FragCoord.y * 1.15 - uHoloTime * 9.0);
  float flicker = 0.93 + 0.07 * sin(uHoloTime * 23.0) * sin(uHoloTime * 7.3);
  vec3 holo = mix(vec3(0.10, 0.46, 0.95), vec3(0.80, 0.98, 1.0), clamp(lum * 1.6, 0.0, 1.0)) * (0.55 + 0.75 * lum);
  holo += fresnel * vec3(0.55, 0.95, 1.0) * 1.9;
  holo *= scan * flicker;
  float alpha = clamp(0.28 + 0.6 * lum + fresnel * 0.9, 0.0, 1.0) * (0.82 + 0.18 * scan);
  gl_FragColor = mix(gl_FragColor, vec4(holo, alpha * gl_FragColor.a), uHolo);
}
`;

function materialsOf(scene: THREE.Object3D): THREE.Material[] {
  const out = new Set<THREE.Material>();
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) out.add(mat);
  });
  return [...out];
}

/**
 * Gives every material of her scene the holographic stage, once, sharing one
 * uniform pair (kept on the scene, so every view of this scene drives the
 * same values). Returns those uniforms.
 */
export function holoUniformsFor(scene: THREE.Object3D): HoloUniforms {
  const existing = scene.userData[PATCHED] as HoloUniforms | undefined;
  if (existing) return existing;
  const uniforms: HoloUniforms = { uHolo: { value: 0 }, uHoloTime: { value: 0 } };
  for (const material of materialsOf(scene)) {
    // Only lit/standard-family materials have the chunks we extend.
    if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhongMaterial || material instanceof THREE.MeshLambertMaterial)) continue;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous?.call(material, shader, renderer);
      shader.uniforms.uHolo = uniforms.uHolo;
      shader.uniforms.uHoloTime = uniforms.uHoloTime;
      shader.vertexShader = `uniform float uHolo;\nuniform float uHoloTime;\n${shader.vertexShader.replace("#include <project_vertex>", VERTEX)}`;
      shader.fragmentShader = `uniform float uHolo;\nuniform float uHoloTime;\n${shader.fragmentShader.replace("#include <dithering_fragment>", FRAGMENT)}`;
    };
    const previousKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${previousKey()}|lelu-holo-1`;
    material.userData.holoOriginal = { transparent: material.transparent, depthWrite: material.depthWrite };
    material.needsUpdate = true;
  }
  scene.userData[PATCHED] = uniforms;
  return uniforms;
}

/**
 * Sets how projected she is (0..1). Translucency is switched on only while
 * she is (partly) a hologram; as she is, her materials are exactly as
 * authored.
 */
export function setHolo(scene: THREE.Object3D, uniforms: HoloUniforms, amount: number, time: number): void {
  uniforms.uHolo.value = amount;
  uniforms.uHoloTime.value = time;
  const projected = amount > 0.01;
  if (scene.userData.holoProjected === projected) return;
  scene.userData.holoProjected = projected;
  for (const material of materialsOf(scene)) {
    const original = material.userData.holoOriginal as { transparent: boolean; depthWrite: boolean } | undefined;
    if (!original) continue;
    material.transparent = projected ? true : original.transparent;
    material.needsUpdate = true;
  }
}
