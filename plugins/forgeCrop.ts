/**
 * ==========================================================
 * LÉLU 3D FORGE — CROP (server only)
 *
 * The board is a blueprint, not the product. This is the
 * instrument that enforces that: a reference board is cut
 * into one image per physical asset, and each cut keeps its
 * provenance — which board, which rectangle, and the sha256
 * of the sheet it came from — so a garment can always be
 * traced back to the region a person chose.
 *
 * Deliberately narrow:
 *
 *   - fractional rectangles, so a crop survives the board
 *     being re-exported at a different resolution
 *   - rectangles are clamped to the sheet and refused if
 *     they fall off it, rather than silently becoming black
 *   - PNG in, PNG out through node:zlib alone. No native
 *     module, no headless browser, no image service.
 *
 * A crop is NOT an authority: it inherits the board's
 * status as a design guide, and still has to be compared
 * against the original photograph before it drives geometry.
 * ==========================================================
 */

import { deflateSync } from "node:zlib";
import { decodePng } from "./forgeReferences.ts";

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  pixels: Uint8Array;
}

/** A rectangle in fractions of the sheet: [0,0] is top-left. */
export interface CropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_EDGE = 8;

function toRgba(image: { width: number; height: number; channels: number; pixels: Uint8Array }): RgbaImage {
  const { width, height, channels, pixels } = image;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const src = i * channels;
    const dst = i * 4;
    if (channels >= 3) {
      out[dst] = pixels[src];
      out[dst + 1] = pixels[src + 1];
      out[dst + 2] = pixels[src + 2];
      out[dst + 3] = channels === 4 ? pixels[src + 3] : 255;
    } else {
      out[dst] = out[dst + 1] = out[dst + 2] = pixels[src];
      out[dst + 3] = channels === 2 ? pixels[src + 1] : 255;
    }
  }
  return { width, height, pixels: out };
}

export function decodeToRgba(bytes: Uint8Array): RgbaImage {
  return toRgba(decodePng(bytes));
}

/** Pixel rectangle for a fractional region, clamped to the sheet. */
export function regionToPixels(width: number, height: number, region: CropRegion): { x: number; y: number; w: number; h: number } {
  for (const [key, value] of Object.entries(region)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Crop region "${key}" must be a fraction between 0 and 1 (got ${value}).`);
  }
  const x = Math.round(region.x * width);
  const y = Math.round(region.y * height);
  const w = Math.min(Math.round(region.w * width), width - x);
  const h = Math.min(Math.round(region.h * height), height - y);
  if (w < MIN_EDGE || h < MIN_EDGE) {
    throw new Error(`Crop ${region.w}×${region.h} of a ${width}×${height} sheet is ${w}×${h}px — too small to drive geometry (minimum ${MIN_EDGE}px a side).`);
  }
  return { x, y, w, h };
}

export function cropImage(image: RgbaImage, region: CropRegion): RgbaImage {
  const { x, y, w, h } = regionToPixels(image.width, image.height, region);
  const pixels = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * image.width + x) * 4;
    pixels.set(image.pixels.subarray(from, from + w * 4), row * w * 4);
  }
  return { width: w, height: h, pixels };
}

/* ------------------------------ encoding ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)])), 8 + data.length);
  return out;
}

/** 8-bit RGBA, non-interlaced — what decodePng reads back, and what Meshy accepts. */
export function encodePng(image: RgbaImage): Uint8Array {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(image.pixels.buffer, image.pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

export function cropPng(bytes: Uint8Array, region: CropRegion): { width: number; height: number; png: Uint8Array } {
  const cropped = cropImage(decodeToRgba(bytes), region);
  return { width: cropped.width, height: cropped.height, png: encodePng(cropped) };
}

/** A solid sheet, for tests and for placeholder boards. */
export function solidPng(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set(rgba, i * 4);
  return encodePng({ width, height, pixels });
}
