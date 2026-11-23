/**
 * ==========================================================
 * LÉLU — FEATURE UNDERSTANDING (PCI-FR 1.0, WP05)
 *
 * The bridge between what she perceives and what she can say or decide.
 * It reads the structured feature observations produced by
 * `scripts/perception/lelu_perception.py` — landmarks, proportions, hairline,
 * baby-hair strands, beads, garment panels, with confidence and evidence —
 * and exposes what LÉLU needs to reason about them:
 *
 *   describe        a component-by-component account, never a vibe
 *   decompose       the subject as parts that can be worked on separately
 *   relations       which parts touch, mirror, bound or occlude which
 *   uncertainty     which measurements are weak, and why
 *   compare         two observations, feature by feature, with deltas
 *   missing         what a reconstruction would still need
 *   recommend       the reconstruction strategy per component
 *   retrieveSimilar nearest previous observation by proportion vector
 *   learn           outcomes of replication attempts, kept as evidence
 *
 * Provenance is explicit on every observation: `observed` means it was
 * measured off pixels; `inferred` means a model or a prior supplied it. The
 * two are never merged silently.
 * ==========================================================
 */

export type ComponentKind = "face" | "hair" | "baby_hair" | "jewelry" | "garment" | "silhouette";
export type Provenance = "observed" | "inferred";

export interface FeatureGeometry {
  /** Points in source-image pixels. */
  points?: number[][];
  /** [x, y, width, height] in source-image pixels. */
  bbox?: number[];
  /** Single measured position. */
  center?: number[];
  radius?: number;
}

export interface FeatureObservation {
  id: string;
  kind: string;
  component: ComponentKind;
  source: string;
  confidence: number;
  provenance: Provenance;
  geometry: FeatureGeometry;
  /** Counts, ratios or other scalar measurements attached to the feature. */
  measurements: Record<string, number | string | null>;
  evidence: Record<string, unknown>;
}

export interface FeatureRelation {
  type: string;
  from: string;
  to: string;
  confidence?: number;
  note?: string;
  value?: number;
}

export interface FeatureObservationSet {
  schema: string;
  source: { path: string; size: [number, number]; sha256?: string; name: string };
  features: FeatureObservation[];
  relationships: FeatureRelation[];
  warnings: string[];
}

export interface ReplicationAttempt {
  id: string;
  reference: string;
  at: number;
  strategy: string;
  /** Measurements that say whether it worked; lower is better for `error` keys. */
  metrics: Record<string, number | null>;
  outcome: "succeeded" | "partial" | "failed";
  notes: string[];
}

/* ------------------------------ raw input ------------------------------ */

interface RawFeaturesJson {
  schema: string;
  source: { path: string; size: [number, number]; sha256?: string };
  features: Record<string, Record<string, unknown>>;
  relationships?: Array<Record<string, unknown>>;
  warnings?: string[];
}

const COMPONENT_OF: Record<string, ComponentKind> = {
  landmarks: "face",
  proportions: "face",
  face_oval: "face",
  regions: "face",
  hairline: "hair",
  hair_region: "hair",
  baby_hairs: "baby_hair",
  jewelry: "jewelry",
  garment: "garment",
  silhouette: "silhouette",
  skin_mask: "silhouette",
};

/** Which extraction the observation came from decides its provenance. */
const PROVENANCE_OF: Record<string, Provenance> = {
  landmarks: "observed",
  proportions: "observed",
  face_oval: "observed",
  regions: "observed",
  hairline: "observed",
  hair_region: "observed",
  baby_hairs: "observed",
  jewelry: "observed",
  garment: "observed",
  silhouette: "observed",
  skin_mask: "observed",
};

const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * A measurement that is genuinely a number.
 *
 * `measurements` is a mixed bag by design (counts, ratios, labels, nulls), so
 * comparing a field directly is a type error and — worse — would coerce a
 * missing value to 0 or a label to NaN. Callers that reason numerically ask
 * this, and decide for themselves what an absent measurement means.
 */
function numericMeasurement(feature: FeatureObservation | undefined, key: string): number | null {
  return number(feature?.measurements[key]);
}

/**
 * Read one `*.features.json` produced by the perception engine.
 *
 * The file is grouped by feature name; this flattens it into observations so
 * every part has its own identity, confidence, provenance and evidence — the
 * shape the rest of this module reasons over.
 */
export function loadObservation(json: RawFeaturesJson | string, sourceName?: string): FeatureObservationSet {
  const raw: RawFeaturesJson = typeof json === "string" ? (JSON.parse(json) as RawFeaturesJson) : json;
  const file = raw.source.path.split("/").pop() ?? raw.source.path;
  const source = sourceName ?? file.replace(/\.[a-z0-9]+$/i, "");
  const features: FeatureObservation[] = [];

  for (const [name, feature] of Object.entries(raw.features ?? {})) {
    const component = COMPONENT_OF[name] ?? "face";
    const confidence = number(feature.confidence) ?? 0.5;
    const provenance = PROVENANCE_OF[name] ?? "inferred";

    if (name === "landmarks" || name === "face_oval") {
      features.push({
        id: name,
        kind: String(feature.kind ?? "landmark_set"),
        component,
        source,
        confidence,
        provenance,
        geometry: { points: (feature.points as number[][]) ?? [], bbox: feature.bbox as number[] | undefined },
        measurements: { count: number(feature.count) ?? (feature.points as number[][] | undefined)?.length ?? 0 },
        evidence: (feature.evidence as Record<string, unknown>) ?? {},
      });
      continue;
    }

    if (name === "proportions") {
      const values = (feature.values as Record<string, number>) ?? {};
      features.push({
        id: "proportions",
        kind: "ratio_set",
        component,
        source,
        confidence,
        provenance,
        geometry: {},
        measurements: { ...values, count: Object.keys(values).length },
        evidence: (feature.evidence as Record<string, unknown>) ?? {},
      });
      continue;
    }

    if (name === "hairline") {
      features.push({
        id: "hairline",
        kind: "polyline",
        component: "hair",
        source,
        confidence,
        provenance,
        geometry: { points: (feature.points as number[][]) ?? [] },
        measurements: { points: (feature.points as number[][] | undefined)?.length ?? 0 },
        evidence: (feature.evidence as Record<string, unknown>) ?? {},
      });
      continue;
    }

    if (name === "baby_hairs") {
      const strands = (feature.strands as Array<Record<string, unknown>>) ?? [];
      // Each strand is its own observation: a root, a tip, a confidence.
      for (const [index, strand] of strands.entries()) {
        const root = (strand.root as number[]) ?? [0, 0];
        const tip = (strand.tip as number[]) ?? [0, 0];
        features.push({
          id: `baby_hair_${index}`,
          kind: "strand",
          component: "baby_hair",
          source,
          confidence: number(strand.confidence) ?? 0.5,
          provenance: "observed",
          geometry: { points: [root, tip], center: [(root[0] + tip[0]) / 2, (root[1] + tip[1]) / 2] },
          measurements: {
            length_px: number(strand.length_px) ?? 0,
            angle_deg: number(strand.angle_deg) ?? 0,
            curvature_px: number(strand.curvature_px) ?? 0,
            thickness_px: number(strand.thickness_px) ?? 0,
          },
          evidence: (strand.evidence as Record<string, unknown>) ?? {},
        });
      }
      continue;
    }

    if (name === "jewelry") {
      const beads = (feature.beads as Array<Record<string, unknown>>) ?? [];
      for (const [index, bead] of beads.entries()) {
        features.push({
          id: `bead_${index}`,
          kind: "bead",
          component: "jewelry",
          source,
          confidence: number(bead.confidence) ?? 0.5,
          provenance: "observed",
          geometry: { center: (bead.center as number[]) ?? [0, 0], radius: number(bead.radius_px) ?? 0 },
          measurements: {
            radius_px: number(bead.radius_px) ?? 0,
            spacing_px: number(bead.spacing_px) ?? 0,
            spacing_over_radius: number(bead.spacing_over_radius) ?? 0,
          },
          evidence: (bead.evidence as Record<string, unknown>) ?? {},
        });
      }
      features.push({
        id: "jewelry",
        kind: "assembly",
        component: "jewelry",
        source,
        confidence,
        provenance: "observed",
        geometry: {},
        measurements: {
          count: number(feature.count) ?? beads.length,
          median_radius_px: number(feature.median_radius_px) ?? 0,
          median_spacing_over_radius: number(feature.median_spacing_over_radius),
          mirror_axis_x: number((feature.symmetry as Record<string, unknown> | null)?.axis_x ?? null),
          mirror_fraction: number((feature.symmetry as Record<string, unknown> | null)?.mirror_fraction ?? null),
        },
        evidence: (feature.evidence as Record<string, unknown>) ?? {},
      });
      continue;
    }

    if (name === "garment") {
      const panels = (feature.panels as Array<Record<string, unknown>>) ?? [];
      for (const panel of panels) {
        features.push({
          id: String(panel.id ?? `panel_${features.length}`),
          kind: "panel",
          component: "garment",
          source,
          confidence: number(panel.confidence) ?? 0.5,
          provenance: "observed",
          geometry: { bbox: panel.bbox as number[] | undefined, points: panel.contour as number[][] | undefined },
          measurements: {
            coverage: number(panel.coverage) ?? 0,
            color_rgb: ((panel.color_rgb as number[]) ?? []).join(","),
          },
          evidence: {},
        });
      }
      continue;
    }

    features.push({
      id: name,
      kind: String(feature.kind ?? "measurement"),
      component,
      source,
      confidence,
      provenance,
      geometry: { bbox: feature.bbox as number[] | undefined, points: feature.contour as number[][] | undefined, center: feature.center as number[] | undefined },
      measurements: {
        area_fraction: number(feature.area_fraction) ?? 0,
        count: number(feature.count) ?? 0,
        iou: number(feature.iou),
      },
      evidence: (feature.evidence as Record<string, unknown>) ?? {},
    });
  }

  const relationships: FeatureRelation[] = ((raw.relationships ?? []) as Array<Record<string, unknown>>).map((r) => ({
    type: String(r.type ?? "relation"),
    from: String(r.from ?? ""),
    to: String(r.to ?? ""),
    confidence: number(r.confidence) ?? undefined,
    note: typeof r.note === "string" ? r.note : undefined,
    value: number(r.value) ?? undefined,
  }));

  return {
    schema: raw.schema,
    source: { ...raw.source, name: source },
    features,
    relationships,
    warnings: raw.warnings ?? [],
  };
}

void PROVENANCE_OF;

/* ------------------------------ reasoning ------------------------------ */

const componentLabel: Record<ComponentKind, string> = {
  face: "face",
  hair: "hair",
  baby_hair: "baby hairs",
  jewelry: "jewelry",
  garment: "garment",
  silhouette: "silhouette",
};

export function components(observation: FeatureObservationSet): ComponentKind[] {
  return [...new Set(observation.features.map((feature) => feature.component))];
}

export function featuresOf(observation: FeatureObservationSet, component: ComponentKind): FeatureObservation[] {
  return observation.features.filter((feature) => feature.component === component);
}

/** A component-by-component account of what she measured, with confidences. */
export function describe(observation: FeatureObservationSet): string {
  const parts = components(observation).map((component) => {
    const items = featuresOf(observation, component);
    if (component === "baby_hair") return `${items.length} baby-hair strands`;
    if (component === "jewelry") {
      const assembly = items.find((f) => f.id === "jewelry");
      return `${items.filter((f) => f.kind === "bead").length} jewelry beads${assembly && typeof assembly.measurements.mirror_fraction === "number" ? ` (mirror ${assembly.measurements.mirror_fraction})` : ""}`;
    }
    if (component === "garment") return `${items.length} garment panels`;
    if (component === "hair") {
      const line = items.find((f) => f.id === "hairline");
      return `hairline of ${line?.measurements.points ?? 0} points`;
    }
    if (component === "face") {
      const landmarks = items.find((f) => f.id === "landmarks");
      const ratios = items.find((f) => f.id === "proportions");
      return `${landmarks?.measurements.count ?? 0} landmarks, ${ratios?.measurements.count ?? 0} proportions`;
    }
    return `${items.length} ${componentLabel[component]} features`;
  });
  const confidence = meanConfidence(observation);
  return `I measured ${observation.source.name}: ${parts.join("; ")}. Mean confidence ${(confidence * 100).toFixed(0)}%.`;
}

/** The subject split into parts that can each be reconstructed on their own. */
export function decompose(observation: FeatureObservationSet): Array<{ component: ComponentKind; ids: string[]; confidence: number; provenance: Provenance[] }> {
  return components(observation).map((component) => {
    const items = featuresOf(observation, component);
    return {
      component,
      ids: items.map((item) => item.id),
      confidence: items.reduce((sum, item) => sum + item.confidence, 0) / Math.max(items.length, 1),
      provenance: [...new Set(items.map((item) => item.provenance))],
    };
  });
}

export function relationsOf(observation: FeatureObservationSet, id?: string): FeatureRelation[] {
  if (!id) return observation.relationships;
  return observation.relationships.filter((relation) => relation.from === id || relation.to === id);
}

export interface UncertaintyNote {
  feature: string;
  component: ComponentKind;
  confidence: number;
  reason: string;
}

/** Which measurements are weak, ranked worst first, with a stated reason. */
export function uncertainty(observation: FeatureObservationSet, threshold = 0.6): UncertaintyNote[] {
  const notes: UncertaintyNote[] = observation.features
    .filter((feature) => feature.confidence < threshold)
    .map((feature) => ({
      feature: feature.id,
      component: feature.component,
      confidence: feature.confidence,
      reason:
        feature.component === "baby_hair"
          ? "thin filaments at the hairline are near the detector's resolution limit"
          : feature.component === "jewelry"
            ? "metal highlights merge with the skin or with each other"
            : feature.component === "hair"
              ? "the hairline is measured where curls hang over the forehead, so occlusion moves it"
              : "measurement is below the confidence threshold",
    }));
  if (observation.warnings.some((warning) => /no face/i.test(warning))) {
    notes.unshift({ feature: "face", component: "face", confidence: 0, reason: "no face was detected; facial features are absent, not zero" });
  }
  return notes.sort((a, b) => a.confidence - b.confidence);
}

export function meanConfidence(observation: FeatureObservationSet): number {
  if (observation.features.length === 0) return 0;
  return observation.features.reduce((sum, feature) => sum + feature.confidence, 0) / observation.features.length;
}

/** Scalar measurements two observations share, e.g. the proportion ratios. */
export function sharedMeasurements(a: FeatureObservationSet, b: FeatureObservationSet, featureId: string): Array<{ key: string; a: number; b: number; delta: number; relative: number }> {
  const fa = a.features.find((feature) => feature.id === featureId);
  const fb = b.features.find((feature) => feature.id === featureId);
  if (!fa || !fb) return [];
  const out: Array<{ key: string; a: number; b: number; delta: number; relative: number }> = [];
  for (const [key, value] of Object.entries(fa.measurements)) {
    const other = fb.measurements[key];
    if (typeof value !== "number" || typeof other !== "number") continue;
    out.push({ key, a: value, b: other, delta: other - value, relative: value === 0 ? 0 : (other - value) / value });
  }
  return out;
}

export interface Comparison {
  reference: string;
  candidate: string;
  proportions: Array<{ key: string; reference: number; candidate: number; relative: number }>;
  meanRelativeProportionError: number | null;
  counts: Record<string, { reference: number; candidate: number }>;
}

/** Feature-by-feature comparison with the reference, in normalised terms. */
export function compare(reference: FeatureObservationSet, candidate: FeatureObservationSet): Comparison {
  const ratios = sharedMeasurements(reference, candidate, "proportions").filter((row) => row.key !== "count");
  const countOf = (set: FeatureObservationSet, prefix: string) => set.features.filter((feature) => feature.id.startsWith(prefix)).length;
  return {
    reference: reference.source.name,
    candidate: candidate.source.name,
    proportions: ratios.map((row) => ({ key: row.key, reference: row.a, candidate: row.b, relative: row.relative })),
    meanRelativeProportionError: ratios.length ? ratios.reduce((sum, row) => sum + Math.abs(row.relative), 0) / ratios.length : null,
    counts: {
      baby_hairs: { reference: countOf(reference, "baby_hair_"), candidate: countOf(candidate, "baby_hair_") },
      beads: { reference: countOf(reference, "bead_"), candidate: countOf(candidate, "bead_") },
      panels: { reference: countOf(reference, "panel"), candidate: countOf(candidate, "panel") },
    },
  };
}

/** What a reconstruction would still need that this observation cannot supply. */
export function missingInformation(observation: FeatureObservationSet): Array<{ component: ComponentKind; need: string }> {
  const out: Array<{ component: ComponentKind; need: string }> = [];
  const has = (component: ComponentKind) => featuresOf(observation, component).length > 0;
  if (!has("face")) out.push({ component: "face", need: "a front-facing photograph with the face at least 120 px wide" });
  if (!has("hair")) out.push({ component: "hair", need: "the hairline must be visible against skin" });
  if (!has("baby_hair")) out.push({ component: "baby_hair", need: "a closer crop of the hairline; wisps are thinner than the current resolution" });
  if (!has("jewelry")) out.push({ component: "jewelry", need: "an accessory photograph, or a pose that does not occlude the piece" });
  if (!has("garment")) out.push({ component: "garment", need: "a torso view; the garment must not be covered by hair or arms" });
  const landmarks = observation.features.find((feature) => feature.id === "landmarks");
  // An absent count is treated as zero, exactly as the previous comparison
  // did (`null < 468` is true): a landmark feature with no measured count is
  // not evidence that the gaze can be reconstructed.
  if (landmarks && (numericMeasurement(landmarks, "count") ?? 0) < 468) {
    out.push({ component: "face", need: "iris landmarks are missing; gaze cannot be reconstructed" });
  }
  return out;
}

/** How each component should be reconstructed, given what was measured. */
export function recommendStrategy(observation: FeatureObservationSet): Array<{ component: ComponentKind; strategy: string; because: string }> {
  const out: Array<{ component: ComponentKind; strategy: string; because: string }> = [];
  const face = featuresOf(observation, "face");
  if (face.length) {
    out.push({
      component: "face",
      strategy: "fit the learned shape model, then build a textured landmark mesh with a parametric depth prior",
      because: `${numericMeasurement(face.find((f) => f.id === "landmarks"), "count") ?? 0} landmarks and ${numericMeasurement(face.find((f) => f.id === "proportions"), "count") ?? 0} proportions are available`,
    });
  }
  const strands = featuresOf(observation, "baby_hair");
  if (featuresOf(observation, "hair").length) {
    out.push({
      component: "hair",
      strategy: "grow strand tubes from the measured hairline along the local curl field",
      because: `hairline and curl orientation are measured${strands.length ? `, with ${strands.length} explicit baby hairs` : ""}`,
    });
  }
  const beads = featuresOf(observation, "jewelry").filter((f) => f.kind === "bead");
  if (beads.length) {
    out.push({
      component: "jewelry",
      strategy: "regenerate beads, links and drops as parametric geometry at the measured radius, spacing and mirror axis",
      because: `${beads.length} beads with spacing and symmetry were detected`,
    });
  }
  const panels = featuresOf(observation, "garment");
  if (panels.length) {
    out.push({
      component: "garment",
      strategy: "build panel surfaces with piping along the measured seam boundaries",
      because: `${panels.length} colour panels were segmented`,
    });
  }
  return out;
}

/** Cosine similarity of the proportion vectors (the pose-invariant identity). */
export function similarity(a: FeatureObservationSet, b: FeatureObservationSet): number {
  const rows = sharedMeasurements(a, b, "proportions").filter((row) => row.key !== "count");
  if (rows.length === 0) return 0;
  const va = rows.map((row) => row.a);
  const vb = rows.map((row) => row.b);
  const dot = va.reduce((sum, value, index) => sum + value * vb[index], 0);
  const na = Math.sqrt(va.reduce((sum, value) => sum + value * value, 0));
  const nb = Math.sqrt(vb.reduce((sum, value) => sum + value * value, 0));
  return na === 0 || nb === 0 ? 0 : dot / (na * nb);
}

/** The most similar previous observations, best first. */
export function retrieveSimilar(query: FeatureObservationSet, library: FeatureObservationSet[], limit = 3): Array<{ source: string; similarity: number }> {
  return library
    .filter((candidate) => candidate.source.name !== query.source.name)
    .map((candidate) => ({ source: candidate.source.name, similarity: similarity(query, candidate) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/* ------------------------------- learning ------------------------------- */

/**
 * Outcomes of replication attempts, kept so LÉLU can say which strategy worked
 * on which kind of reference and which ones failed — the memory WP05 asks for,
 * with the numbers it was decided on.
 */
export class ReplicationMemory {
  private attempts: ReplicationAttempt[] = [];

  record(attempt: ReplicationAttempt): ReplicationAttempt {
    this.attempts = [...this.attempts, attempt];
    return attempt;
  }

  all(): ReplicationAttempt[] {
    return [...this.attempts];
  }

  succeeded(): ReplicationAttempt[] {
    return this.attempts.filter((attempt) => attempt.outcome === "succeeded");
  }

  failed(): ReplicationAttempt[] {
    return this.attempts.filter((attempt) => attempt.outcome === "failed");
  }

  /** Best attempt by a named lower-is-better metric. */
  best(metric: string): ReplicationAttempt | null {
    const scored = this.attempts.filter((attempt) => typeof attempt.metrics[metric] === "number");
    if (scored.length === 0) return null;
    return scored.reduce((best, attempt) => ((attempt.metrics[metric] as number) < (best.metrics[metric] as number) ? attempt : best));
  }

  /** What to avoid: the strategies attached to attempts that failed or stalled. */
  lessons(): string[] {
    return [...this.failed(), ...this.attempts.filter((attempt) => attempt.outcome === "partial")].flatMap((attempt) => attempt.notes.map((note) => `${attempt.strategy}: ${note}`));
  }
}

export interface ReplicationOutcome {
  strategy: string;
  metric: string;
  before: number | null;
  after: number | null;
}

const FeatureUnderstanding = {
  loadObservation,
  describe,
  decompose,
  relationsOf,
  uncertainty,
  compare,
  missingInformation,
  recommendStrategy,
  similarity,
  retrieveSimilar,
  meanConfidence,
  sharedMeasurements,
  classifyOutcome,
  ReplicationMemory,
};

/** Decide an attempt's outcome from its own measurements, not from optimism. */
export function classifyOutcome(outcome: ReplicationOutcome, target: number): { outcome: ReplicationAttempt["outcome"]; improvement: number | null; note: string } {
  if (outcome.before === null || outcome.after === null) return { outcome: "failed", improvement: null, note: `${outcome.metric} could not be measured; no claim is made` };
  const improvement = 1 - outcome.after / outcome.before;
  if (improvement >= target) return { outcome: "succeeded", improvement, note: `${outcome.metric} fell ${(improvement * 100).toFixed(1)}%, target ${(target * 100).toFixed(0)}%` };
  if (improvement > 0) return { outcome: "partial", improvement, note: `${outcome.metric} fell ${(improvement * 100).toFixed(1)}%, short of the ${(target * 100).toFixed(0)}% target` };
  return { outcome: "failed", improvement, note: `${outcome.metric} did not improve (${(improvement * 100).toFixed(1)}%)` };
}

export default FeatureUnderstanding;
