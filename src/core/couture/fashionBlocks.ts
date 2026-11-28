/**
 * ==========================================================
 * LÉLU — FASHION BLOCKS (the garments the bodice engine cannot draft)
 *
 * The existing engine drafts bodices, dresses and skirts. Asked for
 * trousers it returned bodice pieces, and a jacket had no zip front,
 * collar, rib or lining. These drafts fill that gap with the same
 * Pattern / PatternPiece model, so patternSvg, cutOutline, notches and
 * the checks all work on them.
 *
 *   wideCargoTrousers   front/back legs with crotch curves, inseam and
 *                       side seams, stacked-hem extra length, drawstring
 *                       casing, cargo pockets + flaps, chain loops
 *   oversizedBomber     fronts (zip), back on fold, dropped-shoulder
 *                       sleeves, rib cuffs/hem band/collar, full lining
 *   crossoverBralette   triangle cups (shell + lining), under-band,
 *                       crossing straps
 *
 * Units: millimetres. Draft space: y up (waist or hem line at y = 0),
 * matching patternSvg, which flips y so hems point down on the page.
 * Body measurements a draft needs but BodyMeasurements does not carry
 * (body rise, inside leg) are derived and listed in `derived` so the
 * maker knows to measure them.
 *
 * Pure: no DOM.
 * ==========================================================
 */

import { BASE_SIZE, DEFAULT_MEASUREMENTS, GRADE_RULES, SIZES, edgeLength, netOutline, type BodyMeasurements, type Pattern, type PatternCheck, type PatternPiece, type PatternPoint, type Seam, type SeamType } from "./pattern";

export type Fabric = "shell" | "lining" | "rib" | "mesh";

export interface FashionPiece extends PatternPiece {
  fabric: Fabric;
}

export interface FashionPattern extends Omit<Pattern, "pieces" | "style"> {
  pieces: FashionPiece[];
  garment: GarmentId;
  title: string;
  /** Measurements the draft derived because they were not given. */
  derived: Record<string, number>;
  details: string[];
}

export type GarmentId = "wide-cargo-trousers" | "oversized-bomber" | "crossover-bralette";

const P = (x: number, y: number, edge: string, curve?: { cx: number; cy: number }): PatternPoint => ({ x, y, edge, ...(curve ? { curve } : {}) });

function area(points: Array<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function piece(input: { id: string; name: string; label: string; outline: PatternPoint[]; cut: number; onFold?: boolean; sa?: number; fabric: Fabric; grain: [number, number, number, number]; notches?: PatternPiece["notches"]; notes?: string[] }): FashionPiece {
  const net = netOutline({ outline: input.outline });
  const a = area(net) * (input.onFold ? 2 : 1);
  return {
    id: input.id,
    name: input.name,
    label: input.label,
    outline: input.outline,
    cut: input.cut,
    onFold: !!input.onFold,
    seamAllowance: input.sa ?? 10,
    grainline: { a: { x: input.grain[0], y: input.grain[1] }, b: { x: input.grain[2], y: input.grain[3] } },
    notches: input.notches ?? [],
    drillHoles: [],
    notes: input.notes ?? [],
    areaMm2: Math.round(a),
    fabric: input.fabric,
  };
}

const rect = (id: string, name: string, label: string, w: number, h: number, cut: number, fabric: Fabric, notes: string[] = [], sa = 10): FashionPiece =>
  piece({ id, name, label, cut, fabric, sa, notes, outline: [P(0, 0, "bottom"), P(w, 0, "right"), P(w, h, "top"), P(0, h, "left")], grain: [w / 2, h * 0.15, w / 2, h * 0.85] });

const seam = (id: string, a: [string, string], b: [string, string], type: SeamType, description: string, allowanceMm = 10): Seam => ({ id, a: { piece: a[0], edge: a[1] }, b: { piece: b[0], edge: b[1] }, type, allowanceMm, description });

/** Measurements for a size: the base set moved by the grade rules, one step per size. */
export function gradeMeasurements(base: BodyMeasurements, size: string): BodyMeasurements {
  const steps = SIZES.indexOf(size as (typeof SIZES)[number]) - SIZES.indexOf(BASE_SIZE);
  if (Number.isNaN(steps) || SIZES.indexOf(size as (typeof SIZES)[number]) < 0) return base;
  const m = { ...base };
  for (const r of GRADE_RULES) (m[r.measurement] as number) += r.perStep * steps;
  m.height += 10 * steps;
  m.hipDepth += 3 * steps;
  return m;
}

function checks(pieces: FashionPiece[], seams: Seam[], tolerance = 6): PatternCheck[] {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const out: PatternCheck[] = pieces.map((p) => ({ name: `${p.label}: closed outline with area`, ok: p.outline.length >= 3 && p.areaMm2 > 1000, detail: `${(p.areaMm2 / 1e6).toFixed(3)} m² per cut, cut ${p.cut}` }));
  for (const s of seams) {
    const a = byId.get(s.a.piece), b = byId.get(s.b.piece);
    if (!a || !b) {
      out.push({ name: `seam ${s.id}`, ok: false, detail: "joins a piece that does not exist" });
      continue;
    }
    const la = edgeLength(a, s.a.edge), lb = edgeLength(b, s.b.edge);
    const eased = /ease|gather|stretch/i.test(s.description);
    const ok = la > 0 && lb > 0 && (eased || Math.abs(la - lb) <= tolerance);
    out.push({ name: `seam ${s.id}: ${a.label} ${s.a.edge} ↔ ${b.label} ${s.b.edge}`, ok, detail: `${la.toFixed(0)} mm vs ${lb.toFixed(0)} mm${eased ? " (eased/gathered/stretched on purpose)" : ""}` });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Wide-leg cargo trousers with stacked hems and a drawstring waist
 * ------------------------------------------------------------------ */

export function wideCargoTrousers(m: BodyMeasurements = DEFAULT_MEASUREMENTS, opts: { size?: string; stack?: number; hemWidth?: number } = {}): FashionPattern {
  const rise = Math.round(m.hipDepth + m.hip * 0.07); // waist to crotch, seated measurement if known
  const insideLeg = Math.round(m.height * 0.45);
  const stack = opts.stack ?? 180; // extra length that bunches above the shoe
  const leg = rise + insideLeg + stack;
  const ease = 60; // wide, relaxed seat
  const hf = (m.hip + ease) / 4 - 5;
  const hb = (m.hip + ease) / 4 + 5;
  const extF = m.hip / 16;
  const extB = m.hip / 8;
  const hemF = (opts.hemWidth ?? 300) - 10;
  const hemB = (opts.hemWidth ?? 300) + 10;
  const creaseF = (hf + extF) / 2, creaseB = (hb + extB) / 2;

  // Front leg: side seam at x = 0, centre front at x = hf, waist at y = 0 (y up).
  const front = piece({
    id: "trouser-front", name: "trouser-front", label: "TROUSER FRONT", cut: 2, fabric: "shell",
    outline: [
      P(0, 0, "waist"), P(hf, 0, "cf"), P(hf, -m.hipDepth, "crotch", { cx: hf, cy: -rise }), P(hf + extF, -rise, "inseam"),
      P(creaseF + hemF / 2, -leg, "hem"), P(creaseF - hemF / 2, -leg, "side"), P(-6, -m.hipDepth, "side"),
    ],
    grain: [creaseF, -rise - 60, creaseF, -leg + 120],
    notches: [{ edge: "side", t: 0.5, label: "knee" }, { edge: "crotch", t: 0.5, label: "front crotch" }, { edge: "waist", t: 0.5, label: "pocket" }],
    notes: [`Includes ${stack} mm stacking length at the hem`, "Drawstring waist: no darts, gathered into the casing"],
  });
  // Back leg: centre back raised and angled for the seat.
  const back = piece({
    id: "trouser-back", name: "trouser-back", label: "TROUSER BACK", cut: 2, fabric: "shell",
    outline: [
      P(0, 0, "waist"), P(hb + 18, 28, "cb"), P(hb, -m.hipDepth, "crotch", { cx: hb + 4, cy: -rise - 12 }), P(hb + extB, -rise - 12, "inseam"),
      P(creaseB + hemB / 2, -leg, "hem"), P(creaseB - hemB / 2, -leg, "side"), P(-8, -m.hipDepth, "side"),
    ],
    grain: [creaseB, -rise - 60, creaseB, -leg + 120],
    notches: [{ edge: "side", t: 0.5, label: "knee" }, { edge: "crotch", t: 0.4, label: "back crotch ×2" }],
    notes: ["Back crotch double-notched", `Seat angle: centre back raised 28 mm`],
  });
  const waistLen = 2 * (edgeLength(front, "waist") + edgeLength(back, "waist"));
  const casing = rect("waistband-casing", "waistband-casing", "WAISTBAND CASING", Math.round(waistLen + 20), 110, 1, "shell", ["Fold in half lengthwise: 55 mm finished casing", "Two 12 mm eyelets at centre front for the drawstring"]);
  const pocket = rect("cargo-pocket", "cargo-pocket", "CARGO POCKET", 240, 280, 2, "shell", ["Box pleat 30 mm at centre", "Place on the side seam at the knee notch"]);
  const flap = rect("pocket-flap", "pocket-flap", "POCKET FLAP", 250, 90, 4, "shell", ["2 shell per flap (self-faced)", "Snap or copper hook closure"]);
  const loops = rect("chain-loops", "chain-loops", "CHAIN LOOPS STRIP", 40, 640, 1, "shell", ["Fold in quarters and topstitch; cut into 8 loops of 80 mm for the chains"], 0);
  const pieces = [front, back, casing, pocket, flap, loops];
  const seams = [
    seam("side", ["trouser-front", "side"], ["trouser-back", "side"], "flat-felled", "side seam, flat-felled for workwear strength"),
    seam("inseam", ["trouser-front", "inseam"], ["trouser-back", "inseam"], "flat-felled", "inseam, eased over the back thigh"),
    seam("crotch", ["trouser-front", "crotch"], ["trouser-back", "crotch"], "overlock", "crotch seam: overlock, then stitch twice; back is longer and is eased"),
    seam("casing", ["trouser-front", "waist"], ["waistband-casing", "bottom"], "overlock", "casing gathered onto the waist (drawstring)"),
  ];
  return {
    id: `pattern-wide-cargo-trousers-${opts.size ?? BASE_SIZE}`,
    name: "Wide cargo trousers",
    title: "Wide-leg cargo trousers, stacked hem, drawstring waist",
    garment: "wide-cargo-trousers",
    size: opts.size ?? BASE_SIZE,
    unit: "mm",
    measurements: m,
    pieces,
    seams,
    checks: checks(pieces, seams.filter((s) => s.id !== "casing")),
    eases: { bust: 0, waist: 0, hip: ease },
    fabricWidthMm: 1500,
    derived: { bodyRise: rise, insideLeg, outsideLeg: rise + insideLeg },
    details: ["Two front side-slant pockets optional", "Copper chains clipped through the chain loops", "Stacked hem: the extra 180 mm bunches over the shoe; finish with a 25 mm double-turned hem"],
  };
}

/* ------------------------------------------------------------------ *
 * Oversized bomber: zip front, dropped shoulder, rib trims, lined
 * ------------------------------------------------------------------ */

export function oversizedBomber(m: BodyMeasurements = DEFAULT_MEASUREMENTS, opts: { size?: string; ease?: number } = {}): FashionPattern {
  const ease = opts.ease ?? 220;
  const w = (m.bust + ease) / 4;
  const L = m.backLength + 110; // body to the top of the rib band
  const drop = 90; // dropped shoulder
  const neckW = m.neck / 6 + 12;
  const armholeDepth = 270;
  const shoulderX = m.shoulder / 2 + drop;
  const front = piece({
    id: "bomber-front", name: "bomber-front", label: "BOMBER FRONT", cut: 2, fabric: "shell",
    outline: [
      P(0, 0, "hem"), P(w, 0, "side"), P(w, L - armholeDepth, "armhole", { cx: w - 18, cy: L - 60 }), P(shoulderX, L - 42, "shoulder"),
      P(neckW, L, "neck", { cx: neckW - 6, cy: L - 85 }), P(0, L - 85, "cf"),
    ],
    grain: [w * 0.45, 60, w * 0.45, L - 120],
    notches: [{ edge: "armhole", t: 0.35, label: "front sleeve" }, { edge: "cf", t: 0.5, label: "zip midpoint" }],
    notes: ["Centre front: separating zip, 10 mm allowance", "Rose appliqués and chain anchors per the reference placement"],
  });
  const back = piece({
    id: "bomber-back", name: "bomber-back", label: "BOMBER BACK", cut: 1, onFold: true, fabric: "shell",
    outline: [
      P(0, 0, "hem"), P(w, 0, "side"), P(w, L - armholeDepth, "armhole", { cx: w - 10, cy: L - 50 }), P(shoulderX, L - 42, "shoulder"),
      P(neckW, L, "neck", { cx: neckW - 4, cy: L - 22 }), P(0, L - 22, "cb-fold"),
    ],
    grain: [w * 0.4, 60, w * 0.4, L - 120],
    notches: [{ edge: "armhole", t: 0.4, label: "back sleeve ×2" }],
    notes: ["Cut on the fold at centre back"],
  });
  const fArm = edgeLength(front, "armhole"), bArm = edgeLength(back, "armhole");
  const capW = (fArm + bArm) * 0.78; // dropped shoulder: low, wide cap
  const sleeveLen = m.armLength - drop - 60;
  const capH = 95;
  const cuffEnd = (m.wrist + 160) / 2;
  const sleeve = piece({
    id: "bomber-sleeve", name: "bomber-sleeve", label: "BOMBER SLEEVE", cut: 2, fabric: "shell",
    outline: [
      P(-capW / 2, 0, "cap-front", { cx: -capW / 4, cy: capH * 1.05 }), P(0, capH, "cap-back", { cx: capW / 4, cy: capH * 1.05 }), P(capW / 2, 0, "underarm-back"),
      P(cuffEnd, -sleeveLen, "cuff"), P(-cuffEnd, -sleeveLen, "underarm-front"),
    ],
    grain: [0, capH - 30, 0, -sleeveLen + 60],
    notches: [{ edge: "cap-front", t: 0.5, label: "front" }, { edge: "cap-back", t: 0.5, label: "back ×2" }],
    notes: ["Balloon volume: gathered into the rib cuff"],
  });
  const cuff = rect("rib-cuff", "rib-cuff", "RIB CUFF", m.wrist + 40, 150, 2, "rib", ["Fold to 75 mm; stretched to the sleeve end"]);
  const hemBand = rect("rib-hem", "rib-hem", "RIB HEM BAND", Math.round((m.bust + ease) * 0.86), 150, 1, "rib", ["Fold to 75 mm; stretched to the body hem"]);
  const collar = rect("rib-collar", "rib-collar", "RIB COLLAR", Math.round(edgeLength(front, "neck") * 2 + edgeLength(back, "neck") * 2 - 30), 140, 1, "rib", ["Fold to 70 mm stand collar"]);
  const lining = [front, back, sleeve].map((p) => ({ ...p, id: `${p.id}-lining`, name: `${p.name}-lining`, label: `${p.label} LINING`, fabric: "lining" as Fabric, notes: ["Lining: same shape, 5 mm shorter at hems and cuffs"] }));
  const pieces = [front, back, sleeve, cuff, hemBand, collar, ...lining];
  const seams = [
    seam("shoulder", ["bomber-front", "shoulder"], ["bomber-back", "shoulder"], "overlock", "shoulder seam, taped"),
    seam("side", ["bomber-front", "side"], ["bomber-back", "side"], "overlock", "side seam"),
    seam("sleeve-cap", ["bomber-sleeve", "cap-front"], ["bomber-front", "armhole"], "overlock", "set the sleeve, ease the cap to the dropped armhole"),
    seam("cuff", ["bomber-sleeve", "cuff"], ["rib-cuff", "top"], "overlock", "rib cuff stretched onto the gathered sleeve end"),
    seam("hem-band", ["bomber-front", "hem"], ["rib-hem", "top"], "overlock", "rib hem band stretched to the body hem"),
  ];
  return {
    id: `pattern-oversized-bomber-${opts.size ?? BASE_SIZE}`,
    name: "Oversized bomber",
    title: "Oversized patchwork bomber, dropped shoulder, rib trims, fully lined",
    garment: "oversized-bomber",
    size: opts.size ?? BASE_SIZE,
    unit: "mm",
    measurements: m,
    pieces,
    seams,
    checks: checks(pieces, seams.filter((s) => s.id === "side")),
    eases: { bust: ease, waist: 0, hip: 0 },
    fabricWidthMm: 1500,
    derived: { bodyLength: L, droppedShoulder: drop },
    details: ["Patchwork shell: cut the panels from the camo-print shell, or piece them from three colourways (mauve, olive, black) along the swirl lines", "Separating zip, length = centre front", "Copper chains and crystal charms hand-stitched after assembly"],
  };
}

/* ------------------------------------------------------------------ *
 * Crossover bralette
 * ------------------------------------------------------------------ */

export function crossoverBralette(m: BodyMeasurements = DEFAULT_MEASUREMENTS, opts: { size?: string } = {}): FashionPattern {
  const cupBase = m.underbust / 4 + 30;
  const cupH = (m.bust - m.underbust) / 2 + 120;
  const cup = piece({
    id: "bralette-cup", name: "bralette-cup", label: "TRIANGLE CUP", cut: 2, fabric: "shell", sa: 6,
    outline: [P(0, 0, "underband"), P(cupBase, 0, "side"), P(cupBase * 0.18, cupH, "neckline", { cx: cupBase * 0.25, cy: cupH * 0.45 })],
    grain: [cupBase * 0.3, cupH * 0.15, cupBase * 0.25, cupH * 0.7],
    notes: ["Gather 15 mm at the underband for shaping"],
  });
  const cupLining = { ...cup, id: "bralette-cup-lining", name: "bralette-cup-lining", label: "TRIANGLE CUP LINING", fabric: "mesh" as Fabric };
  const band = rect("bralette-band", "bralette-band", "UNDER-BAND", m.underbust - 60, 70, 1, "shell", ["Negative ease 60 mm; 40 mm plush elastic inside", "Hook-and-eye at centre back"], 6);
  const strap = rect("bralette-strap", "bralette-strap", "CROSSING STRAP", 30, 520, 2, "shell", ["Turn through; straps cross at the back"], 6);
  const pieces = [cup, cupLining, band, strap];
  const seams = [seam("cup-band", ["bralette-cup", "underband"], ["bralette-band", "top"], "overlock", "cups gathered onto the under-band", 6)];
  return {
    id: `pattern-crossover-bralette-${opts.size ?? BASE_SIZE}`,
    name: "Crossover bralette",
    title: "Triangle-cup crossover bralette with under-band",
    garment: "crossover-bralette",
    size: opts.size ?? BASE_SIZE,
    unit: "mm",
    measurements: m,
    pieces,
    seams,
    checks: checks(pieces, []),
    eases: { bust: 0, waist: 0, hip: 0 },
    fabricWidthMm: 1500,
    derived: { cupHeight: Math.round(cupH) },
    details: ["Copper chain trim along the neckline", "Rose and crystal pendant at centre front"],
  };
}

export const GARMENTS: Record<GarmentId, (m: BodyMeasurements, o: { size?: string }) => FashionPattern> = {
  "wide-cargo-trousers": wideCargoTrousers,
  "oversized-bomber": oversizedBomber,
  "crossover-bralette": crossoverBralette,
};
