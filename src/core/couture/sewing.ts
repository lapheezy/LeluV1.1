/**
 * ==========================================================
 * LÉLU — FROM PATTERN TO SEWING
 *
 * Everything a maker needs after the pattern is drafted:
 *
 *   patternSheetSvg   the pieces at TRUE SCALE (1 svg unit = 1 mm, sized in
 *                     mm), cut line with real seam allowance, stitch line,
 *                     grainline arrow, notches, labels and a 100 mm test
 *                     square to check the print scale
 *   cuttingLayout     every piece (× its cut count, fold pieces opened)
 *                     packed on the fabric width per fabric, grain kept
 *                     along the length; the length used is the yardage
 *   billOfMaterials   fabrics in metres (+10 % for matching and shrinkage)
 *                     and the trims the garments call for
 *   sewingOrder       the construction sequence per garment, naming the
 *                     pieces, seams, seam finishes and allowances
 *   techPack          all of it as one structure, plus markdown
 *
 * Pure: no DOM. Geometry is deterministic.
 * ==========================================================
 */

import { cutOutline, netOutline, notchPositions } from "./pattern";
import type { Fabric, FashionPattern, FashionPiece, GarmentId } from "./fashionBlocks";

type Vec2 = { x: number; y: number };
const bbox = (pts: Vec2[]) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A piece's cut outline, opened out if it is cut on a fold (mirrored across x = 0). */
export function openedCut(piece: FashionPiece): Vec2[] {
  const cut = cutOutline(piece);
  if (!piece.onFold) return cut;
  return [...cut, ...[...cut].reverse().map((p) => ({ x: -p.x, y: p.y }))];
}

/* ------------------------------------------------------------------ *
 * True-scale pattern sheet
 * ------------------------------------------------------------------ */

export function patternSheetSvg(pattern: FashionPattern, opts: { sheetWidthMm?: number; gapMm?: number } = {}): { svg: string; widthMm: number; heightMm: number } {
  const W = opts.sheetWidthMm ?? 1500, gap = opts.gapMm ?? 40, margin = 30;
  let x = margin, y = margin + 160, rowH = 0;
  const parts: string[] = [];
  for (const piece of pattern.pieces) {
    const cut = cutOutline(piece);
    const b = bbox(cut);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (x + w > W - margin) {
      x = margin;
      y += rowH + gap + 40;
      rowH = 0;
    }
    // Draft space is y-up; the sheet is y-down: flip inside the piece box.
    const tx = (px: number) => (x + (px - b.minX)).toFixed(1);
    const ty = (py: number) => (y + (b.maxY - py)).toFixed(1);
    const path = (pts: Vec2[]) => `M${pts.map((p) => `${tx(p.x)},${ty(p.y)}`).join("L")}Z`;
    const net = netOutline(piece);
    const g = piece.grainline;
    parts.push(`<g data-piece="${esc(piece.id)}">`);
    parts.push(`<path d="${path(cut)}" fill="#fdf8f0" stroke="#111" stroke-width="1.2"/>`);
    parts.push(`<path d="${path(net)}" fill="none" stroke="#7a3b5c" stroke-width="0.8" stroke-dasharray="6 4"/>`);
    parts.push(`<line x1="${tx(g.a.x)}" y1="${ty(g.a.y)}" x2="${tx(g.b.x)}" y2="${ty(g.b.y)}" stroke="#111" stroke-width="0.9" marker-start="url(#arrow)" marker-end="url(#arrow)"/>`);
    for (const n of notchPositions(piece)) parts.push(`<circle cx="${tx(n.x)}" cy="${ty(n.y)}" r="3" fill="#b45309"/><text x="${(+tx(n.x) + 5).toFixed(1)}" y="${ty(n.y)}" font-size="9" font-family="sans-serif" fill="#b45309">${esc(n.label)}</text>`);
    if (piece.onFold) {
      const foldX = tx(0);
      parts.push(`<line x1="${foldX}" y1="${ty(b.maxY)}" x2="${foldX}" y2="${ty(b.minY)}" stroke="#2563eb" stroke-width="2" stroke-dasharray="14 6"/><text x="${(+foldX + 6).toFixed(1)}" y="${(+ty(b.maxY) + 20).toFixed(1)}" font-size="12" fill="#2563eb" font-family="sans-serif">PLACE ON FOLD</text>`);
    }
    const cx = (x + w / 2).toFixed(1), cy = (y + h / 2).toFixed(1);
    const fs = Math.max(9, Math.min(22, w / 14));
    parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fs.toFixed(0)}" font-family="sans-serif" font-weight="700" fill="#111">${esc(piece.label)}</text>`);
    parts.push(`<text x="${cx}" y="${(+cy + fs + 4).toFixed(1)}" text-anchor="middle" font-size="${(fs * 0.62).toFixed(0)}" font-family="sans-serif" fill="#333">${esc(`${pattern.name} · size ${pattern.size} · cut ${piece.cut} · ${piece.fabric} · SA ${piece.seamAllowance} mm`)}</text>`);
    parts.push(`</g>`);
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  const H = y + rowH + margin + 20;
  const header = `<text x="${margin}" y="${margin + 26}" font-size="28" font-family="sans-serif" font-weight="700">${esc(pattern.title)}</text>
<text x="${margin}" y="${margin + 56}" font-size="16" font-family="sans-serif">Size ${esc(pattern.size)} · ${pattern.pieces.length} pieces · true scale: print at 100 %, check the square below measures 100 mm</text>
<rect x="${margin}" y="${margin + 70}" width="100" height="100" fill="none" stroke="#111" stroke-width="1"/><text x="${margin + 108}" y="${margin + 126}" font-size="13" font-family="sans-serif">100 mm test square</text>
<text x="${margin + 300}" y="${margin + 100}" font-size="13" font-family="sans-serif">— solid: cut line (seam allowance included) · dashed: stitch line · arrow: grainline · dots: notches</text>`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H.toFixed(0)}mm" viewBox="0 0 ${W} ${H.toFixed(0)}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#111"/></marker></defs>
<rect width="100%" height="100%" fill="#ffffff"/>
${header}
${parts.join("\n")}
</svg>`;
  return { svg, widthMm: W, heightMm: Math.round(H) };
}

/* ------------------------------------------------------------------ *
 * Cutting layout and yardage
 * ------------------------------------------------------------------ */

export interface Placement {
  garment: GarmentId;
  piece: string;
  label: string;
  copy: number;
  x: number;
  y: number;
  w: number;
  h: number;
  mirrored: boolean;
}
export interface FabricLayout {
  fabric: Fabric;
  widthMm: number;
  lengthMm: number;
  utilisation: number;
  placements: Placement[];
}

const FABRIC_WIDTH: Record<Fabric, number> = { shell: 1500, lining: 1400, rib: 1000, mesh: 1500 };

/** Shelf packing per fabric, tallest first, grain along the fabric length (no rotation). */
export function cuttingLayout(patterns: FashionPattern[], widths: Partial<Record<Fabric, number>> = {}): FabricLayout[] {
  const groups = new Map<Fabric, Array<{ p: FashionPattern; piece: FashionPiece; copy: number; w: number; h: number; area: number }>>();
  for (const p of patterns)
    for (const piece of p.pieces) {
      const b = bbox(openedCut(piece));
      for (let c = 1; c <= piece.cut; c++) {
        const list = groups.get(piece.fabric) ?? [];
        list.push({ p, piece, copy: c, w: Math.ceil(b.maxX - b.minX), h: Math.ceil(b.maxY - b.minY), area: piece.areaMm2 });
        groups.set(piece.fabric, list);
      }
    }
  const out: FabricLayout[] = [];
  for (const [fabric, items] of groups) {
    const W = widths[fabric] ?? FABRIC_WIDTH[fabric];
    const gap = 10;
    items.sort((a, b) => b.h - a.h);
    const placements: Placement[] = [];
    let x = 0, y = 0, rowH = 0;
    for (const it of items) {
      if (it.w > W) throw new Error(`${it.piece.label} (${it.w} mm) is wider than the ${fabric} (${W} mm)`);
      if (x + it.w > W) {
        x = 0;
        y += rowH + gap;
        rowH = 0;
      }
      placements.push({ garment: it.p.garment, piece: it.piece.id, label: it.piece.label, copy: it.copy, x, y, w: it.w, h: it.h, mirrored: it.copy % 2 === 0 && it.piece.cut === 2 });
      x += it.w + gap;
      rowH = Math.max(rowH, it.h);
    }
    const length = y + rowH;
    const used = items.reduce((s, i) => s + i.area, 0);
    out.push({ fabric, widthMm: W, lengthMm: length, utilisation: +(used / (W * length)).toFixed(3), placements });
  }
  return out;
}

export function cuttingLayoutSvg(layout: FabricLayout, scale = 0.25): string {
  const W = layout.widthMm * scale, H = layout.lengthMm * scale;
  const colors: Record<string, string> = { "wide-cargo-trousers": "#a16207", "oversized-bomber": "#7e22ce", "crossover-bralette": "#be185d" };
  const boxes = layout.placements
    .map((p) => `<g><rect x="${(p.x * scale).toFixed(1)}" y="${(p.y * scale).toFixed(1)}" width="${(p.w * scale).toFixed(1)}" height="${(p.h * scale).toFixed(1)}" fill="${colors[p.garment]}33" stroke="${colors[p.garment]}" stroke-width="1"/><text x="${((p.x + p.w / 2) * scale).toFixed(1)}" y="${((p.y + p.h / 2) * scale).toFixed(1)}" font-size="9" text-anchor="middle" font-family="sans-serif">${esc(p.label)}${p.mirrored ? " (flip)" : ""}</text></g>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(W + 40).toFixed(0)}" height="${(H + 60).toFixed(0)}" viewBox="-20 -40 ${(W + 40).toFixed(0)} ${(H + 60).toFixed(0)}"><rect x="-20" y="-40" width="100%" height="100%" fill="#fff"/><text x="0" y="-20" font-size="13" font-family="sans-serif" font-weight="700">${layout.fabric}: ${layout.widthMm} mm wide · ${(layout.lengthMm / 1000).toFixed(2)} m used · ${(layout.utilisation * 100).toFixed(0)} % utilised</text><rect width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="none" stroke="#444" stroke-dasharray="4 3"/>${boxes}</svg>`;
}

/* ------------------------------------------------------------------ *
 * Bill of materials and sewing order
 * ------------------------------------------------------------------ */

export interface BomLine {
  item: string;
  quantity: string;
  for: string;
  note?: string;
}

const FABRIC_DESC: Record<Fabric, string> = {
  shell: "Shell: brushed cotton twill, 280–320 g/m², patchwork camo print (mauve / olive / black) with copper metallic thread",
  lining: "Lining: satin-back viscose, blush",
  rib: "Rib knit 2×2, black, with ≥ 40 % stretch",
  mesh: "Power mesh, nude (cup lining)",
};

export function billOfMaterials(patterns: FashionPattern[], layouts: FabricLayout[]): BomLine[] {
  const has = (g: GarmentId) => patterns.some((p) => p.garment === g);
  const lines: BomLine[] = layouts.map((l) => ({ item: FABRIC_DESC[l.fabric], quantity: `${((l.lengthMm * 1.1) / 1000).toFixed(2)} m at ${l.widthMm} mm wide`, for: [...new Set(l.placements.map((p) => p.garment))].join(", "), note: "includes 10 % for matching and shrinkage; pre-wash" }));
  const bomber = patterns.find((p) => p.garment === "oversized-bomber");
  const trousers = patterns.find((p) => p.garment === "wide-cargo-trousers");
  if (bomber) {
    const zip = Math.round((bomber.derived.bodyLength - 85 + 60) / 10) * 10;
    lines.push({ item: "Separating zip, metal, copper finish", quantity: `1 × ${zip} mm`, for: "oversized-bomber" });
    lines.push({ item: "Fusible interfacing, light", quantity: "0.30 m", for: "oversized-bomber", note: "zip facings" });
  }
  if (trousers) {
    lines.push({ item: "Drawstring cord, 8 mm", quantity: `${((trousers.measurements.waist + 900) / 1000).toFixed(2)} m`, for: "wide-cargo-trousers" });
    lines.push({ item: "Metal eyelets 12 mm, copper", quantity: "2", for: "wide-cargo-trousers" });
    lines.push({ item: "Snaps or copper hooks", quantity: "4", for: "wide-cargo-trousers", note: "pocket flaps" });
  }
  if (has("crossover-bralette")) {
    lines.push({ item: "Plush-back elastic 40 mm", quantity: "0.80 m", for: "crossover-bralette" });
    lines.push({ item: "Hook-and-eye tape, 2 rows", quantity: "1", for: "crossover-bralette" });
  }
  lines.push({ item: "Copper curb chain, 4–6 mm", quantity: "≈ 6 m", for: "all", note: "cut to the reference's drapes; jump rings to attach" });
  lines.push({ item: "Fabric rose appliqués, dusty rose", quantity: "≈ 6", for: "all", note: "jacket sleeves, chest, trouser pocket" });
  lines.push({ item: "Crystal point charms, blush quartz look", quantity: "≈ 24", for: "all" });
  lines.push({ item: "Star and crescent charms, copper", quantity: "≈ 8", for: "all" });
  lines.push({ item: "Polyester thread, colour-matched + topstitch thread", quantity: "4 + 1 spools", for: "all" });
  return lines;
}

export function sewingOrder(p: FashionPattern): string[] {
  switch (p.garment) {
    case "wide-cargo-trousers":
      return [
        "Pre-wash the twill. Cut: front ×2, back ×2, casing ×1, cargo pocket ×2, flap ×4, chain-loop strip ×1. Transfer the knee and crotch notches.",
        "Cargo pockets: press the 30 mm box pleat, hem the top edge (double-turn 20 mm), press the other edges under 10 mm.",
        "Flaps: sew pairs right sides together (10 mm), trim, turn, topstitch 6 mm; set the snaps.",
        "Sew the side seams front to back (10 mm), flat-felled; topstitch.",
        "Place the pockets on the side seam at the knee notch; edge-stitch; sew each flap 15 mm above its pocket and topstitch down.",
        "Sew the inseams (flat-felled), easing the back over the thigh.",
        "Turn one leg right side out, slip it inside the other and sew the crotch seam in one pass (10 mm); stitch again 3 mm away and overlock.",
        "Chain loops: fold the strip in quarters, edge-stitch both sides, cut 8 loops of 80 mm; baste them at the waist edge (front pocket line, side seams, back).",
        "Casing: set two 12 mm eyelets at centre front, 30 mm apart; join the casing ends; fold lengthwise; sew to the waist (10 mm), catching the loops; overlock; thread the drawstring.",
        "Hem: double-turn 25 mm. The 180 mm stacking length is kept, so the hem bunches over the shoe.",
        "Hardware: clip the copper chains through the loops; hand-stitch roses and charms.",
      ];
    case "oversized-bomber":
      return [
        "Cut shell: front ×2, back ×1 on the fold, sleeve ×2. Rib: cuff ×2, hem band ×1, collar ×1. Lining: front ×2, back ×1, sleeve ×2. Fuse the interfacing on the front zip edges.",
        "Shell: sew the shoulders (10 mm, taped), set the sleeves easing the low cap into the dropped armhole, then sew the side and underarm seams in one pass.",
        "Gather the sleeve ends; fold the cuffs, stretch them on and sew (10 mm, overlock).",
        "Fold the hem band, stretch it to the body hem, sew; fold the collar and sew it to the neckline.",
        "Zip: sew each zip half to the centre fronts right sides together, the rib ends folded in.",
        "Lining: assemble the same way, leaving a 200 mm opening in one sleeve seam.",
        "Bag the lining: sew lining to the shell along the fronts (over the zip tape), the inside of the collar and the hem band; then the cuffs. Turn through the sleeve opening and close it by machine.",
        "Topstitch 6 mm along the zip; press with a cloth.",
        "Embellish: hand-stitch the rose appliqués (shoulder, chest), then the copper chains, crystal points and charms following the reference.",
      ];
    case "crossover-bralette":
      return [
        "Cut: cup ×2 shell and ×2 mesh, under-band ×1, straps ×2.",
        "Baste each mesh cup to its shell cup, wrong sides together; bind the neckline edge with a 10 mm self binding.",
        "Gather 15 mm across each cup's base; sew the cups to the under-band (6 mm), centre front meeting.",
        "Enclose the 40 mm plush elastic in the band; overlock; set the hook-and-eye at centre back.",
        "Straps: sew, turn and press; attach at the cup points, cross them at the back and attach to the band.",
        "Finish: copper chain along the necklines, rose and crystal pendant at centre front.",
      ];
  }
}

/* ------------------------------------------------------------------ *
 * The tech pack
 * ------------------------------------------------------------------ */

export interface TechPack {
  title: string;
  size: string;
  reference?: string;
  patterns: FashionPattern[];
  layouts: FabricLayout[];
  bom: BomLine[];
  sewing: Record<string, string[]>;
  checks: { ok: number; total: number; failed: string[] };
}

export function techPack(patterns: FashionPattern[], opts: { title?: string; reference?: string } = {}): TechPack {
  const layouts = cuttingLayout(patterns);
  const all = patterns.flatMap((p) => p.checks);
  return {
    title: opts.title ?? "LÉLU outfit",
    size: patterns[0]?.size ?? "M",
    reference: opts.reference,
    patterns,
    layouts,
    bom: billOfMaterials(patterns, layouts),
    sewing: Object.fromEntries(patterns.map((p) => [p.garment, sewingOrder(p)])),
    checks: { ok: all.filter((c) => c.ok).length, total: all.length, failed: all.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`) },
  };
}

export function techPackMarkdown(t: TechPack): string {
  const m = t.patterns[0]?.measurements;
  const lines = [`# ${t.title} — tech pack (size ${t.size})`, ""];
  if (t.reference) lines.push(`Reference: ${t.reference}`, "");
  if (m) lines.push("## Body measurements (mm)", "", "| measurement | mm |", "|---|---|", ...Object.entries(m).map(([k, v]) => `| ${k} | ${v} |`), "");
  for (const p of t.patterns) {
    lines.push(`## ${p.title}`, "", `Derived (measure to confirm): ${Object.entries(p.derived).map(([k, v]) => `${k} ${v} mm`).join(", ")}`, "", "| piece | cut | fabric | seam allowance | area per cut |", "|---|---|---|---|---|");
    for (const pc of p.pieces) lines.push(`| ${pc.label} | ${pc.cut}${pc.onFold ? " on fold" : ""} | ${pc.fabric} | ${pc.seamAllowance} mm | ${(pc.areaMm2 / 1e6).toFixed(3)} m² |`);
    lines.push("", "Sewing order:", "", ...t.sewing[p.garment].map((s, i) => `${i + 1}. ${s}`), "", ...p.details.map((d) => `- ${d}`), "");
  }
  lines.push("## Cutting", "", ...t.layouts.map((l) => `- ${l.fabric}: ${(l.lengthMm / 1000).toFixed(2)} m of ${l.widthMm} mm wide, ${(l.utilisation * 100).toFixed(0)} % utilised, ${l.placements.length} pieces`), "");
  lines.push("## Bill of materials", "", "| item | quantity | for | note |", "|---|---|---|---|", ...t.bom.map((b) => `| ${b.item} | ${b.quantity} | ${b.for} | ${b.note ?? ""} |`), "");
  lines.push(`## Checks: ${t.checks.ok}/${t.checks.total} pass`, ...t.checks.failed.map((f) => `- FAILED ${f}`), "");
  return lines.join("\n");
}
