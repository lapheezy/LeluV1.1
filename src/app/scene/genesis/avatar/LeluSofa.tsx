/**
 * ==========================================================
 * LÉLU — HER SOFA
 *
 * Where she sits when she settles in: a two-seat luxury sofa — deep
 * plum velvet with a soft sheen, plush rounded cushions, rose-gold
 * legs. Built in code (no download, no credits), scaled to her body,
 * and placed under where her hips actually are while she sits, so the
 * seated clips land on the cushion rather than in the air.
 *
 * Shared by every view of her (it lives inside LeluBody): the same sofa
 * in her window over the chat and in the Cosmos.
 * ==========================================================
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export default function LeluSofa({
  height,
  shown,
  seat,
}: {
  /** Her standing height in scene units (the sofa is sized to her). */
  height: number;
  /** Fade in while she sits, out when she has left it. */
  shown: boolean;
  /** Where her hips are while seated (x, y, z in her body's space), or null before she has sat. */
  seat: { current: THREE.Vector3 | null };
}) {
  const group = useRef<THREE.Group>(null);
  const opacity = useRef(0);

  const parts = useMemo(() => {
    const H = height;
    const velvet = new THREE.MeshPhysicalMaterial({
      color: "#4f1c46",
      roughness: 0.78,
      sheen: 1,
      sheenColor: new THREE.Color("#ffb3e1"),
      sheenRoughness: 0.45,
      transparent: true,
    });
    const cushion = velvet.clone();
    cushion.color = new THREE.Color("#5e2354");
    const gold = new THREE.MeshStandardMaterial({ color: "#d9a48f", metalness: 1, roughness: 0.28, transparent: true });
    const w = 0.92 * H; // two seats wide
    const d = 0.34 * H;
    const base = 0.1 * H; // frame thickness under the cushions
    const leg = 0.07 * H;
    const box = (x: number, y: number, z: number, r: number) => new RoundedBoxGeometry(x, y, z, 4, r);
    return {
      materials: [velvet, cushion, gold],
      velvet,
      cushion,
      gold,
      w,
      d,
      leg,
      base,
      frame: box(w, base, d, 0.025 * H),
      seatCushion: box(w / 2 - 0.012 * H, 0.07 * H, d * 0.86, 0.03 * H),
      back: box(w, 0.32 * H, 0.09 * H, 0.04 * H),
      backCushion: box(w / 2 - 0.02 * H, 0.22 * H, 0.08 * H, 0.035 * H),
      arm: box(0.09 * H, 0.2 * H, d, 0.04 * H),
      legGeo: new THREE.CylinderGeometry(0.012 * H, 0.008 * H, leg, 12),
    };
  }, [height]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    opacity.current += ((shown ? 1 : 0) - opacity.current) * Math.min(1, delta * 4);
    for (const m of parts.materials) m.opacity = opacity.current;
    g.visible = opacity.current > 0.01;
    const hips = seat.current;
    if (hips && shown) {
      // Cushion top just under her hip joint; seat centred under her, back behind her.
      const seatTop = Math.max(parts.leg + parts.base + 0.05 * height, hips.y - 0.075 * height);
      g.position.set(hips.x, seatTop - (parts.leg + parts.base + 0.07 * height), hips.z - 0.05 * height);
    }
  });

  const { w, d, leg, base } = parts;
  const seatY = leg + base;
  return (
    <group ref={group} visible={false} name="LeluSofa">
      {/* legs */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} geometry={parts.legGeo} material={parts.gold} position={[sx * (w / 2 - 0.05 * height), leg / 2, sz * (d / 2 - 0.04 * height)]} />
        )),
      )}
      {/* frame, seat cushions */}
      <mesh geometry={parts.frame} material={parts.velvet} position={[0, leg + base / 2, 0]} />
      {[-1, 1].map((sx) => (
        <mesh key={sx} geometry={parts.seatCushion} material={parts.cushion} position={[sx * (w / 4), seatY + 0.035 * height, 0.02 * height]} />
      ))}
      {/* back, back cushions, arms */}
      <mesh geometry={parts.back} material={parts.velvet} position={[0, seatY + 0.16 * height, -d / 2 + 0.045 * height]} rotation={[-0.12, 0, 0]} />
      {[-1, 1].map((sx) => (
        <mesh key={`bc${sx}`} geometry={parts.backCushion} material={parts.cushion} position={[sx * (w / 4), seatY + 0.17 * height, -d / 2 + 0.11 * height]} rotation={[-0.16, 0, 0]} />
      ))}
      {[-1, 1].map((sx) => (
        <mesh key={`a${sx}`} geometry={parts.arm} material={parts.velvet} position={[sx * (w / 2 - 0.045 * height), seatY + 0.07 * height, 0]} />
      ))}
    </group>
  );
}
