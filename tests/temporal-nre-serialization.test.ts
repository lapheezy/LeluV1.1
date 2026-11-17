/**
 * NRE — serialisation, integrity and version handling.
 *
 * These tests exist to catch the failure that would make every other
 * NRE test meaningless: a round trip that silently drops or changes
 * numbers. Each one asserts a property of the bytes, not of the API.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONFIDENCE_CHANNEL,
  NreCodecUnavailableError,
  NreCorruptionError,
  NreFormatError,
  NreVersionError,
  SUPPORTED_INPUT_VERSIONS,
  buildSparseVoxels,
  canonicalJson,
  createGrid,
  decodeMorton,
  deserializeSnapshot,
  isStrictlyAscending,
  morton3,
  readContainerHeader,
  serializeSnapshot,
  sortByMorton,
  validateVoxels,
  withConfidence,
} from "../src/temporal/nre/index.ts";
import type { Observation, SnapshotManifest, SparseVoxels } from "../src/temporal/nre/index.ts";

const CREATED = "2026-11-17T00:00:00.000Z";

function grid(resolution = 8, cellSize = 0.1) {
  return createGrid({ cellSize, resolution: [resolution, resolution, resolution] });
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    sequence: 1,
    sourceId: "reference:front",
    sourceKind: "image",
    modality: "single-image",
    capturedAt: "2026-11-17T00:00:00.000Z",
    recordedAt: "2026-11-17T00:00:00.100Z",
    confidence: 0.65,
    provenance: {
      producer: "triposr@0.1.0",
      producerKind: "model",
      licence: "MIT (code and weights)",
      inputs: [{ id: "reference:front", sha256: "a".repeat(64) }],
      parameters: { mcResolution: 256, gridSize: 0.5 },
      notes: ["test fixture"],
    },
    representationSha256: null,
    bbox: null,
    ...overrides,
  };
}

function manifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return {
    id: "",
    state: "observed",
    createdAt: CREATED,
    observedAt: CREATED,
    confidence: 0.65,
    lineage: { objectId: "object-a", parentSnapshotId: null, sourceSnapshotIds: [], ordinal: 0 },
    transform: { id: "identity", kind: "identity", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], note: "identity" },
    observations: [observation()],
    voxelCount: 0,
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    summary: "test snapshot",
    ...overrides,
  };
}

function cubeShell(resolution = 8): SparseVoxels {
  const g = grid(resolution);
  const cells: Array<[number, number, number]> = [];
  for (let i = 1; i < resolution - 1; i++) {
    for (let j = 1; j < resolution - 1; j++) {
      for (let k = 1; k < resolution - 1; k++) {
        const shell = i === 1 || j === 1 || k === 1 || i === resolution - 2 || j === resolution - 2 || k === resolution - 2;
        if (shell) cells.push([i, j, k]);
      }
    }
  }
  return buildSparseVoxels(g, cells);
}

test("morton3 interleaves axes and decodeMorton inverts it exactly", () => {
  assert.equal(morton3(0, 0, 0), 0n);
  assert.equal(morton3(1, 0, 0), 1n);
  assert.equal(morton3(0, 1, 0), 2n);
  assert.equal(morton3(0, 0, 1), 4n);
  assert.equal(morton3(2, 0, 0), 8n);

  const points: Array<[number, number, number]> = [[0, 0, 0], [1, 2, 3], [7, 0, 5], [1023, 512, 255], [2097151, 2097150, 1]];
  for (const [x, y, z] of points) {
    assert.deepEqual(decodeMorton(morton3(x, y, z)), [x, y, z], `morton round trip failed for ${x},${y},${z}`);
  }
  assert.throws(() => morton3(2 ** 21, 0, 0), /outside the Morton domain/);
});

test("sortByMorton orders cells, merges duplicates and is strictly ascending", () => {
  const result = sortByMorton(new Int32Array([3, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0]));
  assert.equal(result.duplicates, 1, "the repeated cell must be merged, not counted twice");
  assert.equal(result.coords.length / 3, 4);
  assert.ok(isStrictlyAscending(result.morton));
  assert.deepEqual(Array.from(result.coords.slice(0, 3)), [0, 0, 0]);
});

test("serialisation round trips coordinates, grid and confidence exactly", async () => {
  const voxels = withConfidence(cubeShell(8), 0.5);
  const { bytes, manifest: stored } = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });

  assert.equal(bytes[0], 0x56);
  assert.equal(bytes[1], 0x58);
  assert.equal(bytes[2], 0x5a);
  assert.equal(bytes[3], 1);

  const loaded = await deserializeSnapshot(bytes);
  assert.equal(loaded.voxels.coords.length, voxels.coords.length);
  assert.deepEqual(Array.from(loaded.voxels.coords), Array.from(voxels.coords), "cell coordinates must be identical");
  assert.deepEqual(Array.from(loaded.voxels.morton), Array.from(voxels.morton), "Morton keys must be identical");
  assert.deepEqual(Array.from(loaded.voxels.attributes.confidence), Array.from(voxels.attributes.confidence), "confidence must be identical");
  assert.deepEqual(loaded.voxels.grid, voxels.grid, "the lattice must survive verbatim");
  assert.deepEqual(loaded.manifest.snapshot.bbox, voxels.bbox, "the spatial extent must be recomputed, not trusted");
  assert.equal(loaded.manifest.snapshot.voxelCount, voxels.coords.length / 3);
  assert.equal(stored.attributes[0].quantisation, null, "0.5 is exactly representable in f32, so no quantisation may be reported");
});

test("float64 values that cannot be stored as float32 report their measured loss", async () => {
  const voxels = withConfidence(cubeShell(6), 0.1); // 0.1 is not representable in binary32
  const { bytes, manifest: stored } = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  const loaded = await deserializeSnapshot(bytes);

  const channel = loaded.manifest.attributes.find((c) => c.name === "confidence");
  assert.ok(channel, "the confidence channel must be described in the container");
  assert.ok(channel.quantisation, "storing 0.1 as float32 is quantisation and must be disclosed");
  assert.ok(channel.quantisation.maxAbsoluteError > 0);
  assert.match(channel.quantisation.note, /largest absolute error measured/);

  const recovered = loaded.voxels.attributes.confidence[0];
  const error = Math.abs(recovered - 0.1);
  assert.ok(error <= channel.quantisation.maxAbsoluteError + 1e-15, `residual ${error} exceeds the disclosed bound`);
  assert.ok(error < 1e-7, "float32 narrowing of 0.1 should be within 1e-7");
});

test("a float64 channel survives byte-exactly when the kind is f64", async () => {
  const voxels = cubeShell(6);
  const precise = Float64Array.from({ length: voxels.coords.length / 3 }, (_, i) => Math.sin(i * 0.37) * 0.5 + 0.5);
  const withF64 = {
    ...voxels,
    channels: [{ name: "confidence", kind: "f64" as const, components: 1, quantisation: null, componentsMeaning: ["confidence"] }],
    attributes: { confidence: precise },
  };
  const { bytes } = await serializeSnapshot(manifest(), withF64, { createdAt: CREATED });
  const loaded = await deserializeSnapshot(bytes);
  assert.deepEqual(Array.from(loaded.voxels.attributes.confidence), Array.from(precise), "f64 values must round trip bit-exactly");
  assert.equal(loaded.manifest.attributes[0].quantisation, null);
});

test("provenance, confidence and observations survive the container", async () => {
  const voxels = withConfidence(cubeShell(6), 0.65);
  const { bytes, manifest: stored } = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  const loaded = await deserializeSnapshot(bytes);
  const observationOut = loaded.manifest.snapshot.observations[0];

  assert.equal(observationOut.id, "obs-1");
  assert.equal(observationOut.confidence, 0.65);
  assert.equal(observationOut.sourceKind, "image");
  assert.equal(observationOut.capturedAt, "2026-11-17T00:00:00.000Z");
  assert.equal(observationOut.provenance.producer, "triposr@0.1.0");
  assert.equal(observationOut.provenance.licence, "MIT (code and weights)");
  assert.equal(observationOut.provenance.inputs[0].sha256, "a".repeat(64));
  assert.equal(observationOut.provenance.parameters.mcResolution, 256);
  assert.equal(observationOut.representationSha256, stored.payloadRawSha256);
  assert.equal(loaded.manifest.snapshot.lineage.objectId, "object-a");
});

test("serialisation is deterministic for the same input and timestamp", async () => {
  const voxels = withConfidence(cubeShell(6), 0.4);
  const first = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  const second = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  assert.deepEqual(Array.from(first.bytes), Array.from(second.bytes), "identical inputs must produce identical bytes");
  assert.equal(first.manifest.payloadRawSha256, second.manifest.payloadRawSha256);
});

test("both codecs produce the same numbers and the same snapshot identity", async () => {
  const voxels = withConfidence(cubeShell(8), 0.4);
  const raw = await serializeSnapshot(manifest(), voxels, { codec: "raw", createdAt: CREATED });
  const deflated = await serializeSnapshot(manifest(), voxels, { codec: "deflate-raw", createdAt: CREATED });

  assert.ok(deflated.bytes.byteLength < raw.bytes.byteLength, "deflate must be smaller than the raw payload for this data");
  assert.equal(deflated.manifest.snapshot.id, raw.manifest.snapshot.id, "identity is content addressed on the uncompressed payload");

  const fromRaw = await deserializeSnapshot(raw.bytes);
  const fromDeflated = await deserializeSnapshot(deflated.bytes);
  assert.deepEqual(Array.from(fromRaw.voxels.coords), Array.from(fromDeflated.voxels.coords));
  assert.equal(fromRaw.manifest.codec, "raw");
  assert.equal(fromDeflated.manifest.codec, "deflate-raw");
});

test("an unavailable codec is refused by name instead of mis-decoded", async () => {
  // A version-0 container declaring LZMA: the codec does not exist here.
  const voxels = withConfidence(cubeShell(4), 0.5);
  const serialized = await serializeSnapshot(manifest(), voxels, { codec: "raw", createdAt: CREATED });
  const text = new TextDecoder().decode(serialized.bytes.subarray(12, 12 + 4096));
  const headerEnd = Number(new DataView(serialized.bytes.buffer, serialized.bytes.byteOffset).getBigUint64(4, false));
  const header = JSON.parse(new TextDecoder().decode(serialized.bytes.subarray(12, headerEnd))) as Record<string, unknown>;
  header.codec = "lzma";
  header.metadataSha256 = "";
  const headerBytes = new TextEncoder().encode(canonicalJson(header));
  const out = new Uint8Array(12 + headerBytes.byteLength + (serialized.bytes.byteLength - headerEnd));
  out.set(serialized.bytes.subarray(0, 3));
  out[3] = 0; // version 0 skips NRE digest verification
  new DataView(out.buffer).setBigUint64(4, BigInt(12 + headerBytes.byteLength), false);
  out.set(headerBytes, 12);
  out.set(serialized.bytes.subarray(headerEnd), 12 + headerBytes.byteLength);

  void text;
  await assert.rejects(() => deserializeSnapshot(out), (error: unknown) => {
    assert.ok(error instanceof NreCodecUnavailableError, `expected NreCodecUnavailableError, got ${String(error)}`);
    assert.match(error.message, /lzma/);
    return true;
  });
});

test("a corrupted payload byte is detected", async () => {
  const voxels = withConfidence(cubeShell(8), 0.5);
  const { bytes } = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  const damaged = bytes.slice();
  damaged[damaged.byteLength - 3] ^= 0xff;
  await assert.rejects(() => deserializeSnapshot(damaged), (error: unknown) => {
    assert.ok(error instanceof NreCorruptionError, `expected a corruption error, got ${String(error)}`);
    assert.match(error.message, /digest mismatch|truncated|Payload/);
    return true;
  });
});

test("a corrupted metadata field is detected", async () => {
  const voxels = withConfidence(cubeShell(6), 0.5);
  const { bytes } = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  const damaged = bytes.slice();
  const headerEnd = Number(new DataView(damaged.buffer, damaged.byteOffset).getBigUint64(4, false));
  const header = JSON.parse(new TextDecoder().decode(damaged.subarray(12, headerEnd))) as Record<string, unknown>;
  (header.snapshot as Record<string, unknown>).summary = "tampered";
  const target = damaged.subarray(12, headerEnd);
  const replacement = new TextEncoder().encode(canonicalJson(header));
  assert.ok(replacement.byteLength <= target.byteLength, "tampered header must fit in the original space");
  target.fill(0x20);
  target.set(replacement, 0);

  await assert.rejects(() => deserializeSnapshot(damaged), (error: unknown) => {
    assert.ok(error instanceof NreCorruptionError || error instanceof NreFormatError, `expected a metadata failure, got ${String(error)}`);
    return true;
  });
});

test("truncated files are rejected before the payload is interpreted", async () => {
  const voxels = withConfidence(cubeShell(6), 0.5);
  const { bytes } = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  await assert.rejects(() => deserializeSnapshot(bytes.subarray(0, bytes.byteLength - 8)), /digest mismatch|Payload is|declares/);
  await assert.rejects(() => deserializeSnapshot(new Uint8Array([1, 2, 3])), /too small/);
  await assert.rejects(() => deserializeSnapshot(new Uint8Array(40)), /magic VXZ/);
});

test("an unsupported schema version is refused with the supported list", async () => {
  const voxels = withConfidence(cubeShell(4), 0.5);
  const { bytes } = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  const future = bytes.slice();
  future[3] = 2;
  await assert.rejects(() => deserializeSnapshot(future), (error: unknown) => {
    assert.ok(error instanceof NreVersionError, `expected NreVersionError, got ${String(error)}`);
    assert.match(error.message, new RegExp(`supported input versions: ${SUPPORTED_INPUT_VERSIONS.join(", ")}`));
    return true;
  });
});

test("a version-0 container is migrated with absent provenance recorded as absent", async () => {
  const g = grid(6);
  const voxels = withConfidence(cubeShell(6), 0.5);
  const serialized = await serializeSnapshot(manifest(), voxels, { codec: "raw", createdAt: CREATED });
  const headerEnd = Number(new DataView(serialized.bytes.buffer, serialized.bytes.byteOffset).getBigUint64(4, false));
  const payload = serialized.bytes.subarray(headerEnd);

  const v0Header = {
    grid: g,
    attributes: serialized.manifest.attributes,
    voxelCount: serialized.manifest.voxelCount,
    chunkCount: serialized.manifest.chunkCount,
    chunkSize: serialized.manifest.chunkSize,
    payloadBytes: payload.byteLength,
    payloadRawBytes: payload.byteLength,
    codec: "raw",
    createdAt: CREATED,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(v0Header));
  const out = new Uint8Array(12 + headerBytes.byteLength + payload.byteLength);
  out.set([0x56, 0x58, 0x5a]);
  out[3] = 0;
  new DataView(out.buffer).setBigUint64(4, BigInt(12 + headerBytes.byteLength), false);
  out.set(headerBytes, 12);
  out.set(payload, 12 + headerBytes.byteLength);

  const migrated = await deserializeSnapshot(out);
  assert.equal(migrated.manifest.schemaVersion, 1, "a v0 container is presented to callers as schema version 1");
  assert.equal(migrated.manifest.snapshot.confidence, 0, "a file with no provenance must not claim confidence");
  assert.deepEqual(migrated.manifest.snapshot.observations, [], "no observations may be invented during migration");
  assert.match(migrated.manifest.snapshot.summary, /Migrated from container schema version 0/);
  assert.equal(migrated.voxels.coords.length / 3, serialized.manifest.voxelCount, "the geometry itself must survive migration");
});

test("readContainerHeader inspects metadata without decoding voxels", async () => {
  const voxels = withConfidence(cubeShell(6), 0.5);
  const { bytes } = await serializeSnapshot(manifest(), voxels, { createdAt: CREATED });
  const header = readContainerHeader(bytes);
  assert.equal(header.version, 1);
  assert.equal(header.manifest.format, "nre-vxz");
  assert.ok(header.headerEnd > 12);
});

test("validation catches out-of-lattice cells, bad ordering and malformed channels", () => {
  assert.throws(() => buildSparseVoxels(grid(4), [[4, 0, 0]]), /outside the .* lattice/);
  assert.throws(() => createGrid({ cellSize: 0, resolution: [4, 4, 4] }), /cellSize must be/);
  assert.throws(() => createGrid({ cellSize: 1, resolution: [4, 0, 4] }), /resolution must be/);

  const voxels = withConfidence(cubeShell(4), 0.5);
  assert.equal(validateVoxels(voxels).ok, true);

  const scrambled: SparseVoxels = { ...voxels, morton: BigUint64Array.from([5n, 1n, 2n, 3n, 4n, 6n, 7n, 8n]).slice(0, voxels.morton.length) };
  const report = validateVoxels(scrambled);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => /Morton order/.test(p)));

  const misaligned = { ...voxels, attributes: { confidence: new Float64Array(3) } };
  assert.ok(validateVoxels(misaligned).problems.some((p) => /holds 3 values/.test(p)));

  const outOfRange = withConfidence(cubeShell(4), 0.5);
  outOfRange.attributes.confidence[0] = 1.5;
  assert.ok(validateVoxels(outOfRange).problems.some((p) => /outside \[0,1\]/.test(p)));
});

test("serialising an invalid set is refused rather than written", async () => {
  const voxels = withConfidence(cubeShell(4), 0.5);
  const broken: SparseVoxels = { ...voxels, attributes: { confidence: new Float64Array(4) } };
  await assert.rejects(() => serializeSnapshot(manifest(), broken, { createdAt: CREATED }), NreFormatError);
});

test("the empty set serialises and round trips as empty", async () => {
  const empty = buildSparseVoxels(grid(4), []);
  const { bytes, manifest: stored } = await serializeSnapshot(manifest({ observations: [] }), empty, { createdAt: CREATED });
  const loaded = await deserializeSnapshot(bytes);
  assert.equal(loaded.manifest.voxelCount, 0);
  assert.equal(loaded.voxels.coords.length, 0);
  assert.deepEqual(loaded.manifest.snapshot.bbox, stored.snapshot.bbox);
});

test("default confidence channel is described consistently", () => {
  assert.equal(DEFAULT_CONFIDENCE_CHANNEL.name, "confidence");
  assert.equal(DEFAULT_CONFIDENCE_CHANNEL.kind, "f32");
  assert.equal(DEFAULT_CONFIDENCE_CHANNEL.components, 1);
});
