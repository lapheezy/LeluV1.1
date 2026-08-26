/**
 * ==========================================================
 * LÉLU
 * PROCEDURAL 3D AUTHORING PIPELINE
 *
 * A real, offline, procedural 3D authoring pipeline built on
 * the EXISTING Three.js runtime (no GLTF assets, no external
 * service). It turns LÉLU's persistent AvatarProfile — the
 * SAME profile the portrait and Avatar panel render — into a
 * live THREE.Group humanoid, dresses it from the appearance
 * config (skin, hair, black-lace gown, gold jewelry), places
 * it in a candlelit environment, animates it from the REAL
 * presence state (idle / listening / thinking / speaking),
 * and renders offline snapshots to PNG data URLs that flow
 * into the RenderStore gallery and chat responses.
 *
 * Honest boundaries: the figure is a stylized procedural
 * humanoid, not a photoreal scan and not a skeletal-rigged
 * GLTF. Everything reported by the pipeline is actually
 * built; nothing is faked.
 * ==========================================================
 */

import * as THREE from "three";
import type { AvatarProfile } from "../avatar/AvatarProfile";

/* ----------------------------------------------------------
 * Types
 * ---------------------------------------------------------- */

export type AvatarPresenceMode = "idle" | "listening" | "thinking" | "speaking";

export interface ProceduralAvatarOptions {
  /** Presence mode used for the static snapshot pose. */
  mode?: AvatarPresenceMode;
  /** Time (seconds) for the snapshot pose. */
  time?: number;
  /** Output width in pixels (default 1280). */
  width?: number;
  /** Output height in pixels (default 1600). */
  height?: number;
}

export interface Rendered3DSnapshot {
  dataUrl: string;
  width: number;
  height: number;
  /** Parts of the figure that were authored. */
  parts: string[];
  /** Palette actually used (parsed from the profile appearance). */
  palette: {
    skin: string;
    hair: string;
    gown: string;
    gold: string;
  };
}

export interface AvatarParts {
  group: THREE.Group;
  head: THREE.Group;
  torso: THREE.Mesh;
  gown: THREE.Mesh;
  eyes: THREE.Mesh[];
  jewelry: THREE.Mesh[];
  hairPuffs: THREE.Mesh[];
  arms: THREE.Mesh[];
  candle: THREE.PointLight;
  platform: THREE.Mesh;
}

/* ----------------------------------------------------------
 * Color extraction — reads the appearance TEXT so the model
 * follows what the user actually wrote in the Avatar panel.
 * ---------------------------------------------------------- */

function extractSkinColor(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(dark|deep|rich|ebony|mahogany|chocolate|umber|bronze|brown|tan|caramel|espresso|coffee)\b/.test(lower)) {
    return "#7a4a32";
  }
  if (/\b(medium|olive|honey|warm|golden)\b/.test(lower)) {
    return "#b5744c";
  }
  if (/\b(light|fair|pale|ivory)\b/.test(lower)) {
    return "#e2ac86";
  }
  // Default direction for LÉLU's profile is deep, rich dark skin.
  return "#7a4a32";
}

function extractHairColor(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(blonde|blond|golden|honey)\b/.test(lower)) return "#b98a4e";
  if (/\b(brown|chestnut|auburn|brunette|chocolate)\b/.test(lower)) return "#4a2c1a";
  if (/\b(silver|grey|gray|white)\b/.test(lower)) return "#b9bdc4";
  return "#0c0a12"; // default: short natural black
}

function extractGownColor(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(white|ivory|cream)\b/.test(lower)) return "#d8d4e2";
  if (/\b(red|crimson|burgundy|maroon)\b/.test(lower)) return "#5e1020";
  if (/\b(blue|navy|indigo)\b/.test(lower)) return "#101c3a";
  if (/\b(green|emerald|jade)\b/.test(lower)) return "#0f3326";
  return "#141019"; // default: black lace
}

function extractGoldColor(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(silver|platinum|white gold)\b/.test(lower)) return "#cfd4dc";
  if (/\b(copper|rose gold|bronze)\b/.test(lower)) return "#c98a5e";
  return "#d4a94e"; // default: antique gold
}

export interface AvatarPalette {
  skin: string;
  hair: string;
  gown: string;
  gold: string;
}

/** Resolve the visual palette from the saved appearance config. */
export function resolvePalette(profile: AvatarProfile): AvatarPalette {
  return {
    skin: extractSkinColor(profile.appearance.skin),
    hair: extractHairColor(profile.appearance.hair),
    gown: extractGownColor(profile.appearance.clothing),
    gold: extractGoldColor(profile.appearance.jewelry),
  };
}

/* ----------------------------------------------------------
 * Material helpers
 * ---------------------------------------------------------- */

function standard(color: string, opts: { roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number } = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.08,
  });
  if (opts.emissive) {
    material.emissive = new THREE.Color(opts.emissive);
    material.emissiveIntensity = opts.emissiveIntensity ?? 0.4;
  }
  return material;
}

const GOLD_MATERIAL = () =>
  standard("#d4a94e", { roughness: 0.28, metalness: 0.85, emissive: "#3a2c08", emissiveIntensity: 0.35 });

/* ----------------------------------------------------------
 * Model authoring — the figure is built entirely from
 * primitives, proportioned as a stylized elegant humanoid.
 * ---------------------------------------------------------- */

/**
 * Build the procedural 3D avatar from the saved profile.
 * Every mesh is real; the parts are stored on group.userData so
 * the animation ticker and snapshot renderer can drive them.
 */
export function buildAvatarModel(profile: AvatarProfile): AvatarParts {
  const palette = resolvePalette(profile);
  const group = new THREE.Group();

  const skinMat = standard(palette.skin, { roughness: 0.62, metalness: 0.02 });
  const gownMat = standard(palette.gown, { roughness: 0.5, metalness: 0.35, emissive: palette.gown, emissiveIntensity: 0.12 });
  const hairMat = standard(palette.hair, { roughness: 0.55, metalness: 0.1 });
  const goldMat = GOLD_MATERIAL();

  /* Gown — long black-lace silhouette from the waist down. */
  const gown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.62, 1.25, 24, 1), gownMat);
  gown.position.y = 0.62;
  gown.castShadow = true;
  group.add(gown);

  /* Bodice — fitted upper torso. */
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.5, 6, 16), gownMat);
  torso.position.y = 1.32;
  torso.castShadow = true;
  group.add(torso);

  /* Shoulders / upper chest blend. */
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), gownMat);
  chest.position.y = 1.62;
  chest.scale.set(1.15, 0.8, 0.9);
  group.add(chest);

  /* Arms — skin capsules ending in gold bangles. */
  const arms: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 4, 10), skinMat);
    arm.position.set(side * 0.34, 1.42, 0);
    arm.rotation.z = side * -0.12;
    arm.castShadow = true;
    group.add(arm);
    arms.push(arm);

    const bangle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 8, 18), goldMat);
    bangle.position.set(side * 0.42, 1.14, 0);
    bangle.rotation.y = Math.PI / 2;
    group.add(bangle);
    arms.push(bangle);
  }

  /* Neck. */
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.16, 12), skinMat);
  neck.position.y = 1.74;
  group.add(neck);

  /* Head — assembled as a group so animation can tilt/blink it. */
  const head = new THREE.Group();
  head.position.y = 1.95;

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 28, 22), skinMat);
  skull.scale.set(0.98, 1.08, 0.98);
  skull.position.y = 0.02;
  skull.castShadow = true;
  head.add(skull);

  /* Eyes — glowing, dark expressive (matching the appearance text). */
  const eyeMat = new THREE.MeshStandardMaterial({
    color: "#1a0a06",
    emissive: "#2bd6ff",
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.1,
  });
  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), eyeMat);
    eye.position.set(side * 0.105, 0.12, 0.245);
    head.add(eye);
    eyes.push(eye);
  }

  /* Eyebrows — thin dark arches. */
  const browMat = standard("#0a0608", { roughness: 0.9 });
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.018, 0.02), browMat);
    brow.position.set(side * 0.105, 0.175, 0.252);
    brow.rotation.z = side * -0.12;
    head.add(brow);
  }

  /* Lips — subtle. */
  const lips = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), standard("#5a1825", { roughness: 0.5 }));
  lips.position.set(0, -0.045, 0.265);
  lips.scale.set(1.1, 0.45, 0.55);
  head.add(lips);

  /* Hair — short textured natural cap from the appearance text. */
  const hairPuffs: THREE.Mesh[] = [];
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.295, 24, 18), hairMat);
  hairCap.scale.set(1.02, 0.82, 1.04);
  hairCap.position.set(0, 0.1, -0.015);
  hairCap.castShadow = true;
  head.add(hairCap);
  hairPuffs.push(hairCap);
  const puffPositions: Array<[number, number, number, number]> = [
    [-0.2, 0.16, -0.05, 0.09],
    [0.2, 0.16, -0.05, 0.09],
    [-0.1, 0.22, -0.09, 0.1],
    [0.1, 0.22, -0.09, 0.1],
    [0, 0.24, 0.0, 0.11],
    [-0.24, 0.08, -0.08, 0.08],
    [0.24, 0.08, -0.08, 0.08],
  ];
  for (const [x, y, z, r] of puffPositions) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), hairMat);
    puff.position.set(x, y, z);
    head.add(puff);
    hairPuffs.push(puff);
  }

  /* Gold jewelry — ankh hoops, choker, pendant (per the profile). */
  const jewelry: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.011, 8, 20), goldMat);
    hoop.position.set(side * 0.24, -0.02, 0.16);
    hoop.rotation.x = Math.PI / 2.15;
    head.add(hoop);
    jewelry.push(hoop);
  }
  const choker = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 8, 24), goldMat);
  choker.position.set(0, -0.13, 0.03);
  choker.rotation.x = Math.PI / 2;
  head.add(choker);
  jewelry.push(choker);
  const pendant = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), goldMat);
  pendant.position.set(0, -0.19, 0.17);
  head.add(pendant);
  jewelry.push(pendant);

  group.add(head);

  /* Environment — candlelit platform with gold rim + floating dust. */
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.07, 36), standard("#0b0812", { roughness: 0.85, metalness: 0.2 }));
  platform.position.y = -0.035;
  platform.receiveShadow = true;
  group.add(platform);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.018, 8, 40), goldMat);
  rim.position.y = 0.0;
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  const dustGeometry = new THREE.BufferGeometry();
  const dustCount = 140;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.5 + Math.random() * 1.1;
    dustPositions[i * 3] = Math.cos(angle) * radius;
    dustPositions[i * 3 + 1] = 0.1 + Math.random() * 1.9;
    dustPositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: palette.gold,
      size: 0.016,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(dust);

  /* Candlelight — real warm point light that flickers. */
  const candle = new THREE.PointLight("#ff9d5c", 2.4, 7, 2);
  candle.position.set(0.5, 1.15, 0.95);
  group.add(candle);

  /* Attach parts for animation + snapshot pose. */
  group.userData.parts = { head, torso, gown, eyes, jewelry, hairPuffs, arms, candle, platform, dust };

  return { group, head, torso, gown, eyes, jewelry, hairPuffs, arms, candle, platform };
}

/* ----------------------------------------------------------
 * Presence animation — real motion driven by the state that
 * the portrait and AvatarWindow already use.
 * ---------------------------------------------------------- */

/** Drive the avatar's live motion from the presence mode. Pure time-based; safe per-frame. */
export function tickAvatar(parts: AvatarParts, mode: AvatarPresenceMode, time: number): void {
  const { head, torso, gown, eyes, jewelry, candle, arms } = parts;

  // Breathing — gown + torso scale gently, head floats.
  const breath = Math.sin(time * 1.6) * 0.018;
  torso.scale.set(1 + breath, 1 + breath * 0.6, 1 + breath);
  gown.scale.y = 1 + breath * 0.4;
  head.position.y = 1.95 + Math.sin(time * 1.6) * 0.008;

  // Mode-specific motion.
  switch (mode) {
    case "listening":
      head.rotation.z = 0.07;
      head.rotation.x = 0.04;
      break;
    case "thinking":
      head.rotation.z = 0.03;
      head.rotation.x = -0.06;
      for (const piece of jewelry) {
        const material = piece.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.55 + Math.sin(time * 3.2) * 0.35;
      }
      break;
    case "speaking":
      head.rotation.z = 0.0;
      head.position.y += Math.sin(time * 3.4) * 0.012;
      for (const eye of eyes) {
        const material = eye.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 1.1 + Math.sin(time * 3.4) * 0.5;
      }
      break;
    default:
      head.rotation.z = Math.sin(time * 0.5) * 0.015;
      head.rotation.x = 0;
      break;
  }

  // Candlelight flicker.
  candle.intensity = 2.2 + Math.sin(time * 7.3) * 0.5 + Math.sin(time * 13.1) * 0.25;
  candle.position.x = 0.5 + Math.sin(time * 1.1) * 0.03;

  // Gentle arm sway when speaking/listening.
  const sway = mode === "idle" || mode === "thinking" ? 0 : Math.sin(time * 2.2) * 0.02;
  if (arms[0]) arms[0].rotation.z = -0.12 + sway;
  if (arms[2]) arms[2].rotation.z = 0.12 - sway;
}

/* ----------------------------------------------------------
 * Scene + offline renderer
 * ---------------------------------------------------------- */

function buildScene(profile: AvatarProfile): { scene: THREE.Scene; parts: AvatarParts } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#050410");

  const parts = buildAvatarModel(profile);
  scene.add(parts.group);

  // Lighting rig — warm key, cool rim, soft ambient.
  scene.add(new THREE.AmbientLight("#2a2436", 0.9));
  const key = new THREE.DirectionalLight("#ffd9a0", 2.0);
  key.position.set(2.6, 4.2, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#67e8f9", 0.9);
  rim.position.set(-3.2, 2.2, -2.4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight("#d4a94e", 0.4);
  fill.position.set(0, 1.2, -2.8);
  scene.add(fill);

  return { scene, parts };
}

/* ----------------------------------------------------------
 * Saved reference image — the EXACT saved avatar is the
 * authoritative render. When the user has saved a reference
 * portrait, avatar renders composite that exact image (never
 * a procedural substitute) into the candlelit chamber — the
 * same treatment the procedural figure would receive, but
 * with the user's actual saved visual identity.
 * ---------------------------------------------------------- */

async function renderReferenceAvatar(
  profile: AvatarProfile,
  width: number,
  height: number,
): Promise<string> {
  if (typeof document === "undefined" || !profile.referenceImage) {
    throw new Error("reference-image render requires a DOM and a saved image");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");

  // Candlelit chamber backdrop — same world as the procedural figure.
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#1a1030");
  bg.addColorStop(0.55, "#0d0818");
  bg.addColorStop(1, "#050410");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Warm candlelight halo behind the portrait.
  const glow = ctx.createRadialGradient(width / 2, height * 0.42, 0, width / 2, height * 0.42, height * 0.62);
  glow.addColorStop(0, "rgba(255, 178, 92, 0.28)");
  glow.addColorStop(0.5, "rgba(255, 178, 92, 0.08)");
  glow.addColorStop(1, "rgba(255, 178, 92, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Gold ring + soft frame around the saved portrait.
  const frameW = Math.round(width * 0.9);
  const frameH = Math.round(height * 0.84);
  const fx = (width - frameW) / 2;
  const fy = (height - frameH) / 2;
  ctx.save();
  ctx.shadowColor = "rgba(212, 169, 78, 0.55)";
  ctx.shadowBlur = Math.round(width * 0.04);
  ctx.strokeStyle = "#c9a030";
  ctx.lineWidth = Math.max(3, Math.round(width * 0.006));
  ctx.strokeRect(fx, fy, frameW, frameH);
  ctx.restore();

  // The exact saved image — contain-fit, centered, never cropped.
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("reference image decode failed"));
    img.src = profile.referenceImage as string;
  });
  const scale = Math.min((frameW * 0.92) / Math.max(1, img.naturalWidth), (frameH * 0.92) / Math.max(1, img.naturalHeight));
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);

  return canvas.toDataURL("image/png");
}

/**
 * Render the saved avatar to a PNG data URL — the EXACT saved reference
 * image when one exists, otherwise the procedural figure from the same
 * authoring pipeline. Fully offline. Guarded for browsers; returns null
 * where rendering is impossible.
 */
export async function renderAvatarToImage(
  profile: AvatarProfile,
  options: ProceduralAvatarOptions = {},
): Promise<Rendered3DSnapshot | null> {
  const width = options.width ?? 1280;
  const height = options.height ?? 1600;

  // The exact saved avatar is the source of truth: composite the saved
  // reference image into the candlelit chamber. Falls back to the
  // procedural figure only when no image is saved or it cannot render.
  if (profile.referenceImage && typeof document !== "undefined") {
    try {
      const dataUrl = await renderReferenceAvatar(profile, width, height);
      return {
        dataUrl,
        width,
        height,
        parts: ["saved-reference-image", "candlelit-frame", "gold-ring"],
        palette: resolvePalette(profile),
      };
    } catch (error) {
      console.warn("[Lélu 3D] reference-image avatar render failed — procedural fallback.", error);
    }
  }

  // WebGL path — real Three.js rasterization, when the browser provides it.
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    try {
      const { scene, parts } = buildScene(profile);
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = false;

      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
      camera.position.set(0, 2.1, 5.0);
      camera.lookAt(0, 1.3, 0);

      // Pose the figure for the snapshot.
      const mode = options.mode ?? "idle";
      const time = options.time ?? 0.9;
      tickAvatar(parts, mode, time);
      parts.group.rotation.y = -0.5;

      try {
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL("image/png");
        const palette = resolvePalette(profile);
        return {
          dataUrl,
          width,
          height,
          parts: ["head", "eyes", "hair", "torso", "gown", "arms", "jewelry", "platform", "candlelight", "gold-dust"],
          palette,
        };
      } finally {
        renderer.dispose();
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) {
            for (const item of material) item.dispose();
          } else if (material) {
            material.dispose();
          }
        });
      }
    } catch (error) {
      console.warn("[Lélu 3D] WebGL avatar render failed — software projection fallback.", error);
    }
  }

  // Software projection fallback — the SAME authored model, same pose,
  // rasterized without WebGL. Returns a real PNG in any runtime.
  return renderAvatarSoftware(profile, { ...options, width, height });
}

/* ----------------------------------------------------------
 * Free-form procedural scene authoring
 * ---------------------------------------------------------- */

export type ProceduralSceneKind = "avatar" | "orb" | "planet";

export interface Authored3DScene {
  kind: ProceduralSceneKind;
  group: THREE.Group;
  /** Parts of the scene that were authored. */
  parts: string[];
  name: string;
}

/** Classify what kind of procedural scene a prompt asks for. */
export function classifySceneKind(prompt: string): ProceduralSceneKind {
  const p = prompt.toLowerCase();
  if (/\b(avatar|lelu|lélu|her|she|embod|portrait|human|figure|woman)\b/.test(p)) return "avatar";
  if (/\b(planet|earth|cosmos|galaxy|world|globe|moon|mars)\b/.test(p)) return "planet";
  return "orb";
}

/**
 * Author a procedural scene from a prompt: an orb (default), a
 * planet with rings, or the LÉLU avatar. Everything is constructed
 * live; no external assets.
 */
export function authorScene(prompt: string, profile?: AvatarProfile): Authored3DScene {
  const kind = classifySceneKind(prompt);
  const group = new THREE.Group();
  const parts: string[] = [];

  if (kind === "avatar" && profile) {
    const model = buildAvatarModel(profile);
    group.add(model.group);
    return {
      kind,
      group,
      parts: ["avatar", "platform", "candlelight", "gold-dust"],
      name: `Procedural avatar — ${profile.identity.name}`,
    };
  }

  if (kind === "planet") {
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 48, 32),
      new THREE.MeshStandardMaterial({ color: "#274060", roughness: 0.65, metalness: 0.1 }),
    );
    planet.position.y = 0.35;
    group.add(planet);
    parts.push("planet");

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.35, 0.05, 12, 64),
      new THREE.MeshStandardMaterial({ color: "#d4a94e", roughness: 0.4, metalness: 0.7, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = Math.PI / 2.4;
    ring.rotation.y = 0.3;
    ring.position.y = 0.4;
    group.add(ring);
    parts.push("ring");

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 20, 16),
      new THREE.MeshStandardMaterial({ color: "#8b93a7", roughness: 0.8 }),
    );
    moon.position.set(1.5, 0.95, 0.4);
    group.add(moon);
    parts.push("moon");

    return { kind, group, parts, name: "Procedural planet scene" };
  }

  // Default: glowing orb with orbital rings (the Genesis core language).
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.62, 3),
    new THREE.MeshStandardMaterial({
      color: "#67e8f9",
      emissive: "#0e7490",
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.4,
      flatShading: true,
    }),
  );
  core.position.y = 0.85;
  group.add(core);
  parts.push("core");

  for (const [radius, speed] of [
    [0.95, 0],
    [1.2, 0.6],
  ] as const) {
    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.02, 8, 72),
      new THREE.MeshStandardMaterial({ color: "#a78bfa", emissive: "#4c1d95", emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.5 }),
    );
    orbit.rotation.x = Math.PI / 2;
    orbit.rotation.z = speed;
    orbit.position.y = 0.85;
    group.add(orbit);
    parts.push("orbit-ring");
  }

  return { kind, group, parts, name: "Procedural orb scene" };
}

/** Render any authored scene group to a PNG data URL (offline). */
export async function renderSceneToImage(
  sceneGroup: THREE.Group,
  options: { width?: number; height?: number } = {},
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const width = options.width ?? 1280;
  const height = options.height ?? 1280;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#050410");
  scene.add(new THREE.AmbientLight("#2a2436", 1.0));
  const key = new THREE.DirectionalLight("#ffd9a0", 2.0);
  key.position.set(2.6, 4.2, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#67e8f9", 0.8);
  rim.position.set(-3.2, 2.2, -2.4);
  scene.add(rim);
  scene.add(sceneGroup);

  // WebGL path — real Three.js rasterization, when the browser provides it.
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    try {
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
      camera.position.set(0, 1.4, 4.6);
      camera.lookAt(0, 0.9, 0);

      try {
        renderer.render(scene, camera);
        return {
          dataUrl: renderer.domElement.toDataURL("image/png"),
          width,
          height,
        };
      } finally {
        renderer.dispose();
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) {
            for (const item of material) item.dispose();
          } else if (material) {
            material.dispose();
          }
        });
      }
    } catch (error) {
      console.warn("[Lélu 3D] WebGL scene render failed — software projection fallback.", error);
    }
  }

  // Software projection fallback — renders the SAME authored group to a
  // real PNG with no WebGL/DOM requirements (works in any runtime).
  return renderSceneSoftware(sceneGroup, { width, height });
}

/* ----------------------------------------------------------
 * Software projection rasterizer
 *
 * Renders the SAME authored model to a real PNG with zero
 * WebGL/DOM requirements: the figure, orb or planet is drawn
 * from its actual THREE geometry — world positions, scales,
 * materials and the live presence pose — through a tiny
 * deterministic rasterizer + pure-JS PNG encoder. Browsers
 * use the WebGL path; this path guarantees the pipeline
 * produces a real image in ANY runtime (WebGL-disabled
 * browsers, headless, tests). One model, one pipeline, two
 * rasterizers.
 * ---------------------------------------------------------- */

interface SoftBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function softBuffer(width: number, height: number): SoftBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function softBlend(buf: SoftBuffer, x: number, y: number, rgb: [number, number, number], alpha: number): void {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
  const i = (y * buf.width + x) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  buf.data[i] = buf.data[i] * (1 - a) + rgb[0] * a;
  buf.data[i + 1] = buf.data[i + 1] * (1 - a) + rgb[1] * a;
  buf.data[i + 2] = buf.data[i + 2] * (1 - a) + rgb[2] * a;
  buf.data[i + 3] = 255;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shadeRgb(rgb: [number, number, number], factor: number): [number, number, number] {
  return [Math.min(255, rgb[0] * factor), Math.min(255, rgb[1] * factor), Math.min(255, rgb[2] * factor)];
}

/** Radial-gradient disc — the flat-shaded sphere look. */
function softDisc(
  buf: SoftBuffer,
  cx: number,
  cy: number,
  radius: number,
  rgb: [number, number, number],
  opts: { glow?: [number, number, number]; glowStrength?: number } = {},
): void {
  if (radius <= 0) return;
  const r2 = radius * radius;
  const glow = opts.glow ?? rgb;
  const glowStrength = opts.glowStrength ?? 0.35;
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(buf.width - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(buf.height - 1, Math.ceil(cy + radius + 1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const t = Math.sqrt(d2) / radius;
      const lit = Math.max(0, 1 - t);
      const mix = 0.72 + lit * 0.42;
      softBlend(buf, x, y, shadeRgb(rgb, mix), 1);
      if (lit > 0.55 && glowStrength > 0) {
        softBlend(buf, x, y, glow, (lit - 0.55) * glowStrength);
      }
    }
  }
}

/** Filled capsule between two projected endpoints. */
function softCapsule(
  buf: SoftBuffer,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  rgb: [number, number, number],
): void {
  if (radius <= 0) return;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.max(1e-6, Math.hypot(dx, dy));
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
  const x1 = Math.min(buf.width - 1, Math.ceil(Math.max(ax, bx) + radius + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
  const y1 = Math.min(buf.height - 1, Math.ceil(Math.max(ay, by) + radius + 1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const t = ((x - ax) * dx + (y - ay) * dy) / (len * len);
      const clamped = Math.max(0, Math.min(1, t));
      const px = ax + dx * clamped - x;
      const py = ay + dy * clamped - y;
      if (px * px + py * py > radius * radius) continue;
      softBlend(buf, x, y, rgb, 1);
    }
  }
}

/** Filled convex quad (gown silhouette). */
function softQuad(
  buf: SoftBuffer,
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
  rgb: [number, number, number],
): void {
  const pts = [a, b, c, d];
  const ys = pts.map((p) => p[1]);
  const yMin = Math.max(0, Math.floor(Math.min(...ys)));
  const yMax = Math.min(buf.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = yMin; y <= yMax; y += 1) {
    const xs: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % 4];
      const dy = p2[1] - p1[1];
      if (Math.abs(dy) < 1e-6) continue;
      const t = (y - p1[1]) / dy;
      if (t < 0 || t > 1) continue;
      xs.push(p1[0] + t * (p2[0] - p1[0]));
    }
    if (xs.length < 2) continue;
    xs.sort((u, v) => u - v);
    for (let x = Math.max(0, Math.ceil(xs[0])); x <= Math.min(buf.width - 1, Math.floor(xs[xs.length - 1])); x += 1) {
      const shade = 0.82 + 0.24 * (1 - (y - yMin) / Math.max(1, yMax - yMin));
      softBlend(buf, x, y, shadeRgb(rgb, shade), 1);
    }
  }
}

/** Ellipse ring (hoops, choker, orbital rings). */
function softRing(
  buf: SoftBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  lineWidth: number,
  rgb: [number, number, number],
): void {
  if (rx <= 0 || ry <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - rx - lineWidth));
  const x1 = Math.min(buf.width - 1, Math.ceil(cx + rx + lineWidth));
  const y0 = Math.max(0, Math.floor(cy - ry - lineWidth));
  const y1 = Math.min(buf.height - 1, Math.ceil(cy + ry + lineWidth));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1 || d < 1 - lineWidth / Math.max(rx, ry)) continue;
      softBlend(buf, x, y, rgb, 1);
    }
  }
}

/* ---- PNG encoding (pure JS: CompressionStream or stored deflate) ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  // Compression Streams API (browsers + modern runtimes).
  if (typeof CompressionStream !== "undefined") {
    try {
      const stream = new CompressionStream("deflate-raw");
      const writer = stream.writable.getWriter();
      void writer.write(data as unknown as BufferSource);
      void writer.close();
      const reader = stream.readable.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const raw = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        raw.set(c, offset);
        offset += c.length;
      }
      const out = new Uint8Array(raw.length + 6);
      out[0] = 0x78;
      out[1] = 0x9c;
      out.set(raw, 2);
      new DataView(out.buffer).setUint32(out.length - 4, adler32(data));
      return out;
    } catch {
      // fall through to stored blocks
    }
  }
  // Stored (uncompressed) deflate blocks — valid zlib, no deps.
  const out: number[] = [0x78, 0x01];
  let offset = 0;
  while (offset < data.length) {
    const len = Math.min(0xffff, data.length - offset);
    const last = offset + len >= data.length ? 0x01 : 0x00;
    out.push(last, len & 0xff, (len >> 8) & 0xff, ~len & 0xff, (~len >> 8) & 0xff);
    for (let i = 0; i < len; i += 1) out.push(data[offset + i]);
    offset += len;
  }
  const final = new Uint8Array(out.length + 4);
  final.set(out);
  new DataView(final.buffer).setUint32(final.length - 4, adler32(data));
  return final;
}

async function encodePng(buf: SoftBuffer): Promise<string> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, buf.width);
  view.setUint32(4, buf.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(buf.data.length + buf.height);
  for (let y = 0; y < buf.height; y += 1) {
    raw[y * (buf.width * 4 + 1)] = 0;
    raw.set(buf.data.subarray(y * buf.width * 4, (y + 1) * buf.width * 4), y * (buf.width * 4 + 1) + 1);
  }
  const idat = await deflateZlib(raw);
  const parts: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  let binary = "";
  for (let i = 0; i < out.length; i += 0x8000) {
    binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/* ---- Camera projection (pure THREE math, no GL) ---- */

function makeProjection(
  width: number,
  height: number,
  fov: number,
  eye: [number, number, number],
  target: [number, number, number],
): (point: THREE.Vector3) => [number, number, number] | null {
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 100);
  camera.position.set(...eye);
  camera.lookAt(...target);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const v = new THREE.Vector3();
  return (point: THREE.Vector3) => {
    v.copy(point).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    if (v.z < -1 || v.z > 1) return null;
    return [((v.x + 1) / 2) * width, (1 - (v.y + 1) / 2) * height, v.z];
  };
}

interface SoftDrawable {
  depth: number;
  draw: () => void;
}

/** Rasterize any authored THREE group into a PNG data URL. */
async function rasterizeGroup(
  group: THREE.Object3D,
  width: number,
  height: number,
  options: {
    fov?: number;
    eye?: [number, number, number];
    target?: [number, number, number];
    gradient?: [string, string];
    glow?: { position: THREE.Vector3; color: [number, number, number] };
  },
): Promise<string> {
  const buf = softBuffer(width, height);
  const project = makeProjection(width, height, options.fov ?? 38, options.eye ?? [0, 2.1, 5], options.target ?? [0, 1.3, 0]);

  const [topHex, bottomHex] = options.gradient ?? ["#1a1030", "#050410"];
  const top = hexRgb(topHex);
  const bottom = hexRgb(bottomHex);
  for (let y = 0; y < height; y += 1) {
    const t = y / height;
    const color: [number, number, number] = [
      top[0] + (bottom[0] - top[0]) * t,
      top[1] + (bottom[1] - top[1]) * t,
      top[2] + (bottom[2] - top[2]) * t,
    ];
    for (let x = 0; x < width; x += 1) softBlend(buf, x, y, color, 1);
  }

  if (options.glow) {
    const p = project(options.glow.position);
    if (p) {
      const radius = Math.max(width, height) * 0.34;
      softDisc(buf, p[0], p[1], radius, options.glow.color, { glow: options.glow.color, glowStrength: 0.09 });
    }
  }

  const drawables: SoftDrawable[] = [];
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const worldLight = new THREE.Vector3(0.6, 0.8, 0.75).normalize();

  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (object.type === "Points") {
      const points = object as THREE.Points;
      const positions = points.geometry.getAttribute("position");
      const pointsMaterial = points.material as THREE.PointsMaterial;
      const dotColor: [number, number, number] = pointsMaterial?.color
        ? hexRgb(`#${pointsMaterial.color.getHexString()}`)
        : [212, 169, 78];
      for (let i = 0; i < positions.count; i += 1) {
        pos.set(positions.getX(i), positions.getY(i), positions.getZ(i));
        pos.applyMatrix4(points.matrixWorld);
        const p = project(pos);
        if (!p) continue;
        const px = p[0];
        const py = p[1];
        const depth = p[2];
        drawables.push({
          depth,
          draw: () => softDisc(buf, px, py, Math.max(1, width / 900), dotColor, { glow: dotColor, glowStrength: 0.5 }),
        });
      }
      return;
    }

    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as THREE.BufferGeometry & { parameters?: Record<string, number> };
    const params = geometry.parameters ?? {};
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | THREE.MeshStandardMaterial
      | THREE.PointsMaterial;
    const color: [number, number, number] = material?.color
      ? hexRgb(`#${material.color.getHexString()}`)
      : [200, 200, 200];
    const emissiveHex = (material as THREE.MeshStandardMaterial).emissive?.getHexString();
    const emissive = emissiveHex ? hexRgb(`#${emissiveHex}`) : null;

    mesh.getWorldPosition(pos);
    mesh.getWorldQuaternion(quat);
    mesh.getWorldScale(scale);
    const avgScale = (scale.x + scale.y + scale.z) / 3;
    axis.copy(up).applyQuaternion(quat).normalize();
    const projected = project(pos);
    const depth = projected ? projected[2] : 0;

    if (geometry.type === "SphereGeometry") {
      const radius = (params.radius ?? 0.1) * avgScale;
      const p = projected;
      if (!p) return;
      const lit = Math.max(0.55, 0.8 + 0.25 * axis.dot(worldLight));
      const px = p[0];
      const py = p[1];
      drawables.push({
        depth,
        draw: () =>
          softDisc(buf, px, py, radius, shadeRgb(color, lit), {
            glow: emissive ?? color,
            glowStrength: emissive ? 0.9 : 0.15,
          }),
      });
    } else if (geometry.type === "CapsuleGeometry") {
      const radius = (params.radius ?? 0.07) * avgScale;
      const half = (params.length ?? 0.5) / 2;
      const a = pos.clone().addScaledVector(axis, half);
      const b = pos.clone().addScaledVector(axis, -half);
      const pa = project(a);
      const pb = project(b);
      if (!pa || !pb) return;
      const ax = pa[0];
      const ay = pa[1];
      const bx = pb[0];
      const by = pb[1];
      drawables.push({
        depth,
        draw: () => softCapsule(buf, ax, ay, bx, by, radius, color),
      });
    } else if (geometry.type === "CylinderGeometry") {
      const topR = (params.radiusTop ?? 0.3) * avgScale;
      const bottomR = (params.radiusBottom ?? topR) * avgScale;
      const half = (params.height ?? 1) / 2;
      const topC = pos.clone().addScaledVector(axis, half);
      const botC = pos.clone().addScaledVector(axis, -half);
      const pt = project(topC);
      const pb = project(botC);
      if (!pt || !pb) return;
      const dx = pb[0] - pt[0];
      const dy = pb[1] - pt[1];
      const len = Math.max(1e-6, Math.hypot(dx, dy));
      const nx = (-dy / len) * (topR + bottomR) * 0.5;
      const ny = (dx / len) * (topR + bottomR) * 0.5;
      const t0x = pt[0] - nx;
      const t0y = pt[1] - ny;
      const t1x = pt[0] + nx;
      const t1y = pt[1] + ny;
      const b0x = pb[0] - nx;
      const b0y = pb[1] - ny;
      const b1x = pb[0] + nx;
      const b1y = pb[1] + ny;
      drawables.push({
        depth,
        draw: () => {
          softQuad(buf, [t0x, t0y], [t1x, t1y], [b1x, b1y], [b0x, b0y], color);
          softDisc(buf, pt[0], pt[1], Math.max(1, topR), color);
          softDisc(buf, pb[0], pb[1], Math.max(1, bottomR), color);
        },
      });
    } else if (geometry.type === "TorusGeometry") {
      const major = (params.radius ?? 0.5) * avgScale;
      const tube = (params.tube ?? 0.02) * avgScale;
      const p = projected;
      if (!p) return;
      const facing = Math.abs(axis.dot(new THREE.Vector3(0, 0, 1)));
      const rx = Math.max(1, major);
      const ry = Math.max(1, major * Math.max(0.18, facing));
      const px = p[0];
      const py = p[1];
      const lw = Math.max(1.2, tube * 2);
      drawables.push({
        depth,
        draw: () => softRing(buf, px, py, rx, ry, lw, color),
      });
    }
    // BoxGeometry (brows/lashes) is sub-pixel at these sizes — skipped.
  });

  drawables.sort((a, b) => b.depth - a.depth);
  for (const item of drawables) item.draw();
  return encodePng(buf);
}

/** Software snapshot of the saved avatar (same model, same pose). */
async function renderAvatarSoftware(
  profile: AvatarProfile,
  options: ProceduralAvatarOptions = {},
): Promise<Rendered3DSnapshot | null> {
  try {
    const width = options.width ?? 640;
    const height = options.height ?? 800;
    const mode = options.mode ?? "idle";
    const time = options.time ?? 0.9;
    const { group, head, torso, gown, eyes, jewelry, hairPuffs, arms, candle, platform } = buildAvatarModel(profile);
    const parts: AvatarParts = { group, head, torso, gown, eyes, jewelry, hairPuffs, arms, candle, platform };
    tickAvatar(parts, mode, time);
    group.rotation.y = -0.5;
    group.updateMatrixWorld(true);

    const dataUrl = await rasterizeGroup(group, width, height, {
      fov: 38,
      eye: [0, 2.1, 5],
      target: [0, 1.3, 0],
      glow: { position: candle.getWorldPosition(new THREE.Vector3()), color: [255, 157, 92] },
    });
    return {
      dataUrl,
      width,
      height,
      parts: ["head", "eyes", "hair", "torso", "gown", "arms", "jewelry", "platform", "candlelight", "gold-dust"],
      palette: resolvePalette(profile),
    };
  } catch (error) {
    console.warn("[Lélu 3D] software projection failed", error);
    return null;
  }
}

/** Software snapshot of any authored scene group (orb / planet). */
async function renderSceneSoftware(
  sceneGroup: THREE.Group,
  options: { width?: number; height?: number } = {},
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const width = options.width ?? 640;
    const height = options.height ?? 640;
    sceneGroup.updateMatrixWorld(true);
    const dataUrl = await rasterizeGroup(sceneGroup, width, height, {
      fov: 42,
      eye: [0, 1.4, 4.6],
      target: [0, 0.9, 0],
    });
    return { dataUrl, width, height };
  } catch (error) {
    console.warn("[Lélu 3D] software scene projection failed", error);
    return null;
  }
}
