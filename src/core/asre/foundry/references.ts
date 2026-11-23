/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — REFERENCE INTELLIGENCE
 *
 * The 39 photographs are the authority. This module turns the manifest that
 * `scripts/lelu2/measure-references.py` produced into an addressable library:
 * every file has a hash, a collection, an ordinal, a kind (photograph /
 * specification sheet / anatomy overlay / expression), the measurements that
 * were read from it, the measurements it is allowed to author, and a confidence.
 *
 * It never writes. The references are read-only inputs; the only thing built
 * from them is knowledge.
 *
 * Duplicate detection is by content hash, not filename: two names for the same
 * photograph is a real defect in an asset collection and it is reported.
 * ==========================================================
 */

export interface ReferenceMeasurement {
  file: string;
  ok: boolean;
  sha256: string;
  size: [number, number];
  contentBox?: [number, number, number, number];
  faceBox?: [number, number];
  hairlineY?: number;
  hairlineFromEye?: number;
  browTopY?: number;
  browPeakY?: number;
  eyeLineY?: number;
  mouthY?: number;
  chinY?: number;
  eyeToChinPx?: number;
  confidence?: Record<string, string>;
  collection?: string;
}

export interface ReferenceManifest {
  method: string;
  photographs: number;
  collections: Record<string, number>;
  results: ReferenceMeasurement[];
}

export type ReferenceKind = "photograph" | "specification-sheet" | "anatomy-overlay" | "expression";

export interface ReferenceRecord {
  id: string;
  file: string;
  collection: string;
  ordinal: number;
  kind: ReferenceKind;
  sha256: string;
  pixels: [number, number];
  contentBox: [number, number, number, number] | null;
  duplicateOf: string | null;
  /** What was read off this file, with the method's own confidence labels. */
  measurements: Record<string, number | string>;
  confidence: Record<string, string>;
  /** Measurement keys this file is allowed to author (the specification sheets). */
  authors: string[];
  /** Estimated mm-per-pixel, only where a known millimetre feature exists. */
  scale: { mmPerPx: number; basis: string; confidence: "low" | "medium" | "high" } | null;
  readOnly: true;
}

export interface ReferenceLibrary {
  method: string;
  photographs: number;
  records: ReferenceRecord[];
  collections: Record<string, number>;
  byKind: Record<ReferenceKind, number>;
  specSheets: string[];
  duplicates: Array<{ file: string; sameAs: string }>;
  /** Which of the mission's documented specifications has an authored source. */
  authoredSpecs: Record<string, string[]>;
  /** Files the manifest lists but whose measurements failed. */
  unreadable: string[];
}

/**
 * The five specification sheets among the 39 files, and what each one is
 * allowed to author. This mapping is a claim about the references, so it is
 * kept in code where the report can quote it.
 */
export const SPEC_SHEETS: Record<string, string[]> = {
  "lelu-hair-10": ["swirl radii", "follicle spacing", "curl counts"],
  "lelu-hair-12": ["hairline arc width", "curl radius table"],
  "lelu-hair-14": ["facial landmarks", "facial width ratios", "facial heights"],
  "lelu-hair-16": ["millimetre landmark table", "jaw width", "mouth width", "nose width"],
  "lelu-hair-18": ["hairline arc", "hairline rise", "hairline height"],
};

/** The mission's own hair specification, and which sheet documents it. */
export const DOCUMENTED_SPECS: Record<string, string> = {
  "ringlet radius 4.2 mm": "lelu-hair-12",
  "loose-ringlet radius 6.5 mm": "lelu-hair-12",
  "hairline arc 13.8 cm": "lelu-hair-18",
  "hairline height 3.6 cm": "lelu-hair-18",
  "follicle spacing 1.0–1.6 mm": "lelu-hair-10",
  "baby-hair swirls 0.5 / 0.8 / 1.1 cm": "lelu-hair-10",
};

/** A known millimetre feature used to estimate scale from a photograph. */
export const SCALE_BASIS = {
  faceWidthMm: 142,
  source: "lelu-hair-14 / -16 (face width 142 mm)",
} as const;

function ordinalOf(file: string): number {
  const m = /-(\d+)\.png$/.exec(file) ?? /(\d+)\.png$/.exec(file);
  return m ? Number(m[1]) : 0;
}

function kindOf(collection: string, base: string): ReferenceKind {
  if (base in SPEC_SHEETS) return "specification-sheet";
  if (collection === "lelu-anatomy") return "anatomy-overlay";
  if (collection === "lelu-facial-expressions") return "expression";
  return "photograph";
}

function measurementsOf(r: ReferenceMeasurement): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const numeric: Array<keyof ReferenceMeasurement> = [
    "hairlineY",
    "hairlineFromEye",
    "browTopY",
    "browPeakY",
    "eyeLineY",
    "mouthY",
    "chinY",
    "eyeToChinPx",
  ];
  for (const key of numeric) {
    const value = r[key];
    if (typeof value === "number") out[key] = value;
  }
  if (r.faceBox) out.faceBoxWidthPx = r.faceBox[0];
  if (r.contentBox) out.contentHeightPx = r.contentBox[3] - r.contentBox[1];
  return out;
}

/**
 * Build the library. `subjectFaceWidthMm` is the measured face width used to
 * turn pixels into millimetres; the estimate is labelled low confidence because
 * a single photograph carries perspective, and that is not negotiable.
 */
export function buildReferenceLibrary(manifest: ReferenceManifest, subjectFaceWidthMm = SCALE_BASIS.faceWidthMm): ReferenceLibrary {
  const byHash = new Map<string, string>();
  const records: ReferenceRecord[] = manifest.results.map((r) => {
    const base = r.file.replace(/\.png$/i, "");
    const collection = r.collection ?? r.file.replace(/-\d+\.png$/i, "");
    const duplicateOf = byHash.get(r.sha256) ?? null;
    if (!duplicateOf) byHash.set(r.sha256, r.file);
    const faceWidthPx = r.faceBox?.[0] ?? 0;
    const scale =
      faceWidthPx > 0
        ? {
            mmPerPx: Number((subjectFaceWidthMm / faceWidthPx).toFixed(4)),
            basis: `${subjectFaceWidthMm} mm face width ÷ ${faceWidthPx.toFixed(0)} px face box`,
            confidence: "low" as const,
          }
        : null;
    return {
      id: base,
      file: r.file,
      collection,
      ordinal: ordinalOf(r.file),
      kind: kindOf(collection, base),
      sha256: r.sha256,
      pixels: r.size,
      contentBox: r.contentBox ?? null,
      duplicateOf,
      measurements: measurementsOf(r),
      confidence: r.confidence ?? {},
      authors: SPEC_SHEETS[base] ?? [],
      scale,
      readOnly: true,
    };
  });

  const authoredSpecs: Record<string, string[]> = {};
  for (const [spec, sheet] of Object.entries(DOCUMENTED_SPECS)) {
    authoredSpecs[spec] = records.filter((r) => r.id === sheet).map((r) => r.file);
  }

  const byKind: Record<ReferenceKind, number> = { photograph: 0, "specification-sheet": 0, "anatomy-overlay": 0, expression: 0 };
  for (const r of records) byKind[r.kind]++;

  return {
    method: manifest.method,
    photographs: manifest.photographs,
    records,
    collections: manifest.collections,
    byKind,
    specSheets: records.filter((r) => r.kind === "specification-sheet").map((r) => r.file),
    duplicates: records.filter((r) => r.duplicateOf).map((r) => ({ file: r.file, sameAs: r.duplicateOf! })),
    authoredSpecs,
    unreadable: manifest.results.filter((r) => !r.ok).map((r) => r.file),
  };
}

/** The records allowed to author a given measurement group. */
export function authorsOf(library: ReferenceLibrary, spec: string): ReferenceRecord[] {
  return library.records.filter((r) => r.authors.includes(spec));
}

/** One-line provenance for a chat answer. */
export function describeLibrary(library: ReferenceLibrary): string {
  const kinds = (Object.entries(library.byKind) as Array<[ReferenceKind, number]>)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`)
    .join(", ");
  const dup = library.duplicates.length ? `; ${library.duplicates.length} duplicate file(s) by hash` : "; no duplicates by hash";
  return `${library.photographs} references: ${kinds}${dup}. ${library.specSheets.length} specification sheets are the measurement authority; photographs are the visual authority.`;
}
