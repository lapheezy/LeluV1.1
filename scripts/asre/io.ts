/** Minimal readers for the worker's .npy outputs and for GLBs this module wrote. */
import { readFileSync } from "node:fs";
import type { Mesh } from "../../src/core/asre/volume/mesh";

export interface Npy {
  dtype: string;
  shape: number[];
  data: Float32Array | Int32Array | Uint8Array | Float64Array | BigInt64Array;
}

export function readNpy(file: string): Npy {
  const buf = readFileSync(file);
  if (buf.toString("latin1", 1, 6) !== "NUMPY") throw new Error(`${file}: not .npy`);
  const major = buf[6];
  const hlen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const hstart = major === 1 ? 10 : 12;
  const header = buf.toString("latin1", hstart, hstart + hlen);
  const dtype = /'descr':\s*'([^']+)'/.exec(header)![1];
  if (/'fortran_order':\s*True/.test(header)) throw new Error(`${file}: fortran order unsupported`);
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)![1].match(/\d+/g) ?? []).map(Number);
  const body = buf.subarray(hstart + hlen);
  const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  const ctor = { "<f4": Float32Array, "<i4": Int32Array, "|u1": Uint8Array, "<f8": Float64Array, "<i8": BigInt64Array }[dtype];
  if (!ctor) throw new Error(`${file}: dtype ${dtype} unsupported`);
  return { dtype, shape, data: new ctor(ab) };
}

/** POSITION/indices of every primitive in a GLB (no node transforms), merged. */
export function readGlbMesh(bytes: Uint8Array): Mesh {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jlen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jlen)));
  const binStart = 20 + jlen + 8;
  const view = (acc: { bufferView: number; byteOffset?: number; count: number }, comps: number, ctor: Float32ArrayConstructor | Uint32ArrayConstructor) => {
    const bv = json.bufferViews[acc.bufferView];
    const off = bytes.byteOffset + binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    return new ctor(bytes.buffer.slice(off, off + acc.count * comps * 4));
  };
  const pos: number[] = [], idx: number[] = [];
  for (const m of json.meshes)
    for (const p of m.primitives) {
      const base = pos.length / 3;
      for (const v of view(json.accessors[p.attributes.POSITION], 3, Float32Array)) pos.push(v);
      for (const i of view(json.accessors[p.indices], 1, Uint32Array)) idx.push(i + base);
    }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
