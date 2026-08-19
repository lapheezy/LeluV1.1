#!/usr/bin/env node
/**
 * LÉLU — PWA icon generator (dependency-free, node only).
 *
 * Draws LÉLU's core icon (dark navy radial, cyan core, purple
 * signal ring) as real PNGs: apple-touch-icon.png (180×180),
 * icon-192.png, icon-512.png and icon-maskable-512.png.
 *
 * PNG encoding is hand-rolled (zlib deflate + chunks) so this
 * runs anywhere node exists — no canvas, no Mac tooling.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- tiny PNG encoder ---------- */

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with filter byte 0.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- pixel drawing ---------- */

function hex(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

const CORE = hex("#67e8f9"); // cyan core
const RING = hex("#a78bfa"); // purple signal ring
const BG_EDGE = hex("#020617"); // deep space
const BG_MID = hex("#0b1f3f"); // inner nebula

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x - center) / radius;
      const ny = (y - center) / radius;
      const dist = Math.sqrt(nx * nx + ny * ny);

      // background radial gradient: dark edge → inner nebula
      const t = Math.min(1, dist);
      let r = BG_EDGE[0] + (BG_MID[0] - BG_EDGE[0]) * (1 - t);
      let g = BG_EDGE[1] + (BG_MID[1] - BG_EDGE[1]) * (1 - t);
      let b = BG_EDGE[2] + (BG_MID[2] - BG_EDGE[2]) * (1 - t);

      // glowing cyan core
      const core = Math.exp(-dist * dist * 4.2) * 1.15;
      r += CORE[0] * core;
      g += CORE[1] * core;
      b += CORE[2] * core;

      // inner purple ring (signal path)
      const ring1 = Math.exp(-Math.pow(dist - 0.42, 2) * 320) * 0.85;
      r += RING[0] * ring1;
      g += RING[1] * ring1;
      b += RING[2] * ring1;

      // faint outer halo
      const halo = Math.exp(-Math.pow(dist - 0.86, 2) * 700) * 0.28;
      r += CORE[0] * halo;
      g += CORE[1] * halo;
      b += CORE[2] * halo;

      // edge vignette keeps the icon readable at small sizes
      const vignette = Math.max(0.55, 1 - Math.max(0, dist - 0.82) * 3);
      r *= vignette;
      g *= vignette;
      b *= vignette;

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.max(0, Math.min(255, Math.round(r)));
      rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rgba[idx + 3] = 255;
    }
  }

  return rgba;
}

const targets = [
  { file: "public/apple-touch-icon.png", size: 180 },
  { file: "public/icon-192.png", size: 192 },
  { file: "public/icon-512.png", size: 512 },
  { file: "public/icon-maskable-512.png", size: 512 },
];

for (const target of targets) {
  const rgba = drawIcon(target.size);
  const png = encodePng(target.size, target.size, rgba);
  const path = join(root, target.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  console.log(`✓ ${target.file} (${target.size}×${target.size}, ${png.length} bytes)`);
}
