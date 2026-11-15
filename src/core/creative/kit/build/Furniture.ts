/**
 * LÉLU — BUILD ENGINE: furniture
 *
 * A chair is not a box with legs drawn on it: the seat height, the leg
 * positions, the back rake and the shelf spacing all come from the
 * dimensions, so asking for a taller stool moves the seat and lengthens the
 * legs together.
 *
 * Every piece is the same assembly — a frame, a bearing surface and whatever
 * that kind of furniture adds — so a chair, a table and a shelf share one
 * builder and one parameter surface. Each part is labelled and separately
 * explodable, which is what makes a seat extractable as its own object.
 *
 * This is a geometric and parametrically editable model. Joinery is drawn as
 * solid joints; it is NOT a strength-validated or manufacturing-ready design,
 * and no claim is made that a table built here will carry a stated load.
 */

import { part, sceneOf, layersOf, num, text, validateParams, type BuildOutcome, type BuildPart, type ParamSpec } from "./BuildTypes";

const KINDS = ["chair", "table", "desk", "shelf", "bed", "sofa", "cabinet"] as const;
type Kind = (typeof KINDS)[number];

const LAYERS = [
  { id: "frame", label: "Frame", color: "#8a8f98", note: "The structure that carries everything else." },
  { id: "top", label: "Bearing surface", color: "#c99a6a", note: "Seat, table top or shelf boards — what things rest on." },
  { id: "back", label: "Back", color: "#a97e52", note: "Where a seat supports the spine." },
  { id: "legs", label: "Legs", color: "#6f757e", note: "The four (or six) points that meet the floor." },
  { id: "soft", label: "Upholstery", color: "#b98cff", note: "Cushions and padding, where the piece has them." },
  { id: "storage", label: "Storage", color: "#67e8f9", note: "Drawers, doors and the carcass that holds them." },
];

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "kind", label: "Piece", kind: "choice", value: has("kind") ? String(input?.kind) : "chair", choices: [...KINDS], affects: "Which assembly is built and which parts exist." },
    { key: "width", label: "Width", kind: "number", value: has("width") ? Number(input?.width) : 0.46, min: 0.3, max: 2.4, step: 0.01, unit: "m", affects: "Seat/top width and how far apart the legs stand." },
    { key: "depth", label: "Depth", kind: "number", value: has("depth") ? Number(input?.depth) : 0.48, min: 0.3, max: 1.2, step: 0.01, unit: "m", affects: "Seat/top depth, front-to-back leg spacing, drawer depth." },
    { key: "height", label: "Height", kind: "number", value: has("height") ? Number(input?.height) : 0.86, min: 0.3, max: 2.2, step: 0.01, unit: "m", affects: "Overall height and the leg length." },
    { key: "seatHeight", label: "Seat height", kind: "number", value: has("seatHeight") ? Number(input?.seatHeight) : 0.45, min: 0.28, max: 1.1, step: 0.01, unit: "m", affects: "Where the bearing surface sits and how long the legs are." },
    { key: "material", label: "Material", kind: "choice", value: has("material") ? String(input?.material) : "oak", choices: ["oak", "walnut", "birch", "steel", "upholstered"], affects: "Colour and surface of every part." },
  ];
}

const MATERIALS: Record<string, { color: string; metalness: number; roughness: number }> = {
  oak: { color: "#c99a6a", metalness: 0.05, roughness: 0.7 },
  walnut: { color: "#7d5236", metalness: 0.05, roughness: 0.65 },
  birch: { color: "#e0c9a6", metalness: 0.05, roughness: 0.7 },
  steel: { color: "#9aa3ad", metalness: 0.75, roughness: 0.35 },
  upholstered: { color: "#8b6bd6", metalness: 0.02, roughness: 0.9 },
};

export function buildFurniture(input?: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs(input);
  const { values, rejected } = validateParams(specs, input);
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };

  const kind = text(values, "kind", "chair") as Kind;
  const width = num(values, "width", 0.46);
  const depth = num(values, "depth", 0.48);
  const height = num(values, "height", 0.86);
  let seatHeight = num(values, "seatHeight", 0.45);
  const finish = MATERIALS[text(values, "material", "oak")] ?? MATERIALS.oak;

  const parts: BuildPart[] = [];
  const wood = finish.color;
  const frameColor = "#6f757e";
  const leg = 0.032;
  const inset = 0.04;
  const legAt = (sx: number, sz: number, length: number, id = `leg-${sx > 0 ? "right" : "left"}-${sz > 0 ? "front" : "back"}`, y = length / 2): BuildPart =>
    part({
      id,
      name: `Leg (${sx > 0 ? "right" : "left"} ${sz > 0 ? "front" : "back"})`,
      layer: "legs",
      shape: "box",
      size: { width: leg, height: length, depth: leg },
      position: [sx * (width / 2 - inset), y, sz * (depth / 2 - inset)],
      color: frameColor,
      metalness: finish.metalness,
      roughness: finish.roughness,
      explode: [sx * 0.06, -length * 0.12, sz * 0.06],
      note: `${(length * 100).toFixed(0)} cm long; it is what meets the floor.`,
    });

  /* The bearing surface: every kind has one. */
  const isShelf = kind === "shelf" || kind === "cabinet";
  const surfaceThickness = kind === "table" || kind === "desk" ? 0.035 : 0.045;
  seatHeight = kind === "bed" ? Math.min(0.5, Math.max(0.32, seatHeight * 0.86)) : seatHeight;
  const surfaceY = kind === "shelf" ? height * 0.62 : seatHeight;

  parts.push(
    part({
      id: "surface",
      name: kind === "table" || kind === "desk" ? "Table top" : kind === "bed" ? "Mattress platform" : kind === "shelf" || kind === "cabinet" ? "Shelf" : "Seat",
      layer: "top",
      shape: "box",
      size: { width, height: surfaceThickness, depth },
      position: [0, surfaceY, 0],
      color: wood,
      metalness: finish.metalness,
      roughness: finish.roughness,
      explode: [0, 0.08, 0],
      note: `${(width * 100).toFixed(0)} × ${(depth * 100).toFixed(0)} cm bearing surface at ${(surfaceY * 100).toFixed(0)} cm.`,
    }),
  );

  /* Legs: four for almost everything, six under a long table or a sofa. */
  const legLength = kind === "shelf" || kind === "cabinet" ? surfaceY - surfaceThickness / 2 - 0.02 : surfaceY - surfaceThickness / 2;
  const longRun = width > 1.5;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      parts.push(legAt(sx, sz, Math.max(0.08, legLength)));
    }
  }
  if (longRun) {
    for (const sz of [-1, 1] as const) {
      parts.push(legAt(0, sz, Math.max(0.08, legLength), `leg-${sz > 0 ? "front" : "back"}-mid`));
    }
  }

  /* Back: chairs, sofas and beds have one; tables and shelves do not. */
  const hasBack = kind === "chair" || kind === "sofa" || kind === "bed";
  if (hasBack) {
    const backHeight = Math.max(0.18, height - seatHeight);
    parts.push(
      part({
        id: "back",
        name: kind === "bed" ? "Headboard" : "Back",
        layer: "back",
        shape: "box",
        size: { width: kind === "bed" ? width : width * 0.94, height: backHeight, depth: 0.04 },
        position: [0, seatHeight + backHeight / 2, kind === "bed" ? -depth / 2 + 0.02 : -depth / 2 + inset],
        // A chair back leans; a headboard does not.
        rotation: kind === "chair" ? [-8, 0, 0] : [0, 0, 0],
        color: wood,
        metalness: finish.metalness,
        roughness: finish.roughness,
        explode: [0, 0.1, -0.08],
        note: kind === "chair" ? `Leans back 8° and rises ${(backHeight * 100).toFixed(0)} cm above the seat.` : `Rises ${(backHeight * 100).toFixed(0)} cm above the platform.`,
      }),
    );
  }

  /* Upholstery: a cushion on every seat that would have one. */
  if (kind === "chair" || kind === "sofa" || kind === "bed" || text(values, "material", "") === "upholstered") {
    parts.push(
      part({
        id: "cushion",
        name: "Cushion",
        layer: "soft",
        shape: "box",
        size: { width: width * 0.9, height: 0.07, depth: depth * 0.86 },
        position: [0, surfaceY + surfaceThickness / 2 + 0.035, 0],
        color: "#8b6bd6",
        metalness: 0.02,
        roughness: 0.92,
        explode: [0, 0.16, 0],
        note: "7 cm of padding — the part you actually sit on, and the part that comes off first.",
      }),
    );
  }

  /* Storage and shelving: boards, carcass and a drawer front. */
  if (isShelf) {
    const boards = Math.max(2, Math.min(6, Math.round(height / 0.32)));
    const spacing = (height - surfaceY) / boards;
    for (let i = 1; i <= boards; i += 1) {
      parts.push(
        part({
          id: `shelf-${i}`,
          name: `Shelf ${i}`,
          layer: "top",
          shape: "box",
          size: { width, height: surfaceThickness, depth },
          position: [0, surfaceY + spacing * i, 0],
          color: wood,
          metalness: finish.metalness,
          roughness: finish.roughness,
          explode: [0, 0.05 * i, 0],
          note: `Board ${i} of ${boards}, ${(spacing * 100).toFixed(0)} cm above the one below.`,
        }),
      );
    }
  }
  if (kind === "cabinet" || kind === "desk") {
    const drawers = kind === "desk" ? 1 : 3;
    for (let i = 1; i <= drawers; i += 1) {
      parts.push(
        part({
          id: `drawer-${i}`,
          name: `Drawer ${i}`,
          layer: "storage",
          shape: "box",
          size: { width: width * 0.86, height: Math.min(0.16, seatHeight / (drawers + 0.6)), depth: depth * 0.9 },
          position: [0, seatHeight - (seatHeight / (drawers + 1)) * i, 0],
          color: wood,
          metalness: finish.metalness,
          roughness: finish.roughness,
          explode: [0, 0, 0.16],
          note: `Runs on the carcass below the surface; pulls out ${(depth * 90).toFixed(0)} cm.`,
        }),
      );
    }
  }

  /* Stretchers between the legs: the difference between a frame and four sticks. */
  if (kind === "table" || kind === "desk" || kind === "chair") {
    const z = depth / 2 - inset;
    const y = Math.max(0.06, legLength * 0.28);
    for (const sz of [-1, 1] as const) {
      parts.push(
        part({
          id: `stretcher-${sz > 0 ? "front" : "back"}`,
          name: `Stretcher (${sz > 0 ? "front" : "back"})`,
          layer: "frame",
          shape: "box",
          size: { width: width - inset * 2, height: 0.024, depth: 0.024 },
          position: [0, y, sz * z],
          color: frameColor,
          metalness: finish.metalness,
          roughness: finish.roughness,
          explode: [0, 0, sz * 0.1],
          note: "Ties the legs together; without it the frame racks sideways.",
        }),
      );
    }
  }

  const layers = layersOf(LAYERS, parts);
  const legCount = parts.filter((p) => p.layer === "legs").length;

  return {
    ok: true,
    rejected: [],
    program: {
      kind: "build",
      builder: "furniture",
      domain: "furniture",
      title: title ?? `${kind} — ${(width * 100).toFixed(0)} × ${(depth * 100).toFixed(0)} × ${(height * 100).toFixed(0)} cm`,
      params: values,
      paramSpecs: specs,
      parts,
      layers,
      steps: [
        { id: "frame", name: `1 · ${kind === "shelf" || kind === "cabinet" ? "Carcass" : "Legs"}`, summary: `${legCount} legs`, detail: `${legCount} legs, each ${(Math.max(0.08, legLength) * 100).toFixed(0)} cm long, inset ${(inset * 100).toFixed(0)} cm from the edges so the piece does not tip on its corners.`, focus: ["leg--1-1", "leg-1-1"] },
        { id: "surface", name: "2 · Bearing surface", summary: `${(surfaceY * 100).toFixed(0)} cm`, detail: `The ${kind === "table" || kind === "desk" ? "top" : "seat"} sits at ${(surfaceY * 100).toFixed(0)} cm — the height everything else is measured from.`, focus: ["surface"] },
        { id: "back", name: "3 · Back", summary: hasBack ? `${((height - seatHeight) * 100).toFixed(0)} cm` : "none", detail: hasBack ? `The back rises ${((height - seatHeight) * 100).toFixed(0)} cm above the seat${kind === "chair" ? ", raked 8° so it meets the spine rather than the shoulders" : ""}.` : `A ${kind} has no back — the surface is the whole story.`, focus: hasBack ? ["back"] : ["surface"] },
        { id: "finish", name: "4 · Finish", summary: text(values, "material", "oak"), detail: `Every part is cut from the same ${text(values, "material", "oak")} stock; the model shows one material, not a cut list.`, focus: ["surface", "back"] },
      ],
      derived: [
        { label: "Piece", value: kind },
        { label: "Overall", value: `${(width * 100).toFixed(0)} × ${(depth * 100).toFixed(0)} × ${(height * 100).toFixed(0)} cm` },
        { label: "Seat / top height", value: `${(surfaceY * 100).toFixed(0)} cm` },
        { label: "Legs", value: `${legCount}` },
        { label: "Parts", value: `${parts.length}` },
        { label: "Material", value: text(values, "material", "oak") },
      ],
      scene: sceneOf(parts, {
        camera: { position: [width * 1.7, height * 1.9, depth * 2.6], target: [0, height * 0.45, 0], fov: 40 },
        seed: 4242,
        preset: "furniture",
      }),
      notes: [
        "Dimensions and relationships are computed from the parameters: changing the seat height moves the surface and shortens every leg.",
        "A geometric, parametrically editable model. Joinery is drawn as solid joints and no strength or load claim is made — it is not a manufacturing drawing.",
        "Each part is separately labelled and explodable, which is what makes one part (a seat, a shelf, a drawer) extractable as its own object.",
      ],
      sources: [],
    },
  };
}

export const furnitureBuilder = {
  id: "furniture",
  domain: "furniture" as const,
  label: "Furniture",
  blurb: "Chairs, tables, desks, shelves, beds, sofas and cabinets from one assembly.",
  keywords: ["furniture", "chair", "stool", "table", "desk", "shelf", "shelving", "bookcase", "bed", "sofa", "couch", "cabinet", "drawer", "seat"],
  paramSpecs,
  build: (input?: Record<string, unknown>, title?: string) => buildFurniture(input, title),
  describe: (request: string) => describeFurnitureRequest(request),
};

export function describeFurnitureRequest(request: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const kind = /\b(chair|stool|table|desk|shelf|shelves|bookcase|bed|sofa|couch|cabinet|drawer)\b/i.exec(request);
  if (kind) {
    const word = kind[1].toLowerCase();
    out.kind = word === "stool" ? "chair" : word === "shelves" || word === "bookcase" ? "shelf" : word === "couch" ? "sofa" : word;
  }
  const dims = /\b(\d+(?:\.\d+)?)\s*(?:cm|centimetres?)\s*(?:wide|width)/i.exec(request);
  if (dims) out.width = Number(dims[1]) / 100;
  const seat = /\bseat\s*(?:height\s*)?(?:at\s*)?(\d{2})\s*(?:cm)?/i.exec(request);
  if (seat) out.seatHeight = Number(seat[1]) / 100;
  const material = /\b(oak|walnut|birch|steel|upholstered)\b/i.exec(request);
  if (material) out.material = material[1].toLowerCase();
  return out;
}
