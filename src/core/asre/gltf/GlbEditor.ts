/**
 * ==========================================================
 * LÉLU ASRE — GLB EDITOR (pure, dependency-free)
 *
 * Edits a GLB the way the Forge needs: the result is a NEW file and the
 * source is never touched. Transforms are BAKED into the vertex data
 * (POSITION, NORMAL) with accessor min/max updated, so the production
 * inspector (which ignores node transforms) measures the edited
 * geometry. Colour edits change COLOR_0 (vertex colours, which ASRE
 * assets use) and every material's baseColorFactor. Every byte the
 * edit does not concern is copied unchanged.
 *
 *   translate  [dx, dy, dz] metres
 *   scale      number | [sx, sy, sz]
 *   rotateY    radians about +Y (glTF up)
 *   tint       [r, g, b] multiplier (linear)
 *   ground     true → lift/lower so the lowest vertex sits on y = 0
 *   center     true → centre x and z on 0
 *
 * Supported input: FLOAT VEC3 positions/normals and FLOAT VEC4/VEC3
 * colours, interleaved or not, uncompressed. Anything else (Draco,
 * sparse or quantised accessors) is refused, never edited partially.
 * ==========================================================
 */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;

export interface GlbEdit {
  translate?: [number, number, number];
  scale?: number | [number, number, number];
  rotateY?: number;
  tint?: [number, number, number];
  ground?: boolean;
  center?: boolean;
}

export class GlbEditError extends Error {}

interface Accessor { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[]; sparse?: unknown; normalized?: boolean }
interface BufferView { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }
interface Gltf {
  extensionsUsed?: string[];
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  materials?: Array<{ pbrMetallicRoughness?: { baseColorFactor?: number[] } }>;
  accessors?: Accessor[];
  bufferViews?: BufferView[];
  asset?: Record<string, unknown>;
  extras?: Record<string, unknown>;
  [k: string]: unknown;
}

export function parseGlb(bytes: Uint8Array): { gltf: Gltf; bin: Uint8Array } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || v.getUint32(0, true) !== GLB_MAGIC) throw new GlbEditError("not a GLB file");
  if (v.getUint32(4, true) !== 2) throw new GlbEditError("only glTF 2.0 GLB is supported");
  let pos = 12;
  let gltf: Gltf | null = null;
  let bin = new Uint8Array(0);
  while (pos + 8 <= bytes.length) {
    const len = v.getUint32(pos, true), type = v.getUint32(pos + 4, true);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === CHUNK_JSON) gltf = JSON.parse(new TextDecoder().decode(body)) as Gltf;
    else if (type === CHUNK_BIN) bin = body.slice();
    pos += 8 + len;
  }
  if (!gltf) throw new GlbEditError("GLB has no JSON chunk");
  return { gltf, bin };
}

export function buildGlb(gltf: Gltf, bin: Uint8Array): Uint8Array {
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jpad = (4 - (json.length % 4)) % 4;
  if (jpad) {
    const j = new Uint8Array(json.length + jpad).fill(0x20);
    j.set(json);
    json = j;
  }
  const bpad = (4 - (bin.length % 4)) % 4;
  const binLen = bin.length + bpad;
  const total = 12 + 8 + json.length + (bin.length ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, GLB_MAGIC, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, json.length, true);
  v.setUint32(16, CHUNK_JSON, true);
  out.set(json, 20);
  if (bin.length) {
    const o = 20 + json.length;
    v.setUint32(o, binLen, true);
    v.setUint32(o + 4, CHUNK_BIN, true);
    out.set(bin, o + 8);
  }
  return out;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Visit each element of a FLOAT accessor through a DataView over the BIN chunk. */
function floatAccessor(gltf: Gltf, bin: Uint8Array, index: number, want: number[]) {
  const a = gltf.accessors?.[index];
  if (!a) throw new GlbEditError(`accessor ${index} does not exist`);
  if (a.sparse) throw new GlbEditError("sparse accessors cannot be edited");
  const n = COMPONENTS[a.type];
  if (a.componentType !== FLOAT || !want.includes(n)) throw new GlbEditError(`accessor ${index} is not FLOAT ${want.map((w) => `VEC${w}`).join("/")} (quantised or compressed data is not edited)`);
  const bv = gltf.bufferViews?.[a.bufferView ?? -1];
  if (!bv) throw new GlbEditError(`accessor ${index} has no buffer view`);
  const stride = bv.byteStride ?? n * 4;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (base + stride * (a.count - 1) + n * 4 > bin.length) throw new GlbEditError(`accessor ${index} runs past the binary chunk`);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return {
    accessor: a,
    n,
    count: a.count,
    get: (i: number, c: number) => dv.getFloat32(base + i * stride + c * 4, true),
    set: (i: number, c: number, value: number) => dv.setFloat32(base + i * stride + c * 4, value, true),
  };
}

function positionsOf(gltf: Gltf): number[] {
  const out = new Set<number>();
  for (const m of gltf.meshes ?? []) for (const p of m.primitives) if (p.attributes.POSITION !== undefined) out.add(p.attributes.POSITION);
  return [...out];
}

/** Axis-aligned bounds over every POSITION accessor (read from the data, not min/max). */
export function measureBounds(bytes: Uint8Array): { min: [number, number, number]; max: [number, number, number] } | null {
  const { gltf, bin } = parseGlb(bytes);
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const idx of positionsOf(gltf)) {
    const acc = floatAccessor(gltf, bin, idx, [3]);
    for (let i = 0; i < acc.count; i++)
      for (let c = 0; c < 3; c++) {
        const v = acc.get(i, c);
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

export function editGlb(bytes: Uint8Array, edit: GlbEdit): Uint8Array {
  const { gltf, bin } = parseGlb(bytes);
  if ((gltf.extensionsUsed ?? []).includes("KHR_draco_mesh_compression")) throw new GlbEditError("Draco-compressed geometry cannot be edited without a decoder");
  const s3: [number, number, number] = typeof edit.scale === "number" ? [edit.scale, edit.scale, edit.scale] : edit.scale ?? [1, 1, 1];
  if (s3.some((v) => !Number.isFinite(v) || v === 0)) throw new GlbEditError("scale must be finite and non-zero");
  const c = Math.cos(edit.rotateY ?? 0), s = Math.sin(edit.rotateY ?? 0);
  const t = edit.translate ?? [0, 0, 0];
  // p' = R·(S·p) + T, then the optional ground/centre shift measured on the result
  const xf = (x: number, y: number, z: number): [number, number, number] => {
    const sx = x * s3[0], sy = y * s3[1], sz = z * s3[2];
    return [c * sx + s * sz + t[0], sy + t[1], -s * sx + c * sz + t[2]];
  };
  const positions = positionsOf(gltf);
  const touched = new Set<number>();
  for (const idx of positions) {
    if (touched.has(idx)) continue;
    touched.add(idx);
    const acc = floatAccessor(gltf, bin, idx, [3]);
    for (let i = 0; i < acc.count; i++) {
      const p = xf(acc.get(i, 0), acc.get(i, 1), acc.get(i, 2));
      for (let k = 0; k < 3; k++) acc.set(i, k, p[k]);
    }
  }
  // normals: inverse-transpose of R·S (= R·S⁻¹ for diagonal S), renormalised
  for (const m of gltf.meshes ?? [])
    for (const p of m.primitives) {
      const idx = p.attributes.NORMAL;
      if (idx === undefined || touched.has(-1 - idx)) continue;
      touched.add(-1 - idx);
      const acc = floatAccessor(gltf, bin, idx, [3]);
      for (let i = 0; i < acc.count; i++) {
        const nx = acc.get(i, 0) / s3[0], ny = acc.get(i, 1) / s3[1], nz = acc.get(i, 2) / s3[2];
        const r: [number, number, number] = [c * nx + s * nz, ny, -s * nx + c * nz];
        const l = Math.hypot(...r) || 1;
        for (let k = 0; k < 3; k++) acc.set(i, k, r[k] / l);
      }
    }
  // ground / centre: a second translation measured on the transformed data
  if (edit.ground || edit.center) {
    const b = measureBounds(buildGlb(gltf, bin));
    if (b) {
      const d: [number, number, number] = [edit.center ? -(b.min[0] + b.max[0]) / 2 : 0, edit.ground ? -b.min[1] : 0, edit.center ? -(b.min[2] + b.max[2]) / 2 : 0];
      for (const idx of positions) {
        const acc = floatAccessor(gltf, bin, idx, [3]);
        for (let i = 0; i < acc.count; i++) for (let k = 0; k < 3; k++) acc.set(i, k, acc.get(i, k) + d[k]);
      }
    }
  }
  // accessor min/max must describe the new data
  for (const idx of positions) {
    const acc = floatAccessor(gltf, bin, idx, [3]);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < acc.count; i++)
      for (let k = 0; k < 3; k++) {
        const v = acc.get(i, k);
        mn[k] = Math.min(mn[k], v);
        mx[k] = Math.max(mx[k], v);
      }
    acc.accessor.min = mn;
    acc.accessor.max = mx;
  }
  if (edit.tint) {
    const tint = edit.tint;
    if (tint.some((v) => !Number.isFinite(v) || v < 0)) throw new GlbEditError("tint must be non-negative numbers");
    const colours = new Set<number>();
    for (const m of gltf.meshes ?? []) for (const p of m.primitives) if (p.attributes.COLOR_0 !== undefined) colours.add(p.attributes.COLOR_0);
    for (const idx of colours) {
      const acc = floatAccessor(gltf, bin, idx, [3, 4]);
      for (let i = 0; i < acc.count; i++) for (let k = 0; k < 3; k++) acc.set(i, k, Math.min(1, acc.get(i, k) * tint[k]));
    }
    for (const mat of gltf.materials ?? []) {
      const pbr = (mat.pbrMetallicRoughness ??= {});
      const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
      pbr.baseColorFactor = [Math.min(1, f[0] * tint[0]), Math.min(1, f[1] * tint[1]), Math.min(1, f[2] * tint[2]), f[3] ?? 1];
    }
  }
  return buildGlb(gltf, bin);
}

/** Merge scene-level extras (provenance, version) into a GLB without touching geometry. */
export function withSceneExtras(bytes: Uint8Array, extras: Record<string, unknown>): Uint8Array {
  const { gltf, bin } = parseGlb(bytes);
  const scenes = (gltf.scenes as Array<{ extras?: Record<string, unknown> }> | undefined) ?? [];
  if (scenes[0]) scenes[0].extras = { ...(scenes[0].extras ?? {}), ...extras };
  gltf.asset = { ...(gltf.asset ?? {}), extras: { ...((gltf.asset?.extras as Record<string, unknown>) ?? {}), ...extras } };
  return buildGlb(gltf, bin);
}
