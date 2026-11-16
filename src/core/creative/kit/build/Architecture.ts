/**
 * LÉLU — BUILD ENGINE: architecture (a bay-framed cabin)
 *
 * A parametric cabin: width, depth, bay count, storeys, roof pitch and
 * overhang are the inputs. Columns land on the bay divisions, the window
 * count follows the bays and storeys, the roof rise follows the pitch, and
 * the wall panels fill between the columns — so changing the bay count
 * re-frames the whole building rather than stretching one wall.
 *
 * Dimensions are approximate construction geometry, not a building design.
 */

import {
  part,
  sceneOf,
  layersOf,
  num,
  validateParams,
  type BuildOutcome,
  type BuildPart,
  type BuildProgram,
  type ParamSpec,
} from "./BuildTypes";

const LAYERS = [
  { id: "foundation", label: "Foundation", color: "#8a8f98", note: "The slab and its edge beams take the load to the ground." },
  { id: "structure", label: "Structure", color: "#b7a58c", note: "Posts on the bay grid carry the roof; beams tie them together." },
  { id: "walls", label: "Walls", color: "#d8c08c", note: "Panels fill between the posts, with the door in the middle bay." },
  { id: "glazing", label: "Glazing", color: "#7ec8e3", note: "One window per bay per storey." },
  { id: "roof", label: "Roof", color: "#7a5230", note: "A pitched roof: rise follows the pitch, span follows the depth." },
  { id: "interior", label: "Interior", color: "#c2cbd6", note: "Stair and partition, once there is more than one storey." },
];

const STOREY_HEIGHT = 2.6;

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "width", label: "Width", kind: "number", value: has("width") ? Number(input?.width) : 6, min: 3, max: 12, step: 0.5, unit: "m", affects: "Bay spacing, post count and the roof span." },
    { key: "depth", label: "Depth", kind: "number", value: has("depth") ? Number(input?.depth) : 4.5, min: 2.5, max: 9, step: 0.5, unit: "m", affects: "Side wall length and the roof's slope length." },
    { key: "bays", label: "Bays", kind: "number", value: has("bays") ? Number(input?.bays) : 3, min: 1, max: 5, step: 1, affects: "Number of posts, window columns and their spacing." },
    { key: "storeys", label: "Storeys", kind: "number", value: has("storeys") ? Number(input?.storeys) : 1, min: 1, max: 3, step: 1, affects: "Wall height, window rows, the stair and the total floor area." },
    { key: "roofPitch", label: "Roof pitch", kind: "number", value: has("roofPitch") ? Number(input?.roofPitch) : 25, min: 5, max: 45, step: 1, unit: "°", affects: "Roof rise and the height of the ridge." },
    { key: "overhang", label: "Overhang", kind: "number", value: has("overhang") ? Number(input?.overhang) : 0.4, min: 0, max: 1.2, step: 0.1, unit: "m", affects: "How far the roof reaches past the walls." },
  ];
}

export function buildCabin(input: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs();
  const { values, rejected } = validateParams(specs, input);
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };
  const width = num(values, "width", 6);
  const depth = num(values, "depth", 4.5);
  const bays = Math.round(num(values, "bays", 3));
  const storeys = Math.round(num(values, "storeys", 1));
  const pitch = num(values, "roofPitch", 25);
  const overhang = num(values, "overhang", 0.4);

  const height = STOREY_HEIGHT * storeys;
  const baySpacing = width / bays;
  const postX = Array.from({ length: bays + 1 }, (_, i) => -width / 2 + i * baySpacing);
  const pitchRad = (pitch * Math.PI) / 180;
  const rise = Math.tan(pitchRad) * (depth / 2);
  const slopeLength = (depth / 2 + overhang) / Math.cos(pitchRad);
  const windows = bays * storeys;
  const floorArea = width * depth * storeys;
  const wallThickness = 0.12;

  const parts: BuildPart[] = [];

  // ---- Foundation -----------------------------------------------------
  parts.push(
    part({
      id: "slab",
      name: "Floor slab",
      layer: "foundation",
      shape: "box",
      size: { width: width + 0.6, height: 0.15, depth: depth + 0.6 },
      position: [0, 0.075, 0],
      color: "#9aa0a8",
      metalness: 0.1,
      roughness: 0.9,
      label: [width / 2 + 0.1, 0.08, depth / 2],
      explode: [0, -0.9, 0],
      note: "The slab everything is set out from.",
    }),
    part({
      id: "edge-beam",
      name: "Edge beam",
      layer: "foundation",
      shape: "box",
      size: { width: width + 0.8, height: 0.12, depth: depth + 0.8 },
      position: [0, 0.02, 0],
      color: "#828892",
      metalness: 0.1,
      roughness: 0.9,
      label: [-width / 2 - 0.2, 0.03, -depth / 2],
      explode: [0, -1.2, 0],
      note: "Carries the perimeter load and holds the posts in line.",
    }),
  );

  // ---- Structure ------------------------------------------------------
  const postHeight = height;
  for (const [side, z] of [["front", depth / 2], ["back", -depth / 2]] as Array<[string, number]>) {
    postX.forEach((x, i) => {
      parts.push(
        part({
          id: `post-${side}-${i + 1}`,
          name: `Post ${side} ${i + 1}`,
          layer: "structure",
          shape: "box",
          size: { width: 0.14, height: postHeight, depth: 0.14 },
          position: [x, 0.15 + postHeight / 2, z],
          color: "#b7a58c",
          metalness: 0.15,
          roughness: 0.75,
          label: [x, 0.15 + postHeight + 0.12, z],
          explode: [x * 0.35, 0.2, z * 1.6],
          note: "A post on the bay grid: bay count is the structural rhythm.",
        }),
      );
    });
  }
  for (const z of [depth / 2, -depth / 2]) {
    parts.push(
      part({
        id: `top-beam-${z > 0 ? "front" : "back"}`,
        name: `Top beam (${z > 0 ? "front" : "rear"})`,
        layer: "structure",
        shape: "box",
        size: { width: width + 0.28, height: 0.16, depth: 0.1 },
        position: [0, 0.15 + height - 0.08, z],
        color: "#a89274",
        metalness: 0.15,
        roughness: 0.7,
        label: [width * 0.36, 0.15 + height + 0.04, z],
        explode: [0, 0.5, z * 1.8],
        note: "Ties the posts and carries the roof plates.",
      }),
    );
  }

  // ---- Walls ----------------------------------------------------------
  parts.push(
    part({
      id: "wall-back",
      name: "Back wall",
      layer: "walls",
      shape: "box",
      size: { width, height, depth: wallThickness },
      position: [0, 0.15 + height / 2, -depth / 2],
      color: "#d8c08c",
      metalness: 0.05,
      roughness: 0.9,
      label: [0, 0.15 + height + 0.05, -depth / 2],
      explode: [0, 0.1, -1.4],
      note: "The solid wall of the cabin.",
    }),
    part({
      id: "wall-left",
      name: "Side wall (west)",
      layer: "walls",
      shape: "box",
      size: { width: wallThickness, height, depth },
      position: [-width / 2, 0.15 + height / 2, 0],
      color: "#d1b882",
      metalness: 0.05,
      roughness: 0.9,
      label: [-width / 2 - 0.1, 0.15 + height * 0.8, depth * 0.35],
      explode: [-1.4, 0.1, 0],
      note: "The gable-side wall.",
    }),
    part({
      id: "wall-right",
      name: "Side wall (east)",
      layer: "walls",
      shape: "box",
      size: { width: wallThickness, height, depth },
      position: [width / 2, 0.15 + height / 2, 0],
      color: "#d1b882",
      metalness: 0.05,
      roughness: 0.9,
      label: [width / 2 + 0.1, 0.15 + height * 0.8, depth * 0.35],
      explode: [1.4, 0.1, 0],
      note: "The other gable-side wall.",
    }),
  );

  // Front: a door in the middle bay, a panel in every other bay.
  const doorBay = Math.floor(bays / 2);
  postX.slice(0, -1).forEach((x, i) => {
    const w = baySpacing - 0.18;
    const cx = x + baySpacing / 2;
    const isDoor = i === doorBay;
    const panelHeight = isDoor ? 2.1 : height;
    const y = isDoor ? 0.15 + panelHeight / 2 : 0.15 + height / 2;
    parts.push(
      part({
        id: isDoor ? "door" : `wall-front-${i + 1}`,
        name: isDoor ? "Door" : `Front panel ${i + 1}`,
        layer: "walls",
        shape: "box",
        size: { width: isDoor ? 0.95 : w, height: panelHeight, depth: wallThickness },
        position: [cx, y, depth / 2],
        color: isDoor ? "#6e5136" : "#d8c08c",
        metalness: 0.05,
        roughness: isDoor ? 0.6 : 0.9,
        label: [cx, y + panelHeight / 2 + 0.08, depth / 2],
        explode: [0, 0.1, 1.6],
        note: isDoor ? "The entrance, in the middle bay." : "A panel between two posts.",
      }),
    );
  });

  // ---- Glazing --------------------------------------------------------
  for (let storey = 0; storey < storeys; storey += 1) {
    postX.slice(0, -1).forEach((x, i) => {
      const cx = x + baySpacing / 2;
      const isDoor = i === doorBay && storey === 0;
      const y = 0.15 + storey * STOREY_HEIGHT + (isDoor ? 1.62 : 1.5);
      const h = isDoor ? 0.9 : 1.1;
      parts.push(
        part({
          id: `window-${storey + 1}-${i + 1}`,
          name: `Window ${storey + 1}.${i + 1}`,
          layer: "glazing",
          shape: "box",
          size: { width: Math.max(0.6, baySpacing - 0.7), height: h, depth: 0.05 },
          position: [cx, y, depth / 2 + 0.02],
          color: "#7ec8e3",
          metalness: 0.2,
          roughness: 0.1,
          opacity: 0.4,
          label: [cx, y + h / 2 + 0.08, depth / 2 + 0.1],
          explode: [0, 0.05, 1.9],
          note: "One window per bay per storey — the count follows the grid.",
        }),
      );
    });
  }

  // ---- Roof -----------------------------------------------------------
  for (const side of [1, -1] as const) {
    parts.push(
      part({
        id: `roof-${side > 0 ? "front" : "back"}`,
        name: `Roof plate (${side > 0 ? "front" : "rear"})`,
        layer: "roof",
        shape: "box",
        size: { width: width + overhang * 2, height: 0.1, depth: slopeLength },
        position: [0, 0.15 + height + rise / 2, side * (depth / 4 + overhang / 2)],
        rotation: [side * pitch, 0, 0],
        color: "#7a5230",
        metalness: 0.1,
        roughness: 0.85,
        label: [width * 0.3, 0.15 + height + rise + 0.12, side * depth * 0.3],
        explode: [0, 1.1, side * 1.2],
        note: `Pitched at ${pitch}°: the ridge ${(0.15 + height + rise).toFixed(2)} m above the slab.`,
      }),
    );
  }
  parts.push(
    part({
      id: "ridge",
      name: "Ridge beam",
      layer: "roof",
      shape: "box",
      size: { width: width + overhang * 2, height: 0.12, depth: 0.12 },
      position: [0, 0.15 + height + rise + 0.04, 0],
      color: "#66452a",
      metalness: 0.1,
      roughness: 0.8,
      label: [0, 0.15 + height + rise + 0.16, 0],
      explode: [0, 1.4, 0],
      note: "Where the two roof plates meet.",
    }),
  );

  // ---- Interior -------------------------------------------------------
  if (storeys > 1) {
    for (let i = 0; i < 6; i += 1) {
      parts.push(
        part({
          id: `stair-${i + 1}`,
          name: `Stair tread ${i + 1}`,
          layer: "interior",
          shape: "box",
          size: { width: 0.9, height: 0.05, depth: 0.24 },
          position: [-width / 2 + 1 + i * 0.24, 0.15 + 0.18 + i * 0.36, -depth / 2 + 0.9],
          color: "#c2cbd6",
          metalness: 0.1,
          roughness: 0.8,
          label: [-width / 2 + 1 + i * 0.24, 0.2 + i * 0.36, -depth / 2 + 0.9],
          explode: [0, 0.3, -0.8],
          note: "One tread of the stair to the upper floor.",
        }),
      );
    }
  }
  parts.push(
    part({
      id: "partition",
      name: "Partition",
      layer: "interior",
      shape: "box",
      size: { width: 0.08, height: height - 0.2, depth: depth * 0.5 },
      position: [width * 0.12, 0.15 + (height - 0.2) / 2, -depth * 0.22],
      color: "#d7dbe2",
      metalness: 0.05,
      roughness: 0.9,
      label: [width * 0.12, 0.15 + height * 0.7, -depth * 0.22],
      explode: [0.6, 0.2, -0.6],
      note: "Divides the plan without touching the frame.",
    }),
  );

  const program: BuildProgram = {
    kind: "build",
    builder: "cabin",
    domain: "architecture",
    title: title ?? `${bays}-bay cabin — ${width} × ${depth} m`,
    params: values,
    paramSpecs: specs.map((spec) => ({ ...spec, value: values[spec.key] })),
    parts,
    layers: layersOf(LAYERS, parts),
    steps: [
      { id: "setout", name: "1 · Set out", summary: `${bays} bays at ${baySpacing.toFixed(2)} m`, detail: `The slab is divided into ${bays} bays of ${baySpacing.toFixed(2)} m; every post lands on a division.`, focus: ["slab", "post-front-1"] },
      { id: "frame", name: "2 · Frame", summary: "Posts and top beams", detail: `Two rows of ${bays + 1} posts carry the roof beams at ${(0.15 + height).toFixed(2)} m.`, focus: ["post-front-1", "top-beam-front"] },
      { id: "envelope", name: "3 · Envelope", summary: "Walls and the door", detail: "Back and side walls close the volume; the front is panelled between posts with the door in the middle bay.", focus: ["wall-back", "door"] },
      { id: "glazing", name: "4 · Glazing", summary: `${windows} windows`, detail: `One window per bay per storey gives ${windows} openings at ${bays} × ${storeys}.`, focus: ["window-1-1"] },
      { id: "roof", name: "5 · Roof", summary: `${pitch}° pitch, ${rise.toFixed(2)} m rise`, detail: `Each plate spans ${slopeLength.toFixed(2)} m up the slope to a ridge ${(0.15 + height + rise).toFixed(2)} m above the slab.`, focus: ["roof-front", "ridge"] },
      { id: "inside", name: "6 · Inside", summary: storeys > 1 ? "Stair and partition" : "Partition only", detail: storeys > 1 ? "One storey means a stair is needed; the partition divides the plan." : "With a single storey there is no stair, only the partition.", focus: ["partition"] },
    ],
    derived: [
      { label: "Footprint", value: `${width} × ${depth} m` },
      { label: "Floor area", value: `${floorArea.toFixed(1)} m²` },
      { label: "Bay spacing", value: `${baySpacing.toFixed(2)} m` },
      { label: "Roof rise", value: `${rise.toFixed(2)} m` },
      { label: "Ridge height", value: `${(0.15 + height + rise).toFixed(2)} m` },
      { label: "Windows", value: `${windows}` },
    ],
    scene: sceneOf(parts, {
      camera: { position: [width * 1.05, 0.15 + height + rise + 2.4, depth * 2.3], target: [0, 0.15 + height * 0.5, 0], fov: 42 },
      seed: 8213,
      preset: "cabin",
    }),
    notes: [
      "Bay count drives the frame: posts land on the divisions, windows follow the bays, and the wall panels fill between them.",
      `Roof geometry follows the pitch: rise = tan(${pitch}°) × depth/2 = ${rise.toFixed(2)} m.`,
      "This is construction geometry for explaining the structure — not a building design, and not checked against any code.",
    ],
  };
  return { ok: true, program, rejected };
}

export const cabinBuilder = {
  id: "cabin",
  domain: "architecture" as const,
  label: "Bay-framed cabin",
  keywords: ["cabin", "house", "building", "pavilion", "shed", "studio building"],
  paramSpecs,
  build: buildCabin,
};

export function describeCabinRequest(textInput: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const storeys = /\b(\d)\s*(?:-|\s)?(?:storey|storeys|story|stories|floor|floors)\b/i.exec(textInput);
  if (storeys) out.storeys = Number(storeys[1]);
  const bays = /\b(\d)\s*(?:-|\s)?bays?\b/i.exec(textInput);
  if (bays) out.bays = Number(bays[1]);
  const size = /\b(\d+(?:\.\d+)?)\s*(?:m\s*)?(?:by|x|×)\s*(\d+(?:\.\d+)?)\s*m?\b/i.exec(textInput);
  if (size) {
    out.width = Number(size[1]);
    out.depth = Number(size[2]);
  }
  return out;
}
