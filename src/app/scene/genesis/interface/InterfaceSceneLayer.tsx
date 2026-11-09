/**
 * ==========================================================
 * LÉLU — COSMOS SCENE LAYER (inside the Genesis v1 canvas)
 *
 * Renders what LÉLU composed into the live 3D Cosmos:
 *
 *   • the environment dome (gradient / nebula / garden / river /
 *     studio / plain), INSIDE the native cosmic backdrop so the
 *     original sky remains whenever the backdrop is "cosmos";
 *   • token-driven lighting and fog — only when a non-default
 *     theme is effective, so the original scene is untouched;
 *   • every scene object (planets with atmospheres, rings and
 *     moons, nebulae, crystals, flora, orbs, rivers, particles,
 *     artboards, lights, glTF models) with its material and
 *     animation;
 *   • interaction: hover highlights, and selecting an object
 *     that links to a workspace opens it (touch included).
 *
 * The preview is rendered exactly like the live state: what the
 * user approves is what they saw.
 * ==========================================================
 */

import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, useGLTF } from "@react-three/drei";
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  DoubleSide,
  FogExp2,
  Group,
  Mesh,
  PlaneGeometry,
  SRGBColorSpace,
  type Fog,
} from "three";
import { isDefaultLook } from "../../../../core/interface/InterfaceOrchestrator";
import type { EnvironmentTokens, LightingTokens } from "../../../../core/interface/DesignTokens";
import type { SceneObject } from "../../../../core/interface/SceneModel";
import useInterface from "./useInterface";

const isPhone = () => typeof window !== "undefined" && window.innerWidth < 720;

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[Interface] Cosmos object failed to render (contained)", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ------------------------------------------------------------------ *
 * ENVIRONMENT DOME
 * ------------------------------------------------------------------ */

const DOME_OPACITY: Record<string, number> = { gradient: 0.82, nebula: 0.62, garden: 0.74, river: 0.84, studio: 0.93, plain: 1 };

function paintDome(env: EnvironmentTokens, background: string): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const stops = env.backdrop === "plain" ? [background, background] : env.gradientStops.length ? env.gradientStops : [background];
  const vertical = g.createLinearGradient(0, 0, 0, canvas.height);
  stops.forEach((c, i) => vertical.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
  g.fillStyle = vertical;
  g.fillRect(0, 0, canvas.width, canvas.height);

  // Deterministic pseudo-random so a preview and its applied state match.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  if (env.backdrop === "nebula" || env.backdrop === "garden" || env.backdrop === "studio") {
    const blobs = env.backdrop === "studio" ? 3 : 9;
    for (let i = 0; i < blobs; i++) {
      const color = env.nebulaColors[i % env.nebulaColors.length] ?? "#ffffff";
      const x = rand() * canvas.width;
      const y = canvas.height * (env.backdrop === "garden" ? 0.45 + rand() * 0.45 : 0.15 + rand() * 0.7);
      const r = 90 + rand() * (env.backdrop === "studio" ? 260 : 200);
      const radial = g.createRadialGradient(x, y, 0, x, y, r);
      radial.addColorStop(0, `${color}${env.backdrop === "studio" ? "55" : "88"}`);
      radial.addColorStop(1, `${color}00`);
      g.globalCompositeOperation = "lighter";
      g.fillStyle = radial;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over";
  }
  if (env.backdrop === "river") {
    g.globalAlpha = 0.22;
    g.strokeStyle = env.nebulaColors[0] ?? "#e0f2fe";
    for (let band = 0; band < 14; band++) {
      g.lineWidth = 2 + rand() * 5;
      g.beginPath();
      const baseY = canvas.height * (0.5 + band * 0.035);
      for (let x = 0; x <= canvas.width; x += 16) g.lineTo(x, baseY + Math.sin(x / 90 + band) * 6);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  const stars = Math.round(env.particleDensity * (env.backdrop === "plain" ? 0 : 900));
  g.fillStyle = env.particleColor;
  for (let i = 0; i < stars; i++) {
    g.globalAlpha = 0.25 + rand() * 0.6;
    g.fillRect(rand() * canvas.width, rand() * canvas.height * (env.backdrop === "garden" ? 0.6 : 1), rand() < 0.08 ? 2 : 1, 1);
  }
  g.globalAlpha = 1;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function EnvironmentDome({ env, background }: { env: EnvironmentTokens; background: string }) {
  const texture = useMemo(() => paintDome(env, background), [env, background]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const ref = useRef<Mesh>(null);
  useFrame((_, dt) => {
    // A barely perceptible drift keeps the environment alive.
    if (ref.current && env.backdrop !== "plain") ref.current.rotation.y += dt * 0.004;
  });
  if (!texture) return null;
  return (
    <mesh ref={ref} renderOrder={-10}>
      <sphereGeometry args={[400, 48, 24]} />
      <meshBasicMaterial map={texture} side={BackSide} transparent opacity={DOME_OPACITY[env.backdrop] ?? 0.8} depthWrite={false} fog={false} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ *
 * LIGHTING + FOG
 * ------------------------------------------------------------------ */

function ThemeLighting({ lighting }: { lighting: LightingTokens }) {
  const { scene } = useThree();
  useEffect(() => {
    if (lighting.fogDensity <= 0) return;
    const previous = scene.fog as Fog | FogExp2 | null;
    // Token density is perceptual; scaled so the far native sky is veiled,
    // not erased.
    scene.fog = new FogExp2(new Color(lighting.fogColor), lighting.fogDensity * 0.06);
    return () => {
      scene.fog = previous;
    };
  }, [scene, lighting.fogColor, lighting.fogDensity]);
  return (
    <>
      <ambientLight intensity={lighting.ambient * 0.6} color={lighting.keyColor} />
      <directionalLight position={[4, 6, 5]} intensity={lighting.keyIntensity} color={lighting.keyColor} />
      <pointLight position={[-5, -2, 3]} intensity={lighting.keyIntensity * 0.8} distance={30} color={lighting.rimColor} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * OBJECTS
 * ------------------------------------------------------------------ */

function glowTexture(color: string): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const radial = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  radial.addColorStop(0, `${color}ff`);
  radial.addColorStop(0.35, `${color}66`);
  radial.addColorStop(1, `${color}00`);
  g.fillStyle = radial;
  g.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function Glow({ color, size, opacity = 0.6 }: { color: string; size: number; opacity?: number }) {
  const texture = useMemo(() => glowTexture(color), [color]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return (
    <Billboard>
      <mesh>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
    </Billboard>
  );
}

function StandardMaterial({ object, color = object.color }: { object: SceneObject; color?: string }) {
  const m = object.material;
  return (
    <meshStandardMaterial
      color={color}
      roughness={m.roughness}
      metalness={m.metalness}
      emissive={color}
      emissiveIntensity={m.emissiveIntensity}
      transparent={m.opacity < 1}
      opacity={m.opacity}
      wireframe={m.wireframe}
    />
  );
}

function Planet({ object, segments }: { object: SceneObject; segments: number }) {
  const moons = object.features.moons ?? 0;
  const moonRefs = useRef<Array<Group | null>>([]);
  useFrame(({ clock }) => {
    moonRefs.current.forEach((moon, i) => {
      if (!moon) return;
      const t = clock.elapsedTime * (0.6 + i * 0.25) * object.animation.speed + i * 2;
      moon.position.set(Math.cos(t) * (1.6 + i * 0.35), Math.sin(t * 0.7) * 0.2, Math.sin(t) * (1.6 + i * 0.35));
    });
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[1, segments, Math.round(segments * 0.75)]} />
        <StandardMaterial object={object} />
      </mesh>
      {object.features.atmosphere ? (
        <mesh scale={1.12}>
          <sphereGeometry args={[1, segments, Math.round(segments * 0.75)]} />
          <meshBasicMaterial color={object.secondaryColor ?? object.color} transparent opacity={0.18} side={BackSide} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      ) : null}
      {object.features.rings ? (
        <mesh rotation={[Math.PI / 2.4, 0, 0.2]}>
          <ringGeometry args={[1.35, 1.95, 64]} />
          <meshStandardMaterial color={object.secondaryColor ?? object.color} transparent opacity={0.55} side={DoubleSide} roughness={0.8} />
        </mesh>
      ) : null}
      {Array.from({ length: moons }, (_, i) => (
        <group key={i} ref={(g) => (moonRefs.current[i] = g)}>
          <mesh scale={0.16}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Flora({ object }: { object: SceneObject }) {
  const petals = object.features.petals ?? 6;
  const petalColor = object.secondaryColor ?? object.color;
  return (
    <group>
      <mesh position={[0, -0.9, 0]}>
        <cylinderGeometry args={[0.04, 0.07, 1.8, 8]} />
        <meshStandardMaterial color={object.color} roughness={0.8} />
      </mesh>
      {[-0.4, 0.2].map((y, i) => (
        <mesh key={y} position={[i ? -0.22 : 0.22, y - 0.6, 0]} rotation={[0, 0, i ? 0.9 : -0.9]} scale={[0.32, 0.08, 0.16]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color={object.color} roughness={0.7} />
        </mesh>
      ))}
      {Array.from({ length: petals }, (_, i) => {
        const a = (i / petals) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32]} rotation={[0.5 * Math.sin(a), -a, 0.55]} scale={[0.34, 0.06, 0.16]}>
            <sphereGeometry args={[1, 14, 10]} />
            <meshStandardMaterial color={petalColor} roughness={0.5} emissive={petalColor} emissiveIntensity={object.material.emissiveIntensity} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.08, 0]} scale={0.16}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#fde68a" emissive="#fde68a" emissiveIntensity={0.9} />
      </mesh>
    </group>
  );
}

function River({ object }: { object: SceneObject }) {
  const geometry = useMemo(() => new PlaneGeometry(2, 0.5, 80, 6), []);
  const base = useMemo(() => Float32Array.from(geometry.attributes.position.array), [geometry]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }) => {
    const pos = geometry.attributes.position;
    const t = clock.elapsedTime * object.animation.speed;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      pos.setZ(i, Math.sin(x * 3 + t) * 0.06 + Math.sin(y * 9 + t * 1.7) * 0.015);
      pos.setY(i, y + Math.sin(x * 1.6 + t * 0.4) * 0.12);
    }
    pos.needsUpdate = true;
  });
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2.3, 0, 0]}>
      <meshStandardMaterial color={object.color} emissive={object.secondaryColor ?? object.color} emissiveIntensity={0.25} transparent opacity={0.7} side={DoubleSide} roughness={0.2} metalness={0.3} />
    </mesh>
  );
}

function Particles({ object }: { object: SceneObject }) {
  const count = Math.round((object.features.count ?? 300) * (isPhone() ? 0.45 : 1));
  const positions = useMemo(() => {
    let seed = count * 31 + 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      array[i * 3] = rand();
      array[i * 3 + 1] = rand() * 0.6;
      array[i * 3 + 2] = rand() * 0.8;
    }
    return array;
  }, [count]);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={object.color} size={0.025 / Math.max(0.2, object.scale) * 6} sizeAttenuation transparent opacity={0.85} depthWrite={false} blending={AdditiveBlending} />
    </points>
  );
}

function Nebula({ object }: { object: SceneObject }) {
  const colors = [object.color, object.secondaryColor ?? object.color, object.color];
  return (
    <group>
      {colors.map((c, i) => (
        <group key={i} position={[(i - 1) * 0.45, Math.sin(i * 2) * 0.2, -i * 0.1]}>
          <Glow color={c} size={1.6 - i * 0.25} opacity={object.material.opacity} />
        </group>
      ))}
    </group>
  );
}

function Model({ object }: { object: SceneObject }) {
  const gltf = useGLTF(object.url!);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={scene} />;
}

function ObjectBody({ object, segments }: { object: SceneObject; segments: number }) {
  switch (object.kind) {
    case "planet":
    case "moon":
      return <Planet object={object} segments={object.kind === "moon" ? 20 : segments} />;
    case "star":
      return (
        <group>
          <mesh>
            <sphereGeometry args={[1, 24, 18]} />
            <meshBasicMaterial color={object.color} />
          </mesh>
          <Glow color={object.color} size={5} opacity={0.7} />
          <pointLight intensity={object.material.emissiveIntensity * 3} distance={20} color={object.color} />
        </group>
      );
    case "orb":
      return (
        <group>
          <mesh>
            <sphereGeometry args={[1, 32, 24]} />
            <StandardMaterial object={object} />
          </mesh>
          <Glow color={object.color} size={3.2} opacity={0.45} />
        </group>
      );
    case "crystal":
      return (
        <mesh>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={object.color} roughness={0.1} metalness={0.6} emissive={object.color} emissiveIntensity={object.material.emissiveIntensity + 0.2} flatShading transparent opacity={Math.min(1, object.material.opacity) * 0.9} />
        </mesh>
      );
    case "flora":
      return <Flora object={object} />;
    case "river":
      return <River object={object} />;
    case "particles":
      return <Particles object={object} />;
    case "nebula":
      return <Nebula object={object} />;
    case "artboard":
      return (
        <group>
          <mesh>
            <boxGeometry args={[1.6, 1, 0.03]} />
            <meshStandardMaterial color={object.color} roughness={0.9} emissive={object.color} emissiveIntensity={0.08} />
          </mesh>
          <mesh position={[0, 0, -0.03]}>
            <boxGeometry args={[1.7, 1.1, 0.02]} />
            <meshStandardMaterial color={object.secondaryColor ?? "#1f1f24"} roughness={0.6} />
          </mesh>
        </group>
      );
    case "light":
      return <pointLight intensity={object.scale * 2} distance={25} color={object.color} />;
    case "model":
      return object.url ? (
        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={object.color} wireframe />
            </mesh>
          }
        >
          <Model object={object} />
        </Suspense>
      ) : null;
    default:
      return null;
  }
}

function SceneObjectNode({ object, segments }: { object: SceneObject; segments: number }) {
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const phase = useMemo(() => (object.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % 100) / 16, [object.id]);
  const radius = Math.hypot(object.position[0], object.position[2]);
  const angle0 = Math.atan2(object.position[2], object.position[0]);

  useFrame(({ clock }, dt) => {
    const g = outer.current;
    const body = inner.current;
    if (!g || !body) return;
    const t = clock.elapsedTime * object.animation.speed + phase;
    const [x, y, z] = object.position;
    g.position.set(x, y, z);
    switch (object.animation.type) {
      case "spin":
        body.rotation.y += dt * 0.35 * object.animation.speed;
        break;
      case "orbit":
        g.position.set(Math.cos(angle0 + t * 0.15) * radius, y, Math.sin(angle0 + t * 0.15) * radius);
        body.rotation.y += dt * 0.2;
        break;
      case "bob":
        g.position.y = y + Math.sin(t) * 0.12;
        break;
      case "pulse":
        body.scale.setScalar(1 + Math.sin(t * 2) * 0.06);
        break;
      case "sway":
        body.rotation.z = Math.sin(t * 0.8) * 0.12;
        break;
      case "drift":
        body.rotation.y += dt * 0.03 * object.animation.speed;
        g.position.x = x + Math.sin(t * 0.2) * 0.15;
        break;
      default:
        break;
    }
    const target = object.scale * (hovered && object.link ? 1.1 : 1);
    g.scale.lerp({ x: target, y: target, z: target } as never, 0.15);
  });

  const interactive = Boolean(object.link);
  const open = () => {
    if (!object.link) return;
    window.dispatchEvent(new CustomEvent("lelu-interface-open-link", { detail: object.link }));
  };

  return (
    <group
      ref={outer}
      position={object.position}
      scale={object.scale}
      onPointerOver={
        interactive
          ? (e) => {
              e.stopPropagation();
              setHovered(true);
              document.body.style.cursor = "pointer";
            }
          : undefined
      }
      onPointerOut={
        interactive
          ? () => {
              setHovered(false);
              document.body.style.cursor = "";
            }
          : undefined
      }
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              open();
            }
          : undefined
      }
    >
      <group ref={inner} rotation={object.rotation}>
        <SceneBoundary>
          <ObjectBody object={object} segments={segments} />
        </SceneBoundary>
      </group>
      {object.label && (interactive || hovered) ? (
        <Html position={[0, object.kind === "flora" ? 0.6 : 1.45, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: interactive ? "auto" : "none" }}>
          <button
            type="button"
            onClick={open}
            style={{
              whiteSpace: "nowrap",
              padding: "4px 10px",
              minHeight: 28,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.35)",
              background: hovered ? "rgba(15,23,42,0.92)" : "rgba(15,23,42,0.7)",
              color: "#f8fafc",
              fontSize: 12,
              fontFamily: "var(--lelu-font-heading, system-ui)",
              cursor: interactive ? "pointer" : "default",
              backdropFilter: "blur(8px)",
            }}
            aria-label={interactive ? `Open ${object.label}` : object.label}
          >
            {object.label}
          </button>
        </Html>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * LAYER
 * ------------------------------------------------------------------ */

export default function InterfaceSceneLayer() {
  const view = useInterface();
  const config = view.effective;
  const custom = !isDefaultLook(config);
  const segments = isPhone() ? 24 : 40;
  const env = config.tokens.environment;

  if (!custom && config.scene.objects.length === 0) return null;

  return (
    <SceneBoundary>
      {custom && env.backdrop !== "cosmos" ? <EnvironmentDome env={env} background={config.tokens.palette.background} /> : null}
      {custom ? (
        <ThemeLighting lighting={config.tokens.lighting} />
      ) : (
        // Objects composed under the original look still need light; the
        // range is limited so the native Genesis scene is not relit.
        <pointLight position={[0, 3, 2]} intensity={1.4} distance={14} />
      )}
      {config.scene.objects.map((object) => (
        <SceneObjectNode key={object.id} object={object} segments={segments} />
      ))}
    </SceneBoundary>
  );
}
