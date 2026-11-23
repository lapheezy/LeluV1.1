/**
 * ==========================================================
 * LÉLUVERSE — HER ROTATING ROOM (the 3D room)
 *
 * The owner's pictures, built: a circular room of black marble with
 * copper-gold inlays and pink light, open to the Cosmos through tall
 * windows, with a turntable at its centre. Around the rim, six
 * sections (src/core/world/RotatingRoom.ts). Choosing one turns the
 * ring until it stands at the back of the room; on the way the
 * furniture transforms — what leaves sinks into the floor through a
 * glowing seam, what arrives rises out of it — and the turntable's
 * rings counter-rotate like the mechanism in the owner's stage
 * picture. "stage" retracts everything; "plan" flies the camera
 * overhead and raises every section: the floor plan.
 *
 * Every piece of furniture is a Meshy model of her own furniture
 * (public/lelu-room/*.glb), loaded only when its section first stands.
 * The room's surfaces are built in code (no download).
 * Units: the room is laid out in metres and drawn at her scale
 * (UNITS_PER_METRE: her body is 2.42 scene units for 1.72 m).
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { WorldState } from "../../../core/forge/ForgeClient";
import RoomStore, { layout, ROOM_SECTIONS, SECTION_SPAN, BACK_ANGLE, type RoomMode, type RoomPieceId } from "../../../core/world/RotatingRoom";
import { mountRoom } from "../../../core/world/roomPresence";
import { genesisCameraIntentBus } from "./GenesisCameraIntent";

/** Her body is 2.42 scene units tall for 1.72 m (LeluV2Presence BODY_HEIGHT). */
export const UNITS_PER_METRE = 2.42 / 1.72;
const M = UNITS_PER_METRE;
const WALL_HEIGHT_M = 4.2;
const PLATFORM_R_M = 1.75;
const PIECE_URL = (p: RoomPieceId) => `/lelu-room/${p}.glb`;

/* ------------------------------ shared assets ------------------------------ */

const pieceCache = new Map<RoomPieceId, Promise<THREE.Group>>();
function loadPiece(piece: RoomPieceId): Promise<THREE.Group> {
  let p = pieceCache.get(piece);
  if (!p) {
    p = new GLTFLoader().loadAsync(PIECE_URL(piece)).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = true;
        }
      });
      return g.scene;
    });
    pieceCache.set(piece, p);
  }
  return p;
}

/** Black marble with copper-gold and rose veins, drawn once. */
function marbleTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 40, size / 2, size / 2, size / 1.4);
  grad.addColorStop(0, "#1a1220");
  grad.addColorStop(1, "#08060b");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const vein = (color: string, width: number, count: number, alpha: number) => {
    g.strokeStyle = color;
    g.globalAlpha = alpha;
    g.lineWidth = width;
    for (let i = 0; i < count; i++) {
      let x = rnd() * size;
      let y = rnd() * size;
      let a = rnd() * Math.PI * 2;
      g.beginPath();
      g.moveTo(x, y);
      const steps = 14 + Math.floor(rnd() * 26);
      for (let s = 0; s < steps; s++) {
        a += (rnd() - 0.5) * 0.9;
        x += Math.cos(a) * 16;
        y += Math.sin(a) * 16;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  };
  vein("#5b4636", 3, 50, 0.35);
  vein("#d9a066", 1.2, 90, 0.55);
  vein("#ff7fc8", 0.8, 40, 0.35);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.anisotropy = 4;
  return t;
}

/** The theater screen's picture: a violet nebula and a planet's limb. */
function nebulaTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const w = 1024;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#07051a";
  g.fillRect(0, 0, w, h);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w;
    const y = rnd() * h * 0.8;
    const r = 30 + rnd() * 140;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const hue = rnd() < 0.5 ? "196,72,255" : "255,92,190";
    gr.addColorStop(0, `rgba(${hue},0.32)`);
    gr.addColorStop(1, `rgba(${hue},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`;
    g.fillRect(rnd() * w, rnd() * h, 1.4, 1.4);
  }
  // a planet's lit limb along the bottom
  const pl = g.createRadialGradient(w * 0.5, h * 2.1, h * 1.5, w * 0.5, h * 2.1, h * 1.72);
  pl.addColorStop(0, "rgba(40,50,140,1)");
  pl.addColorStop(0.92, "rgba(120,140,255,0.9)");
  pl.addColorStop(1, "rgba(230,220,255,0)");
  g.fillStyle = pl;
  g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* --------------------------------- pieces --------------------------------- */

function Piece({ piece, register }: { piece: RoomPieceId; register: (g: THREE.Group | null) => void }) {
  const [model, setModel] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    let alive = true;
    loadPiece(piece)
      .then((scene) => alive && setModel(scene.clone(true)))
      .catch((e: unknown) => console.info("[room] piece unavailable", piece, e instanceof Error ? e.message : e));
    return () => {
      alive = false;
    };
  }, [piece]);
  return (
    <group ref={register} visible={false}>
      <group scale={M}>{model ? <primitive object={model} /> : null}</group>
      {/* the glowing seam it rises through */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} name="seam">
        <ringGeometry args={[0.15 * M, 0.75 * M, 48]} />
        <meshBasicMaterial color="#ff8ad8" transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ---------------------------------- room ---------------------------------- */

export default function RotatingRoom({ state }: { state: WorldState }) {
  const s = state.environment.settings;
  const [cx, cz] = state.origin.centre;
  const floorY = state.origin.floorY;
  const R = s.radius;
  const [mode, setMode] = useState<RoomMode>(() => RoomStore.get().mode);
  /** Sections whose furniture has been asked for (loaded once, kept). */
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set([RoomStore.get().section]));
  const pieces = useMemo(() => layout(0, "plan"), []);
  const groups = useRef(new Map<string, THREE.Group>());
  const turntable = useRef<THREE.Group>(null);
  const turntableOuter = useRef<THREE.Group>(null);
  const dividers = useRef<THREE.Group>(null);
  const screen = useRef<THREE.Group>(null);
  const shown = useRef(new Map<string, number>());
  const marble = useMemo(marbleTexture, []);
  const nebula = useMemo(nebulaTexture, []);

  // She walks around what stands; the presence reads it from here.
  useEffect(() => mountRoom({ centre: [cx, cz], floorY, unitsPerMetre: M }), [cx, cz, floorY]);

  useEffect(
    () =>
      RoomStore.subscribe((st) => {
        setMode(st.mode);
        setLoaded((prev) => {
          const next = new Set(prev);
          if (st.mode === "plan") ROOM_SECTIONS.forEach((x) => next.add(x.id));
          next.add(st.section);
          return next.size === prev.size ? prev : next;
        });
      }),
    [],
  );

  // The floor plan is seen from above: fly up, and come back down when it is left.
  const wasPlan = useRef(mode === "plan");
  useEffect(() => {
    if (mode === "plan") {
      genesisCameraIntentBus.emit({ type: "fly", position: [cx, floorY + R * 2.3, cz + R * 0.55], lookAt: [cx, floorY, cz] });
    } else if (wasPlan.current) {
      genesisCameraIntentBus.emit({ type: "reset" });
    }
    wasPlan.current = mode === "plan";
  }, [mode, cx, cz, floorY, R]);

  const pillars = useMemo(() => {
    const list: Array<{ x: number; z: number; a: number }> = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      // the front (toward the viewer, +z) stays open
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.95) continue;
      list.push({ x: cx + Math.sin(a) * R, z: cz + Math.cos(a) * R, a });
    }
    return list;
  }, [R, cx, cz]);

  const gear = useMemo(() => {
    const teeth: Array<[number, number, number]> = [];
    const n = 72;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      teeth.push([Math.sin(a) * (PLATFORM_R_M + 0.07) * M, Math.cos(a) * (PLATFORM_R_M + 0.07) * M, a]);
    }
    return teeth;
  }, []);

  useFrame((_, delta) => {
    const now = Date.now();
    const st = RoomStore.get();
    const ring = RoomStore.ringAt(now);
    const turning = Boolean(st.turn);
    const placed = layout(ring, st.mode);
    for (const p of placed) {
      const g = groups.current.get(p.key);
      if (!g) continue;
      // ease toward the target rise so stage/plan switches also animate
      const prev = shown.current.get(p.key) ?? 0;
      const rise = prev + (p.rise - prev) * Math.min(1, delta * 4.5);
      shown.current.set(p.key, rise);
      const height = (p.piece === "chandelier" ? 1.4 : 2.3) * M;
      g.visible = rise > 0.003;
      g.position.set(cx + p.x * M, floorY + (p.y ?? 0) * M - (1 - rise) * height * (p.y ? 0 : 1) + (p.y ? (1 - rise) * 3 * M : 0), cz + p.z * M);
      g.rotation.y = p.rotationY;
      const seam = g.getObjectByName("seam") as THREE.Mesh | undefined;
      if (seam) {
        (seam.material as THREE.MeshBasicMaterial).opacity = p.y ? 0 : Math.max(0, 1 - Math.abs(rise * 2 - 1)) * 0.85;
        seam.position.y = (1 - rise) * height + 0.012;
      }
    }
    const rad = (ring * Math.PI) / 180;
    if (dividers.current) dividers.current.rotation.y = rad;
    // the turntable counter-rotates while the ring turns (the stage picture's mechanism)
    if (turntable.current) turntable.current.rotation.y = -rad * 0.5;
    if (turntableOuter.current) turntableOuter.current.rotation.y = rad * 0.25;
    if (screen.current) {
      const theater = placed.find((p) => p.section === "theater");
      const r = theater ? theater.rise : 0;
      const a = ((BACK_ANGLE + ROOM_SECTIONS.findIndex((x) => x.id === "theater") * SECTION_SPAN + ring) * Math.PI) / 180;
      screen.current.visible = r > 0.01;
      screen.current.position.set(cx + Math.sin(a) * (R - 0.35), floorY - (1 - r) * 3.2 * M, cz + Math.cos(a) * (R - 0.35));
      screen.current.rotation.y = a + Math.PI;
    }
    const glow = turning || st.mode === "stage" ? 1 : 0.45;
    turntable.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && (o as THREE.Mesh).name === "glow") m.opacity += (glow - m.opacity) * Math.min(1, delta * 3);
    });
  });

  return (
    <group name="LeluRotatingRoom">
      {/* floor: black marble, copper-gold inlays, the pink ring around the turntable */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, floorY - 0.01, cz]} receiveShadow>
        <circleGeometry args={[R, 96]} />
        <meshStandardMaterial map={marble ?? undefined} color={marble ? "#ffffff" : "#120d16"} roughness={0.22} metalness={0.35} />
      </mesh>
      {[0.98, 0.72].map((k) => (
        <mesh key={k} rotation={[-Math.PI / 2, 0, 0]} position={[cx, floorY + 0.002, cz]}>
          <ringGeometry args={[R * k - 0.06, R * k, 128]} />
          <meshStandardMaterial color="#d9a066" metalness={1} roughness={0.25} emissive="#5a3214" emissiveIntensity={0.6} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, floorY + 0.004, cz]}>
        <ringGeometry args={[(PLATFORM_R_M + 0.16) * M, (PLATFORM_R_M + 0.22) * M, 128]} />
        <meshBasicMaterial color="#ff5fc4" transparent opacity={0.85} toneMapped={false} />
      </mesh>

      {/* the turntable: an inlaid disc of rings, spokes and a gear rim */}
      <group position={[cx, floorY + 0.006, cz]}>
        <group ref={turntable}>
          {[0.35, 0.7, 1.1, 1.45].map((r) => (
            <mesh key={r} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[r * M - 0.025, r * M, 96]} />
              <meshStandardMaterial color="#e0aa70" metalness={1} roughness={0.2} emissive="#6b3a16" emissiveIntensity={0.5} />
            </mesh>
          ))}
          {Array.from({ length: 12 }, (_, i) => (
            <mesh key={i} rotation={[-Math.PI / 2, 0, (i / 12) * Math.PI * 2]} position={[0, 0.001, 0]}>
              <planeGeometry args={[0.018, PLATFORM_R_M * 2 * M * 0.82]} />
              <meshStandardMaterial color="#d9a066" metalness={1} roughness={0.3} />
            </mesh>
          ))}
          <mesh name="glow" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
            <ringGeometry args={[0.12 * M, 0.3 * M, 64]} />
            <meshBasicMaterial color="#ff7ad9" transparent opacity={0.45} toneMapped={false} />
          </mesh>
        </group>
        <group ref={turntableOuter}>
          {gear.map(([x, z, a], i) => (
            <mesh key={i} position={[x, 0.015, z]} rotation={[0, a, 0]}>
              <boxGeometry args={[0.05, 0.03, 0.12]} />
              <meshStandardMaterial color="#c98a55" metalness={1} roughness={0.3} />
            </mesh>
          ))}
        </group>
      </group>

      {/* the section boundaries turn with the ring: glowing lines on the floor */}
      <group ref={dividers} position={[cx, floorY + 0.005, cz]}>
        {ROOM_SECTIONS.map((_, i) => {
          const a = ((BACK_ANGLE + (i + 0.5) * SECTION_SPAN) * Math.PI) / 180;
          const r0 = (PLATFORM_R_M + 0.3) * M;
          const len = R * 0.97 - r0;
          return (
            <mesh key={i} position={[Math.sin(a) * (r0 + len / 2), 0, Math.cos(a) * (r0 + len / 2)]} rotation={[-Math.PI / 2, 0, -a]}>
              <planeGeometry args={[0.03, len]} />
              <meshBasicMaterial color="#ffb38a" transparent opacity={0.5} toneMapped={false} />
            </mesh>
          );
        })}
      </group>

      {/* the wall: tall window bays open to the Cosmos, copper pillars with her glowing sigil */}
      {pillars.map(({ x, z, a }, i) => (
        <group key={i} position={[x, floorY, z]} rotation={[0, a, 0]}>
          <mesh position={[0, (WALL_HEIGHT_M * M) / 2, 0]}>
            <boxGeometry args={[0.22, WALL_HEIGHT_M * M, 0.22]} />
            <meshStandardMaterial color="#120c10" metalness={0.7} roughness={0.25} />
          </mesh>
          {[-0.12, 0.12].map((dx) => (
            <mesh key={dx} position={[dx, (WALL_HEIGHT_M * M) / 2, -0.02]}>
              <boxGeometry args={[0.014, WALL_HEIGHT_M * M, 0.2]} />
              <meshBasicMaterial color="#c9824a" toneMapped={false} />
            </mesh>
          ))}
          {/* the sigil: a ring over a cross */}
          <group position={[0, WALL_HEIGHT_M * M * 0.55, -0.12]}>
            <mesh>
              <torusGeometry args={[0.13, 0.012, 8, 32]} />
              <meshBasicMaterial color="#ff8a5c" toneMapped={false} />
            </mesh>
            <mesh position={[0, -0.32, 0]}>
              <boxGeometry args={[0.02, 0.38, 0.02]} />
              <meshBasicMaterial color="#ff8a5c" toneMapped={false} />
            </mesh>
            <mesh position={[0, -0.36, 0]}>
              <boxGeometry args={[0.16, 0.02, 0.02]} />
              <meshBasicMaterial color="#ff8a5c" toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
      {/* the halo along the top of the wall and the dome's rim */}
      <mesh position={[cx, floorY + WALL_HEIGHT_M * M, cz]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[R, 0.07, 10, 128, Math.PI * 2]} />
        <meshBasicMaterial color="#ffb070" toneMapped={false} />
      </mesh>
      <mesh position={[cx, floorY + WALL_HEIGHT_M * M + 0.6, cz]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[R * 0.82, 0.05, 10, 128]} />
        <meshBasicMaterial color="#ff5fc4" toneMapped={false} />
      </mesh>
      {/* a low marble plinth along the walled part of the rim */}
      <mesh position={[cx, floorY + 0.12, cz]} rotation={[0, Math.PI, 0]}>
        <cylinderGeometry args={[R + 0.05, R + 0.05, 0.24, 128, 1, true, -Math.PI * 0.72, Math.PI * 1.44]} />
        <meshStandardMaterial color="#0c080d" metalness={0.6} roughness={0.2} side={THREE.DoubleSide} />
      </mesh>

      {/* the theater's screen rises with its section */}
      <group ref={screen} visible={false}>
        <mesh position={[0, 2.2 * M, 0]}>
          <planeGeometry args={[4.4 * M, 2.3 * M]} />
          <meshBasicMaterial map={nebula ?? undefined} color={nebula ? "#ffffff" : "#2a1450"} toneMapped={false} />
        </mesh>
        <mesh position={[0, 2.2 * M, -0.02]}>
          <boxGeometry args={[4.55 * M, 2.45 * M, 0.04]} />
          <meshStandardMaterial color="#0b0709" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* her furniture, section by section (loaded the first time its section stands) */}
      {pieces.map((p) =>
        loaded.has(p.section) ? (
          <Piece
            key={p.key}
            piece={p.piece}
            register={(g) => {
              if (g) groups.current.set(p.key, g);
              else groups.current.delete(p.key);
            }}
          />
        ) : null,
      )}

      {/* light scoped to the room so the rest of the Cosmos keeps its look */}
      <pointLight position={[cx, floorY + 4.2 * M, cz]} intensity={s.ambient * 7} distance={R * 2.6} color="#ffd2a8" />
      <pointLight position={[cx, floorY + 2.4 * M, cz - R * 0.55]} intensity={s.keyLight * 3.2} distance={R * 2.2} color="#ffb4dc" />
      <pointLight position={[cx + R * 0.6, floorY + 1.6 * M, cz + R * 0.3]} intensity={s.keyLight * 1.6} distance={R * 1.8} color="#c89bff" />
    </group>
  );
}
