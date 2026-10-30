/**
 * ==========================================================
 * LÉLU 3D FORGE — GLB INSPECTOR
 *
 * "A mesh came back" is not "a usable asset exists", and "the
 * provider said rigged" is not "it deforms". This reads the
 * GLB container itself (glTF 2.0 binary: 12-byte header, JSON
 * chunk, BIN chunk) and measures what is really inside it:
 *
 *   geometry   meshes, primitives, vertices, triangles, bounds
 *   surface    materials, base-colour textures, PBR maps
 *   rig        skins, joints, humanoid bone coverage, and the
 *              actual skin weights — every vertex's weights
 *              must sum to 1 and point at joints that exist
 *   motion     clips, durations, and whether they drive joints
 *
 * Dependency-free and DOM-free so the server validates a
 * download before it is ever offered to the Cosmos, and the
 * browser can re-check what it loads. Draco-compressed
 * geometry cannot be read without a decoder; that is reported
 * as "not measurable", never as a pass.
 * ==========================================================
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

interface Gltf {
  asset?: { version?: string; generator?: string };
  extensionsUsed?: string[];
  nodes?: Array<{ name?: string; mesh?: number; skin?: number; children?: number[] }>;
  meshes?: Array<{ name?: string; primitives: Array<{ attributes: Record<string, number>; indices?: number; material?: number }> }>;
  materials?: Array<{
    name?: string;
    pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
    normalTexture?: unknown;
  }>;
  textures?: unknown[];
  images?: unknown[];
  skins?: Array<{ name?: string; joints: number[]; inverseBindMatrices?: number }>;
  animations?: Array<{ name?: string; channels: Array<{ target: { node?: number; path: string } }>; samplers: Array<{ input: number }> }>;
  accessors?: Accessor[];
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }>;
}

export interface GlbReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  bytes: number;
  generator: string | null;
  geometry: {
    meshes: number;
    primitives: number;
    vertices: number;
    triangles: number;
    /** Axis-aligned bounds of POSITION accessors (node transforms not applied). */
    bounds: { min: number[]; max: number[]; size: number[] } | null;
    dracoCompressed: boolean;
  };
  surface: { materials: number; textures: number; images: number; baseColorTextured: boolean; pbrMaps: boolean };
  rig: {
    skins: number;
    joints: number;
    humanoidBonesFound: string[];
    humanoidBonesMissing: string[];
    /** Fraction of skinned vertices whose weights sum to 1 ± 0.02 with joints in range. null = not measurable. */
    weightValidity: number | null;
    skinnedVertices: number;
  };
  motion: { clips: Array<{ name: string; duration: number; channels: number; drivesJoints: boolean }> };
  verdict: {
    meshValid: boolean;
    textured: boolean;
    rigValid: boolean;
    animated: boolean;
  };
}

/**
 * Core humanoid bones a deforming, walking, gesturing character needs.
 * Matched loosely against joint names because exporters disagree on
 * spelling (Hips / mixamorig:Hips / pelvis, LeftUpLeg / thigh_l …).
 */
const HUMANOID_BONES: Array<[string, RegExp]> = [
  ["hips", /hips|pelvis|root_?hip/i],
  ["spine", /spine|chest/i],
  ["neck", /neck/i],
  ["head", /head(?!top)/i],
  ["leftUpperArm", /left(?!.*(fore|lower|hand)).*arm|upperarm_?l\b/i],
  ["rightUpperArm", /right(?!.*(fore|lower|hand)).*arm|upperarm_?r\b/i],
  ["leftForearm", /left.*(fore_?arm|lower_?arm)|(fore|lower)arm_?l\b/i],
  ["rightForearm", /right.*(fore_?arm|lower_?arm)|(fore|lower)arm_?r\b/i],
  ["leftHand", /left.*hand|hand_?l\b/i],
  ["rightHand", /right.*hand|hand_?r\b/i],
  ["leftUpperLeg", /left.*(up_?leg|thigh|upper_?leg)|thigh_?l\b/i],
  ["rightUpperLeg", /right.*(up_?leg|thigh|upper_?leg)|thigh_?r\b/i],
  ["leftLowerLeg", /left(?!.*(up_?leg|upper|thigh|foot|toe)).*(leg|shin|calf|knee)|calf_?l\b/i],
  ["rightLowerLeg", /right(?!.*(up_?leg|upper|thigh|foot|toe)).*(leg|shin|calf|knee)|calf_?r\b/i],
  ["leftFoot", /left.*foot|foot_?l\b/i],
  ["rightFoot", /right.*foot|foot_?r\b/i],
];

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function componentBytes(type: number): number {
  return type === 5120 || type === 5121 ? 1 : type === 5122 || type === 5123 ? 2 : 4;
}

function readComponent(view: DataView, offset: number, type: number, normalized: boolean): number {
  switch (type) {
    case 5126:
      return view.getFloat32(offset, true);
    case 5121: {
      const v = view.getUint8(offset);
      return normalized ? v / 255 : v;
    }
    case 5123: {
      const v = view.getUint16(offset, true);
      return normalized ? v / 65535 : v;
    }
    case 5125:
      return view.getUint32(offset, true);
    case 5120: {
      const v = view.getInt8(offset);
      return normalized ? Math.max(v / 127, -1) : v;
    }
    case 5122: {
      const v = view.getInt16(offset, true);
      return normalized ? Math.max(v / 32767, -1) : v;
    }
    default:
      return Number.NaN;
  }
}

/** Read an accessor's elements, or null if its data cannot be located. */
function readAccessor(gltf: Gltf, bin: DataView | null, index: number): number[][] | null {
  const acc = gltf.accessors?.[index];
  if (!acc || acc.bufferView === undefined || !bin) return null;
  const bv = gltf.bufferViews?.[acc.bufferView];
  if (!bv || bv.buffer !== 0) return null;
  const width = COMPONENTS[acc.type] ?? 1;
  const size = componentBytes(acc.componentType);
  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : width * size;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  if (base + stride * (acc.count - 1) + width * size > bin.byteLength) return null;
  const out: number[][] = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const row = new Array<number>(width);
    for (let c = 0; c < width; c++) {
      row[c] = readComponent(bin, base + i * stride + c * size, acc.componentType, acc.normalized === true);
    }
    out[i] = row;
  }
  return out;
}

function parseContainer(buffer: ArrayBuffer): { gltf: Gltf; bin: DataView | null } {
  if (buffer.byteLength < 20) throw new Error("File is too small to be a GLB.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Not a GLB (bad magic).");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}.`);
  const declared = view.getUint32(8, true);
  if (declared > buffer.byteLength) throw new Error(`GLB is truncated (${buffer.byteLength} of ${declared} bytes).`);

  let offset = 12;
  let gltf: Gltf | null = null;
  let bin: DataView | null = null;
  while (offset + 8 <= declared) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > declared) throw new Error("GLB chunk runs past the end of the file.");
    if (type === CHUNK_JSON) {
      gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length))) as Gltf;
    } else if (type === CHUNK_BIN && !bin) {
      bin = new DataView(buffer, start, length);
    }
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!gltf) throw new Error("GLB has no JSON chunk.");
  return { gltf, bin };
}

export function inspectGlb(input: ArrayBuffer | Uint8Array): GlbReport {
  const buffer =
    input instanceof Uint8Array
      ? (input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer)
      : input;
  const problems: string[] = [];
  const warnings: string[] = [];
  const report: GlbReport = {
    ok: false,
    problems,
    warnings,
    bytes: buffer.byteLength,
    generator: null,
    geometry: { meshes: 0, primitives: 0, vertices: 0, triangles: 0, bounds: null, dracoCompressed: false },
    surface: { materials: 0, textures: 0, images: 0, baseColorTextured: false, pbrMaps: false },
    rig: { skins: 0, joints: 0, humanoidBonesFound: [], humanoidBonesMissing: HUMANOID_BONES.map(([n]) => n), weightValidity: null, skinnedVertices: 0 },
    motion: { clips: [] },
    verdict: { meshValid: false, textured: false, rigValid: false, animated: false },
  };

  let gltf: Gltf;
  let bin: DataView | null;
  try {
    ({ gltf, bin } = parseContainer(buffer));
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
    return report;
  }
  report.generator = gltf.asset?.generator ?? null;
  const draco = (gltf.extensionsUsed ?? []).includes("KHR_draco_mesh_compression");
  report.geometry.dracoCompressed = draco;
  if (draco) warnings.push("Geometry is Draco-compressed; vertex data and skin weights are not measurable without a decoder.");

  /* geometry */
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes ?? []) {
    report.geometry.meshes++;
    for (const prim of mesh.primitives ?? []) {
      report.geometry.primitives++;
      const pos = gltf.accessors?.[prim.attributes.POSITION];
      if (!pos) {
        problems.push(`Mesh "${mesh.name ?? "?"}" has a primitive with no POSITION.`);
        continue;
      }
      report.geometry.vertices += pos.count;
      const idx = prim.indices !== undefined ? gltf.accessors?.[prim.indices] : undefined;
      report.geometry.triangles += Math.floor((idx?.count ?? pos.count) / 3);
      if (pos.min && pos.max) {
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], pos.min[a]);
          max[a] = Math.max(max[a], pos.max[a]);
        }
      }
    }
  }
  if (Number.isFinite(min[0]) && Number.isFinite(max[0])) {
    report.geometry.bounds = { min, max, size: max.map((v, i) => v - min[i]) };
  }
  const size = report.geometry.bounds?.size ?? [0, 0, 0];
  report.verdict.meshValid =
    report.geometry.meshes > 0 &&
    report.geometry.vertices > 0 &&
    report.geometry.triangles > 0 &&
    size.every((s) => Number.isFinite(s) && s >= 0) &&
    Math.max(...size) > 0;
  if (!report.verdict.meshValid) problems.push("No measurable, non-degenerate mesh geometry.");
  else if (size.some((s) => s === 0)) warnings.push("Geometry is flat along one axis.");

  /* surface */
  report.surface.materials = gltf.materials?.length ?? 0;
  report.surface.textures = gltf.textures?.length ?? 0;
  report.surface.images = gltf.images?.length ?? 0;
  report.surface.baseColorTextured = (gltf.materials ?? []).some((m) => m.pbrMetallicRoughness?.baseColorTexture !== undefined);
  report.surface.pbrMaps = (gltf.materials ?? []).some(
    (m) => m.pbrMetallicRoughness?.metallicRoughnessTexture !== undefined || m.normalTexture !== undefined,
  );
  report.verdict.textured = report.surface.baseColorTextured && report.surface.images > 0;

  /* rig */
  const skins = gltf.skins ?? [];
  report.rig.skins = skins.length;
  const jointSet = new Set<number>();
  for (const skin of skins) for (const j of skin.joints) jointSet.add(j);
  report.rig.joints = jointSet.size;
  if (skins.length > 0) {
    const names = [...jointSet].map((j) => gltf.nodes?.[j]?.name ?? "");
    report.rig.humanoidBonesFound = HUMANOID_BONES.filter(([, re]) => names.some((n) => re.test(n))).map(([n]) => n);
    report.rig.humanoidBonesMissing = HUMANOID_BONES.filter(([n]) => !report.rig.humanoidBonesFound.includes(n)).map(([n]) => n);

    for (const skin of skins) {
      if (skin.inverseBindMatrices !== undefined) {
        const ibm = gltf.accessors?.[skin.inverseBindMatrices];
        if (ibm && ibm.count !== skin.joints.length) {
          problems.push(`Skin "${skin.name ?? "?"}" has ${skin.joints.length} joints but ${ibm.count} inverse bind matrices.`);
        }
      }
    }

    if (!draco) {
      let checked = 0;
      let valid = 0;
      for (const node of gltf.nodes ?? []) {
        if (node.mesh === undefined || node.skin === undefined) continue;
        const jointCount = skins[node.skin]?.joints.length ?? 0;
        for (const prim of gltf.meshes?.[node.mesh]?.primitives ?? []) {
          const jIdx = prim.attributes.JOINTS_0;
          const wIdx = prim.attributes.WEIGHTS_0;
          if (jIdx === undefined || wIdx === undefined) continue;
          const joints = readAccessor(gltf, bin, jIdx);
          const weights = readAccessor(gltf, bin, wIdx);
          if (!joints || !weights) continue;
          for (let v = 0; v < weights.length; v++) {
            checked++;
            const sum = weights[v].reduce((s, w) => s + w, 0);
            const inRange = joints[v].every((j, k) => weights[v][k] === 0 || (j >= 0 && j < jointCount));
            if (Math.abs(sum - 1) <= 0.02 && inRange) valid++;
          }
        }
      }
      report.rig.skinnedVertices = checked;
      report.rig.weightValidity = checked > 0 ? valid / checked : null;
      if (checked === 0) problems.push("Skins exist but no primitive carries readable JOINTS_0/WEIGHTS_0.");
    }

    const coverage = report.rig.humanoidBonesFound.length / HUMANOID_BONES.length;
    if (coverage < 0.8) {
      warnings.push(`Only ${report.rig.humanoidBonesFound.length}/${HUMANOID_BONES.length} core humanoid bones recognised (missing: ${report.rig.humanoidBonesMissing.join(", ")}).`);
    }
    report.verdict.rigValid =
      coverage >= 0.8 && report.rig.weightValidity !== null && report.rig.weightValidity >= 0.99 && !problems.some((p) => p.includes("inverse bind"));
    if (report.rig.weightValidity !== null && report.rig.weightValidity < 0.99) {
      problems.push(`Only ${(report.rig.weightValidity * 100).toFixed(1)}% of skinned vertices have normalized, in-range weights.`);
    }
  }

  /* motion */
  for (const anim of gltf.animations ?? []) {
    let duration = 0;
    for (const sampler of anim.samplers ?? []) {
      const input = gltf.accessors?.[sampler.input];
      if (input?.max?.[0] !== undefined) duration = Math.max(duration, input.max[0]);
    }
    const drivesJoints = (anim.channels ?? []).some((c) => c.target.node !== undefined && jointSet.has(c.target.node));
    report.motion.clips.push({ name: anim.name ?? "clip", duration, channels: anim.channels?.length ?? 0, drivesJoints });
  }
  report.verdict.animated = report.motion.clips.some((c) => c.duration > 0 && c.drivesJoints);

  report.ok = problems.length === 0 && report.verdict.meshValid;
  return report;
}
