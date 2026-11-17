/**
 * ==========================================================
 * LÉLU ASRE — PNG DECODE / ENCODE (no dependency)
 *
 * Enough of PNG for reconstruction inputs: greyscale, RGB, palette,
 * grey+alpha and RGBA at bit depth 8 (16-bit is reduced to its high
 * byte), non-interlaced. Interlaced files are refused with a clear
 * error rather than decoded wrongly. zlib is injected so this module
 * stays free of Node/DOM imports (the server passes node:zlib).
 * ==========================================================
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8Array;
}

export interface Zlib {
  inflate(bytes: Uint8Array): Uint8Array;
  deflate(bytes: Uint8Array): Uint8Array;
}

export class PngError extends Error {}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function decodePng(bytes: Uint8Array, zlib: Pick<Zlib, "inflate">): RgbaImage {
  if (!isPng(bytes)) throw new PngError("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (pos + 12 + len > bytes.length) throw new PngError(`truncated ${type} chunk`);
    if (crc32(bytes, pos + 4, pos + 8 + len) !== view.getUint32(pos + 8 + len)) throw new PngError(`bad CRC in ${type} chunk`);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "PLTE") palette = body.slice();
    else if (type === "tRNS") trns = body.slice();
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!width || !height) throw new PngError("missing IHDR");
  if (interlace) throw new PngError("interlaced PNG is not supported; re-save it non-interlaced");
  if (depth !== 8 && depth !== 16) throw new PngError(`bit depth ${depth} is not supported (8 or 16 only)`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new PngError(`colour type ${colorType} is not supported`);
  if (colorType === 3 && !palette) throw new PngError("palette image without PLTE");
  const bpp = channels * (depth / 8);
  const stride = width * bpp;
  let total = 0;
  for (const c of idat) total += c.length;
  const joined = new Uint8Array(total);
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = zlib.inflate(joined);
  if (raw.length < height * (stride + 1)) throw new PngError("image data is shorter than the header says");
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new PngError(`unknown filter ${filter} on row ${y}`);
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = (k: number) => cur[x * bpp + k * (depth / 8)];
      const d = (y * width + x) * 4;
      if (colorType === 0) {
        out[d] = out[d + 1] = out[d + 2] = s(0);
        out[d + 3] = trns && depth === 8 && trns.length >= 2 && s(0) === trns[1] ? 0 : 255;
      } else if (colorType === 2) {
        out[d] = s(0);
        out[d + 1] = s(1);
        out[d + 2] = s(2);
        out[d + 3] = 255;
      } else if (colorType === 3) {
        const i = s(0);
        out[d] = palette![3 * i];
        out[d + 1] = palette![3 * i + 1];
        out[d + 2] = palette![3 * i + 2];
        out[d + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (colorType === 4) {
        out[d] = out[d + 1] = out[d + 2] = s(0);
        out[d + 3] = s(1);
      } else {
        out[d] = s(0);
        out[d + 1] = s(1);
        out[d + 2] = s(2);
        out[d + 3] = s(3);
      }
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  v.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

/** RGBA → PNG (filter 0 rows, one IDAT). */
export function encodePng(img: RgbaImage, zlib: Pick<Zlib, "deflate">): Uint8Array {
  const { width, height, data } = img;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
