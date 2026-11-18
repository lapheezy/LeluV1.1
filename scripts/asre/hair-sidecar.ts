/** Strand sidecar encoder (Node only: gzip). */
import { gzipSync } from "node:zlib";
import type { Strands } from "../../src/core/asre/reference/hairArch.ts";

/**
 * Compact strand sidecar ("LHC1", gzip): header JSON, then per-strand point
 * counts (u16), positions quantized to u16 over the bounding box (0.02 mm at
 * 1.3 m), root/tip radius in µm (u16), sRGB colour (u8) and kind (u8).
 */
export function encodeStrands(s: Strands): Uint8Array {
  const n = s.counts.length, np = s.positions.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.positions.length; i += 3) for (let a = 0; a < 3; a++) [lo[a], hi[a]] = [Math.min(lo[a], s.positions[i + a]), Math.max(hi[a], s.positions[i + a])];
  const header = new TextEncoder().encode(JSON.stringify({ format: "LHC1", strands: n, points: np, lo, hi, coords: "y-up metres (glTF)" }));
  const q = new Uint16Array(np * 3);
  for (let i = 0; i < np; i++) for (let a = 0; a < 3; a++) q[3 * i + a] = Math.round(((s.positions[3 * i + a] - lo[a]) / Math.max(1e-9, hi[a] - lo[a])) * 65535);
  const counts = Uint16Array.from(s.counts);
  const rad = Uint16Array.from(s.radius, (r) => Math.round(r * 1e6));
  const col = Uint8Array.from(s.color, (c) => Math.round(Math.max(0, Math.min(1, c)) * 255));
  const parts = [new Uint8Array(new Uint32Array([0x3143484c, header.length]).buffer), header];
  const pad = (4 - ((8 + header.length) % 4)) % 4;
  parts.push(new Uint8Array(pad));
  for (const a of [counts, q, rad]) parts.push(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  parts.push(col, s.kind);
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return gzipSync(out, { level: 9 });
}
