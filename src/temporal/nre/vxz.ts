/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — .VXZ CONTAINER (O-VOXEL FRAMING)
 *
 * O-Voxel's documented .vxz layout, kept intact:
 *
 *   bytes 0..2    "VXZ"
 *   byte  3       version (O-Voxel writes 0; NRE writes 1)
 *   bytes 4..11   big-endian uint64 offset of the binary payload
 *   bytes 12..N   UTF-8 JSON metadata
 *   bytes N..     compressed chunk stream
 *
 * ...with 256-voxel chunks in Morton order, exactly as O-Voxel chunks
 * its cache-aligned payload.
 *
 * What NRE adds is inside the JSON metadata and inside each chunk:
 *
 *   metadata   the snapshot (observations, confidence, provenance,
 *              lineage, grid, coordinate system, transform) and the
 *              digests that make the file self-verifying.
 *   chunk      chunk index, voxel count, i32 cell coordinates, then one
 *              block per declared attribute channel.
 *
 * Nothing is inferred on read: a version this build does not know, a
 * codec it cannot run, a digest that does not match, a chunk count that
 * disagrees or a coordinate outside the declared lattice are all hard
 * failures with a named error, because a partially-understood numerical
 * file is worse than none.
 * ==========================================================
 */

import { canonicalJson, sha256Hex } from "./hash.ts";
import { codecById } from "./codec.ts";
import { decodeMorton, isStrictlyAscending, morton3 } from "./morton.ts";
import type {
  AttributeChannel,
  NreContainerManifest,
  NreSnapshot,
  SnapshotManifest,
  SpatialGrid,
  SparseVoxels,
} from "./types.ts";
import { NRE_SCHEMA_VERSION, SUPPORTED_INPUT_VERSIONS, VXZ_CHUNK_VOXELS } from "./types.ts";
import { validateVoxels, voxelCount } from "./voxels.ts";

export class NreFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NreFormatError";
  }
}

export class NreVersionError extends Error {
  constructor(version: number) {
    super(
      `Container schema version ${version} is not supported by this build (supported input versions: ${SUPPORTED_INPUT_VERSIONS.join(", ")}; ` +
        `this build writes ${NRE_SCHEMA_VERSION}). The file was refused before its payload was read.`,
    );
    this.name = "NreVersionError";
  }
}

export class NreCorruptionError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NreCorruptionError";
  }
}

const KIND_BYTES: Record<string, number> = { f32: 4, f64: 8, u8: 1, u16: 2, i32: 4 };
const PAYLOAD_MAGIC = 0x3158564e; // "NVX1" little-endian

export interface SerializeTimings {
  encodeMs: number;
  compressMs: number;
  totalMs: number;
}

export interface SerializeResult {
  bytes: Uint8Array;
  manifest: NreContainerManifest;
  timings: SerializeTimings;
}

export interface SerializeOptions {
  codec?: string;
  /** Fixed timestamp for deterministic fixtures. Defaults to now. */
  createdAt?: string;
}

/** The manifest digest covers every field except itself. */
function metadataDigestInput(manifest: NreContainerManifest): string {
  return canonicalJson({ ...manifest, metadataSha256: "" });
}

function writePayload(voxels: SparseVoxels, chunkSize: number): { payload: Uint8Array; chunkCount: number } {
  const n = voxelCount(voxels);
  const channels = voxels.channels;
  const chunkCount = Math.max(1, Math.ceil(n / chunkSize));
  const prelude = 8;
  let bytes = prelude;
  for (let c = 0; c < chunkCount; c++) {
    const count = Math.min(chunkSize, n - c * chunkSize);
    bytes += 8 + count * 3 * 4;
    for (const channel of channels) bytes += count * channel.components * (KIND_BYTES[channel.kind] ?? 4);
  }

  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, PAYLOAD_MAGIC, true);
  view.setUint32(4, n, true);

  let offset = prelude;
  for (let c = 0; c < chunkCount; c++) {
    const start = c * chunkSize;
    const count = Math.max(0, Math.min(chunkSize, n - start));
    view.setUint32(offset, c, true);
    view.setUint32(offset + 4, count, true);
    offset += 8;
    for (let v = start; v < start + count; v++) {
      view.setInt32(offset, voxels.coords[v * 3], true);
      view.setInt32(offset + 4, voxels.coords[v * 3 + 1], true);
      view.setInt32(offset + 8, voxels.coords[v * 3 + 2], true);
      offset += 12;
    }
    for (const channel of channels) {
      const values = voxels.attributes[channel.name];
      if (!values) throw new Error(`Channel "${channel.name}" has no values to serialise.`);
      for (let v = start; v < start + count; v++) {
        for (let component = 0; component < channel.components; component++) {
          const value = values[v * channel.components + component];
          switch (channel.kind) {
            case "f32": view.setFloat32(offset, value, true); offset += 4; break;
            case "f64": view.setFloat64(offset, value, true); offset += 8; break;
            case "u8": view.setUint8(offset, clampInt(value, 0, 255)); offset += 1; break;
            case "u16": view.setUint16(offset, clampInt(value, 0, 65535), true); offset += 2; break;
            case "i32": view.setInt32(offset, clampInt(value, -2147483648, 2147483647), true); offset += 4; break;
            default: throw new Error(`Unknown attribute kind "${channel.kind}".`);
          }
        }
      }
    }
  }
  if (offset !== bytes) throw new Error(`Payload writer wrote ${offset} bytes but reserved ${bytes}.`);
  return { payload: out, chunkCount };
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

function readPayload(
  payload: Uint8Array,
  grid: SpatialGrid,
  channels: AttributeChannel[],
  expectedVoxels: number,
  expectedChunks: number,
  chunkSize: number,
): SparseVoxels {
  if (payload.byteLength < 8) throw new NreCorruptionError("Payload is shorter than its 8-byte prelude.");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (view.getUint32(0, true) !== PAYLOAD_MAGIC) throw new NreCorruptionError("Payload prelude magic is wrong (expected NVX1).");
  const declared = view.getUint32(4, true);
  if (declared !== expectedVoxels) {
    throw new NreCorruptionError(`Payload declares ${declared} voxels but the metadata declares ${expectedVoxels}.`);
  }

  const coords = new Int32Array(declared * 3);
  const attributeData: Record<string, Float64Array> = {};
  for (const channel of channels) attributeData[channel.name] = new Float64Array(declared * channel.components);

  let offset = 8;
  let written = 0;
  const [nx, ny, nz] = grid.resolution;
  for (let c = 0; c < expectedChunks; c++) {
    if (offset + 8 > payload.byteLength) throw new NreCorruptionError(`Payload ended before chunk ${c}.`);
    const chunkIndex = view.getUint32(offset, true);
    const count = view.getUint32(offset + 4, true);
    offset += 8;
    if (chunkIndex !== c) throw new NreCorruptionError(`Chunk ${c} declares index ${chunkIndex}; the stream is out of order.`);
    if (count > chunkSize) throw new NreCorruptionError(`Chunk ${c} declares ${count} voxels, more than the ${chunkSize} chunk size.`);
    if (written + count > declared) throw new NreCorruptionError(`Chunk ${c} overruns the declared voxel count.`);
    if (offset + count * 12 > payload.byteLength) throw new NreCorruptionError(`Chunk ${c} coordinate block is truncated.`);
    for (let v = 0; v < count; v++) {
      const i = view.getInt32(offset, true);
      const j = view.getInt32(offset + 4, true);
      const k = view.getInt32(offset + 8, true);
      offset += 12;
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
        throw new NreCorruptionError(
          `Voxel (${i},${j},${k}) in chunk ${c} lies outside the declared ${nx}×${ny}×${nz} lattice.`,
        );
      }
      const target = written + v;
      coords[target * 3] = i;
      coords[target * 3 + 1] = j;
      coords[target * 3 + 2] = k;
    }
    for (const channel of channels) {
      const width = channel.components;
      const size = KIND_BYTES[channel.kind] ?? 4;
      if (offset + count * width * size > payload.byteLength) {
        throw new NreCorruptionError(`Chunk ${c} attribute "${channel.name}" block is truncated.`);
      }
      const target = attributeData[channel.name];
      for (let v = 0; v < count; v++) {
        for (let component = 0; component < width; component++) {
          let value: number;
          switch (channel.kind) {
            case "f32": value = view.getFloat32(offset, true); offset += 4; break;
            case "f64": value = view.getFloat64(offset, true); offset += 8; break;
            case "u8": value = view.getUint8(offset); offset += 1; break;
            case "u16": value = view.getUint16(offset, true); offset += 2; break;
            case "i32": value = view.getInt32(offset, true); offset += 4; break;
            default: throw new NreFormatError(`Unknown attribute kind "${channel.kind}".`);
          }
          target[(written + v) * width + component] = value;
        }
      }
    }
    written += count;
  }
  if (written !== declared) {
    throw new NreCorruptionError(`Payload chunks hold ${written} voxels but ${declared} were declared.`);
  }
  if (offset !== payload.byteLength) {
    throw new NreCorruptionError(`Payload has ${payload.byteLength - offset} trailing bytes after the last chunk.`);
  }

  const morton = new BigUint64Array(declared);
  for (let v = 0; v < declared; v++) {
    morton[v] = morton3(coords[v * 3], coords[v * 3 + 1], coords[v * 3 + 2]);
  }
  if (!isStrictlyAscending(morton)) {
    throw new NreCorruptionError("Payload voxels are not in strictly ascending Morton order.");
  }

  const bbox = boundsFromCoords(grid, coords);
  return {
    grid,
    coords,
    morton,
    attributes: attributeData,
    channels: [...channels],
    bbox,
    occupancy: "sparse-surface",
  };
}

function boundsFromCoords(grid: SpatialGrid, coords: Int32Array): { min: [number, number, number]; max: [number, number, number] } {
  const c = grid.cellSize;
  const [ox, oy, oz] = grid.origin;
  if (coords.length === 0) return { min: [ox, oy, oz], max: [ox, oy, oz] };
  let minI = Infinity, minJ = Infinity, minK = Infinity, maxI = -Infinity, maxJ = -Infinity, maxK = -Infinity;
  for (let v = 0; v < coords.length; v += 3) {
    minI = Math.min(minI, coords[v]); maxI = Math.max(maxI, coords[v]);
    minJ = Math.min(minJ, coords[v + 1]); maxJ = Math.max(maxJ, coords[v + 1]);
    minK = Math.min(minK, coords[v + 2]); maxK = Math.max(maxK, coords[v + 2]);
  }
  return {
    min: [ox + minI * c, oy + minJ * c, oz + minK * c],
    max: [ox + (maxI + 1) * c, oy + (maxJ + 1) * c, oz + (maxK + 1) * c],
  };
}

/**
 * Serialise one snapshot into a .vxz container.
 *
 * The voxel set is authoritative: `voxelCount` and `bbox` in the stored
 * snapshot are recomputed from the cells, so a caller passing a stale
 * manifest cannot make the file lie about its own size.
 */
/**
 * Measure the narrowing each channel actually suffers, per payload.
 *
 * A float64 attribute written as float32 is quantisation, and the record
 * says how much it cost for THIS data rather than quoting a theoretical
 * bound: maxAbsoluteError is the largest per-value error observed, and 0
 * means the stored values are exact (quantisation null).
 */
function channelsWithMeasuredQuantisation(
  channels: AttributeChannel[],
  attributes: Record<string, Float64Array>,
): AttributeChannel[] {
  return channels.map((channel) => {
    const values = attributes[channel.name];
    if (!values || channel.kind === "f64") {
      return { ...channel, quantisation: channel.kind === "f64" ? null : channel.quantisation };
    }
    let maxError = 0;
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      const stored =
        channel.kind === "f32"
          ? Math.fround(value)
          : clampInt(value, channel.kind === "u8" ? 0 : channel.kind === "u16" ? 0 : -2147483648, channel.kind === "u8" ? 255 : channel.kind === "u16" ? 65535 : 2147483647);
      const error = Math.abs(value - stored);
      if (error > maxError) maxError = error;
    }
    if (maxError === 0) return { ...channel, quantisation: null };
    return {
      ...channel,
      quantisation: {
        source: "f64",
        scale: 1,
        offset: 0,
        maxAbsoluteError: maxError,
        note: `Narrowed to ${channel.kind} for storage; the largest absolute error measured in this payload is ${maxError.toExponential(3)}.`,
      },
    };
  });
}

export async function serializeSnapshot(
  snapshot: SnapshotManifest,
  voxels: SparseVoxels,
  options: SerializeOptions = {},
): Promise<SerializeResult> {
  const started = performance.now();
  const validation = validateVoxels(voxels);
  if (!validation.ok) throw new NreFormatError(`Refusing to serialise an invalid voxel set: ${validation.problems.join("; ")}`);

  const codec = codecById(options.codec ?? "deflate-raw");
  const { payload, chunkCount } = writePayload(voxels, VXZ_CHUNK_VOXELS);
  const encodeMs = performance.now() - started;

  const compressStart = performance.now();
  const compressed = await codec.compress(payload);
  const compressMs = performance.now() - compressStart;

  const payloadSha256 = await sha256Hex(compressed);
  const payloadRawSha256 = await sha256Hex(payload);
  const n = voxelCount(voxels);
  const manifest: NreContainerManifest = {
    format: "nre-vxz",
    schemaVersion: NRE_SCHEMA_VERSION,
    id: `nre-${payloadRawSha256.slice(0, 16)}`,
    createdAt: options.createdAt ?? new Date().toISOString(),
    chunkSize: VXZ_CHUNK_VOXELS,
    mortonOrder: true,
    occupancy: voxels.occupancy,
    grid: voxels.grid,
    attributes: channelsWithMeasuredQuantisation(voxels.channels, voxels.attributes),
    voxelCount: n,
    chunkCount,
    snapshot: {
      ...snapshot,
      // Snapshot identity is content addressed on the uncompressed payload,
      // so re-serialising the same numbers never mints a new identity.
      id: snapshot.id && snapshot.id.length > 0 ? snapshot.id : `snp-${payloadRawSha256.slice(0, 16)}`,
      voxelCount: n,
      bbox: voxels.bbox,
      observations: snapshot.observations.map((o) => ({ ...o, representationSha256: o.representationSha256 ?? payloadRawSha256 })),
    },
    payloadBytes: compressed.byteLength,
    payloadRawBytes: payload.byteLength,
    codec: codec.id,
    payloadSha256,
    payloadRawSha256,
    metadataSha256: "",
  };
  manifest.metadataSha256 = await sha256Hex(new TextEncoder().encode(metadataDigestInput(manifest)));

  const header = new TextEncoder().encode(canonicalJson(manifest));
  const headerEnd = 12 + header.byteLength;
  const bytes = new Uint8Array(headerEnd + compressed.byteLength);
  bytes[0] = 0x56; // V
  bytes[1] = 0x58; // X
  bytes[2] = 0x5a; // Z
  bytes[3] = NRE_SCHEMA_VERSION;
  new DataView(bytes.buffer).setBigUint64(4, BigInt(headerEnd), false);
  bytes.set(header, 12);
  bytes.set(compressed, headerEnd);

  return {
    bytes,
    manifest,
    timings: { encodeMs, compressMs, totalMs: performance.now() - started },
  };
}

/** Read just the JSON metadata — used for inspection without decoding voxels. */
export function readContainerHeader(bytes: Uint8Array): { version: number; manifest: Record<string, unknown>; headerEnd: number } {
  if (bytes.byteLength < 20) throw new NreFormatError(`File is ${bytes.byteLength} bytes, too small to be a .vxz container.`);
  if (bytes[0] !== 0x56 || bytes[1] !== 0x58 || bytes[2] !== 0x5a) {
    throw new NreFormatError("Not a .vxz container: expected the ASCII magic VXZ.");
  }
  const version = bytes[3];
  if (!SUPPORTED_INPUT_VERSIONS.includes(version)) throw new NreVersionError(version);
  const headerEnd = Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(4, false));
  if (headerEnd < 13 || headerEnd > bytes.byteLength) {
    throw new NreCorruptionError(`Header offset ${headerEnd} is outside the file (${bytes.byteLength} bytes).`);
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(12, headerEnd))) as Record<string, unknown>;
  } catch (error) {
    throw new NreCorruptionError(`Metadata is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { version, manifest, headerEnd };
}

/**
 * Version 0 → 1. O-Voxel writes version 0 with its own metadata and no
 * NRE fields. Every NRE-only field is filled with an honest "absent"
 * value and recorded in the summary: confidence 0 and no observations,
 * because the file genuinely carries no provenance and pretending
 * otherwise would launder an unmeasured reconstruction into a trusted one.
 */
function migrateV0(manifest: Record<string, unknown>, id: string): NreContainerManifest {
  const migrated: NreContainerManifest = {
    format: "nre-vxz",
    schemaVersion: 1,
    id,
    createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : "1970-01-01T00:00:00.000Z",
    chunkSize: typeof manifest.chunkSize === "number" ? manifest.chunkSize : VXZ_CHUNK_VOXELS,
    mortonOrder: true,
    occupancy: "sparse-surface",
    grid: manifest.grid as SpatialGrid,
    attributes: Array.isArray(manifest.attributes) ? (manifest.attributes as AttributeChannel[]) : [],
    voxelCount: Number(manifest.voxelCount ?? 0),
    chunkCount: Number(manifest.chunkCount ?? 0),
    snapshot: {
      id,
      state: "observed",
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : "1970-01-01T00:00:00.000Z",
      observedAt: null,
      confidence: 0,
      lineage: { objectId: "migrated-v0", parentSnapshotId: null, sourceSnapshotIds: [], ordinal: 0 },
      transform: { id: "identity", kind: "identity", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], note: "identity" },
      observations: [],
      voxelCount: Number(manifest.voxelCount ?? 0),
      bbox: { min: [0, 0, 0], max: [0, 0, 0] },
      summary: "Migrated from container schema version 0 (O-Voxel native): no observation provenance was present in the file.",
    },
    payloadBytes: Number(manifest.payloadBytes ?? 0),
    payloadRawBytes: Number(manifest.payloadRawBytes ?? 0),
    codec: typeof manifest.codec === "string" ? manifest.codec : "lzma",
    payloadSha256: typeof manifest.payloadSha256 === "string" ? manifest.payloadSha256 : "",
    payloadRawSha256: typeof manifest.payloadRawSha256 === "string" ? manifest.payloadRawSha256 : "",
    metadataSha256: "",
  };
  migrated.metadataSha256 = typeof manifest.metadataSha256 === "string" ? manifest.metadataSha256 : "";
  return migrated;
}

/** Load a container: verify everything, then decode. */
export async function deserializeSnapshot(bytes: Uint8Array): Promise<NreSnapshot> {
  const { version, manifest: raw, headerEnd } = readContainerHeader(bytes);
  const payload = bytes.subarray(headerEnd);
  const containerSha256 = await sha256Hex(bytes);

  let manifest: NreContainerManifest;
  if (version === 0) {
    manifest = migrateV0(raw, `nre-migrated-${containerSha256.slice(0, 16)}`);
  } else {
    manifest = raw as unknown as NreContainerManifest;
    if (manifest.format !== "nre-vxz") {
      throw new NreFormatError(`Container declares format "${String(manifest.format)}"; expected "nre-vxz".`);
    }
    if (typeof manifest.metadataSha256 !== "string" || manifest.metadataSha256.length === 0) {
      throw new NreCorruptionError("Container has no metadata digest; a container written by this build always does.");
    }
    const recomputed = await sha256Hex(new TextEncoder().encode(metadataDigestInput(manifest)));
    if (recomputed !== manifest.metadataSha256) {
      throw new NreCorruptionError(`Metadata digest mismatch: stored ${manifest.metadataSha256.slice(0, 16)}…, recomputed ${recomputed.slice(0, 16)}….`);
    }
    if (manifest.schemaVersion !== version) {
      throw new NreCorruptionError(`Header version byte ${version} disagrees with metadata schemaVersion ${manifest.schemaVersion}.`);
    }
    if (manifest.payloadSha256) {
      const actual = await sha256Hex(payload);
      if (actual !== manifest.payloadSha256) {
        throw new NreCorruptionError(`Payload digest mismatch: stored ${manifest.payloadSha256.slice(0, 16)}…, recomputed ${actual.slice(0, 16)}….`);
      }
    }
  }

  if (payload.byteLength !== manifest.payloadBytes) {
    throw new NreCorruptionError(`Payload is ${payload.byteLength} bytes but the metadata declares ${manifest.payloadBytes}.`);
  }
  if (!manifest.grid || !Array.isArray(manifest.grid.resolution)) {
    throw new NreFormatError("Container has no usable spatial grid; the lattice is required to address voxels.");
  }

  // Version 0 files may carry an LZMA payload. That is refused by name.
  const codec = codecById(manifest.codec);
  const rawPayload = await codec.decompress(payload);
  if (rawPayload.byteLength !== manifest.payloadRawBytes) {
    throw new NreCorruptionError(
      `Decompressed payload is ${rawPayload.byteLength} bytes but the metadata declares ${manifest.payloadRawBytes}.`,
    );
  }
  if (manifest.payloadRawSha256) {
    const rawSha = await sha256Hex(rawPayload);
    if (rawSha !== manifest.payloadRawSha256) {
      throw new NreCorruptionError(`Uncompressed payload digest mismatch: stored ${manifest.payloadRawSha256.slice(0, 16)}…, recomputed ${rawSha.slice(0, 16)}….`);
    }
  }

  const voxels = readPayload(
    rawPayload,
    manifest.grid,
    manifest.attributes,
    manifest.voxelCount,
    manifest.chunkCount,
    manifest.chunkSize,
  );
  voxels.occupancy = manifest.occupancy;
  if (voxels.coords.length / 3 !== manifest.snapshot.voxelCount) {
    throw new NreCorruptionError(
      `Snapshot declares ${manifest.snapshot.voxelCount} voxels but the payload holds ${voxels.coords.length / 3}.`,
    );
  }

  return {
    manifest,
    voxels,
    containerBytes: bytes.byteLength,
    containerSha256,
  };
}

/** Round-trip a set of coordinates through Morton order for a quick sanity check. */
export function mortonRoundTripFine(coords: Int32Array): boolean {
  for (let v = 0; v < coords.length; v += 3) {
    const [i, j, k] = decodeMorton(morton3(coords[v], coords[v + 1], coords[v + 2]));
    if (i !== coords[v] || j !== coords[v + 1] || k !== coords[v + 2]) return false;
  }
  return true;
}
