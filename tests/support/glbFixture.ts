/**
 * Builds small but genuine glTF 2.0 binaries for the Forge tests: a
 * skinned triangle bound to a 16-bone humanoid skeleton, optionally with
 * a texture and a rotation clip, optionally with broken skin weights.
 * Real bytes, so the inspector is tested against the format, not a mock.
 */

import { crc32, deflateSync } from "node:zlib";

export const HUMANOID = [
  "Hips", "Spine", "Neck", "Head",
  "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftHand", "RightHand",
  "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot",
];

/** A valid 2×2 RGB PNG (or any size), built with zlib. */
export function tinyPng(width = 2, height = 2, rgb: [number, number, number] = [200, 120, 90]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(0);
    for (let x = 0; x < width; x++) rows.push(...rgb.map((c) => (c + x * 7 + y * 13) & 0xff));
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.from(rows))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

export function buildGlb(options: { skinned?: boolean; animated?: boolean; textured?: boolean; brokenWeights?: boolean; bones?: string[] } = {}): Uint8Array {
  const bones = options.bones ?? HUMANOID;
  const parts: Buffer[] = [];
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  let length = 0;
  const push = (data: Buffer, accessor?: Record<string, unknown>) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
    parts.push(data);
    length += data.length;
    if (accessor) accessors.push({ bufferView: bufferViews.length - 1, ...accessor });
    return accessor ? accessors.length - 1 : bufferViews.length - 1;
  };
  const floats = (values: number[]) => Buffer.from(new Float32Array(values).buffer);

  const position = push(floats([0, 0, 0, 0.5, 1.7, 0, -0.5, 1.7, 0]), {
    componentType: 5126, count: 3, type: "VEC3", min: [-0.5, 0, 0], max: [0.5, 1.7, 0],
  });
  const attributes: Record<string, number> = { POSITION: position };
  if (options.skinned) {
    attributes.JOINTS_0 = push(Buffer.from([0, 1, 0, 0, 2, 3, 0, 0, 4, 5, 0, 0]), { componentType: 5121, count: 3, type: "VEC4" });
    const w = options.brokenWeights ? [0.3, 0.3, 0, 0, 0.5, 0.5, 0, 0, 0.2, 0.1, 0, 0] : [0.6, 0.4, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0];
    attributes.WEIGHTS_0 = push(floats(w), { componentType: 5126, count: 3, type: "VEC4" });
  }
  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "lelu-forge-test" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    meshes: [{ name: "body", primitives: [{ attributes, material: 0 }] }],
    materials: [{ name: "skin", pbrMetallicRoughness: options.textured ? { baseColorTexture: { index: 0 } } : {} }],
    nodes: [{ name: "Body", mesh: 0, ...(options.skinned ? { skin: 0 } : {}) }],
  };
  const nodes = gltf.nodes as Array<Record<string, unknown>>;
  if (options.skinned) {
    const jointNodes = bones.map((name, i) => {
      nodes.push({ name, ...(i === 0 ? { children: bones.slice(1).map((_, k) => k + 2) } : {}) });
      return nodes.length - 1;
    });
    const identity = Array.from({ length: bones.length }, () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).flat();
    const ibm = push(floats(identity), { componentType: 5126, count: bones.length, type: "MAT4" });
    gltf.skins = [{ name: "Armature", joints: jointNodes, inverseBindMatrices: ibm }];
  } else {
    nodes.push({ name: "Empty" });
  }
  if (options.textured) {
    const view = push(Buffer.from(tinyPng()));
    gltf.images = [{ bufferView: view, mimeType: "image/png" }];
    gltf.textures = [{ source: 0 }];
  }
  if (options.animated && options.skinned) {
    const input = push(floats([0, 1.25]), { componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1.25] });
    const output = push(floats([0, 0, 0, 1, 0, 0.38, 0, 0.92]), { componentType: 5126, count: 2, type: "VEC4" });
    gltf.animations = [{ name: "Idle", samplers: [{ input, output }], channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }] }];
  }
  gltf.accessors = accessors;
  gltf.bufferViews = bufferViews;
  const bin = Buffer.concat(parts);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  gltf.buffers = [{ byteLength: binPadded.length }];

  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
  const chunkHead = (len: number, type: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return new Uint8Array(Buffer.concat([header, chunkHead(json.length, 0x4e4f534a), json, chunkHead(binPadded.length, 0x004e4942), binPadded]));
}
