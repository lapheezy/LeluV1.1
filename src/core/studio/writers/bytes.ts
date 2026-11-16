/** LÉLU — Creation Studio byte helpers (browser and Node). */

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(clean, "base64"));
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}

export type ImageType = "png" | "jpg" | "gif" | "bmp" | "svg" | "webp";

/** Decode a data: URL into bytes and an image type. */
export function dataUrlBytes(url: string): { type: ImageType; bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const type: ImageType | null =
    mime === "image/png" ? "png" : mime === "image/jpeg" || mime === "image/jpg" ? "jpg" : mime === "image/gif" ? "gif" : mime === "image/bmp" ? "bmp" : mime === "image/svg+xml" ? "svg" : mime === "image/webp" ? "webp" : null;
  if (!type) return null;
  const bytes = m[2] ? base64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return { type, bytes, mime };
}

/** SHA-256 of bytes, hex. Web Crypto in both the browser and Node 20+. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
