/**
 * ==========================================================
 * LÉLU ASRE — NRE CONTAINER (.lnre)
 *
 *   offset  size  field
 *   0       4     magic "LNRE"
 *   4       2     container format version (u16 LE) = 1
 *   6       2     flags (bit 0: body compressed by the caller's codec)
 *   8       4     header length H (u32 LE)
 *   12      H     header: canonical JSON (sorted keys, UTF-8)
 *   12+H    4     CRC-32 of header
 *   16+H    4     body length B (u32 LE)
 *   20+H    B     body (see below)
 *   20+H+B  4     CRC-32 of body (as stored, i.e. after compression)
 *   24+H+B  32    SHA-256 of every preceding byte
 *
 * Body, schemaVersion 2 (cells sorted by Morton code):
 *   for each cell:  varint(delta Morton code, first delta from 0)
 *                   varint(evidence count)
 *                   for each evidence: varint(obs*2 + explicitP)
 *                                      [float64 LE p, only if explicitP]
 *
 * Confidence and the provenance mask are DERIVED on load (noisy-OR and
 * OR of observation classes), so they cannot disagree with the evidence.
 *
 * Deterministic: the same grid always yields the same bytes (sorted cells,
 * canonical JSON, no wall-clock in the container).
 *
 * schemaVersion 1 (the minimal layout: confidence + provenance byte per
 * cell, no evidence list) is still readable and is migrated on load.
 * ==========================================================
 */

import { crc32, sha256 } from "./hash";
import { SparseVoxelGrid } from "./SparseVoxelGrid";
import { Provenance, primaryProvenance, type GridSpec, type Observation, type ProvenanceName } from "./types";

export const NRE_MAGIC = "LNRE";
export const NRE_CONTAINER_VERSION = 1;
export const NRE_SCHEMA = "lelu.nre.grid";
export const NRE_SCHEMA_VERSION = 2;

export interface Codec {
  name: string;
  compress(bytes: Uint8Array): Uint8Array;
  decompress(bytes: Uint8Array): Uint8Array;
}

export class NreFormatError extends Error {
  constructor(
    message: string,
    readonly section: "magic" | "version" | "header" | "body" | "checksum" | "schema",
  ) {
    super(message);
    this.name = "NreFormatError";
  }
}

/* ------------------------------- primitives ------------------------------- */

class Writer {
  private buf = new Uint8Array(1024);
  length = 0;
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number): void {
    this.ensure(1);
    this.buf[this.length++] = b;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  /** Unsigned LEB128 for integers up to 2^53. */
  varint(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`varint: ${v}`);
    while (v >= 0x80) {
      this.byte((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.byte(v);
  }
  u16(v: number): void {
    this.ensure(2);
    new DataView(this.buf.buffer).setUint16(this.length, v, true);
    this.length += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    new DataView(this.buf.buffer).setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }
  f64(v: number): void {
    this.ensure(8);
    new DataView(this.buf.buffer).setFloat64(this.length, v, true);
    this.length += 8;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

class Reader {
  pos = 0;
  private readonly view: DataView;
  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  need(n: number, section: NreFormatError["section"]): void {
    if (this.pos + n > this.buf.length) throw new NreFormatError(`truncated ${section}`, section);
  }
  varint(): number {
    let result = 0;
    let mul = 1;
    for (;;) {
      this.need(1, "body");
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      if (!(b & 0x80)) return result;
      mul *= 0x80;
      if (mul > 2 ** 56) throw new NreFormatError("varint overflow", "body");
    }
  }
  u16(): number {
    this.need(2, "header");
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(section: NreFormatError["section"] = "header"): number {
    this.need(4, section);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    this.need(8, "body");
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  take(n: number, section: NreFormatError["section"]): Uint8Array {
    this.need(n, section);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/** JSON with recursively sorted keys: one byte sequence per value. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/* --------------------------------- header --------------------------------- */

interface HeaderV2 {
  schema: typeof NRE_SCHEMA;
  schemaVersion: 2;
  spec: GridSpec;
  observations: Observation[];
  cellCount: number;
  codec: string | null;
  rawBodyBytes: number;
}

interface HeaderV1 {
  schema: typeof NRE_SCHEMA;
  schemaVersion: 1;
  spec: GridSpec;
  cellCount: number;
  codec: string | null;
  rawBodyBytes: number;
}

/* --------------------------------- encode --------------------------------- */

export interface EncodeOptions {
  codec?: Codec;
}

export function encodeGrid(grid: SparseVoxelGrid, options: EncodeOptions = {}): Uint8Array {
  const observations = grid.getObservations();
  const body = new Writer();
  let prev = 0;
  for (const [code, cell] of grid.entries()) {
    body.varint(code - prev);
    prev = code;
    body.varint(cell.evidence.length);
    for (const e of cell.evidence) {
      const explicit = e.p !== observations[e.obs].confidence;
      body.varint(e.obs * 2 + (explicit ? 1 : 0));
      if (explicit) body.f64(e.p);
    }
  }
  const raw = body.done();
  const stored = options.codec ? options.codec.compress(raw) : raw;
  const header: HeaderV2 = {
    schema: NRE_SCHEMA,
    schemaVersion: 2,
    spec: grid.spec,
    observations: [...observations],
    cellCount: grid.size,
    codec: options.codec?.name ?? null,
    rawBodyBytes: raw.length,
  };
  return frame(new TextEncoder().encode(canonicalJson(header)), stored, options.codec ? 1 : 0);
}

function frame(headerBytes: Uint8Array, body: Uint8Array, flags: number): Uint8Array {
  const out = new Writer();
  out.bytes(new TextEncoder().encode(NRE_MAGIC));
  out.u16(NRE_CONTAINER_VERSION);
  out.u16(flags);
  out.u32(headerBytes.length);
  out.bytes(headerBytes);
  out.u32(crc32(headerBytes));
  out.u32(body.length);
  out.bytes(body);
  out.u32(crc32(body));
  const pre = out.done();
  out.bytes(sha256(pre));
  return out.done();
}

/**
 * Legacy writer for schemaVersion 1 (confidence + provenance byte per cell).
 * Kept so the migration path is exercised by real bytes, not a description.
 */
export function encodeGridV1(grid: SparseVoxelGrid): Uint8Array {
  const body = new Writer();
  let prev = 0;
  for (const [code, cell] of grid.entries()) {
    body.varint(code - prev);
    prev = code;
    body.f64(cell.confidence);
    body.byte(cell.provenance & 0xff);
  }
  const raw = body.done();
  const header: HeaderV1 = { schema: NRE_SCHEMA, schemaVersion: 1, spec: grid.spec, cellCount: grid.size, codec: null, rawBodyBytes: raw.length };
  return frame(new TextEncoder().encode(canonicalJson(header)), raw, 0);
}

/* --------------------------------- decode --------------------------------- */

export interface DecodeOptions {
  codecs?: Codec[];
}

export interface DecodeResult {
  grid: SparseVoxelGrid;
  schemaVersion: number;
  migratedFrom: number | null;
}

export function decodeGrid(bytes: Uint8Array, options: DecodeOptions = {}): DecodeResult {
  if (bytes.length < 56) throw new NreFormatError("container too short", "magic");
  const r = new Reader(bytes);
  const magic = new TextDecoder().decode(r.take(4, "magic"));
  if (magic !== NRE_MAGIC) throw new NreFormatError(`bad magic ${JSON.stringify(magic)}`, "magic");
  const expected = sha256(bytes.subarray(0, bytes.length - 32));
  const actual = bytes.subarray(bytes.length - 32);
  const shaOk = expected.every((b, i) => b === actual[i]);
  const version = r.u16();
  if (version !== NRE_CONTAINER_VERSION) throw new NreFormatError(`unsupported container version ${version}`, "version");
  const flags = r.u16();
  const headerLen = r.u32();
  const headerBytes = r.take(headerLen, "header");
  if (crc32(headerBytes) !== r.u32()) throw new NreFormatError("header checksum mismatch (corrupted header)", "header");
  const bodyLen = r.u32("body");
  if (bytes.length !== 12 + headerLen + 4 + 4 + bodyLen + 4 + 32) throw new NreFormatError("container length mismatch (truncated or padded)", "body");
  const stored = r.take(bodyLen, "body");
  if (crc32(stored) !== r.u32("body")) throw new NreFormatError("body checksum mismatch (corrupted body)", "body");
  if (!shaOk) throw new NreFormatError("container SHA-256 mismatch", "checksum");
  let header: HeaderV1 | HeaderV2;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    throw new NreFormatError("header is not JSON", "header");
  }
  if (header.schema !== NRE_SCHEMA) throw new NreFormatError(`unknown schema ${String(header.schema)}`, "schema");
  let raw = stored;
  if (flags & 1) {
    const codec = options.codecs?.find((c) => c.name === header.codec);
    if (!codec) throw new NreFormatError(`body compressed with codec ${String(header.codec)} which was not supplied`, "body");
    raw = codec.decompress(stored);
  }
  if (raw.length !== header.rawBodyBytes) throw new NreFormatError("decompressed body length mismatch", "body");
  if (header.schemaVersion === 2) return { grid: decodeV2(header, raw), schemaVersion: 2, migratedFrom: null };
  if (header.schemaVersion === 1) return { grid: migrateV1(header, raw), schemaVersion: 2, migratedFrom: 1 };
  throw new NreFormatError(`schemaVersion ${(header as { schemaVersion: number }).schemaVersion} is newer than this reader (${NRE_SCHEMA_VERSION})`, "schema");
}

function decodeV2(header: HeaderV2, raw: Uint8Array): SparseVoxelGrid {
  const grid = new SparseVoxelGrid(header.spec);
  for (const o of header.observations) grid.addObservation(o);
  const obs = grid.getObservations();
  const r = new Reader(raw);
  let code = 0;
  for (let i = 0; i < header.cellCount; i++) {
    code += r.varint();
    const n = r.varint();
    const evidence = [];
    let provenance = 0;
    for (let k = 0; k < n; k++) {
      const v = r.varint();
      const index = Math.floor(v / 2);
      if (index >= obs.length) throw new NreFormatError(`evidence refers to observation #${index} of ${obs.length}`, "body");
      const p = v % 2 ? r.f64() : obs[index].confidence;
      evidence.push({ obs: index, p });
      provenance |= Provenance[obs[index].provenance];
    }
    let miss = 1;
    for (const e of evidence) miss *= 1 - e.p;
    grid.setCellByCode(code, { confidence: 1 - miss, provenance, evidence });
  }
  if (r.pos !== raw.length) throw new NreFormatError("trailing bytes in body", "body");
  return grid;
}

/** v1 → v2: one migration observation per provenance class; each cell keeps its confidence as one evidence term. */
function migrateV1(header: HeaderV1, raw: Uint8Array): SparseVoxelGrid {
  const grid = new SparseVoxelGrid(header.spec);
  const indexFor = new Map<ProvenanceName, number>();
  const r = new Reader(raw);
  let code = 0;
  for (let i = 0; i < header.cellCount; i++) {
    code += r.varint();
    const confidence = r.f64();
    r.need(1, "body");
    const mask = r.buf[r.pos++];
    const name = primaryProvenance(mask) ?? "INFERRED";
    let index = indexFor.get(name);
    if (index === undefined) {
      index = grid.addObservation({
        id: `migrated-v1-${name.toLowerCase()}`,
        capturedAt: 0,
        source: "nre-migration:v1->v2",
        modality: "voxel-grid",
        provenance: name,
        confidence: 1,
        parameters: { fromSchemaVersion: 1 },
        fingerprint: `migrated-v1-${name}`,
        lineage: ["schemaVersion 1 stored a fused confidence without its evidence"],
      }).index;
      indexFor.set(name, index);
    }
    grid.setCellByCode(code, { confidence, provenance: mask, evidence: [{ obs: index, p: confidence }] });
  }
  return grid;
}

/**
 * Baseline for compression ratios: each occupied cell dumped as three float64
 * world coordinates (24 bytes/cell), the layout of a raw point-cloud export.
 * (The historical 9.84:1 figure — 45,475 cells, 110,884 bytes — matches this
 * baseline: 45,475 × 24 / 110,884 = 9.84.)
 */
export function naiveByteSize(grid: SparseVoxelGrid): number {
  return grid.size * 24;
}
