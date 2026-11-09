/**
 * ==========================================================
 * LÉLU — ATELIER: WHAT A DESIGN IS
 *
 * A design direction is a set of components with stable IDs
 * (C-01, C-02 …). The same IDs label the BOM rows, the drawing
 * callouts, the DXF layers, the OBJ groups, the glTF nodes and
 * the production steps, so a change to one component reaches
 * every view of it.
 *
 * Every claim carries how it is known (EvidenceLevel). Nothing
 * here is "simulated", "reviewed" or "tested" unless evidence of
 * that was supplied — the Atelier never promotes itself.
 * ==========================================================
 */

/** How a claim, a number or a whole design is known. Ordered weakest → strongest. */
export const EVIDENCE_LEVELS = [
  "conceptual",          // an idea; nothing checked
  "research-supported",  // backed by cited sources
  "calculated",          // computed here from stated inputs (mass, cost, volume)
  "software-validated",  // checked by software here (geometry, interference, file read-back)
  "simulated",           // a physics/FEA/CFD simulation result was supplied
  "independently-reviewed", // a qualified person reviewed it (supplied)
  "physically-tested",   // a physical test result was supplied
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export type Shape = "box" | "cylinder" | "sphere";

export interface Vec3 { x: number; y: number; z: number }

/** One part. Dimensions in millimetres; position is the part's centre. */
export interface Component {
  id: string;          // "C-01"
  name: string;
  shape: Shape;
  /** box: width (x) × depth (y) × height (z). cylinder: diameter = width, height = height (axis z). sphere: diameter = width. */
  size: { width: number; depth: number; height: number };
  position: Vec3;
  material: string;
  quantity: number;
  /** Unit cost in the project's currency, when known. */
  unitCost?: number;
  /** Where the cost/part comes from: source ids. */
  sources?: string[];
  supplier?: string;
  /** Free-form engineering note (tolerance, finish, standard). */
  notes?: string;
  /** Tolerance on its size, ± mm. */
  tolerance?: number;
  /** Which assembly step fits it (1-based); derived when absent. */
  step?: number;
  /** Purchased (bought in) or fabricated. */
  make?: "buy" | "fabricate";
  /** Electrical connections to other components, for wiring diagrams. */
  connects?: Array<{ to: string; signal: string }>;
}

export interface Material {
  name: string;
  /** g/cm³ */
  density: number;
  source?: string;
}

export interface AtelierSource {
  id: string;
  title: string;
  url?: string;
  kind?: "product" | "paper" | "patent" | "standard" | "supplier" | "datasheet" | "article" | "other";
  accessed?: string;
  /** What it supports. */
  supports?: string;
  /** It could not be opened (paywall, blocked): kept so the gap is visible. */
  inaccessible?: boolean;
}

/** Material the user supplied, and what was actually found in it. */
export interface InspectedInput {
  id: string;
  kind: "image" | "photo" | "video" | "document" | "pdf" | "sketch" | "audio" | "cad" | "url" | "text";
  name: string;
  /** What inspection really found — empty when it could not be inspected. */
  findings: string;
  /** How it was inspected (e.g. "vision model", "parsed PDF text", "STL read-back"). Absent = not inspected. */
  method?: string;
  inspected: boolean;
}

export interface Claim {
  text: string;
  level: EvidenceLevel;
  sources?: string[];
}

export interface DesignDirection {
  id: string;           // "D1"
  name: string;
  /** One-line design identity. */
  identity: string;
  /** Visual concept, in words (an image can be attached). */
  concept: string;
  conceptImage?: string;
  /** How it works. */
  function: string;
  /** Technical architecture: the principle that makes it different from the others. */
  architecture: string;
  components: Component[];
  claims: Claim[];
  limitations: string[];
  validationRequired: string[];
  /** Estimated complexity, 1 (simple) – 5 (very complex), with the reason. */
  complexity: { score: number; reason: string };
  /** Parent direction when this one was forked or combined. */
  derivedFrom?: string[];
}

export interface DesignVersion {
  version: number;
  at: number;
  note: string;
  directions: DesignDirection[];
  selected?: string;
  /** Which components changed in this version (for propagation reports). */
  changed?: string[];
}

export interface AtelierProject {
  id: string;
  title: string;
  brief: string;
  currency: string;
  inputs: InspectedInput[];
  sources: AtelierSource[];
  materials: Material[];
  versions: DesignVersion[];
  createdAt: number;
  updatedAt: number;
  conversationId?: string;
  /** Every design-file export, with its read-back result. */
  exports?: Array<{ directionId: string; version: number; format: string; filename: string; size: number; ok: boolean; at: number; checks: Array<{ name: string; ok: boolean; detail?: string }> }>;
}

/** Common engineering materials (density g/cm³, typical handbook values). */
export const MATERIAL_LIBRARY: Material[] = [
  { name: "aluminium 6061", density: 2.7 },
  { name: "steel", density: 7.85 },
  { name: "stainless steel 304", density: 8.0 },
  { name: "abs", density: 1.05 },
  { name: "pla", density: 1.24 },
  { name: "petg", density: 1.27 },
  { name: "polycarbonate", density: 1.2 },
  { name: "nylon", density: 1.14 },
  { name: "silicone", density: 1.1 },
  { name: "glass", density: 2.5 },
  { name: "borosilicate glass", density: 2.23 },
  { name: "copper", density: 8.96 },
  { name: "brass", density: 8.5 },
  { name: "oak", density: 0.75 },
  { name: "plywood", density: 0.6 },
  { name: "bamboo", density: 0.7 },
  { name: "carbon fibre", density: 1.6 },
  { name: "fr4", density: 1.85 },
  { name: "lifepo4 cell", density: 2.3 },
  { name: "li-ion cell", density: 2.6 },
  { name: "monocrystalline pv", density: 2.3 },
  { name: "rubber", density: 1.2 },
  { name: "foam", density: 0.05 },
  { name: "concrete", density: 2.4 },
];

/** Words that mean a design needs a qualified person before anyone builds it. */
export const SAFETY_DOMAINS: Array<{ domain: string; pattern: RegExp; reviewer: string }> = [
  { domain: "electrical", pattern: /\b(mains|230 ?v|120 ?v|high voltage|battery|batteries|li-?ion|lipo|lifepo4|charger|charging|electrical|wiring|circuit)\b/i, reviewer: "a qualified electrical engineer (and the applicable battery/EMC standards)" },
  { domain: "medical", pattern: /\b(medical|implant|patient|clinical|surgical|diagnos|prosthe|orthotic|drug)\b/i, reviewer: "a regulatory/medical-device specialist" },
  { domain: "structural", pattern: /\b(load[- ]bearing|structural|beam|truss|bridge|scaffold|ladder|climb|seat|chair|helmet|harness|bike frame)\b/i, reviewer: "a structural engineer" },
  { domain: "pressure / heat", pattern: /\b(pressure vessel|boiler|combust|gas|flame|burner|heater|steam)\b/i, reviewer: "a qualified pressure/thermal engineer" },
  { domain: "children", pattern: /\b(child|children|toy|infant|baby|kids?)\b/i, reviewer: "a toy/child-product safety assessor (EN 71 / ASTM F963)" },
  { domain: "food contact", pattern: /\b(food|drink|cup|bottle|kitchen|cook)\b/i, reviewer: "a food-contact materials assessment" },
];
