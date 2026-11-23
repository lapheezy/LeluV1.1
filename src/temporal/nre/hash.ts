/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — CONTENT ADDRESSING
 *
 * Three things in the engine rest on a digest:
 *
 *   corruption  the payload digest is recomputed on read; a file that
 *               changed under us is refused, not repaired.
 *   identity    a snapshot's id is derived from its payload digest, so
 *               two snapshots with the same id really are the same
 *               numbers.
 *   provenance  observations record the digest of their input bytes.
 *
 * WebCrypto only (`crypto.subtle`), which exists in browsers and in
 * Node ≥ 18, so the same code path runs in a test and in the page. No
 * dependency, no Node built-in, nothing to polyfill.
 * ==========================================================
 */

const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer view: a Uint8Array over a SharedArrayBuffer
  // (or a subarray with a byteOffset) is rejected by subtle.digest.
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return bytesToHex(new Uint8Array(digest));
}

export function sha256HexOfText(text: string): Promise<string> {
  return sha256Hex(encoder.encode(text));
}

/**
 * Canonical JSON: object keys sorted, no whitespace, `undefined` dropped.
 *
 * The metadata digest must not change because a caller built the same
 * object with a different key insertion order — that would make every
 * round trip look like a distinct file.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      throw new Error("Binary data cannot be canonicalised as JSON metadata.");
    }
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = sortValue(source[key]);
    }
    return out;
  }
  return value;
}
