/**
 * ==========================================================
 * LÉLU — TEXTILE & MATERIAL INTELLIGENCE
 *
 * Every material carries two property systems — how it looks
 * (PBR) and how it behaves (GSM, thickness, stretch, bending,
 * shear, friction, damping, shrinkage) — plus provenance for
 * every value.
 *
 * NOTHING HERE IS A LABORATORY MEASUREMENT. Each record says how
 * its numbers are known: industry-typical ranges compiled in this
 * file, a published typical value, a supplier datasheet, or a
 * value the user supplied. `measured` is the literal false unless
 * a test result is attached by the user, so no report can call
 * these numbers measured.
 *
 * Units are fixed and stated once, not per field:
 *   gsm g/m² · thickness mm · stretch % · bending mN·cm
 *   (cantilever) · shear N/m (low shear) · friction μ ·
 *   damping ratio · shrinkage % (warp, weft).
 * ==========================================================
 */

import { clamp, round } from "./geometry";

export type MaterialCategory =
  | "natural" | "luxury" | "technical" | "leather" | "metal" | "glass" | "ceramic" | "gemstone" | "composite";

export type Confidence = "low" | "medium" | "high";

export type ProvenanceBasis =
  | "industry-typical range"
  | "published typical value"
  | "supplier datasheet"
  | "user-supplied"
  | "estimated";

export interface Provenance {
  basis: ProvenanceBasis;
  /** Where the range comes from. Required for anything but an estimate. */
  source?: string;
  confidence: Confidence;
  /** Literal false: this library holds no laboratory measurement. */
  measured: false;
  /** What the value is NOT, when that matters. */
  note?: string;
}

export interface VisualProperties {
  /** sRGB hex. */
  baseColor: string;
  roughness: number;
  metallic: number;
  /** 0–1; how much light passes through (silk chiffon, organza, tulle). */
  transmission: number;
  ior: number;
  /** Fabric sheen at grazing angles — the velvet/satin difference. */
  sheen: number;
  sheenColor: string;
  sheenRoughness: number;
  iridescence: number;
  clearcoat: number;
  /** Displacement amplitude for surface texture, mm (weave, ribs, grain). */
  displacementMm: number;
  opacity: number;
  doubleSided: boolean;
}

export interface PhysicalProperties {
  gsm: number;
  thicknessMm: number;
  stretch: { warpPct: number; weftPct: number; biasPct: number };
  bendingStiffness: number;
  shearStiffness: number;
  friction: number;
  dampingRatio: number;
  shrinkagePct: { warp: number; weft: number };
  /** Fibre + weave, in words. */
  construction: string;
  /** Drapemeter drape coefficient, % — omitted when not known. */
  drapeCoefficientPct?: number;
}

/** A solid (metal, glass, gem, ceramic) rather than a cloth. */
export interface SolidProperties {
  densityGCm3: number;
  /** Refractive index for gemstones and glass. */
  refractiveIndex?: number;
  /** Mohs hardness, where it is meaningful. */
  hardnessMohs?: number;
  finish: string;
}

export interface CoutureMaterial {
  id: string;
  name: string;
  category: MaterialCategory;
  fibre: string;
  visual: VisualProperties;
  physical?: PhysicalProperties;
  solid?: SolidProperties;
  provenance: Provenance;
  tags: string[];
  /** What this material actually does when it is draped or worn. */
  behaviour: string;
  /** Anything a maker must know before cutting it. */
  makingNotes: string[];
}

const VISUAL_DEFAULTS: VisualProperties = {
  baseColor: "#cccccc",
  roughness: 0.7,
  metallic: 0,
  transmission: 0,
  ior: 1.45,
  sheen: 0,
  sheenColor: "#ffffff",
  sheenRoughness: 0.5,
  iridescence: 0,
  clearcoat: 0,
  displacementMm: 0.05,
  opacity: 1,
  doubleSided: true,
};

type ClothDraft = {
  id: string;
  name: string;
  category: MaterialCategory;
  fibre: string;
  gsm: number;
  thicknessMm: number;
  stretch: [number, number, number];
  bending: number;
  shear: number;
  friction: number;
  damping: number;
  shrinkage: [number, number];
  construction: string;
  colour: string;
  roughness: number;
  metallic?: number;
  sheen?: number;
  transmission?: number;
  iridescence?: number;
  opacity?: number;
  visual?: Partial<VisualProperties>;
  tags: string[];
  behaviour: string;
  makingNotes: string[];
  basis?: ProvenanceBasis;
  confidence?: Confidence;
  drapePct?: number;
};

const CLOTH_BASIS = "industry-typical ranges compiled in this library (textile handbooks, mill datasheets), not measured here";

function cloth(d: ClothDraft): CoutureMaterial {
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    fibre: d.fibre,
    visual: {
      ...VISUAL_DEFAULTS,
      baseColor: d.colour,
      roughness: d.roughness,
      metallic: d.metallic ?? 0,
      sheen: d.sheen ?? 0,
      transmission: d.transmission ?? 0,
      iridescence: d.iridescence ?? 0,
      opacity: d.opacity ?? 1,
      sheenColor: d.visual?.sheenColor ?? "#fff6e8",
      ...d.visual,
    },
    physical: {
      gsm: d.gsm,
      thicknessMm: d.thicknessMm,
      stretch: { warpPct: d.stretch[0], weftPct: d.stretch[1], biasPct: d.stretch[2] },
      bendingStiffness: d.bending,
      shearStiffness: d.shear,
      friction: d.friction,
      dampingRatio: d.damping,
      shrinkagePct: { warp: d.shrinkage[0], weft: d.shrinkage[1] },
      construction: d.construction,
      drapeCoefficientPct: d.drapePct,
    },
    provenance: {
      basis: d.basis ?? "industry-typical range",
      source: CLOTH_BASIS,
      confidence: d.confidence ?? "medium",
      measured: false,
      note: "A starting point for simulation and costing; test the actual bolt before production.",
    },
    tags: d.tags,
    behaviour: d.behaviour,
    makingNotes: d.makingNotes,
  };
}

type SolidDraft = {
  id: string;
  name: string;
  category: MaterialCategory;
  colour: string;
  metallic: number;
  roughness: number;
  density: number;
  refractiveIndex?: number;
  hardness?: number;
  finish: string;
  transmission?: number;
  iridescence?: number;
  tags: string[];
  behaviour: string;
  makingNotes: string[];
  solidDensityBasis?: string;
};

function solid(d: SolidDraft): CoutureMaterial {
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    fibre: d.finish,
    visual: {
      ...VISUAL_DEFAULTS,
      baseColor: d.colour,
      metallic: d.metallic,
      roughness: d.roughness,
      transmission: d.transmission ?? 0,
      iridescence: d.iridescence ?? 0,
      clearcoat: d.metallic > 0.5 ? 0.15 : 0.4,
      doubleSided: false,
      displacementMm: 0,
      ior: d.refractiveIndex ?? 1.5,
    },
    solid: {
      densityGCm3: d.density,
      refractiveIndex: d.refractiveIndex,
      hardnessMohs: d.hardness,
      finish: d.finish,
    },
    provenance: {
      basis: "published typical value",
      source: d.solidDensityBasis ?? "standard handbook values for the alloy/stone named",
      confidence: "medium",
      measured: false,
      note: "Alloy and stone properties vary by grade; confirm with the supplier's datasheet.",
    },
    tags: d.tags,
    behaviour: d.behaviour,
    makingNotes: d.makingNotes,
  };
}

export const MATERIALS: CoutureMaterial[] = [
  /* ---------------- natural ---------------- */
  cloth({
    id: "cotton-poplin", name: "Cotton poplin", category: "natural", fibre: "100% cotton",
    gsm: 120, thicknessMm: 0.22, stretch: [2, 2, 4], bending: 11, shear: 3.2, friction: 0.42, damping: 0.14,
    shrinkage: [2.5, 2], construction: "plain weave, combed 60s warp × 60s weft", colour: "#e8e5dc",
    roughness: 0.82, tags: ["shirting", "structured", "beginner"],
    behaviour: "Holds a crisp fold, creases sharply and takes a press; stable on the bias but not forgiving of a bad grainline.",
    makingNotes: ["Pre-wash: 2–2.5% warp shrinkage will shorten a bodice.", "Press with steam to set seams flat."],
    drapePct: 52,
  }),
  cloth({
    id: "cotton-jersey", name: "Cotton jersey", category: "natural", fibre: "95% cotton, 5% elastane",
    gsm: 180, thicknessMm: 0.45, stretch: [18, 32, 40], bending: 4, shear: 1.1, friction: 0.5, damping: 0.2,
    shrinkage: [4, 3], construction: "single jersey, 28 gauge", colour: "#f2f0ea", roughness: 0.86,
    tags: ["knit", "casual", "stretch"],
    behaviour: "Stretches most across the weft, so a bodice cut on the cross will cling; the bias stretches almost as much again.",
    makingNotes: ["Use a ballpoint needle and a stretch stitch.", "Let it relax 24 h before cutting — the width can grow."],
    drapePct: 68,
  }),
  cloth({
    id: "linen", name: "Linen", category: "natural", fibre: "100% flax",
    gsm: 165, thicknessMm: 0.3, stretch: [1.5, 2, 5], bending: 20, shear: 4.5, friction: 0.4, damping: 0.12,
    shrinkage: [4, 3], construction: "plain weave, wet-spun flax", colour: "#d9cfb8", roughness: 0.9,
    tags: ["summer", "structured", "slub"],
    behaviour: "Stiff until it is worn and washed, then it softens into deep, soft folds; creases are the material's character, not a defect.",
    makingNotes: ["Wash and tumble-dry before cutting: 4% warp shrinkage is normal.", "Plan for fraying at raw edges."],
    drapePct: 45,
  }),
  cloth({
    id: "wool-crepe", name: "Wool crepe", category: "natural", fibre: "100% merino wool",
    gsm: 230, thicknessMm: 0.55, stretch: [3, 4, 9], bending: 17, shear: 3.8, friction: 0.48, damping: 0.22,
    shrinkage: [1.5, 1], construction: "crepe weave, 2/2 twill base", colour: "#2f2b28", roughness: 0.8,
    tags: ["tailoring", "winter", "drape"],
    behaviour: "Drapes heavily and holds a sculptural fold; the crepe texture hides seam impressions and keeps edges from curling.",
    makingNotes: ["Steam-shrink before cutting.", "A tailor's ham is essential for pressing darts."],
    drapePct: 62,
  }),

  /* ---------------- luxury ---------------- */
  cloth({
    id: "silk-satin", name: "Silk satin (duchesse face)", category: "luxury", fibre: "100% mulberry silk",
    gsm: 110, thicknessMm: 0.24, stretch: [2, 2, 6], bending: 6, shear: 1.6, friction: 0.28, damping: 0.1,
    shrinkage: [1, 1], construction: "5-end satin weave, 22 momme", colour: "#f4e7d3",
    roughness: 0.26, sheen: 0.85, tags: ["luxury", "liquid", "bias"],
    behaviour: "Flows along the bias and pours over the body; the satin face catches light in a moving highlight while the reverse stays matte.",
    makingNotes: ["Lay up in one direction: the face changes colour with the grain.", "Use silk pins and a fine microtex needle."],
    drapePct: 82,
  }),
  cloth({
    id: "silk-charmeuse", name: "Silk charmeuse", category: "luxury", fibre: "100% mulberry silk",
    gsm: 90, thicknessMm: 0.2, stretch: [2, 2, 8], bending: 4, shear: 1.2, friction: 0.26, damping: 0.09,
    shrinkage: [1.5, 1], construction: "satin weave, 19 momme, crepe back", colour: "#e6d3c4",
    roughness: 0.3, sheen: 0.9, tags: ["luxury", "lingerie", "bias"],
    behaviour: "Almost liquid: it finds every curve and refuses a sharp fold. Bias-cut charmeuse grows as it hangs.",
    makingNotes: ["Hang a bias-cut panel 24 h before hemming.", "French seams only — an overlock shows through."],
    drapePct: 88,
  }),
  cloth({
    id: "silk-organza", name: "Silk organza", category: "luxury", fibre: "100% silk",
    gsm: 35, thicknessMm: 0.08, stretch: [1, 1, 3], bending: 22, shear: 6.5, friction: 0.3, damping: 0.08,
    shrinkage: [1, 1], construction: "plain weave, tightly twisted 2-ply silk", colour: "#f7f1e6",
    roughness: 0.4, sheen: 0.45, transmission: 0.55, tags: ["sheer", "structure", "couture"],
    behaviour: "Holds a standing shape: a sculpted organza shell keeps its own silhouette and reads as translucent volume, not cloth.",
    makingNotes: ["Cut with tissue under the blade — it slips.", "French seams or binding; a raw edge shows."],
    drapePct: 30,
  }),
  cloth({
    id: "silk-chiffon", name: "Silk chiffon", category: "luxury", fibre: "100% silk",
    gsm: 30, thicknessMm: 0.07, stretch: [1, 1, 4], bending: 2, shear: 0.8, friction: 0.24, damping: 0.07,
    shrinkage: [2, 1.5], construction: "open crepe plain weave", colour: "#fbf6ef",
    roughness: 0.55, sheen: 0.3, transmission: 0.7, tags: ["sheer", "float", "couture"],
    behaviour: "Floats rather than falls; it is the lightest thing in the room and will not hold a pleat without support.",
    makingNotes: ["Spray starch or gelatin sizing before cutting.", "Never hang: store flat."],
    drapePct: 92,
  }),
  cloth({
    id: "silk-tulle", name: "Silk tulle", category: "luxury", fibre: "100% silk",
    gsm: 22, thicknessMm: 0.06, stretch: [3, 3, 5], bending: 8, shear: 2.4, friction: 0.35, damping: 0.15,
    shrinkage: [0.5, 0.5], construction: "hexagonal bobbinet mesh", colour: "#fdf8f2",
    roughness: 0.5, sheen: 0.25, transmission: 0.85, tags: ["sheer", "volume", "bridal"],
    behaviour: "Layers into cloud-like volume; a hundred layers weighs almost nothing, and each one moves independently.",
    makingNotes: ["Layer and pin in stacks; baste through all layers.", "Edges are usually left raw or bound with ribbon."],
    drapePct: 74,
  }),
  cloth({
    id: "velvet-silk", name: "Silk velvet", category: "luxury", fibre: "silk pile on silk ground",
    gsm: 280, thicknessMm: 0.9, stretch: [3, 3, 8], bending: 12, shear: 2.8, friction: 0.6, damping: 0.3,
    shrinkage: [1, 1], construction: "warp-pile velvet, 2-pile", colour: "#3a1030",
    roughness: 0.85, sheen: 0.55, visual: { sheenRoughness: 0.25, sheenColor: "#ffd9ea" }, tags: ["luxury", "depth", "pile"],
    behaviour: "Absorbs light into the pile and answers with a soft glow at the shoulder line; the nap changes colour in the hand.",
    makingNotes: ["Cut all pieces with the nap running one way.", "Never press the pile — steam from the back."],
    drapePct: 58,
  }),
  cloth({
    id: "silk-taffeta", name: "Silk taffeta", category: "luxury", fibre: "100% silk",
    gsm: 95, thicknessMm: 0.18, stretch: [1, 1, 4], bending: 26, shear: 7, friction: 0.32, damping: 0.1,
    shrinkage: [1, 1], construction: "plain weave, fine slub weft", colour: "#7d1f3a",
    roughness: 0.35, sheen: 0.6, iridescence: 0.2, tags: ["structure", "ballgown", "crisp"],
    behaviour: "Scrunchy and architectural: it holds volume on its own and whispers when it moves.",
    makingNotes: ["Pin inside the seam allowance only — pin marks are permanent.", "Seams can be pressed open without shine at low heat."],
    drapePct: 40,
  }),
  cloth({
    id: "silk-mikado", name: "Silk mikado", category: "luxury", fibre: "100% silk",
    gsm: 220, thicknessMm: 0.5, stretch: [1, 1, 4], bending: 30, shear: 8, friction: 0.34, damping: 0.12,
    shrinkage: [1, 1], construction: "dense ribbed satin", colour: "#efe9e2",
    roughness: 0.32, sheen: 0.7, tags: ["sculpture", "bridal", "structure"],
    behaviour: "The couture sculpting cloth: it stands in a fold, holds a peplum and takes a knife pleat with a memory.",
    makingNotes: ["Steam-shape over a ham rather than pressing flat.", "Use a walking foot — it is heavy and shifts."],
    drapePct: 28,
  }),

  /* ---------------- technical ---------------- */
  cloth({
    id: "nylon-ripstop", name: "Nylon ripstop", category: "technical", fibre: "100% nylon 6.6",
    gsm: 70, thicknessMm: 0.12, stretch: [2, 2, 3], bending: 9, shear: 3, friction: 0.3, damping: 0.2,
    shrinkage: [0.5, 0.5], construction: "ripstop plain weave, 20D", colour: "#20262b",
    roughness: 0.4, tags: ["technical", "outerwear", "light"],
    behaviour: "Light, crisp and almost waterproof; the ripstop grid stops a tear and gives the cloth a faint quilted read.",
    makingNotes: ["Heat-seal or tape seams for weatherproofing.", "Low pin density: pin holes are permanent."],
    drapePct: 44,
  }),
  cloth({
    id: "polyester-satin", name: "Polyester satin", category: "technical", fibre: "100% polyester",
    gsm: 100, thicknessMm: 0.2, stretch: [2, 2, 5], bending: 7, shear: 2, friction: 0.3, damping: 0.12,
    shrinkage: [0.5, 0.5], construction: "satin weave, 75D", colour: "#1a1f3a",
    roughness: 0.28, sheen: 0.8, tags: ["evening", "budget", "liquid"],
    behaviour: "A sharper, cooler highlight than silk and a faster fall; it resists creasing and takes dye vividly.",
    makingNotes: ["Low iron only — it glazes above 150 °C.", "Static: use an anti-static lining."],
    drapePct: 78,
  }),
  cloth({
    id: "elastane-jersey", name: "Elastane power mesh", category: "technical", fibre: "80% nylon, 20% elastane",
    gsm: 150, thicknessMm: 0.35, stretch: [45, 65, 80], bending: 1.5, shear: 0.4, friction: 0.55, damping: 0.28,
    shrinkage: [2, 2], construction: "warp knit power mesh", colour: "#14131a",
    roughness: 0.6, sheen: 0.15, transmission: 0.25, tags: ["stretch", "support", "activewear"],
    behaviour: "Pulls back hard: it compresses the body and returns to shape, which is why it is used for support layers.",
    makingNotes: ["Negative ease is the point — cut smaller than the body.", "Overlock with woolly nylon; do not stretch the seam."],
    drapePct: 24,
  }),
  cloth({
    id: "technical-mesh", name: "Technical mesh", category: "technical", fibre: "100% polyester",
    gsm: 85, thicknessMm: 0.25, stretch: [10, 14, 18], bending: 3, shear: 1.2, friction: 0.5, damping: 0.22,
    shrinkage: [1, 1], construction: "open warp knit, hexagonal", colour: "#2b3a44",
    roughness: 0.65, transmission: 0.45, tags: ["technical", "ventilation", "sport"],
    behaviour: "Holds a three-dimensional stand-off from the body and lets air through; reads as structure with see-through.",
    makingNotes: ["Bond or bind edges — an overlock crushes the holes.", "Cut with a hot knife to stop fraying."],
    drapePct: 36,
  }),
  cloth({
    id: "neoprene", name: "Neoprene (SBR, jersey faced)", category: "technical", fibre: "chloroprene foam, nylon jersey face",
    gsm: 480, thicknessMm: 2, stretch: [12, 12, 16], bending: 55, shear: 9, friction: 0.7, damping: 0.4,
    shrinkage: [0.5, 0.5], construction: "closed-cell foam laminated both sides", colour: "#0e1418",
    roughness: 0.75, tags: ["scuba", "structure", "sculpture"],
    behaviour: "A slab, not a cloth: it holds a cut edge, carries a seam without support and makes volume with almost no weight penalty.",
    makingNotes: ["Do not pin — the holes stay; use clips.", "Seams are usually butted and glued or zigzagged."],
    drapePct: 6,
  }),

  /* ---------------- leather ---------------- */
  cloth({
    id: "leather-lambskin", name: "Lambskin leather", category: "leather", fibre: "chrome-tanned lambskin",
    gsm: 700, thicknessMm: 0.7, stretch: [6, 10, 14], bending: 120, shear: 14, friction: 0.62, damping: 0.35,
    shrinkage: [0.5, 0.5], construction: "full-grain hide, 0.6–0.8 mm", colour: "#2a1a12",
    roughness: 0.55, sheen: 0.2, visual: { clearcoat: 0.25 }, tags: ["leather", "outerwear", "luxury"],
    behaviour: "Behaves as a stiff shell: it holds a stand collar and a sculpted seam, and creases where the body bends.",
    makingNotes: ["Cut single layer, mirror pairs; hide defects must be avoided.", "Skive seams — bulk is unforgiving."],
    drapePct: 12,
  }),
  cloth({
    id: "suede", name: "Goat suede", category: "leather", fibre: "chrome-tanned goat suede",
    gsm: 520, thicknessMm: 0.55, stretch: [8, 12, 18], bending: 75, shear: 10, friction: 0.75, damping: 0.3,
    shrinkage: [0.5, 0.5], construction: "napped split hide", colour: "#8a6a52",
    roughness: 0.95, sheen: 0.3, visual: { sheenColor: "#d8bb9a", sheenRoughness: 0.8 }, tags: ["leather", "soft", "nap"],
    behaviour: "Velvet-soft on the surface and directional in the hand; it sags into rounded folds rather than creasing.",
    makingNotes: ["Nap direction must be consistent across all pieces.", "Brush rather than press."],
    drapePct: 26,
  }),
  cloth({
    id: "metallic-lame", name: "Metallic lamé", category: "technical", fibre: "metallised polyester film on mesh",
    gsm: 140, thicknessMm: 0.18, stretch: [4, 6, 9], bending: 14, shear: 3, friction: 0.35, damping: 0.14,
    shrinkage: [0.5, 0.5], construction: "film-coated knit base", colour: "#c9a45c",
    roughness: 0.2, metallic: 0.85, tags: ["metallic", "evening", "mirror"],
    makingNotes: ["Fingerprints and pin marks are permanent.", "Line it: the reverse is scratchy."],
    behaviour: "Mirror-like and unforgiving: every fold reads as a hard facet of light rather than a soft shadow.",
    drapePct: 48,
  }),

  /* ---------------- solids: metals, glass, ceramic, composite ---------------- */
  solid({ id: "gold-18k", name: "18k yellow gold", category: "metal", colour: "#e6c069", metallic: 1, roughness: 0.18, density: 15.6, finish: "polished 18k (750) yellow gold", tags: ["jewelry", "luxury", "castable"], behaviour: "Warm, dense and highly reflective; castable and repairable, which is why fine settings use it.", makingNotes: ["Alloy and hallmark vary by market.", "Cast shrinkage ~1.5% must be in the model."] }),
  solid({ id: "silver-925", name: "Sterling silver 925", category: "metal", colour: "#d8dde2", metallic: 1, roughness: 0.22, density: 10.36, finish: "polished sterling silver", tags: ["jewelry", "affordable"], behaviour: "Bright and white; tarnishes, so a rhodium flash is usual on a production piece.", makingNotes: ["Firescale if soldered without protection."] }),
  solid({ id: "platinum-950", name: "Platinum 950", category: "metal", colour: "#e8e9ec", metallic: 1, roughness: 0.16, density: 20.7, finish: "polished platinum 950", tags: ["jewelry", "heirloom"], behaviour: "Dense and grey-white; wears by burnishing rather than losing metal.", makingNotes: ["High melting point; different bench workflow."] }),
  solid({ id: "titanium", name: "Titanium grade 5", category: "metal", colour: "#9aa0a6", metallic: 1, roughness: 0.34, density: 4.43, finish: "brushed Ti-6Al-4V", tags: ["wearable", "light", "aerospace"], behaviour: "Light and strong with a cool grey read; anodises to colour without pigment.", makingNotes: ["Difficult to machine; galling at tools.", "Not for a skin-contact wear test without a passivated finish."] }),
  solid({ id: "copper", name: "Copper", category: "metal", colour: "#c07443", metallic: 1, roughness: 0.3, density: 8.96, finish: "polished copper", tags: ["sculpture", "conductive"], behaviour: "Red-warm and changing: it oxidises toward brown and green with handling.", makingNotes: ["Clear-coat if the surface must stay bright."] }),
  solid({ id: "aluminium-anodised", name: "Anodised aluminium 6061", category: "metal", colour: "#8d949c", metallic: 0.95, roughness: 0.4, density: 2.7, finish: "clear anodised 6061-T6", tags: ["product", "housing", "light"], behaviour: "Matte-metallic and light; anodising gives a hard, non-conductive skin for a housing.", makingNotes: ["Anodise colour must be specified per batch."] }),
  solid({ id: "borosilicate-glass", name: "Borosilicate glass", category: "glass", colour: "#dfeef2", metallic: 0, roughness: 0.03, density: 2.23, transmission: 0.92, refractiveIndex: 1.47, hardness: 5.5, finish: "polished borosilicate", tags: ["glass", "transparent", "vessel"], behaviour: "Clear and thermally forgiving; a thick section tints green and bends light at the rim.", makingNotes: ["Annealing schedule matters for thick sections."] }),
  solid({ id: "sapphire-crystal", name: "Sapphire crystal", category: "glass", colour: "#eaf2f6", metallic: 0, roughness: 0.02, density: 3.98, transmission: 0.95, refractiveIndex: 1.77, hardness: 9, finish: "polished synthetic sapphire", tags: ["wearable", "watch", "scratch-resistant"], behaviour: "Almost scratch-proof and optically clear; its high index makes it read as a deep, glossy window.", makingNotes: ["Expensive; AR-coating is typical."] }),
  solid({ id: "ceramic-porcelain", name: "Porcelain", category: "ceramic", colour: "#f4f1ea", metallic: 0, roughness: 0.25, density: 2.4, hardness: 7, finish: "glazed porcelain", tags: ["ceramic", "vessel", "gloss"], behaviour: "Glazed white with a wet-looking gloss; unglazed edges read dry and matte.", makingNotes: ["Fires with ~12% linear shrinkage."] }),
  solid({ id: "carbon-fibre", name: "Carbon fibre composite", category: "composite", colour: "#1a1c1f", metallic: 0.15, roughness: 0.35, density: 1.6, finish: "2×2 twill, clear-coated", tags: ["composite", "light", "technical"], behaviour: "A woven gloss that shifts with the weave direction; stiff and light in one direction only.", makingNotes: ["Layup direction is structural — a cosmetic model is not a ply book."] }),
  solid({ id: "diamond", name: "Diamond (brilliant)", category: "gemstone", colour: "#f7fbfd", metallic: 0, roughness: 0.02, density: 3.52, transmission: 0.85, refractiveIndex: 2.42, hardness: 10, iridescence: 0.35, finish: "round brilliant, 57 facets", tags: ["gemstone", "bridal", "luxury"], behaviour: "Total internal reflection: the brilliance comes from geometry, not colour — the pavilion angle does the work.", makingNotes: ["Facet angles are cut for the material's critical angle."] }),
  solid({ id: "sapphire-blue", name: "Blue sapphire", category: "gemstone", colour: "#1d4f9c", metallic: 0, roughness: 0.05, density: 4.0, transmission: 0.55, refractiveIndex: 1.77, hardness: 9, iridescence: 0.15, finish: "oval mixed cut", tags: ["gemstone", "colour", "luxury"], behaviour: "Deep blue with a directional pleochroism; the cut orientation decides whether it reads velvet-blue or inky.", makingNotes: ["Heat treatment is common and must be disclosed."] }),
  solid({ id: "emerald", name: "Emerald", category: "gemstone", colour: "#1f7a52", metallic: 0, roughness: 0.06, density: 2.72, transmission: 0.5, refractiveIndex: 1.58, hardness: 7.5, finish: "emerald cut", tags: ["gemstone", "colour", "luxury"], behaviour: "Glows green with visible inclusions; the step cut shows colour rather than sparkle.", makingNotes: ["Brittle: setting pressure must be controlled."] }),
  solid({ id: "ruby", name: "Ruby", category: "gemstone", colour: "#9c1230", metallic: 0, roughness: 0.05, density: 4.0, transmission: 0.55, refractiveIndex: 1.77, hardness: 9, finish: "cushion brilliant", tags: ["gemstone", "colour", "luxury"], behaviour: "Saturated red that fluoresces in daylight; reads hotter than its base colour.", makingNotes: ["Origin and treatment affect value more than cut."] }),
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export function materialById(id: string): CoutureMaterial | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

export function findMaterial(query: string): CoutureMaterial | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return BY_ID.get(q)
    ?? MATERIALS.find((m) => m.name.toLowerCase() === q)
    ?? MATERIALS.find((m) => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase()))
    ?? MATERIALS.find((m) => m.tags.some((t) => t === q))
    ?? MATERIALS.find((m) => m.tags.some((t) => q.includes(t)));
}

export interface MaterialQuery {
  text?: string;
  categories?: MaterialCategory[];
  tags?: string[];
  /** Cloth only: gsm at most / at least. */
  maxGsm?: number;
  minGsm?: number;
  /** Cloth only: at least this much stretch in any direction, %. */
  minStretchPct?: number;
  /** Cloth only: transmission at least this (sheer materials). */
  minTransmission?: number;
  /** Only materials a cloth simulation can run (has physical properties). */
  clothOnly?: boolean;
  limit?: number;
}

export function searchMaterials(query: MaterialQuery = {}): CoutureMaterial[] {
  const text = (query.text ?? "").trim().toLowerCase();
  const tags = (query.tags ?? []).map((t) => t.toLowerCase());
  const out = MATERIALS.filter((m) => {
    if (query.clothOnly && !m.physical) return false;
    if (query.categories?.length && !query.categories.includes(m.category)) return false;
    if (tags.length && !tags.every((t) => m.tags.some((x) => x.includes(t)))) return false;
    if (m.physical) {
      if (query.maxGsm !== undefined && m.physical.gsm > query.maxGsm) return false;
      if (query.minGsm !== undefined && m.physical.gsm < query.minGsm) return false;
      if (query.minStretchPct !== undefined) {
        const s = m.physical.stretch;
        if (Math.max(s.warpPct, s.weftPct, s.biasPct) < query.minStretchPct) return false;
      }
    } else if (query.maxGsm !== undefined || query.minGsm !== undefined || query.minStretchPct !== undefined) {
      return false;
    }
    if (query.minTransmission !== undefined && m.visual.transmission < query.minTransmission) return false;
    if (text) {
      const hay = `${m.name} ${m.fibre} ${m.category} ${m.tags.join(" ")} ${m.behaviour} ${m.physical?.construction ?? ""}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
  return out.slice(0, query.limit ?? 40);
}

/* ---------------- behaviour → simulation ---------------- */

export interface SimulationParameters {
  /** kg/m², from GSM. */
  massPerAreaKgM2: number;
  /** 0–1 PBD structural constraint stiffness (higher = less stretch). */
  structuralStiffness: number;
  /** 0–1 shear constraint stiffness. */
  shearStiffness: number;
  /** 0–1 bend constraint stiffness — what makes satin fall and mikado stand. */
  bendStiffness: number;
  /** Velocity damping per second, 0–1. */
  damping: number;
  /** Coulomb friction coefficient applied on contact. */
  friction: number;
  /** The strain the solver allows before it pulls back hard, %. */
  maxStrainPct: number;
  /** How the numbers were derived, so a report can show the mapping. */
  derivation: string;
}

/**
 * The single bridge between a material's measured/typical numbers and the
 * cloth solver. Every coefficient is a stated function of a physical value,
 * so changing silk for leather changes the simulation for a reason.
 */
export function simulationParameters(material: CoutureMaterial): SimulationParameters {
  const p = material.physical;
  if (!p) throw new Error(`${material.name} is a solid, not a cloth: it cannot be simulated as fabric.`);
  const stretch = Math.max(p.stretch.warpPct, p.stretch.weftPct);
  const structural = clamp(0.55 + 0.44 * (1 - clamp(stretch / 30, 0, 1)), 0.2, 0.99);
  const bend = clamp(0.02 + p.bendingStiffness / 120, 0.02, 0.95);
  const shear = clamp(0.05 + p.shearStiffness / 14, 0.05, 0.9);
  return {
    massPerAreaKgM2: p.gsm / 1000,
    structuralStiffness: round(structural, 3),
    shearStiffness: round(shear, 3),
    bendStiffness: round(bend, 3),
    damping: round(clamp(p.dampingRatio, 0.02, 0.8), 3),
    friction: round(clamp(p.friction, 0.05, 0.95), 3),
    maxStrainPct: round(clamp(stretch + 3, 4, 90), 1),
    derivation: `structural 0.55+0.44·(1−max stretch ${stretch}%/30) = ${round(structural, 3)}; bend 0.02+bending ${p.bendingStiffness} mN·cm/120 = ${round(bend, 3)}; shear 0.05+${p.shearStiffness} N/m/14 = ${round(shear, 3)}; mass ${p.gsm} g/m²`,
  };
}

/** Mass of a cloth piece, g, from its area in mm² and its GSM. */
export function clothMassGrams(material: CoutureMaterial, areaMm2: number): number | null {
  if (!material.physical) return null;
  return round((areaMm2 / 1_000_000) * material.physical.gsm, 1);
}

export interface MaterialPage {
  id: string;
  name: string;
  category: MaterialCategory;
  fibre: string;
  visual: VisualProperties;
  physical?: PhysicalProperties;
  solid?: SolidProperties;
  provenance: Provenance;
  tags: string[];
  behaviour: string;
  makingNotes: string[];
  simulation?: SimulationParameters;
}

/** Everything known about one material, with its provenance intact. */
export function materialPage(m: CoutureMaterial): MaterialPage {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    fibre: m.fibre,
    visual: m.visual,
    physical: m.physical,
    solid: m.solid,
    provenance: m.provenance,
    tags: m.tags,
    behaviour: m.behaviour,
    makingNotes: m.makingNotes,
    ...(m.physical ? { simulation: simulationParameters(m) } : {}),
  };
}

export const MATERIAL_CATEGORIES: MaterialCategory[] = ["natural", "luxury", "technical", "leather", "metal", "glass", "ceramic", "gemstone", "composite"];
