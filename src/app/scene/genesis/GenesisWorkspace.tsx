/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS WORKSPACE
 *
 * Living workspace objects inside Genesis.
 *
 * These are the "three spheres" of the scene: one world-node
 * per cognition workspace (engineering / creative / research
 * spaces from state.cognition.workspaces). They are the 3D
 * navigation targets for the workspace system and stay in
 * sync with the 2D Workspaces panel via focusWorkspace /
 * selectDestination.
 *
 * Visually they belong to the same cosmos as the Core: each
 * node sits in a shallow arc around Genesis, carries an
 * atmospheric glow shell and an orbit ring with a spark, and
 * gently drifts — so they read as worlds of the same system,
 * not as unexplained floating spheres.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";

import { useGenesis } from "./GenesisCore";
import type GenesisNavigator from "./GenesisNavigator";

/** Palette for the world-nodes, keyed by workspace index. */
const WORLD_COLORS = ["#a78bfa", "#38bdf8", "#f9a8d4", "#7dd3fc", "#c4b5fd"];

/*
 * The workspace-preview diamond places Creation Studio on the Core's
 * left and Research Lab on its right (the reference composition). The
 * 3D worlds sit at the same screen positions the 2D preview nodes use,
 * so clicking either surface focuses the same real world. The "core"
 * workspace is skipped — it IS the Genesis Core itself.
 */
const WORLD_POSITIONS: Record<string, [number, number, number]> = {
  creation: [-2.3, 0.1, 0.35],
  research: [2.3, 0.1, 0.35],
};

function positionForWorkspace(
  id: string,
  name: string,
  index: number,
  count: number,
): [number, number, number] {
  const named = WORLD_POSITIONS[id] ?? WORLD_POSITIONS[name.toLowerCase()];
  if (named) {
    return named;
  }
  // Unknown workspaces fan out below the core so they never stack on it.
  const spread = Math.PI * 0.7;
  const start = -spread / 2;
  const t = count <= 1 ? 0.5 : index / (count - 1);
  const angle = start + t * spread;
  const radius = 3.1;
  return [
    Math.sin(angle) * radius,
    -0.7 + Math.cos(angle) * 1.1,
    0.7 + (1 - Math.cos(angle)) * 0.5,
  ];
}

interface WorkspaceNodeProps {
  id: string;
  name: string;
  index: number;
  count: number;
  navigator?: GenesisNavigator;
}

function WorkspaceNode({ id, name, index, count, navigator }: WorkspaceNodeProps) {
  const { state, focusWorkspace, selectDestination } = useGenesis();

  const node = useRef<Group>(null);
  const ring = useRef<Group>(null);
  const spark = useRef<Mesh>(null);
  const coreMesh = useRef<Mesh>(null);
  const time = useRef(0);

  const color = WORLD_COLORS[index % WORLD_COLORS.length];
  const active = state.activeWorkspace === id;

  /*
   * Positioned by the workspace-preview diamond: Creation Studio left,
   * Research Lab right (matching the 2D preview nodes over the same
   * screen area), unknown workspaces fanning out below the Core.
   * (Workspace identity, colors, size and click targets are unchanged.)
   */
  const position = useMemo<[number, number, number]>(() => {
    return positionForWorkspace(id, name, index, count);
  }, [id, name, index, count]);

  // The palette color and active flag are stable per node (index-derived), so
  // these materials are effectively created once; useFrame() tunes their
  // uniforms every frame. The dependencies only keep exhaustive-deps honest.
  const coreMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: new Color(color),
        emissive: new Color(color),
        emissiveIntensity: active ? 1.7 : 0.55,
        roughness: 0.32,
        metalness: 0.15,
      }),
    [color, active],
  );

  const glowMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity: 0.1,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [color],
  );

  const ringMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity: active ? 0.55 : 0.26,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [color, active],
  );

  const sparkMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  function selectWorkspace() {
    focusWorkspace(id);

    selectDestination({
      id,
      type: "workspace",
      name,
      position: {
        x: position[0],
        y: position[1],
        z: position[2],
      },
    });

    navigator?.navigate({
      id,
      type: "workspace",
      name,
      position: {
        x: position[0],
        y: position[1],
        z: position[2],
      },
    });
  }

  useFrame((_, delta) => {
    time.current += delta;
    if (!node.current || !ring.current || !spark.current || !coreMesh.current) {
      return;
    }

    // Gentle breathing so each world feels alive.
    const bob = Math.sin(time.current * 0.65 + index * 1.7) * 0.09;
    node.current.position.y = position[1] + bob;

    const targetIntensity = active ? 1.8 + Math.sin(time.current * 3) * 0.25 : 0.5 + Math.sin(time.current * 1.3 + index) * 0.08;
    coreMaterial.emissiveIntensity += (targetIntensity - coreMaterial.emissiveIntensity) * 0.06;

    const targetOpacity = active ? 0.16 : 0.1;
    glowMaterial.opacity += (targetOpacity - glowMaterial.opacity) * 0.06;

    const targetRing = active ? 0.62 : 0.26;
    ringMaterial.opacity += (targetRing - ringMaterial.opacity) * 0.06;

    const pulse = active ? 1 + Math.sin(time.current * 2.6) * 0.04 : 1;
    coreMesh.current.scale.setScalar(pulse);

    ring.current.rotation.z += delta * (0.35 + (active ? 0.35 : 0));
    const angle = time.current * (0.55 + index * 0.07);
    spark.current.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.28, Math.sin(angle) * 0.68);
  });

  return (
    <group ref={node} position={position} name={`WorkspaceNode-${name}`}>
      {/* World core */}
      <mesh
        ref={coreMesh}
        material={coreMaterial}
        onClick={selectWorkspace}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        <sphereGeometry args={[0.46, 48, 48]} />
      </mesh>

      {/* Atmospheric glow shell */}
      <mesh material={glowMaterial} scale={1.6}>
        <sphereGeometry args={[0.46, 32, 32]} />
      </mesh>

      {/* Orbit ring + spark */}
      <group ref={ring} rotation={[Math.PI / 2.55, 0.35, index * 0.9]}>
        <mesh material={ringMaterial}>
          <torusGeometry args={[0.8, 0.012, 12, 80]} />
        </mesh>
        <mesh ref={spark} material={sparkMaterial}>
          <sphereGeometry args={[0.05, 12, 12]} />
        </mesh>
      </group>
    </group>
  );
}

interface GenesisWorkspaceProps {
  navigator?: GenesisNavigator;
}

export default function GenesisWorkspace({ navigator }: GenesisWorkspaceProps) {
  const { state } = useGenesis();
  // The "core" workspace is the Genesis Core itself — the workspace-preview
  // diamond draws it as the top node, so it must not double as a world.
  const workspaces = (state.cognition?.workspaces ?? []).filter(
    (workspace: any) => workspace.id !== "core",
  );
  const count = workspaces.length;

  return (
    <>
      {workspaces.map((workspace: any, index: number) => (
        <WorkspaceNode
          key={workspace.id ?? index}
          id={workspace.id ?? String(index)}
          name={workspace.name ?? "Workspace"}
          index={index}
          count={count}
          navigator={navigator}
        />
      ))}
    </>
  );
}
