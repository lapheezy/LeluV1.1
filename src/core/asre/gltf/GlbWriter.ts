/**
 * ==========================================================
 * LÉLU ASRE — GLB WRITER (glTF 2.0 binary)
 *
 * Dependency-free. One node + mesh per named part, so components stay
 * individually addressable in the Cosmos and in Blender.
 *
 * glTF is Y-up, right-handed, metres. Geometry built Z-up (Blender,
 * marching cubes on [x,y,z] volumes) is converted explicitly:
 *
 *     (x, y, z)_zup  →  (x, z, −y)_gltf
 *
 * which is a proper rotation (det = +1), so winding and outward normals
 * survive the conversion. The tests check both.
 *
 * Every file this writes is re-read by LÉLU's own GlbInspector.
 * ==========================================================
 */

import type { Mesh } from "../volume/mesh";
import type { CoordinateSystem } from "../nre/types";

export interface GlbMaterial {
  name: string;
  baseColor: [number, number, number, number];
  metallic?: number;
  roughness?: number;
}

export interface GlbPart {
  name: string;
  mesh: Mesh;
  material?: GlbMaterial;
  /** Free-form metadata stored in node.extras (e.g. provenance, component id, version hash). */
  extras?: Record<string, unknown>;
}

export interface GlbOptions {
  sourceAxes?: CoordinateSystem;
  generator?: string;
  /** Scene-level extras (e.g. character id, snapshot id). */
  extras?: Record<string, unknown>;
}

const FLOAT = 5126;
const UINT32 = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export function zUpToYUp(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i];
    out[i + 1] = src[i + 2];
    out[i + 2] = -src[i + 1];
  }
  return out;
}

export function writeGlb(parts: GlbPart[], options: GlbOptions = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  let binLength = 0;
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const push = (data: Uint8Array, target: number): number => {
    const pad = (4 - (binLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      binLength += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: data.byteLength, target });
    chunks.push(data);
    binLength += data.byteLength;
    return bufferViews.length - 1;
  };
  const vec = (arr: Float32Array, type: "VEC3" | "VEC4", withBounds: boolean): number => {
    const view = push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), ARRAY_BUFFER);
    const comps = type === "VEC3" ? 3 : 4;
    const acc: Record<string, unknown> = { bufferView: view, componentType: FLOAT, count: arr.length / comps, type };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < arr.length; i += 3)
        for (let a = 0; a < 3; a++) {
          if (arr[i + a] < min[a]) min[a] = arr[i + a];
          if (arr[i + a] > max[a]) max[a] = arr[i + a];
        }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const zup = options.sourceAxes === "z-up-right-handed";
  const materials: Array<Record<string, unknown>> = [];
  const meshes: Array<Record<string, unknown>> = [];
  const nodes: Array<Record<string, unknown>> = [];
  for (const part of parts) {
    const { mesh } = part;
    if (mesh.indices.length === 0) continue;
    const positions = zup ? zUpToYUp(mesh.positions) : mesh.positions;
    const attributes: Record<string, number> = { POSITION: vec(positions, "VEC3", true) };
    if (mesh.normals) attributes.NORMAL = vec(zup ? zUpToYUp(mesh.normals) : mesh.normals, "VEC3", false);
    if (mesh.colors) attributes.COLOR_0 = vec(mesh.colors, "VEC4", false);
    const iv = push(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength), ELEMENT_ARRAY_BUFFER);
    accessors.push({ bufferView: iv, componentType: UINT32, count: mesh.indices.length, type: "SCALAR" });
    const primitive: Record<string, unknown> = { attributes, indices: accessors.length - 1, mode: 4 };
    const m = part.material ?? { name: `${part.name}-material`, baseColor: [0.8, 0.8, 0.8, 1] };
    materials.push({
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: m.baseColor, metallicFactor: m.metallic ?? 0, roughnessFactor: m.roughness ?? 0.6 },
      ...(m.baseColor[3] < 1 ? { alphaMode: "BLEND" } : {}),
    });
    primitive.material = materials.length - 1;
    meshes.push({ name: part.name, primitives: [primitive] });
    nodes.push({ name: part.name, mesh: meshes.length - 1, ...(part.extras ? { extras: part.extras } : {}) });
  }

  const gltf = {
    asset: { version: "2.0", generator: options.generator ?? "LELU ASRE GlbWriter" },
    scene: 0,
    scenes: [{ name: "asre", nodes: nodes.map((_, i) => i), ...(options.extras ? { extras: options.extras } : {}) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (binLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLength + binPad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  let o = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(o, binLength + binPad, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
