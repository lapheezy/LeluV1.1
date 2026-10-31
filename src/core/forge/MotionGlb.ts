/**
 * ==========================================================
 * LÉLU 3D FORGE — MOTION-ONLY GLB
 *
 * A Meshy animation job returns the WHOLE character again (mesh, 8
 * textures, ~24 MB) with one clip on it. LÉLU's body is already loaded
 * once; what each animation adds is only its motion. This keeps the
 * node hierarchy (so tracks bind to her bones by name) and the clip's
 * keyframe data, and drops meshes, skins, materials, textures and
 * images — a few hundred KB instead of ~24 MB per clip.
 *
 * Pure byte manipulation (no DOM, no three.js), so the server-side
 * Forge can run it when an animation job is collected.
 * ==========================================================
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface GltfJson {
  asset: unknown;
  scene?: number;
  scenes?: Array<{ nodes?: number[]; name?: string }>;
  nodes?: Array<Record<string, unknown>>;
  animations?: Array<{
    name?: string;
    channels: Array<{ sampler: number; target: { node?: number; path: string } }>;
    samplers: Array<{ input: number; output: number; interpolation?: string }>;
  }>;
  accessors?: Array<Record<string, unknown> & { bufferView?: number; sparse?: unknown }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }>;
  buffers?: Array<{ byteLength: number; uri?: string }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

function readGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Not a GLB file.");
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
    else if (type === CHUNK_BIN) bin = data;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error("GLB is missing its JSON or binary chunk.");
  return { json, bin };
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function writeGlb(json: GltfJson, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.byteLength);
  const binLength = pad4(bin.byteLength);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength); // JSON pads with spaces
  const binStart = 20 + jsonLength;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, CHUNK_BIN, true);
  out.set(bin, binStart + 8);
  return out;
}

/**
 * Keep the bones and one clip, renamed to `clipName`; drop everything
 * that draws. Throws when the file has no animation to keep.
 */
export function motionOnlyGlb(glb: Uint8Array, clipName: string): Uint8Array {
  const { json, bin } = readGlb(glb);
  const animations = json.animations ?? [];
  if (animations.length === 0) throw new Error("The GLB has no animation.");
  // Meshy puts the action first; any extra clip is the rig's base layer.
  const clip = animations[0];

  const accessorMap = new Map<number, number>();
  const viewMap = new Map<number, number>();
  const accessors: NonNullable<GltfJson["accessors"]> = [];
  const views: NonNullable<GltfJson["bufferViews"]> = [];
  const chunks: Uint8Array[] = [];
  let binLength = 0;

  const keepView = (index: number): number => {
    const existing = viewMap.get(index);
    if (existing !== undefined) return existing;
    const source = json.bufferViews![index];
    const start = source.byteOffset ?? 0;
    const data = bin.subarray(start, start + source.byteLength);
    const aligned = pad4(binLength);
    if (aligned > binLength) chunks.push(new Uint8Array(aligned - binLength));
    chunks.push(data);
    const next = views.length;
    views.push({ buffer: 0, byteOffset: aligned, byteLength: source.byteLength, ...(source.byteStride ? { byteStride: source.byteStride } : {}) });
    binLength = aligned + source.byteLength;
    viewMap.set(index, next);
    return next;
  };
  const keepAccessor = (index: number): number => {
    const existing = accessorMap.get(index);
    if (existing !== undefined) return existing;
    const source = json.accessors![index];
    if (source.sparse) throw new Error("Sparse animation accessors are not supported.");
    const copy = { ...source };
    if (typeof source.bufferView === "number") copy.bufferView = keepView(source.bufferView);
    const next = accessors.length;
    accessors.push(copy);
    accessorMap.set(index, next);
    return next;
  };

  const samplers = clip.samplers.map((s) => ({
    input: keepAccessor(s.input),
    output: keepAccessor(s.output),
    ...(s.interpolation ? { interpolation: s.interpolation } : {}),
  }));

  const nodes = (json.nodes ?? []).map((node) => {
    const { mesh: _mesh, skin: _skin, camera: _camera, weights: _weights, ...rest } = node;
    return rest;
  });

  const out: GltfJson = {
    asset: json.asset,
    scene: json.scene ?? 0,
    scenes: json.scenes,
    nodes,
    animations: [{ name: clipName, channels: clip.channels, samplers }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: binLength }],
  };
  const merged = new Uint8Array(binLength);
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.byteLength;
  }
  return writeGlb(out, merged);
}
