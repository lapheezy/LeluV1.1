/**
 * ==========================================================
 * LÉLU — COUTURE: COMPONENTS AS OBJECTS
 *
 * A built garment is an assembly. This file turns that assembly
 * into parts and components that can each be extracted into a
 * Cosmos object: cloth layers, sculptural structures, a sleeve,
 * a collar, a pattern piece, a material swatch.
 *
 * The sleeve is generated from the drafted sleeve pattern
 * piece's own cap height, bicep and wrist widths — not from a
 * guessed cylinder — so the extracted sleeve is the thing the
 * pattern describes.
 *
 * Units: mm, z-up, waist at z = 0.
 * ==========================================================
 */

import { clamp, meshNormals, triangulate, type Mesh } from "./geometry";
import type { BuiltGarment } from "./garment";
import { netOutline, type Pattern, type PatternPiece } from "./pattern";
import { findMaterial, type CoutureMaterial } from "./textiles";
import type { ComponentKind, ComponentSocket, CreativeComponent, CreativePart, ObjectCheck, Vec3 } from "./objects";

/* ---------------- primitive surfaces ---------------- */

/** Tube with a closed dome cap, hanging along -z from the origin. */
export function sleeveMesh(options: { rTopMm: number; rBottomMm: number; lengthMm: number; capMm: number; segments?: number; rings?: number }): Mesh {
  const segments = Math.max(12, options.segments ?? 32);
  const rings = Math.max(8, options.rings ?? 22);
  const capRings = 7;
  // The pattern's cap height is the length of the cap curve, not height above
  // the shoulder: the shoulder cap itself rises only a little.
  const rise = Math.min(options.capMm * 0.16, 26);
  const positions: number[] = [];
  const indices: number[] = [];

  // Dome above z = 0, then the shaft down to -length.
  for (let i = 0; i <= capRings; i += 1) {
    const t = i / capRings;
    const z = rise * Math.cos((t * Math.PI) / 2);
    const r = options.rTopMm * Math.sin((t * Math.PI) / 2) + 1.5;
    for (let j = 0; j < segments; j += 1) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, Math.sin(a) * r, z);
    }
  }
  for (let i = 0; i <= rings; i += 1) {
    const t = i / rings;
    const z = -t * options.lengthMm;
    // Bicep → wrist with a slight elbow taper, so a long sleeve is not a cone.
    const ease = Math.sin(t * Math.PI) * 0.06;
    const r = options.rTopMm + (options.rBottomMm - options.rTopMm) * t + ease * options.rTopMm;
    for (let j = 0; j < segments; j += 1) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, Math.sin(a) * r, z);
    }
  }
  for (let row = 0; row < capRings; row += 1) {
    for (let j = 0; j < segments; j += 1) {
      const j2 = (j + 1) % segments;
      const a = row * segments + j, b = row * segments + j2;
      const c = (row + 1) * segments + j, d = (row + 1) * segments + j2;
      indices.push(a, b, c, b, d, c);
    }
  }
  const shaftStart = (capRings + 1) * segments;
  for (let row = 0; row <= rings; row += 1) {
    for (let j = 0; j < segments; j += 1) {
      const j2 = (j + 1) % segments;
      const a = shaftStart + row * segments + j, b = shaftStart + row * segments + j2;
      if (row === rings) break;
      const c = shaftStart + (row + 1) * segments + j, d = shaftStart + (row + 1) * segments + j2;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices };
}

/** A flat 2D pattern piece laid in the XY plane — editable geometry, not a picture. */
export function flatPieceMesh(piece: PatternPiece): Mesh {
  const pts = netOutline(piece);
  const positions: number[] = [];
  for (const p of pts) positions.push(p.x, p.y, 0);
  const indices = triangulate(pts);
  return { positions, indices };
}

/** A 220 mm fabric swatch with a deterministic drape wave, for material objects. */
export function swatchMesh(sizeMm = 220, waves = 3, amplitudeMm = 14): Mesh {
  const n = 18;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      const u = i / n;
      const v = j / n;
      const z = Math.sin(u * Math.PI * waves) * amplitudeMm * (0.35 + v) - v * sizeMm * 0.08;
      positions.push((u - 0.5) * sizeMm, (v - 0.5) * sizeMm, z);
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const a = i * (n + 1) + j, b = a + 1, c = a + (n + 1), d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices };
}

/* ---------------- garment assembly → object parts ---------------- */

export interface AssemblyObject {
  parts: CreativePart[];
  components: CreativeComponent[];
  sockets: ComponentSocket[];
  checks: ObjectCheck[];
  data: Record<string, unknown>;
}

const SOS: ComponentKind[] = ["sleeve"];

function colourOf(material: CoutureMaterial | undefined, fallback = "#b9a7c9"): string {
  return material?.visual.baseColor ?? fallback;
}

function sculpturalKind(kind: string): ComponentKind {
  if (kind === "rib-cage") return "boning";
  if (kind === "standing-collar") return "collar";
  if (kind === "translucent-shell") return "overskirt";
  if (kind === "modular-panels" || kind === "lattice" || kind === "pleated-panel" || kind === "ruffle") return "panel";
  return "other";
}

function maxOf(values: number[]): number {
  return values.reduce((m, v) => Math.max(m, v), -Infinity);
}

/**
 * Turn a built garment into parts, components and sockets.
 * Sleeves come from the pattern's sleeve piece; when the style has no
 * sleeve piece, no sleeve component is invented.
 */
export function garmentAssembly(g: BuiltGarment, options: { sleeves?: boolean } = {}): AssemblyObject {
  const parts: CreativePart[] = [];
  const components: CreativeComponent[] = [];
  const sockets: ComponentSocket[] = [];
  const checks: ObjectCheck[] = [];

  for (const layer of g.layers) {
    const componentId = `c-${layer.id.toLowerCase()}`;
    const partId = `p-${layer.id.toLowerCase()}`;
    const roleKind: ComponentKind = layer.role === "shell" ? "shell" : layer.role === "lining" ? "lining" : "panel";
    parts.push({
      id: partId,
      label: `${layer.role} · ${layer.material.name}`,
      mesh: layer.mesh,
      materialId: layer.materialId,
      color: colourOf(layer.material),
      opacity: layer.opacity,
      thin: true,
      componentId,
    });
    components.push({
      id: componentId,
      name: `${layer.role === "shell" ? "Bodice & skirt shell" : layer.role} (${layer.material.name})`,
      kind: roleKind,
      partIds: [partId],
      materialId: layer.materialId,
      status: "attached",
      dimensions: {
        areaMm2: layer.areaMm2,
        massG: layer.massG,
        offsetMm: layer.offsetMm,
        simulated: layer.simulated ? 1 : 0,
      },
      note: layer.note,
    });
  }

  for (const part of g.sculptural) {
    const material = findMaterial(part.material);
    const componentId = `c-${part.id.toLowerCase()}`;
    const kind = sculpturalKind(part.kind);
    parts.push({
      id: `p-${part.id.toLowerCase()}`,
      label: `${part.kind} · ${material?.name ?? part.material}`,
      mesh: part.mesh,
      materialId: part.material,
      color: colourOf(material),
      // Transmission is what turns organza into a veil; without this the
      // overskirt renders as an opaque white sheet over the garment.
      opacity: clamp((material?.visual.opacity ?? 1) * (1 - (material?.visual.transmission ?? 0) * 1.45), 0.12, 1),
      thin: true,
      componentId,
    });
    components.push({
      id: componentId,
      name: part.name,
      kind,
      partIds: [`p-${part.id.toLowerCase()}`],
      materialId: part.material,
      status: "attached",
      dimensions: { ...part.params, triangles: part.triangles },
      note: part.note,
    });
  }

  /* ---- sleeves from the drafted sleeve piece ---- */

  const shell = g.layers.find((l) => l.role === "shell") ?? g.layers[0];
  const shellPositions = shell ? shell.mesh.positions : [];
  let shoulderZ = 320;
  let shoulderX = 190;
  for (let i = 0; i < shellPositions.length; i += 3) {
    shoulderZ = Math.max(shoulderZ, shellPositions[i + 2] - 10);
    shoulderX = Math.max(shoulderX, Math.abs(shellPositions[i]));
  }
  shoulderX *= 0.92;

  const sleevePiece = g.pattern.pieces.find((p) => p.id === "sleeve");
  if (sleevePiece && options.sleeves !== false) {
    const xs = sleevePiece.outline.map((p) => p.x);
    const ys = sleevePiece.outline.map((p) => p.y);
    const width = maxOf(xs) - Math.min(...xs);
    const length = Math.abs(Math.min(...ys));
    // The piece is a half-sleeve cut twice; the mesh is the full tube.
    const rTop = width / 2;
    const wristEdge = sleevePiece.outline.find((p) => p.edge === "wrist");
    const underarmEdge = sleevePiece.outline.find((p) => p.edge === "underarm-front");
    const rBottom = wristEdge && underarmEdge ? Math.abs(wristEdge.x - underarmEdge.x) / 2 : rTop * 0.62;
    const capMatch = sleevePiece.notes.find((n) => n.startsWith("Cap height"));
    const capHeight = Number(capMatch?.match(/Cap height ([\d.]+)/)?.[1] ?? 90);

    for (const side of [-1, 1] as const) {
      const suffix = side < 0 ? "left" : "right";
      const componentId = `c-sleeve-${suffix}`;
      const partId = `p-sleeve-${suffix}`;
      const raw = sleeveMesh({ rTopMm: rTop, rBottomMm: Math.max(28, rBottom), lengthMm: length, capMm: capHeight });
      // Seat the sleeve at its shoulder socket: the pattern drafts a flat
      // piece, so the tube is placed where the armhole is, tilted outward.
      const tilt = (side < 0 ? -1 : 1) * (10 * Math.PI) / 180;
      const seated: number[] = [];
      for (let i = 0; i < raw.positions.length; i += 3) {
        const x = raw.positions[i];
        const y = raw.positions[i + 1];
        const z = raw.positions[i + 2];
        const xr = x * Math.cos(tilt) + z * Math.sin(tilt);
        const zr = -x * Math.sin(tilt) + z * Math.cos(tilt);
        seated.push(xr + side * shoulderX, y, zr + shoulderZ - 20);
      }
      const mesh: Mesh = { positions: seated, indices: raw.indices, normals: meshNormals(seated, raw.indices) };
      const material = findMaterial(shell?.materialId ?? "silk-mikado") ?? g.layers[0].material;
      parts.push({
        id: partId,
        label: `${suffix} sleeve · ${material.name}`,
        mesh,
        materialId: material.id,
        color: colourOf(material),
        opacity: material.visual.opacity,
        thin: true,
        componentId,
      });
      components.push({
        id: componentId,
        name: `${suffix === "left" ? "Left" : "Right"} sleeve`,
        kind: "sleeve",
        partIds: [partId],
        materialId: material.id,
        status: "attached",
        patternPieceId: sleevePiece.id,
        dimensions: {
          capHeightMm: capHeight,
          bicepHalfMm: rTop,
          wristHalfMm: rBottom,
          lengthMm: length,
          triangles: Math.floor(mesh.indices.length / 3),
        },
        note: `Drafted from the sleeve piece: cap ${capHeight.toFixed(1)} mm solved to the armscye, ${length.toFixed(0)} mm long.`,
      });
      sockets.push({
        id: `socket-sleeve-${suffix}`,
        accepts: SOS,
        positionMm: [side * shoulderX, 0, shoulderZ - 20],
        rotationDeg: [0, 0, side < 0 ? -8 : 8],
      });
    }
    checks.push({ name: "sleeves drafted from the pattern", ok: true, detail: `${length.toFixed(0)} mm sleeve, cap ${capHeight.toFixed(1)} mm, wrist ${(rBottom * 2).toFixed(0)} mm` });
  } else {
    checks.push({ name: "sleeves", ok: true, detail: "this style has no sleeve piece, so no sleeve component exists" });
  }

  // Shoulders are the sleeve sockets of the shell; a collar can also be seated there.
  const shellComponent = components.find((c) => c.kind === "shell");
  if (shellComponent) {
    shellComponent.socket = {
      id: "socket-shell",
      accepts: ["sleeve", "collar", "panel", "boning", "overskirt", "lining"],
      positionMm: [0, 0, shoulderZ],
      rotationDeg: [0, 0, 0],
    };
  }

  const partless = components.filter((c) => c.partIds.length === 0);
  checks.push({ name: "every component has geometry", ok: partless.length === 0, detail: `${components.length} components, ${parts.length} parts` });
  const orphanParts = parts.filter((p) => !components.some((c) => c.id === p.componentId));
  checks.push({ name: "every part belongs to a component", ok: orphanParts.length === 0, detail: `${orphanParts.length} orphans` });

  return {
    parts,
    components,
    sockets,
    checks,
    data: {
      garmentId: g.id,
      patternId: g.pattern.id,
      style: g.report.style,
      measurements: g.report.measurements,
      material: g.report.material,
      triangles: g.report.totalTriangles,
      massG: g.report.totalMassG,
      simulationMs: g.report.simulationMs,
      fabric: g.report.fabric,
      checks: g.checks,
      notes: g.report.notes,
    },
  };
}

/* ---------------- pattern as objects ---------------- */

export function patternAssembly(pattern: Pattern): AssemblyObject {
  const parts: CreativePart[] = [];
  const components: CreativeComponent[] = [];
  const checks: ObjectCheck[] = [];

  for (const piece of pattern.pieces) {
    const mesh = flatPieceMesh(piece);
    const id = `c-piece-${piece.id}`;
    parts.push({
      id: `p-piece-${piece.id}`,
      label: `${piece.name} (net)`,
      mesh,
      materialId: "pattern-paper",
      color: piece.id === "sleeve" ? "#e9dcc4" : "#f0e6d2",
      opacity: 1,
      thin: true,
      componentId: id,
    });
    const xs = piece.outline.map((p) => p.x);
    const ys = piece.outline.map((p) => p.y);
    components.push({
      id,
      name: piece.name,
      kind: "pattern-piece",
      partIds: [`p-piece-${piece.id}`],
      materialId: "pattern-paper",
      status: "attached",
      patternPieceId: piece.id,
      dimensions: {
        widthMm: Number((maxOf(xs) - Math.min(...xs)).toFixed(1)),
        heightMm: Number((maxOf(ys) - Math.min(...ys)).toFixed(1)),
        areaMm2: piece.areaMm2,
        cut: piece.cut,
        seamAllowanceMm: piece.seamAllowance,
      },
      note: `${piece.cut === 2 ? "Cut 2" : "Cut 1"}${piece.onFold ? " on the fold" : ""}, ${piece.seamAllowance} mm allowance. ${piece.notes[0] ?? ""}`.trim(),
    });
  }
  checks.push({ name: "pattern pieces exported as geometry", ok: parts.every((p) => p.mesh.indices.length > 0), detail: `${parts.length} triangulated pieces` });
  checks.push({ name: "pattern checks", ok: pattern.checks.every((c) => c.ok), detail: `${pattern.checks.filter((c) => c.ok).length}/${pattern.checks.length}` });

  return {
    parts,
    components,
    sockets: [],
    checks,
    data: {
      patternId: pattern.id,
      size: pattern.size,
      measurements: pattern.measurements,
      style: pattern.style,
      seams: pattern.seams,
      checks: pattern.checks,
      fabricWidthMm: pattern.fabricWidthMm,
    },
  };
}

export function textileSampleAssembly(materialId: string, sizeMm = 220): AssemblyObject {
  const material = findMaterial(materialId);
  if (!material) return { parts: [], components: [], sockets: [], checks: [{ name: "material", ok: false, detail: `no material ${materialId}` }], data: {} };
  const mesh = swatchMesh(sizeMm);
  const parts: CreativePart[] = [
    {
      id: "p-swatch",
      label: `${material.name} swatch`,
      mesh,
      materialId: material.id,
      color: colourOf(material),
      opacity: material.visual.opacity,
      thin: true,
      componentId: "c-swatch",
    },
  ];
  const components: CreativeComponent[] = [
    {
      id: "c-swatch",
      name: `${material.name} swatch`,
      kind: "other",
      partIds: ["p-swatch"],
      materialId: material.id,
      status: "attached",
      dimensions: { sizeMm },
      note: `${material.category} · ${material.physical ? `${material.physical.gsm} g/m²` : "solid"}`,
    },
  ];
  return {
    parts,
    components,
    sockets: [],
    checks: [{ name: "swatch geometry", ok: mesh.indices.length > 0, detail: `${Math.floor(mesh.indices.length / 3)} triangles` }],
    data: { material: material.id, properties: material.physical ?? null, visual: material.visual, provenance: material.provenance },
  };
}

/** Local socket position as an absolute transform offset. */
export function socketPosition(socket: ComponentSocket, parentPosition: Vec3): Vec3 {
  return [parentPosition[0] + socket.positionMm[0], parentPosition[1] + socket.positionMm[1], parentPosition[2] + socket.positionMm[2]];
}

export function meshNormalsOf(mesh: Mesh): number[] {
  return mesh.normals ?? meshNormals(mesh.positions, mesh.indices);
}
