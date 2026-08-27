/**
 * ==========================================================
 * LÉLUVERSE — COSMIC BACKDROP
 *
 * Full-viewport procedural sky dome rendered in the 3D scene.
 *
 * Deliberately implemented WITHOUT any custom GLSL: a plain
 * MeshBasicMaterial with a procedural CanvasTexture nebula,
 * tinted every frame on the CPU from sampleCosmosAtmosphere().
 * A custom-shader failure is what made the sky render pure
 * black before; a basic material cannot fail to compile, so
 * the atmosphere phases (deep-black-space → core-colors →
 * sunset → static → storm → hurricane → dissipation) are
 * always visible in the 3D scene, with the DOM CosmosSkyBackdrop
 * behind the transparent canvas as the guaranteed fallback.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  Group,
  MeshBasicMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

import { sampleCosmosAtmosphere } from "../cosmos/CosmosAtmosphere";

/* Bright linear-space tints — the sky is NEVER allowed to go black. */
const BASE_TINT = new Color(0.55, 0.6, 1.0);
const CORE_TINT = new Color(0.75, 1.05, 1.7);
const SUNSET_TINT = new Color(1.6, 0.9, 0.45);
const STATIC_TINT = new Color(1.1, 1.2, 1.45);
const STORM_TINT = new Color(1.15, 0.7, 1.75);
const HURRICANE_TINT = new Color(0.65, 1.25, 1.85);
const RAINBOW_TINT = new Color(1.0, 0.78, 0.98);
const FLASH_COLOR = new Color(1.0, 1.05, 1.25);

/** Deterministic PRNG so the sky is identical on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Procedural nebula + starfield texture — bright, never pure black. */
function createSkyTexture(): CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    // Base: visible deep blue, not black.
    const base = ctx.createLinearGradient(0, 0, 0, size);
    base.addColorStop(0, "#101736");
    base.addColorStop(0.55, "#0b1026");
    base.addColorStop(1, "#141b40");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    const rng = mulberry32(0x51e1);

    // Nebula clouds — bright enough to read through the phase tint.
    const hues = [210, 225, 245, 265, 285, 195];
    for (let i = 0; i < 70; i += 1) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 60 + rng() * 220;
      const hue = hues[Math.floor(rng() * hues.length)];
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(
        0,
        `hsla(${hue}, 90%, ${55 + rng() * 25}%, ${0.16 + rng() * 0.22})`,
      );
      glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Fine dust bands
    for (let i = 0; i < 26; i += 1) {
      const y = rng() * size;
      const h = 6 + rng() * 26;
      const band = ctx.createLinearGradient(0, y - h, 0, y + h);
      band.addColorStop(0, "hsla(230, 70%, 60%, 0)");
      band.addColorStop(
        0.5,
        `hsla(230, 80%, ${60 + rng() * 25}%, ${0.06 + rng() * 0.08})`,
      );
      band.addColorStop(1, "hsla(230, 70%, 60%, 0)");
      ctx.fillStyle = band;
      ctx.fillRect(0, y - h, size, h * 2);
    }

    // Stars
    for (let i = 0; i < 700; i += 1) {
      const brightness = 0.25 + rng() * 0.75;
      ctx.fillStyle = `rgba(255,255,255,${brightness * 0.8})`;
      ctx.beginPath();
      ctx.arc(rng() * size, rng() * size, 0.35 + rng() * 1.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

export default function CosmicBackdrop() {
  const groupRef = useRef<Group>(null);

  const { material, flashMaterial } = useMemo(() => {
    const texture = typeof document === "undefined" ? null : createSkyTexture();
    const material = new MeshBasicMaterial({
      map: texture ?? undefined,
      color: BASE_TINT.clone(),
      transparent: true,
      opacity: 0.95,
      side: BackSide,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    const flashMaterial = new MeshBasicMaterial({
      color: FLASH_COLOR.clone(),
      transparent: true,
      opacity: 0,
      side: BackSide,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return { material, flashMaterial };
  }, []);

  const scratch = useMemo(() => new Color(), []);

  useFrame(({ clock }, delta) => {
    const root = groupRef.current;
    if (!root) return;

    const t = clock.elapsedTime;
    const atmosphere = sampleCosmosAtmosphere(t);

    // Phase mix computed on the CPU — no shader to fail.
    scratch.copy(BASE_TINT);
    scratch.lerp(CORE_TINT, atmosphere.coreColors * 0.85);
    scratch.lerp(SUNSET_TINT, atmosphere.sunset * 0.9);
    scratch.lerp(STATIC_TINT, atmosphere.static * 0.5);
    scratch.lerp(STORM_TINT, atmosphere.storm * 0.8);
    scratch.lerp(HURRICANE_TINT, atmosphere.hurricane * 0.9);
    scratch.lerp(RAINBOW_TINT, atmosphere.rainbow * 0.4);
    material.color.copy(scratch);

    // During static (TV snow) and rainbow (test pattern) the DOM layers
    // carry the look — pull this sphere's additive opacity down so the
    // snow/bars behind the transparent canvas show through crisply.
    const revealDom = Math.max(atmosphere.static * 0.7, atmosphere.rainbow * 0.6);
    material.opacity = 0.95 - revealDom * 0.55;

    // Lightning: sharp white-blue pulses during storm/hurricane.
    const flashPulse =
      Math.pow(Math.max(0, Math.sin(t * 11.0)), 6) +
      Math.pow(Math.max(0, Math.sin(t * 17.0 + 2.1)), 10) * 0.6;
    flashMaterial.opacity = Math.min(1, atmosphere.lightning * flashPulse * 1.25);

    // Hurricane visibly spins the whole sky; storm adds turbulence.
    root.rotation.y += delta * (0.002 + atmosphere.hurricane * 0.05 + atmosphere.storm * 0.02);
    root.rotation.x = Math.sin(t * 0.03) * 0.02;
  });

  return (
    <group ref={groupRef} name="CosmicBackdrop" renderOrder={0}>
      <mesh material={material} raycast={() => null} frustumCulled={false}>
        <sphereGeometry args={[500, 32, 24]} />
      </mesh>
      <mesh material={flashMaterial} raycast={() => null} frustumCulled={false}>
        <sphereGeometry args={[505, 32, 24]} />
      </mesh>
    </group>
  );
}
