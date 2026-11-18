/**
 * ==========================================================
 * LÉLU ASRE — CC0 REFERENCE ASSET PARSERS
 *
 * MakeHuman's data format, read without MakeHuman: OBJ meshes with their
 * joint vertex groups, `.target` morph targets, `.mhw` skin weights and
 * `.mhclo` garment mappings.
 *
 * All of this is CC0 (Data Collection AB / Joel Palmius / Jonas Hauquier,
 * explicit CC0 release September 2020). The parsers are ours; see
 * docs/asre/10_MISSION58_WP03_REFERENCE.md for the licence audit.
 *
 * Pure functions, no I/O: the Node loader (scripts/asre/load-cc0-anatomy.ts)
 * reads the files, the browser path can receive the same data baked.
 * ==========================================================
 */

export interface RefMesh {
  /** xyz triplets, metres, in the mesh's own frame. */
  positions: Float32Array;
  /** Triangle triplets. */
  indices: Uint32Array;
  /** Named vertex groups (e.g. `joint-l-finger-1-1`) → vertex indices. */
  groups: Map<string, number[]>;
  /** Named groups → the triangles declared under them (indices into `indices`, i.e. 3 per face). */
  groupFaces: Map<string, number[]>;
}

/**
 * Parse a Wavefront OBJ that MakeHuman writes: `v`, `f`, `g`. Faces may be
 * polygons and carry `v/vt/vn` triples — only the vertex index is used, and
 * polygons are fanned into triangles.
 */
export function parseObj(text: string): RefMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const groups = new Map<string, number[]>();
  const groupFaces = new Map<string, number[]>();
  let current: number[] | null = null;
  let currentFaces: number[] | null = null;
  let currentName = "";
  let vbase = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    if (line[0] === "v" && line[1] === " ") {
      const p = line.slice(2).trim().split(/\s+/);
      positions.push(+p[0], +p[1], +p[2]);
      vbase++;
    } else if (line[0] === "g" && (line.length === 1 || line[1] === " ")) {
      const name = line.slice(1).trim();
      current = [];
      currentFaces = [];
      currentName = name;
      groups.set(name, current);
      groupFaces.set(name, currentFaces);
    } else if (line[0] === "o" && line[1] === " ") {
      current = null;
      currentFaces = null;
    } else if (line[0] === "f" && line[1] === " ") {
      const toks = line.slice(2).trim().split(/\s+/);
      const verts = toks.map((t) => {
        const i = parseInt(t.split("/")[0], 10);
        return i < 0 ? vbase + i : i - 1;
      });
      if (current) current.push(...verts);
      for (let k = 2; k < verts.length; k++) {
        indices.push(verts[0], verts[k - 1], verts[k]);
        currentFaces?.push(indices.length - 3, indices.length - 2, indices.length - 1);
      }
      if (currentFaces && !currentName) currentFaces = null;
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), groups, groupFaces };
}

export interface Target {
  /** Vertex indices this target moves. */
  indices: Int32Array;
  /** Parallel xyz deltas (mesh units). */
  deltas: Float32Array;
}

/** Parse a `.target` morph: one `index dx dy dz` per line, `#` comments. */
export function parseTarget(text: string): Target {
  const idx: number[] = [];
  const d: number[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const t = line.split(/\s+/);
    if (t.length < 4) continue;
    const i = parseInt(t[0], 10);
    const dx = +t[1], dy = +t[2], dz = +t[3];
    if (!Number.isFinite(i) || !Number.isFinite(dx + dy + dz)) continue;
    idx.push(i);
    d.push(dx, dy, dz);
  }
  return { indices: Int32Array.from(idx), deltas: Float32Array.from(d) };
}

/** Add `weight ×` a morph target to positions (in place, mesh units). */
export function applyTarget(positions: Float32Array, t: Target, weight = 1): void {
  for (let k = 0; k < t.indices.length; k++) {
    const i = t.indices[k] * 3;
    if (i + 2 >= positions.length) continue;
    positions[i] += t.deltas[3 * k] * weight;
    positions[i + 1] += t.deltas[3 * k + 1] * weight;
    positions[i + 2] += t.deltas[3 * k + 2] * weight;
  }
}

/**
 * Parse `.mhw` skin weights: `{ "weights": { "<bone>": [[vertex, weight], …] } }`.
 * Returns, per vertex, the (bone, weight) pairs — the inverse index, which is
 * what linear blend skinning needs.
 */
export function parseWeights(text: string, boneNames?: string[]): { bones: string[]; perVertex: Array<Array<[number, number]>>; count: number } {
  const json = JSON.parse(text) as { weights: Record<string, Array<[number, number]>> };
  const bones = Object.keys(json.weights).sort();
  if (boneNames) for (const b of boneNames) if (!bones.includes(b)) bones.push(b);
  let maxV = 0;
  for (const b of bones) for (const [v] of json.weights[b] ?? []) if (v > maxV) maxV = v;
  const perVertex: Array<Array<[number, number]>> = Array.from({ length: maxV + 1 }, () => []);
  bones.forEach((b, bi) => {
    for (const [v, w] of json.weights[b] ?? []) if (w > 1e-5) perVertex[v]?.push([bi, w]);
  });
  // normalise: MakeHuman weights do not always sum to 1 per vertex
  for (const list of perVertex) {
    let s = 0;
    for (const [, w] of list) s += w;
    if (s > 1e-6 && Math.abs(s - 1) > 1e-3) for (const e of list) e[1] /= s;
  }
  return { bones, perVertex, count: maxV + 1 };
}

/** One `.mhclo` vertex: which base triangle it sticks to, and where on it. */
export interface MhcloVertex {
  /** Indices into the base mesh vertices. */
  tri: [number, number, number];
  /** Barycentric weights for that triangle. */
  bary: [number, number, number];
  /** Small offset along the base normal, in mesh units. */
  offset: [number, number, number];
}

export interface Mhclo {
  name: string;
  objFile: string;
  material: string | null;
  hasUv: boolean;
  verts: MhcloVertex[];
}

/**
 * Parse a `.mhclo` garment: a header of `key value` lines, then one line per
 * garment vertex: `vidx v1 v2 v3 w1 w2 w3 ox oy oz`. That is the actual
 * garment construction MakeHuman ships — how a garment vertex is bound to the
 * body surface. Applying it to a body gives a fitted garment, not a shell.
 */
export function parseMhclo(text: string): Mhclo {
  const out: Mhclo = { name: "", objFile: "", material: null, hasUv: false, verts: [] };
  let inVerts = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const t = line.split(/\s+/);
    if (!inVerts) {
      switch (t[0]) {
        case "name": out.name = t.slice(1).join(" "); break;
        case "obj_file": out.objFile = t[1]; break;
        case "material": out.material = t[1]; break;
        case "has_uv": out.hasUv = t[1] === "1" || t[1] === "true"; break;
        case "verts": inVerts = true; break;
        default: break;
      }
      continue;
    }
    // Two dialects in the wild: `vidx v1 v2 v3 w1 w2 w3 ox oy oz` (10 tokens,
    // garments) and `v1 v2 v3 w1 w2 w3 ox oy oz` (9 tokens, eyes/teeth/hair).
    // The vertex order is the OBJ's own, so the leading index is redundant.
    const o = t.length >= 10 ? 1 : 0;
    if (t.length < o + 9) continue;
    const tri: [number, number, number] = [parseInt(t[o], 10), parseInt(t[o + 1], 10), parseInt(t[o + 2], 10)];
    const bary: [number, number, number] = [+t[o + 3], +t[o + 4], +t[o + 5]];
    const offset: [number, number, number] = [+t[o + 6], +t[o + 7], +t[o + 8]];
    if (tri.some((v) => !Number.isFinite(v)) || bary.some((v) => !Number.isFinite(v))) continue;
    out.verts.push({ tri, bary, offset });
  }
  return out;
}
