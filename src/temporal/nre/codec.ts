/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — PAYLOAD CODECS
 *
 * O-Voxel's .vxz frames the payload with LZMA. NRE keeps the framing
 * (magic, version byte, big-endian header offset, JSON metadata, one
 * compressed chunk stream) and keeps the codec pluggable, because:
 *
 *   • Node's zlib and the browser's Web APIs ship deflate-raw and
 *     nothing else that is universal — no LZMA in either, and LZMA was
 *     not removed from the design, only made optional;
 *   • an NRE file must be readable in a browser tab with no wasm
 *     download, or the Temporal Studio is not offline-capable;
 *   • a codec it cannot run must be REFUSED BY NAME, never guessed at.
 *
 * So: `raw` (identity, deterministic, byte-exact) and `deflate-raw`
 * (universal via CompressionStream / DecompressionStream) are native,
 * and `lzma` is a known id that raises NreCodecUnavailableError until a
 * codec is registered for it — which is how an O-Voxel-written file is
 * handled honestly instead of mis-decoded.
 * ==========================================================
 */

export type NreCodecId = "raw" | "deflate-raw" | "lzma";

export interface NreCodec {
  id: NreCodecId;
  /** Human note recorded in documentation and error messages. */
  note: string;
  compress(bytes: Uint8Array): Promise<Uint8Array>;
  decompress(bytes: Uint8Array): Promise<Uint8Array>;
}

export class NreCodecUnavailableError extends Error {
  constructor(id: string) {
    super(
      `Payload codec "${id}" is not available in this runtime. Available: ${[...REGISTERED_CODECS.keys()].join(", ")}. ` +
        `Files written with an unavailable codec are refused rather than mis-decoded; register a codec for "${id}" to read them.`,
    );
    this.name = "NreCodecUnavailableError";
  }
}

/** Identity codec: largest files, byte-exact, no runtime requirements. */
export const rawCodec: NreCodec = {
  id: "raw",
  note: "Uncompressed. Deterministic and byte-exact; the reference the compressed codecs are checked against.",
  async compress(bytes) {
    return bytes.slice();
  },
  async decompress(bytes) {
    return bytes.slice();
  },
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const writer = stream.writable.getWriter();
  const reading = new Response(stream.readable).arrayBuffer();
  await writer.write(input);
  await writer.close();
  return new Uint8Array(await reading);
}

/** deflate-raw: universal (Node ≥ 18 and every current browser). */
export const deflateRawCodec: NreCodec = {
  id: "deflate-raw",
  note: "RFC 1951 deflate without a wrapper, via CompressionStream/DecompressionStream (Node ≥ 18, all current browsers).",
  async compress(bytes) {
    if (typeof CompressionStream === "undefined") throw new NreCodecUnavailableError("deflate-raw");
    return pipe(bytes, new CompressionStream("deflate-raw"));
  },
  async decompress(bytes) {
    if (typeof DecompressionStream === "undefined") throw new NreCodecUnavailableError("deflate-raw");
    return pipe(bytes, new DecompressionStream("deflate-raw"));
  },
};

const REGISTERED_CODECS = new Map<string, NreCodec>([
  ["raw", rawCodec],
  ["deflate-raw", deflateRawCodec],
]);

/** Codec ids the engine recognises even when it cannot run them. */
export const KNOWN_CODEC_IDS: readonly string[] = ["raw", "deflate-raw", "lzma"];

/** Register an additional codec (e.g. an LZMA implementation for O-Voxel interop). */
export function registerCodec(codec: NreCodec): void {
  REGISTERED_CODECS.set(codec.id, codec);
}

export function codecById(id: string): NreCodec {
  const codec = REGISTERED_CODECS.get(id);
  if (!codec) throw new NreCodecUnavailableError(id);
  return codec;
}

export function availableCodecs(): string[] {
  return [...REGISTERED_CODECS.keys()];
}
