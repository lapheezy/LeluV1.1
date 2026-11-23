/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS V2 — CINEMATIC 3D SCENE
 *
 * The complete Genesis v2 workspace as a real WebGL scene
 * (three.js / react-three-fiber, the same rendering technology
 * the v1 world uses — not CSS circles stacked into fake 3D).
 *
 * Reference-2 composition, from top to bottom:
 *
 *                     GENESIS CORE
 *                Consciousness Engine
 *                       /   |   \
 *          CREATION STUDIO  RESEARCH LAB
 *                       |
 *                  GENESIS VAULT
 *
 * The ONE Genesis Core is the central anchor: a luminous,
 * shader-driven energy body (the shared GenesisCoreMaterial —
 * the same ONE core surface the whole app reads from the
 * EngineBus) with tilted orbital rings, GPU emission particles,
 * electric arcs, ocean ripples and a bright additive bloom.
 * It also carries six per-morphology form layers (storm filaments,
 * aurora veils, ocean currents, plasma cells, electric arcs, bio
 * membrane) driven by the same engine weights, so every evolution
 * version the Core moves through has its own visible 3D form.
 *
 * Around it orbit three real satellite modules — Creation
 * Studio (violet), Research Lab (cyan), Genesis Vault (emerald)
 * — each a luminous wireframe sphere with its own orbit rings,
 * travelling sparks, particle halo and module light. Curved
 * energy beams carry travelling pulses from the Core to each
 * module, and fine threads connect the modules to each other.
 *
 * The environment is deep space: the living star field, the
 * procedural nebula sky and aurora curtains (shared cosmic
 * environment components), plus drifting additive nebula
 * sprites in violet/cyan/magenta so the workspace reads as one
 * immersive cosmic atmosphere.
 *
 * The interface is integrated INTO the environment: labels are
 * DOM overlays anchored to each 3D object (drei Html), so they
 * always track their sphere, and the workspace chrome lives
 * above the canvas in GenesisLab. This scene is mounted ONLY
 * while the v2 workspace owns the viewport (GenesisScene
 * router) — nothing here leaks into Genesis v1.
 * ==========================================================
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { useContextBridge } from "@react-three/drei";
import SpatialLayer from "./spatial/SpatialLayer";
import CreativeObjects3D from "./cosmos/CreativeObjects3D";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  ShaderMaterial,
} from "three";

import { GenesisContext, GenesisStateContext } from "./GenesisCore";
import StarField from "./environment/stars/StarField";
import Cosmos from "./environment/Cosmos";
import GenesisV2CameraRig from "./GenesisV2CameraRig";
import LeluV2Presence from "./LeluV2Presence";
import WorldScene from "./WorldScene";
import AdaptiveQuality from "./AdaptiveQuality";
import SceneFrameGovernor, { useSceneFrameloop } from "./SceneFrameGovernor";
import { DPR_START } from "./qualityLimits";

export type V2NodeId = "core" | "studio" | "lab" | "vault";

export interface GenesisV2Scene3DProps {
  /** Interaction energy 0..1 (thinking/speaking/tools) — drives beams. */
  activity: number;
  /** Which module is currently focused/selected. */
  focused: V2NodeId;
  /** Navigate to a module (opens its panel in the v2 chrome). */
  onSelect: (id: V2NodeId) => void;
  /** Optional DOM label block anchored under the Core (reference hierarchy:
   * GENESIS CORE → Consciousness Engine → waveform → Coherence). */
  coreLabel?: ReactNode;
}

/* ------------------------------ constants ------------------------------ */


/* ------------------------------ glow texture --------------------------- */

/** Soft radial glow sprite texture (white → transparent); tint via color. */
function makeGlowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.28, "rgba(255, 255, 255, 0.42)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------ nebula sprites ------------------------- */

function NebulaSprites() {
  const group = useRef<Group>(null);
  const texture = useMemo(makeGlowTexture, []);

  const seeds = useMemo(
    () => [
      { x: -7.2, y: 2.9, z: -4.8, s: 17, c: "#8b5cf6", o: 0.4, d: 0.0 },
      { x: 7.4, y: 2.0, z: -5.4, s: 16, c: "#22d3ee", o: 0.36, d: 2.0 },
      { x: 0.5, y: 5.2, z: -7.0, s: 21, c: "#e879f9", o: 0.32, d: 4.0 },
      { x: -5.2, y: -4.0, z: -4.0, s: 14, c: "#6366f1", o: 0.34, d: 1.2 },
      { x: 5.8, y: -4.4, z: -4.9, s: 15, c: "#34d399", o: 0.28, d: 3.0 },
      { x: -2.4, y: -5.4, z: -5.8, s: 13, c: "#7dd3fc", o: 0.26, d: 5.2 },
      { x: 3.2, y: 5.6, z: -6.2, s: 14, c: "#c084fc", o: 0.28, d: 6.4 },
    ],
    [],
  );

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    if (!group.current) {
      return;
    }
    // The whole nebula field drifts imperceptibly — the cosmos never sits still.
    group.current.rotation.y += delta * 0.004;
    group.current.children.forEach((child, index) => {
      const seed = seeds[index];
      if (!seed) {
        return;
      }
      child.position.x = seed.x + Math.sin(time * 0.03 + seed.d) * 0.5;
      child.position.y = seed.y + Math.cos(time * 0.024 + seed.d) * 0.4;
    });
  });

  return (
    <group ref={group} name="V2Nebula" renderOrder={2}>
      {seeds.map((seed, index) => (
        <sprite key={index} position={[seed.x, seed.y, seed.z]} scale={[seed.s, seed.s, 1]}>
          <spriteMaterial
            map={texture}
            color={seed.c}
            transparent
            opacity={seed.o}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
}

/* ------------------------------ dust field ----------------------------- */

const dustVertexShader = `
  attribute float aSize;
  attribute float aPhase;

  uniform float uTime;

  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.55 + 0.45 * sin(uTime * 0.8 + aPhase);
    vAlpha = 0.22 + 0.38 * tw;
    gl_PointSize = aSize * (300.0 / max(1.0, -mv.z)) * tw;
    gl_Position = projectionMatrix * mv;
  }
`;

const dustFragmentShader = `
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    gl_FragColor = vec4(0.72, 0.85, 1.0, a);
  }
`;

/**
 * A slow-drifting cloud of additive cosmic dust behind the whole scene.
 * Thousands of faint motes give the workspace tangible depth — space
 * reads as a volume, not a flat backdrop.
 */
function DustField() {
  const group = useRef<Group>(null);

  const { geometry, material } = useMemo(() => {
    const count = 420;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 24;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 13;
      positions[index * 3 + 2] = -7 - Math.random() * 8;
      sizes[index] = 0.02 + Math.random() * 0.055;
      phases[index] = Math.random() * Math.PI * 2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: dustVertexShader,
      fragmentShader: dustFragmentShader,
    });
    return { geometry, material };
  }, []);

  useFrame(({ clock }, delta) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y += delta * 0.006;
    }
  });

  return (
    <group ref={group} name="V2DustField" renderOrder={2}>
      <points
        geometry={geometry}
        material={material}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

/* ------------------------------ the scene ------------------------------ */

export default function GenesisV2Scene3D(_props: GenesisV2Scene3DProps) {
  /* The v2 scene lives inside GenesisCore's provider (GenesisScene wraps the
     whole router). R3F renders this canvas in its own reconciler root, so
     the shared context must be bridged in — exactly like the v1 world does. */
  const ContextBridge = useContextBridge(GenesisContext, GenesisStateContext);
  const frameloop = useSceneFrameloop();
  const [dpr, setDpr] = useState(DPR_START);

  return (
    <Canvas
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      camera={{ position: [0, 0.55, 8.6], fov: 46, near: 0.1, far: 220 }}
      gl={{ antialias: true, alpha: true }}
      dpr={dpr}
      frameloop={frameloop}
    >
      {/* pixel ratio follows measured frame rate (up to the display's own, e.g. 4K) */}
      <AdaptiveQuality onChange={setDpr} />
      {/* yield the GPU to the conversation (paused under full-screen chat) */}
      <SceneFrameGovernor />
      <ContextBridge>
        {/* free exploration camera — orbit / free-fly / touch / focus.
            The Gen V2 world is explorable: the camera is never locked. */}
        <GenesisV2CameraRig />

        {/* deep-space environment — the same living cosmos family as v1 */}
        <StarField />
        <Cosmos />
        <NebulaSprites />
        <DustField />

        {/* restrained illumination */}
        <ambientLight intensity={0.4} />
        <pointLight position={[-6, 4, 3]} intensity={0.5} color="#7c3aed" />
        <pointLight position={[6, 4, 3]} intensity={0.5} color="#0ea5e9" />
        <pointLight position={[0, -5, 2]} intensity={0.45} color="#10b981" />

        {/* Authorial spatial objects — the live SpatialSceneGraph rendered
            with the EXISTING renderer. The Genesis Core, its three modules
            (Creation Studio, Research Lab, Vault) and their beams are NOT in
            her world any more: this is her room (owner, 2026-11-20). */}
        <SpatialLayer />
        {/* The creative engine's actual geometry — garment, sleeve, pendant,
            stone, chair — drawn from the same store the tools write to. */}
        <CreativeObjects3D />

        {/* LÉLU — the exact saved avatar, present in the world and driven
            by the real agent activity (listening/thinking/speaking/
            working/rendering/searching), with her own warm light. */}
        <LeluV2Presence />

        {/* LÉLUVERSE: the environment she is in (her circular room by default),
            its objects with live physics, and her wearables — persisted server-side. */}
        <WorldScene />
      </ContextBridge>
    </Canvas>
  );
}
