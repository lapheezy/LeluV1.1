/**
 * ==========================================================
 * LÉLU — WORLD EXPORT (STL / OBJ)
 *
 * The capability that closed a real gap: LÉLU could build objects in her
 * world but could not hand them to a 3D printer or another 3D tool.
 *
 * Found by her resource-intelligence workflow (Job 3): two open-source
 * alternatives were discovered and evaluated (@jscad/stl-serializer, MIT;
 * the installed three.js exporters, MIT), both proven in the isolated
 * sandbox, and the INSTALLED one was chosen — three is already LÉLU's 3D
 * engine, so this adds no dependency and no bytes to install.
 *
 * Pure: placements in, file text out. It runs in the browser (the tool)
 * and in Node (tests) alike. Forge assets (GLB meshes) are referenced, not
 * re-meshed: only built-in primitives are rebuilt here.
 * ==========================================================
 */
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry,
  type BufferGeometry,
} from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import type { CosmosPlacement } from "../forge/ForgeClient";

export type WorldExportFormat = "stl" | "obj";

export interface WorldExportResult {
  format: WorldExportFormat;
  text: string;
  bytes: number;
  exported: Array<{ id: string; label: string; shape: string }>;
  skipped: Array<{ id: string; label: string; reason: string }>;
  /** STL facets or OBJ faces — a real count from the file itself. */
  faces: number;
}

function geometryFor(shape: NonNullable<CosmosPlacement["primitive"]>["shape"], height: number, proportions: [number, number, number]): BufferGeometry {
  const [px, py, pz] = proportions;
  const h = Math.max(0.01, height);
  switch (shape) {
    case "box": return new BoxGeometry(h * px, h * py, h * pz);
    case "sphere": return new SphereGeometry((h * px) / 2, 32, 24);
    case "cylinder": return new CylinderGeometry((h * px) / 2, (h * px) / 2, h * py, 32);
    case "cone": return new ConeGeometry((h * px) / 2, h * py, 32);
    case "torus": return new TorusGeometry((h * px) / 2.6, (h * px) / 10, 16, 48);
    case "plane": return new BoxGeometry(h * px, 0.01, h * pz); // printable: a thin slab, not a zero-thickness plane
  }
}

function buildGroup(placements: CosmosPlacement[], only?: string[]) {
  const group = new Group();
  const exported: WorldExportResult["exported"] = [];
  const skipped: WorldExportResult["skipped"] = [];
  const wanted = only?.length ? new Set(only) : null;
  for (const placement of placements) {
    if (wanted && !wanted.has(placement.id) && !(placement.group && wanted.has(placement.group))) continue;
    if (placement.worn || placement.attach) {
      skipped.push({ id: placement.id, label: placement.label, reason: "worn by a character" });
      continue;
    }
    if (!placement.primitive) {
      skipped.push({ id: placement.id, label: placement.label, reason: `a 3D Forge mesh — its GLB file is ${placement.file}` });
      continue;
    }
    const mesh = new Mesh(geometryFor(placement.primitive.shape, placement.height, placement.primitive.proportions ?? [1, 1, 1]));
    mesh.name = placement.label || placement.id;
    mesh.position.set(...placement.position);
    mesh.rotation.y = placement.rotationY ?? 0;
    group.add(mesh);
    exported.push({ id: placement.id, label: placement.label, shape: placement.primitive.shape });
  }
  group.updateMatrixWorld(true);
  return { group, exported, skipped };
}

/** Rebuild the primitives as meshes and export them as one file. */
export function exportPlacements(placements: CosmosPlacement[], format: WorldExportFormat, only?: string[]): WorldExportResult {
  const { group, exported, skipped } = buildGroup(placements, only);
  const text = exported.length === 0 ? "" : format === "stl" ? (new STLExporter().parse(group) as string) : new OBJExporter().parse(group);
  const faces = format === "stl" ? (text.match(/facet normal/g) ?? []).length : (text.match(/^f /gm) ?? []).length;
  for (const child of group.children) (child as Mesh).geometry.dispose();
  return { format, text, bytes: new TextEncoder().encode(text).length, exported, skipped, faces };
}

export interface WorldGlbResult {
  glb: ArrayBuffer;
  bytes: number;
  meshes: number;
  /** The file begins with the binary glTF magic and declares version 2. */
  valid: boolean;
  exported: WorldExportResult["exported"];
  skipped: WorldExportResult["skipped"];
}

/**
 * The same rebuilt primitives as one binary glTF (GLB) — the capability
 * "world-export-gltf", activated only once the capability ledger says it is
 * approved and registered (the tool is off until then).
 */
export async function exportPlacementsGlb(placements: CosmosPlacement[], only?: string[]): Promise<WorldGlbResult> {
  const { group, exported, skipped } = buildGroup(placements, only);
  if (exported.length === 0) return { glb: new ArrayBuffer(0), bytes: 0, meshes: 0, valid: false, exported, skipped };
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const glb = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
  const view = new DataView(glb);
  const valid = glb.byteLength > 12 && view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2;
  for (const child of group.children) (child as Mesh).geometry.dispose();
  return { glb, bytes: glb.byteLength, meshes: exported.length, valid, exported, skipped };
}
