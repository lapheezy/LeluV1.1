/**
 * ==========================================================
 * LÉLU
 * VISUAL STUDY — looking at the render, not at the claim
 *
 * WP07 says a visual defect is never corrected until the
 * resulting render is examined. To examine one, the image has to
 * become numbers. This decodes a PNG and measures the silhouette
 * it actually contains:
 *
 *   coverage        how much of the frame the subject occupies
 *   bounds          where the subject starts and stops
 *   centroid        where its mass sits
 *   third profile   coverage in crown / middle / lower bands
 *   IoU             how much two renders overlap
 *
 * Everything here is a measurement of the pixels. None of it says
 * "better" — a coverage drop can be a fixed helmet or a bald spot,
 * and which one it is has to come from the geometry and the
 * measurement files. The findings therefore name what changed and
 * how much, and point at the measurement that can settle it.
 *
 * PNG decoding is injected (`inflate`) so this module stays
 * runtime-agnostic: the CLI passes zlib, a browser passes
 * DecompressionStream, and a test passes a tiny stub.
 * ==========================================================
 */

export interface RasterImage {
  width: number;
  height: number;
  /** Always RGBA, one byte per channel, row-major. */
  data: Uint8Array;
}

export type Inflate = (bytes: Uint8Array) => Uint8Array;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode an 8-bit, non-interlaced PNG into RGBA.
 *
 * Widths, heights, bit depth and colour type are read from the file
 * rather than assumed, and anything this decoder does not handle
 * (16-bit, palette, interlaced) throws with the reason — an image
 * silently decoded wrong would produce confident nonsense.
 */
export function decodePng(bytes: Uint8Array, inflate: Inflate): RasterImage {
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (bytes[index] !== SIGNATURE[index]) throw new Error("not a PNG (signature mismatch)");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error(`truncated PNG chunk ${type}`);

    if (type === "IHDR") {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, end));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4; // skip CRC
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (only 8-bit is decoded)`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`unsupported PNG colour type ${colorType}`);

  const compressed = concat(idat);
  const raw = inflate(compressed);
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) {
    throw new Error(`PNG pixel data is short: ${raw.length} bytes for ${width}x${height}x${channels}`);
  }

  const pixels = new Uint8Array(width * height * channels);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[source];
    source += 1;
    const rowStart = row * stride;
    const previousStart = rowStart - stride;
    for (let column = 0; column < stride; column += 1) {
      const value = raw[source + column];
      const left = column >= channels ? pixels[rowStart + column - channels] : 0;
      const up = row > 0 ? pixels[previousStart + column] : 0;
      const upLeft = row > 0 && column >= channels ? pixels[previousStart + column - channels] : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + Math.floor((left + up) / 2);
          break;
        case 4:
          out = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter ${filter} on row ${row}`);
      }
      pixels[rowStart + column] = out & 0xff;
    }
    source += stride;
  }

  if (channels === 4) return { width, height, data: pixels };

  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const from = index * channels;
    const to = index * 4;
    if (channels === 1) {
      rgba[to] = rgba[to + 1] = rgba[to + 2] = pixels[from];
      rgba[to + 3] = 255;
    } else if (channels === 2) {
      rgba[to] = rgba[to + 1] = rgba[to + 2] = pixels[from];
      rgba[to + 3] = pixels[from + 1];
    } else {
      rgba[to] = pixels[from];
      rgba[to + 1] = pixels[from + 1];
      rgba[to + 2] = pixels[from + 2];
      rgba[to + 3] = 255;
    }
  }
  return { width, height, data: rgba };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export interface SilhouetteMetrics {
  width: number;
  height: number;
  background: [number, number, number, number];
  /** Fraction of pixels that differ from the background. */
  coverage: number;
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
  boxWidth: number;
  boxHeight: number;
  centroid: { x: number; y: number } | null;
  /** Coverage in the upper, middle and lower third of the frame. */
  thirds: [number, number, number];
}

function pixelAt(image: RasterImage, x: number, y: number): [number, number, number, number] {
  const at = (y * image.width + x) * 4;
  return [image.data[at], image.data[at + 1], image.data[at + 2], image.data[at + 3]];
}

/**
 * Which colour is the empty background. The four corners are the
 * candidates (a subject rarely fills all of them) and the most common
 * exact value wins; ties fall back to the top-left.
 */
export function backgroundOf(image: RasterImage): [number, number, number, number] {
  const corners = [
    pixelAt(image, 0, 0),
    pixelAt(image, image.width - 1, 0),
    pixelAt(image, 0, image.height - 1),
    pixelAt(image, image.width - 1, image.height - 1),
  ];
  let best = corners[0];
  let bestCount = -1;
  for (const candidate of corners) {
    const count = corners.filter((other) => other.every((value, index) => Math.abs(value - candidate[index]) <= 2)).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function silhouette(image: RasterImage, tolerance = 12): SilhouetteMetrics {
  const background = backgroundOf(image);
  const mask = new Uint8Array(image.width * image.height);
  let covered = 0;
  let sumX = 0;
  let sumY = 0;
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;
  const band = Math.floor(image.height / 3);
  const thirds: [number, number, number] = [0, 0, 0];
  const bandCounts: [number, number, number] = [0, 0, 0];

  for (let y = 0; y < image.height; y += 1) {
    const bandIndex = band === 0 ? 0 : Math.min(2, Math.floor(y / band));
    bandCounts[bandIndex] += image.width;
    for (let x = 0; x < image.width; x += 1) {
      const [r, g, b, a] = pixelAt(image, x, y);
      const distance = Math.max(
        Math.abs(r - background[0]),
        Math.abs(g - background[1]),
        Math.abs(b - background[2]),
        Math.abs(a - background[3]),
      );
      if (a > 16 && distance > tolerance) {
        const at = y * image.width + x;
        mask[at] = 1;
        covered += 1;
        thirds[bandIndex] += 1;
        sumX += x;
        sumY += y;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }

  const total = image.width * image.height;
  return {
    width: image.width,
    height: image.height,
    background,
    coverage: total === 0 ? 0 : Number((covered / total).toFixed(4)),
    bounds: x1 >= 0 ? { x0, y0, x1, y1 } : null,
    boxWidth: x1 >= 0 ? x1 - x0 + 1 : 0,
    boxHeight: y1 >= 0 ? y1 - y0 + 1 : 0,
    centroid: covered > 0 ? { x: sumX / covered, y: sumY / covered } : null,
    thirds: [0, 1, 2].map((index) =>
      bandCounts[index] === 0 ? 0 : Number((thirds[index] / bandCounts[index]).toFixed(4)),
    ) as [number, number, number],
  };
}

export interface VisualFinding {
  kind: "silhouette-change" | "region-change" | "position-shift" | "frame-change" | "detail-change";
  severity: "info" | "medium" | "high";
  detail: string;
  /** The measurement that can settle whether the change is a defect. */
  corroborateWith: string;
}

export interface VisualComparison {
  a: string;
  b: string;
  width: number;
  height: number;
  coverageA: number;
  coverageB: number;
  coverageRelative: number;
  iou: number;
  pixelDifference: number;
  boundsDelta: { x0: number; y0: number; x1: number; y1: number } | null;
  thirdDeltas: [number, number, number];
  findings: VisualFinding[];
}

/**
 * Compare two renders of the same subject.
 *
 * The IoU is computed over the two silhouettes, so it answers "is the
 * shape the same" rather than "are the pixels the same" — different
 * lighting on identical geometry still overlaps completely, while a
 * helmet that grew does not.
 */
export function compareRenders(a: RasterImage, b: RasterImage, names: { a: string; b: string }): VisualComparison {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`renders differ in size: ${a.width}x${a.height} vs ${b.width}x${b.height}; framing must match before pixels are compared`);
  }
  const left = silhouette(a);
  const right = silhouette(b);
  const background = left.background;
  let intersection = 0;
  let union = 0;
  let changed = 0;

  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const at = (y * a.width + x) * 4;
      const inA =
        a.data[at + 3] > 16 &&
        Math.max(
          Math.abs(a.data[at] - background[0]),
          Math.abs(a.data[at + 1] - background[1]),
          Math.abs(a.data[at + 2] - background[2]),
        ) > 12;
      const inB =
        b.data[at + 3] > 16 &&
        Math.max(
          Math.abs(b.data[at] - background[0]),
          Math.abs(b.data[at + 1] - background[1]),
          Math.abs(b.data[at + 2] - background[2]),
        ) > 12;
      if (inA && inB) intersection += 1;
      if (inA || inB) union += 1;
      if (Math.abs(a.data[at] - b.data[at]) + Math.abs(a.data[at + 1] - b.data[at + 1]) + Math.abs(a.data[at + 2] - b.data[at + 2]) > 24) {
        changed += 1;
      }
    }
  }

  const coverageRelative = left.coverage === 0 ? (right.coverage === 0 ? 0 : 1) : (right.coverage - left.coverage) / left.coverage;
  const thirdDeltas: [number, number, number] = [0, 1, 2].map((index) =>
    Number((right.thirds[index] - left.thirds[index]).toFixed(4)),
  ) as [number, number, number];
  const boundsDelta =
    left.bounds && right.bounds
      ? {
          x0: right.bounds.x0 - left.bounds.x0,
          y0: right.bounds.y0 - left.bounds.y0,
          x1: right.bounds.x1 - left.bounds.x1,
          y1: right.bounds.y1 - left.bounds.y1,
        }
      : null;

  const findings: VisualFinding[] = [];
  if (Math.abs(coverageRelative) >= 0.15) {
    findings.push({
      kind: "silhouette-change",
      severity: Math.abs(coverageRelative) >= 0.3 ? "high" : "medium",
      detail: `silhouette coverage moved ${(coverageRelative * 100).toFixed(1)}% (${(left.coverage * 100).toFixed(2)}% → ${(right.coverage * 100).toFixed(2)}% of frame)`,
      corroborateWith: "hair/strand counts and per-region occupancy in the geometry metrics",
    });
  }
  const regionNames = ["crown / upper third", "middle third", "lower third"];
  thirdDeltas.forEach((delta, index) => {
    if (Math.abs(delta) >= 0.05) {
      findings.push({
        kind: "region-change",
        severity: Math.abs(delta) >= 0.1 ? "high" : "medium",
        detail: `${regionNames[index]} coverage ${delta > 0 ? "rose" : "fell"} ${(Math.abs(delta) * 100).toFixed(1)} percentage points`,
        corroborateWith: "strand roots in that region and the root-clearance report",
      });
    }
  });
  if (boundsDelta && (Math.abs(boundsDelta.x0) > 2 || Math.abs(boundsDelta.y0) > 2 || Math.abs(boundsDelta.x1) > 2 || Math.abs(boundsDelta.y1) > 2)) {
    findings.push({
      kind: "frame-change",
      severity: "medium",
      detail: `silhouette bounds moved by (${boundsDelta.x0}, ${boundsDelta.y0}) → (${boundsDelta.x1}, ${boundsDelta.y1}) px`,
      corroborateWith: "the shared cameras.json — a bounds change with identical framing is geometry, not camera",
    });
  }
  const centroidShift =
    left.centroid && right.centroid
      ? Math.hypot(right.centroid.x - left.centroid.x, right.centroid.y - left.centroid.y)
      : 0;
  if (centroidShift > a.width * 0.02) {
    findings.push({
      kind: "position-shift",
      severity: "medium",
      detail: `subject centroid moved ${centroidShift.toFixed(1)} px (${((centroidShift / a.width) * 100).toFixed(1)}% of frame width)`,
      corroborateWith: "root positions and the head-mesh transform",
    });
  }
  if (findings.length === 0) {
    findings.push({
      kind: "detail-change",
      severity: "info",
      detail: `silhouette is stable; ${(changed / (a.width * a.height) * 100).toFixed(1)}% of pixels differ (detail only)`,
      corroborateWith: "nothing — the shape did not change",
    });
  }

  return {
    a: names.a,
    b: names.b,
    width: a.width,
    height: a.height,
    coverageA: Number(left.coverage.toFixed(4)),
    coverageB: Number(right.coverage.toFixed(4)),
    coverageRelative: Number(coverageRelative.toFixed(4)),
    iou: union === 0 ? 0 : Number((intersection / union).toFixed(4)),
    pixelDifference: Number((changed / (a.width * a.height)).toFixed(4)),
    boundsDelta,
    thirdDeltas,
    findings,
  };
}
