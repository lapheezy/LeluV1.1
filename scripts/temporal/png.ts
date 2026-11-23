/**
 * ==========================================================
 * TEMPORAL STUDIO — DEPENDENCY-FREE PNG CODEC (Node only)
 *
 * The ASRE engine works on raw pixels and must not depend on an image
 * library to get them. PNG is a small enough format to decode honestly:
 * 8-bit RGB and RGBA, no interlacing, all five filter types, zlib from
 * node:zlib. Anything outside that is rejected with the reason instead
 * of being decoded wrongly.
 *
 * Encoding is filter-0 only: it exists so the experiments can write the
 * masks, depth fields and overlays they measured, which is how the
 * numerical work becomes something a human can look at.
 * ==========================================================
 */

import { deflateSync, inflateSync } from "node:zlib";
import type { ImageFrame } from "../../src/temporal/asre/types.ts";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Chunk {
  type: string;
  data: Uint8Array;
}

function readChunks(bytes: Uint8Array): Chunk[] {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG: signature mismatch");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode an 8-bit RGB/RGBA non-interlaced PNG into an RGBA frame. */
export function decodePng(bytes: Uint8Array): ImageFrame {
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("PNG has no IHDR");
  const header = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const bitDepth = ihdr.data[8];
  const colourType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}; this decoder handles 8-bit only`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");
  const channels = colourType === 2 ? 3 : colourType === 6 ? 4 : colourType === 0 ? 1 : -1;
  if (channels < 0) throw new Error(`unsupported PNG colour type ${colourType}; handled: 0 (grey), 2 (RGB), 6 (RGBA)`);

  const compressed = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => Buffer.from(c.data)));
  const raw = inflateSync(compressed);
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let offset = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const value = raw[offset + x];
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + Math.floor((left + up) / 2);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unknown PNG filter type ${filter} on row ${y}`);
      }
      row[x] = restored & 0xff;
    }
    offset += stride;
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      const src = x * channels;
      if (channels === 1) {
        out[dst] = row[src];
        out[dst + 1] = row[src];
        out[dst + 2] = row[src];
        out[dst + 3] = 255;
      } else {
        out[dst] = row[src];
        out[dst + 1] = row[src + 1];
        out[dst + 2] = row[src + 2];
        out[dst + 3] = channels === 4 ? row[src + 3] : 255;
      }
    }
    previous = row;
  }

  return { width, height, rgba: out };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode an RGBA frame as a PNG (filter 0). */
export function encodePng(frame: ImageFrame): Uint8Array {
  const { width, height, rgba } = frame;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw), { level: 6 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A blank RGBA canvas. */
export function blankFrame(width: number, height: number, colour: [number, number, number] = [18, 20, 24]): ImageFrame {
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = colour[0];
    rgba[p * 4 + 1] = colour[1];
    rgba[p * 4 + 2] = colour[2];
    rgba[p * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

export function setPixel(frame: ImageFrame, x: number, y: number, colour: [number, number, number], alpha = 255): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  const i = (Math.floor(y) * frame.width + Math.floor(x)) * 4;
  frame.rgba[i] = colour[0];
  frame.rgba[i + 1] = colour[1];
  frame.rgba[i + 2] = colour[2];
  frame.rgba[i + 3] = alpha;
}

export function blendPixel(frame: ImageFrame, x: number, y: number, colour: [number, number, number], alpha: number): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  const i = (Math.floor(y) * frame.width + Math.floor(x)) * 4;
  frame.rgba[i] = Math.round(frame.rgba[i] * (1 - alpha) + colour[0] * alpha);
  frame.rgba[i + 1] = Math.round(frame.rgba[i + 1] * (1 - alpha) + colour[1] * alpha);
  frame.rgba[i + 2] = Math.round(frame.rgba[i + 2] * (1 - alpha) + colour[2] * alpha);
  frame.rgba[i + 3] = 255;
}

/** Nearest-neighbour resize, so a diagnostic image can be shown at any size. */
export function resizeFrame(frame: ImageFrame, width: number, height: number): ImageFrame {
  const out = blankFrame(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(frame.height - 1, Math.floor((y / height) * frame.height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(frame.width - 1, Math.floor((x / width) * frame.width));
      const src = (sy * frame.width + sx) * 4;
      const dst = (y * width + x) * 4;
      out.rgba[dst] = frame.rgba[src];
      out.rgba[dst + 1] = frame.rgba[src + 1];
      out.rgba[dst + 2] = frame.rgba[src + 2];
      out.rgba[dst + 3] = 255;
    }
  }
  return out;
}

/** Compose frames horizontally into one canvas. */
export function sideBySide(frames: ImageFrame[], gap = 8, background: [number, number, number] = [12, 13, 16]): ImageFrame {
  const height = Math.max(...frames.map((f) => f.height));
  const width = frames.reduce((sum, f) => sum + f.width, 0) + gap * (frames.length - 1);
  const out = blankFrame(width, height, background);
  let offsetX = 0;
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const src = (y * frame.width + x) * 4;
        const dst = (y * width + (x + offsetX)) * 4;
        out.rgba[dst] = frame.rgba[src];
        out.rgba[dst + 1] = frame.rgba[src + 1];
        out.rgba[dst + 2] = frame.rgba[src + 2];
        out.rgba[dst + 3] = 255;
      }
    }
    offsetX += frame.width + gap;
  }
  return out;
}
