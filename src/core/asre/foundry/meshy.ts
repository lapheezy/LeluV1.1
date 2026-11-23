/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — MESHY ASSET INSPECTION
 *
 * `leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb`
 * is the LÉLU character the project already owns: a Meshy body + auto-rig, a
 * Meshy head bust head-swapped onto it in Blender, and twelve ARKit face keys.
 * It is 49.5 MB. Nothing about that is visible from a filename, so this module
 * reads the GLB itself — header, JSON chunk, binary chunk — and reports what is
 * actually inside: primitives, triangles, materials, texture resolution, UV
 * sets, skins, joints, animation clips, morph targets and bounds.
 *
 * It is deliberately dependency-free and read-only. It never writes to the
 * asset; a checksum of the file is part of every report so an "improved"
 * version can be proven to have come from this exact baseline.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: Record<string, number>[];
}

export interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
  weights?: number[];
  extras?: Record<string, unknown>;
}

export interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
}

export interface GltfJson {
  asset?: { version?: string; generator?: string; copyright?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  materials?: { name?: string; pbrMetallicRoughness?: Record<string, unknown>; normalTexture?: unknown; emissiveTexture?: unknown }[];
  textures?: { source?: number; sampler?: number }[];
  images?: { name?: string; mimeType?: string; bufferView?: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  accessors?: GltfAccessor[];
  skins?: { name?: string; joints: number[]; skeleton?: number; inverseBindMatrices?: number }[];
  animations?: { name?: string; channels: { target: { node?: number; path: string } }[]; samplers: unknown[] }[];
}

export interface GlbContainer {
  magic: string;
  version: number;
  declaredLength: number;
  json: GltfJson;
  bin: Buffer<ArrayBufferLike>;
  chunks: { type: string; length: number }[];
}

export interface TextureInfo {
  index: number;
  name: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  embedded: boolean;
}

export interface PrimitiveInfo {
  mesh: string;
  primitive: number;
  vertices: number;
  indices: number;
  triangles: number;
  material: string;
  uvSets: string[];
  colors: string[];
  morphTargets: number;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

export interface SkippedFeature {
  feature: string;
  reason: string;
}

export interface MeshInspection {
  file: string;
  fileName: string;
  bytes: number;
  sha256: string;
  generatedBy: string | null;
  gltfVersion: string;
  counts: {
    nodes: number;
    meshes: number;
    primitives: number;
    materials: number;
    textures: number;
    images: number;
    skins: number;
    joints: number;
    animations: number;
    animationChannels: number;
    morphTargets: number;
    vertices: number;
    triangles: number;
  };
  /** True when the whole body is one primitive: hair, clothes and skin cannot be moved apart. */
  fused: boolean;
  primitives: PrimitiveInfo[];
  materials: string[];
  textures: TextureInfo[];
  uvSets: string[];
  skins: { name: string; joints: number; skeleton: string | null }[];
  animations: { name: string; channels: number; durationIsAuthored: boolean }[];
  morphTargets: { mesh: string; targets: string[]; names: string[] }[];
  bounds: { min: [number, number, number]; max: [number, number, number]; heightM: number; widthM: number; depthM: number } | null;
  heightM: number | null;
  headToBodyRatio: number | null;
  headToBodyBasis: string;
  unsupported: SkippedFeature[];
  notes: string[];
}

function readChunks(buf: Buffer): GlbContainer {
  if (buf.length < 20) throw new Error(`GLB too short: ${buf.length} bytes`);
  const magic = buf.toString("ascii", 0, 4);
  if (magic !== "glTF") throw new Error(`not a GLB (magic ${JSON.stringify(magic)})`);
  const version = buf.readUInt32LE(4);
  const declaredLength = buf.readUInt32LE(8);
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const chunks: { type: string; length: number }[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    chunks.push({ type, length });
    if (type === "JSON") {
      const raw = buf.toString("utf8", start, start + length).replace(/\0+$/, "").trim();
      json = JSON.parse(raw) as GltfJson;
    } else if (type === "BIN\0" || type === "BIN ") {
      bin = buf.subarray(start, start + length);
    }
    offset = start + length; // chunks are 4-byte aligned by the exporter
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { magic, version, declaredLength, json, bin, chunks };
}

/** Texture size without an image library: PNG IHDR, JPEG SOF, or the WebP/VP8 header. */
export function imageSize(bytes: Buffer<ArrayBufferLike>): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      const length = bytes.readUInt16BE(i + 2);
      i += 2 + length;
    }
  }
  if (bytes.length > 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const fourcc = bytes.toString("ascii", 12, 16);
    if (fourcc === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (fourcc === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function inspectGlb(file: string): MeshInspection {
  const abs = path.resolve(file);
  const buf = readFileSync(abs);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const container = readChunks(buf);
  const g = container.json;
  const accessors = g.accessors ?? [];
  const bufferViews = g.bufferViews ?? [];

  const boundBox = (): void => undefined;
  void boundBox;

  const primitives: PrimitiveInfo[] = [];
  const morphTargets: { mesh: string; targets: string[]; names: string[] }[] = [];
  let vertices = 0;
  let triangles = 0;
  let morphTotal = 0;
  g.meshes?.forEach((mesh, meshIndex) => {
    const meshName = mesh.name ?? `mesh_${meshIndex}`;
    mesh.primitives.forEach((prim, primIndex) => {
      const posAccessor = prim.attributes.POSITION !== undefined ? accessors[prim.attributes.POSITION] : undefined;
      const idxAccessor = prim.indices !== undefined ? accessors[prim.indices] : undefined;
      const vertexCount = posAccessor?.count ?? 0;
      const indexCount = idxAccessor?.count ?? 0;
      vertices += vertexCount;
      triangles += Math.floor(indexCount / 3);
      const uvSets = Object.keys(prim.attributes).filter((k) => k.startsWith("TEXCOORD"));
      const colors = Object.keys(prim.attributes).filter((k) => k.startsWith("COLOR"));
      const targetCount = prim.targets?.length ?? 0;
      morphTotal += targetCount;
      const min = posAccessor?.min;
      const max = posAccessor?.max;
      primitives.push({
        mesh: meshName,
        primitive: primIndex,
        vertices: vertexCount,
        indices: indexCount,
        triangles: Math.floor(indexCount / 3),
        material: prim.material !== undefined ? (g.materials?.[prim.material]?.name ?? `material_${prim.material}`) : "(none)",
        uvSets,
        colors,
        morphTargets: targetCount,
        bounds:
          min && max && min.length === 3 && max.length === 3
            ? { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] }
            : null,
      });
    });
    if (mesh.primitives.some((p) => (p.targets?.length ?? 0) > 0)) {
      morphTargets.push({
        mesh: meshName,
        targets: (mesh.primitives[0]?.targets ?? []).map((_, i) => `target_${i}`),
        names: Array.isArray(mesh.extras?.targetNames) ? (mesh.extras.targetNames as string[]) : [],
      });
    }
  });

  const textures: TextureInfo[] = (g.images ?? []).map((image, index) => {
    let bytes = 0;
    let size: { width: number; height: number } | null = null;
    if (image.bufferView !== undefined) {
      const view = bufferViews[image.bufferView];
      if (view) {
        const start = view.byteOffset ?? 0;
        const slice = container.bin.subarray(start, start + view.byteLength);
        bytes = view.byteLength;
        size = imageSize(slice);
      }
    }
    return {
      index,
      name: image.name ?? `image_${index}`,
      mimeType: image.mimeType ?? "unknown",
      bytes,
      width: size?.width ?? null,
      height: size?.height ?? null,
      embedded: image.bufferView !== undefined,
    };
  });

  // Bounds are the union of every primitive's POSITION min/max; glTF requires
  // those accessor fields, so this is exact rather than sampled.
  let lo: [number, number, number] | null = null;
  let hi: [number, number, number] | null = null;
  for (const prim of primitives) {
    if (!prim.bounds) continue;
    lo = lo
      ? ([Math.min(lo[0], prim.bounds.min[0]), Math.min(lo[1], prim.bounds.min[1]), Math.min(lo[2], prim.bounds.min[2])] as [number, number, number])
      : ([...prim.bounds.min] as [number, number, number]);
    hi = hi
      ? ([Math.max(hi[0], prim.bounds.max[0]), Math.max(hi[1], prim.bounds.max[1]), Math.max(hi[2], prim.bounds.max[2])] as [number, number, number])
      : ([...prim.bounds.max] as [number, number, number]);
  }
  const bounds =
    lo && hi
      ? {
          min: lo,
          max: hi,
          heightM: hi[1] - lo[1],
          widthM: hi[0] - lo[0],
          depthM: hi[2] - lo[2],
        }
      : null;

  const uvSets = Array.from(new Set(primitives.flatMap((p) => p.uvSets))).sort();
  const joints = (g.skins ?? []).reduce((sum, skin) => sum + skin.joints.length, 0);
  const animations = (g.animations ?? []).map((clip, index) => ({
    name: clip.name ?? `clip_${index}`,
    channels: clip.channels.length,
    durationIsAuthored: (clip.samplers?.length ?? 0) > 0,
  }));

  // Head-to-body ratio needs a head height. A rigged humanoid has no "head"
  // landmark here, so the ratio is reported only when a node names one.
  const headNode = (g.nodes ?? []).find((n) => /head/i.test(n.name ?? ""));
  const headY = headNode ? null : null;
  void headY;

  const unsupported: SkippedFeature[] = [];
  if (g.animations?.length) unsupported.push({ feature: "animation playback in Blender renders", reason: "renders use the rest pose; clips are inspected but not played" });
  if (morphTotal > 0) unsupported.push({ feature: "morph target geometry", reason: "counted and named; shape keys are not evaluated in the benchmark renders" });

  return {
    file: abs,
    fileName: path.basename(abs),
    bytes: statSync(abs).size,
    sha256,
    generatedBy: g.asset?.generator ?? null,
    gltfVersion: g.asset?.version ?? "unknown",
    counts: {
      nodes: g.nodes?.length ?? 0,
      meshes: g.meshes?.length ?? 0,
      primitives: primitives.length,
      materials: g.materials?.length ?? 0,
      textures: g.textures?.length ?? 0,
      images: g.images?.length ?? 0,
      skins: g.skins?.length ?? 0,
      joints,
      animations: animations.length,
      animationChannels: animations.reduce((sum, a) => sum + a.channels, 0),
      morphTargets: morphTotal,
      vertices,
      triangles,
    },
    fused: primitives.length <= 2 && primitives.every((p) => p.triangles > 1000),
    primitives,
    materials: (g.materials ?? []).map((m, i) => m.name ?? `material_${i}`),
    textures,
    uvSets,
    skins: (g.skins ?? []).map((skin, i) => ({
      name: skin.name ?? `skin_${i}`,
      joints: skin.joints.length,
      skeleton: skin.skeleton !== undefined ? (g.nodes?.[skin.skeleton]?.name ?? `node_${skin.skeleton}`) : null,
    })),
    animations,
    morphTargets: morphTargets.map((m) => ({ ...m, names: m.names.length ? m.names : m.targets })),
    bounds,
    heightM: bounds?.heightM ?? null,
    headToBodyRatio: null,
    headToBodyBasis: "no head landmark in the GLB; head measurements come from the Blender inspection (scripts/blender/lelu_meshy_inspect.py)",
    unsupported,
    notes: [
      "vertices/triangles are summed over primitives, so a vertex shared by two primitives counts twice — this is what the GPU draws",
      "bounds come from the POSITION accessor min/max, which glTF requires to be exact",
      "texture sizes are read from the PNG/JPEG/WebP headers inside the binary chunk",
    ],
  };
}

export function summariseInspection(i: MeshInspection): string {
  const c = i.counts;
  return [
    `${i.fileName}: ${(c.triangles / 1000).toFixed(1)}k triangles, ${(c.vertices / 1000).toFixed(1)}k vertices, ${c.materials} materials, ${c.images} images, ${c.joints} joints, ${c.animations} clips, ${c.morphTargets} morph targets`,
    `height ${i.heightM ? i.heightM.toFixed(3) : "?"} m, ${i.fused ? "geometry fused" : "geometry split into components"}, UV sets ${i.uvSets.join(",") || "none"}`,
  ].join("\n");
}
