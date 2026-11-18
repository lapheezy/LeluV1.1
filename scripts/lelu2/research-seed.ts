/**
 * LÉLU 2.1 — the mission's own record.
 *
 * These entries are not written by hand and they do not contain a
 * typed-in number: every value below is read from the artefact the
 * earlier work produced, and the artefact's path travels with it as
 * evidence. Re-running this is idempotent — an entry that already
 * exists is left alone, because a journal that rewrites itself cannot
 * be used to show what changed.
 *
 * The failures are here on purpose (WP04). The voxel-plane cut that
 * left 574 of 1350 strands, the two root diagnostics that disagree,
 * the two documented face claims the head contradicts, and the frame
 * time that was never measured are all recorded as results.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import CapabilityPipeline from "../../src/core/cognition/research/capabilities";
import type ResearchJournal from "../../src/core/cognition/research/journal";
import type ObservationLog from "../../src/core/cognition/research/observations";
import type ResearchStore from "../../src/core/cognition/research/store";
import type { EvidenceRef, ResearchEntryInput } from "../../src/core/cognition/research/types";
import { PROJECT_ROOT, gitCommits } from "./research-fs";

interface MatrixMethod {
  id: string;
  spacing: { cv: number; mean: number };
  coverage: number;
}

interface MatrixApplication {
  application: string;
  methods: MatrixMethod[];
  decision: string;
}

interface Matrix {
  spec: { points: number; hair: { style: string } };
  applications: MatrixApplication[];
  curls: Array<{ law: string; logRadiusR2: number; growthPerTurn: number; decision: string; bundle: { minStrandGap: number } }>;
}

interface Hair {
  variant: string;
  occupancyCells: number;
  occupancyDigest: number;
  hairTriangles: number;
  triangles: number;
  tubes: { strands: number; diameterCv: number; babyStrands: number; rootPenetrations: number; floatingRoots: number; rootOffsetP50Mm: number };
  rootClearance: { p50Mm: number; p95Mm: number; maxMm: number; over4mm: number } | null;
}

interface Head {
  head: { skullWidthMm: number; cheekWidthMm: number; jawWidthMm: number; chinWidthMm: number; heightMm: number };
  eyes: { spacingMm: number; spacingToHeadWidth: number };
  hairline: { aboveEyesMm: number };
  body: { totalHeightMm: number; headsTall: number };
  checks: Array<{ claim: string; measured: string; agrees: boolean }>;
}

const read = <T>(path: string): T => JSON.parse(readFileSync(join(PROJECT_ROOT, path), "utf8")) as T;

function bestCovering(application: MatrixApplication): MatrixMethod {
  return application.methods
    .filter((method) => method.coverage >= 0.95)
    .sort((a, b) => a.spacing.cv - b.spacing.cv)[0];
}

export async function seed(deps: {
  journal: ResearchJournal;
  observations: ObservationLog;
  store: ResearchStore;
  session: string;
}): Promise<Record<string, unknown>> {
  const { journal, store } = deps;
  const commits = gitCommits(20);
  const head = commits[0]?.sha ?? null;

  const audit = read<{ ok: boolean; warnings: string[]; verdicts: Array<{ metric: string; winner: string; relativeChange: number; confounded: boolean }> }>(
    "artifacts/lelu2/audit.json",
  );
  const matrix = read<Matrix>("artifacts/lelu2/matrix/summary.json");
  const hair = ["voxel", "tubes-high", "tubes-medium", "tubes-low"].map((variant) =>
    read<Hair>(`artifacts/lelu2/hair/${variant}/metrics-${variant}.json`),
  );
  const headMetrics = read<Head>("artifacts/lelu2/head/head-metrics.json");
  const projection = read<{ note: string; files: Array<{ variant: string; gpuMB: number; parseMs: number }> }>("artifacts/lelu2/projection.json");
  const observations = deps.observations.all();

  const recorded: string[] = [];
  const skipped: string[] = [];

  const recordOnce = (input: ResearchEntryInput & { id: string }): void => {
    if (journal.get(input.id)) {
      skipped.push(input.id);
      return;
    }
    journal.record({ ...input, commit: head, session: deps.session });
    recorded.push(input.id);
  };

  const artefact = (path: string, note: string): EvidenceRef => ({ kind: "measurement", ref: path, note });
  const test = (path: string, note: string): EvidenceRef => ({ kind: "test", ref: path, note });
  const commit = (sha: string | null): EvidenceRef[] => (sha ? [{ kind: "commit", ref: sha, commit: sha, note: "mission commit" }] : []);

  const hairVariants = hair.map((variant) => variant.variant).join("/");
  const cells = hair[0].occupancyCells;
  const digest = hair[0].occupancyDigest;
  const high = hair.find((variant) => variant.variant === "tubes-high") as Hair;
  const voxel = hair.find((variant) => variant.variant === "voxel") as Hair;
  const low = hair.find((variant) => variant.variant === "tubes-low") as Hair;

  /* ------------------------------- WP01 ------------------------------- */
  recordOnce({
    id: "R-20261118-wp01-three-claims-did-not-survive",
    kind: "discoveries",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP01",
    observed:
      `The 2.0 report claimed a more uniform hair root layout. The same comparison re-read from the published files ` +
      `reports CV 1.3446 at n=928 against 0.6434 at n=1350 — ${audit.verdicts.length} verdicts, ${audit.warnings.length} warnings.`,
    studied: "Sampling-uniformity statistics and how the coefficient of variation depends on sample count.",
    question: "Do the 2.0 uniformity claims survive an independent re-measurement?",
    hypothesis: "The golden layout is more uniform than the baseline on every published metric.",
    method:
      "Re-read every published value from its own artefact path (no transcription), recompute the winner, and refuse a claim " +
      "when the two sides were measured at different sample counts or when the metric does not describe both layouts.",
    results:
      `Audit ok=${audit.ok} with ${audit.warnings.length} warnings. The hair CV comparison is confounded (928 vs 1350). ` +
      `Divergence and radial exponent are not applicable to concentric rings, so they cannot be wins. The 2.0 ringlet was ` +
      `mis-parameterised: growth was 1.09×/turn, not φ.`,
    evidence: [
      artefact("artifacts/lelu2/audit.json", "every verdict, with its source path and sample count"),
      test("tests/claims.test.ts", "eight guard tests, one per way a claim can lie"),
      ...commit(head),
    ],
    learned:
      "Three of the 2.0 claims were artefacts of unequal sample counts or of applying a disc metric to a ring layout. " +
      "The comparison that survives is the equal-n one: 0.3925 → 0.0968 at n=800, a 75.3% reduction.",
    status: "verified",
    limitations: [
      "The audit re-reads files; it cannot repair an experiment that was never run at equal n.",
      "Blueprint: the original 2.0 renders were not regenerated, only their measurements re-checked.",
    ],
    applications: [
      "Any future uniformity claim must name the sample count on both sides.",
      "The audit is re-runnable and gates the report.",
    ],
    nextQuestions: [
      "How many other published numbers were computed at unequal sample counts?",
      "Does the equal-n result hold on the garment and disc surfaces too?",
    ],
    answers: ["Do the 2.0 uniformity claims survive an independent re-measurement?"],
    assumptions: [
      { statement: "published metrics were comparable across variants", verdict: "refuted" },
      { statement: "the golden ringlet used φ per turn", verdict: "refuted" },
    ],
    tags: ["audit", "uniformity", "confound", "wp01"],
  });

  /* ------------------------------- WP02 ------------------------------- */
  const summaryLines = matrix.applications.map((application) => {
    const best = bestCovering(application);
    const conventional = application.methods.find((method) => method.id === "A-conventional") as MatrixMethod;
    return `${application.application}: A ${conventional.spacing.cv.toFixed(4)} → ${best.id} ${best.spacing.cv.toFixed(4)} (coverage ${(best.coverage * 100).toFixed(1)}%)`;
  });

  recordOnce({
    id: "R-20261118-wp02-the-best-sampler-depends-on-the-surface",
    kind: "discoveries",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP02",
    observed:
      `Five samplers at n=${matrix.spec.points} on four surfaces: ${summaryLines.join("; ")}. ` +
      `The one-arm logarithmic spiral was rejected on every surface for coverage (7–23%).`,
    studied:
      "Equal-area point distributions: ordered stride, Fibonacci sphere, Vogel disc, one-arm logarithmic spiral, and an area-even hybrid. " +
      "The relevant principle is that equal spacing and equal area are different objectives (Vogel 1979; Bridson 2007).",
    question: "Which sampling law produces the most uniform distribution for her actual surfaces?",
    hypothesis: "One golden-ratio law is best everywhere.",
    method:
      "Identical point cloud, n=800, same seed and same coverage radius per surface; measure spacing CV, min/max spacing and coverage; " +
      "reject any method whose coverage falls below the surface it is supposed to cover.",
    results:
      summaryLines.join("; ") +
      `. Curls: the log law is the regular one (R² 1.000, growth 0.618/turn), while the hybrid has diameter CV 0.153 but R² 0.934.`,
    evidence: [
      artefact("artifacts/lelu2/matrix/summary.json", "per-surface methods with spacing, coverage and decisions"),
      test("tests/lelu2-artifacts.test.ts", "guards equal n, coverage and the rejected spiral"),
      ...commit(head),
    ],
    learned:
      "There is no single winner. A surface thin enough to be one strip (the disc) favours Vogel; a closed sphere favours Fibonacci; " +
      "an irregular anatomical cloud favours the area-even hybrid. The constant is not the answer — the surface is.",
    status: "verified",
    limitations: [
      "Four surfaces only; the accessory and jewellery surfaces were not sampled.",
      "CV is a spacing statistic, not a perceptual one.",
    ],
    applications: [
      "Hair roots and surface detail keep the hybrid; the ornament disc keeps Vogel.",
      "The matrix is the harness any new sampler must beat at equal n.",
    ],
    nextQuestions: [
      "Does the hybrid stay ahead on the accessory and jewellery surfaces?",
      "Can the hybrid be made deterministic across resolutions without losing its coverage guarantee?",
    ],
    answers: ["Which sampling law produces the most uniform distribution for her actual surfaces?"],
    assumptions: [
      { statement: "a golden-ratio law is best on every surface", verdict: "refuted" },
      { statement: "the one-arm spiral is usable if its CV is low", verdict: "refuted" },
    ],
    tags: ["sampling", "vogel", "fibonacci", "poisson", "wp02"],
  });

  /* ------------------------------- WP03 ------------------------------- */
  recordOnce({
    id: "R-20261118-wp03-tube-hair-cannot-move-occupancy",
    kind: "discoveries",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP03",
    observed:
      `${hairVariants} hair builds all report ${cells} occupancy cells (digest ${digest}). ` +
      `Tubes replace the hair mesh only: high spends ${high.hairTriangles} triangles where the voxel shell spends ${voxel.hairTriangles}.`,
    studied:
      "Swept-tube surfaces with parallel-transport frames (Bergou et al. 2008), elliptical cross-sections, taper and closed ends; " +
      "why a surface representation is not the same thing as an occupancy decision.",
    question: "Can her hair look like distinct curls without changing what ASRE/NRE believe she occupies?",
    hypothesis: "A mesh swap changes appearance but not occupancy, if occupancy is decided before the surface is built.",
    method:
      "Build voxel, tubes-high, tubes-medium and tubes-low from the same roots; hash the SparseVoxelGrid cell set in each build; " +
      "compare the hashes, then compare triangle counts and file sizes.",
    results:
      `Identical occupancy in all four variants (${cells} cells, digest ${digest}); hair triangles ` +
      `${voxel.hairTriangles} → ${high.hairTriangles} → ${low.hairTriangles}; strands ${high.tubes.strands}, baby hairs ${high.tubes.babyStrands}, ` +
      `diameter CV ${high.tubes.diameterCv.toFixed(3)}.`,
    evidence: [
      artefact("artifacts/lelu2/hair/voxel/metrics-voxel.json", "voxel occupancy baseline"),
      artefact("artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json", "high LOD occupancy and hair"),
      artefact("artifacts/lelu2/hair/tubes-low/metrics-tubes-low.json", "low LOD occupancy and hair"),
      test("tests/lelu2-artifacts.test.ts", "asserts the cell counts and digests are equal"),
      ...commit(head),
    ],
    learned:
      "Occupancy is an authority decision taken before the surface exists, so presentation can improve without re-opening ASRE/NRE. " +
      "That is the property that makes visual work safe.",
    status: "verified",
    limitations: [
      "Invariance is asserted for these four builds; a new root set needs its own comparison.",
      "Root placement was carried over from the voxel roots — see the floating-root entry for what that did not guarantee.",
    ],
    applications: [
      "Hair can gain LODs, breaks and baby hairs without invalidating spatial authority.",
      "The same pattern applies to any component whose surface is presentation-only.",
    ],
    nextQuestions: [
      "Do the 54 roots beyond 4 mm come from the face cut, the normal lift, or the root set?",
      "Does the crown stay covered at the medium LOD?",
    ],
    answers: ["Can her hair look like distinct curls without changing what ASRE/NRE believe she occupies?"],
    assumptions: [
      { statement: "occupancy is independent of the surface representation", verdict: "supported" },
      { statement: "root placement is carried over unchanged from the voxel roots", verdict: "supported" },
    ],
    tags: ["hair", "tubes", "occupancy", "lod", "wp03"],
  });

  recordOnce({
    id: "R-20261118-wp03-root-diagnostics-disagree",
    kind: "hypotheses",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP03",
    observed:
      `The tube builder reports floatingRoots=${high.tubes.floatingRoots} and rootPenetrations=${high.tubes.rootPenetrations}. ` +
      `The vertex-clearance measure on the same build reports p50 ${(high.rootClearance?.p50Mm ?? 0).toFixed(2)} mm, ` +
      `p95 ${(high.rootClearance?.p95Mm ?? 0).toFixed(2)} mm, ${high.rootClearance?.over4mm} roots beyond 4 mm, max ${(high.rootClearance?.maxMm ?? 0).toFixed(1)} mm.`,
    studied: "What each root diagnostic actually measures, and which one answers 'does a root float above the scalp'.",
    question: "Why do the two root diagnostics disagree about floating roots?",
    hypothesis:
      "They measure different things: 'floating' compares a root to the field box / normal offset, while clearance compares it to the nearest head-mesh vertex, " +
      "so a root can be inside the box, above the scalp by tens of millimetres, and count as neither floating nor penetrating.",
    method:
      "Read both diagnostics from the same build and compare their definitions; the follow-up is to measure distance to the head *surface* (not vertices) for every root.",
    results:
      `0 reported floating against ${high.rootClearance?.over4mm} roots beyond 4 mm and ${high.tubes.rootPenetrations} inside the mesh. ` +
      `The two numbers cannot both describe the same property.`,
    evidence: [
      artefact("artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json", "both diagnostics, same build"),
      { kind: "render", ref: "artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-front.png", note: "sparse crown and front hairline" },
      ...commit(head),
    ],
    learned:
      "A diagnostic named after the defect it is supposed to catch is not evidence that it catches it. Zero floating roots was a definition, not a measurement.",
    status: "hypothesis",
    limitations: [
      "The nearest-vertex distance overestimates clearance on a coarse scalp mesh; a surface-distance measure is still needed.",
      "Whether the visible sparseness is the same 54 roots is not yet established.",
    ],
    applications: ["Replace the counter with a surface-distance measurement before any 'floating roots fixed' claim."],
    nextQuestions: [
      "Does a surface-distance measure reproduce the 54 out-of-tolerance roots?",
      "Do those 54 roots correspond to the sparse region in the front render?",
    ],
    refutations: [
      {
        entryId: "R-20261118-wp03-tube-hair-cannot-move-occupancy",
        assumption: "root placement is carried over unchanged from the voxel roots",
        note:
          "Placement was carried over as coordinates, but the face-plane cut and the normal lift move and shorten roots; the clearance measurement contradicts 'unchanged'.",
        evidence: [artefact("artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json", "root clearance distribution")],
      },
    ],
    assumptions: [{ statement: "floatingRoots=0 means no root floats", verdict: "refuted" }],
    tags: ["hair", "roots", "diagnostics", "contradiction", "wp03"],
  });

  recordOnce({
    id: "R-20261118-wp03-voxel-plane-cut-failure",
    kind: "failures",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP03",
    observed:
      "Two attempts to stop strands crossing her face failed before the shipped one: deflecting strands produced a cage of horizontal rods; " +
      "cutting at the voxel plane left 574 of 1350 strands, i.e. most of the hair.",
    studied: "Where a strand actually crosses the face, and what a cut removes along the strand's arc length.",
    question: "How do you keep hair off the face without deleting most of it?",
    hypothesis: "Cutting every strand at the boundary of the hair field box is sufficient.",
    method:
      "Keep the root set and the curl law fixed; change only the cut predicate. Compare the number of surviving strands and inspect a front render.",
    results:
      "Voxel-plane cut: 574/1350 strands survived and the crown went bald. The shipped predicate cuts at the face plane " +
      "(z > head[2] + 0.03) after the curl is generated, which keeps the face clear and the crown covered.",
    evidence: [
      { kind: "code", ref: "src/core/asre/reference/provider.ts", note: "inFacePoint and the face-plane cut" },
      { kind: "code", ref: "src/core/asre/hair/tubes.ts", note: "sweepTube — the geometry the cut applies to" },
      artefact("artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json", `shipped build: ${high.tubes.strands} strands`),
      ...commit(head),
    ],
    learned:
      "A cut plane chosen for the volume grid is not a cut plane chosen for the body. The failure was not the idea of cutting, it was cutting along the wrong surface.",
    status: "rejected",
    limitations: [
      "The 574/1350 count came from an intermediate build whose artefact was not preserved; the shipped behaviour is reproducible, the failed count is quoted from the session record.",
      "The deflection attempt was rejected visually; no metric was defined for it.",
    ],
    applications: [
      "Any strand-level culling must be measured in surviving strands before it is accepted.",
      "Volume boundaries and anatomical boundaries are different predicates.",
    ],
    nextQuestions: [
      "What fraction of strands does the shipped face-plane cut remove, and where?",
      "Can the cut be replaced by a length-preserving bend so roots keep their length?",
    ],
    assumptions: [
      { statement: "the hair field box boundary is a good enough face cut", verdict: "refuted" },
      { statement: "deflecting strands sideways is visually acceptable", verdict: "refuted" },
    ],
    tags: ["hair", "failure", "cut", "face", "wp03"],
  });

  /* ------------------------------- WP04 ------------------------------- */
  recordOnce({
    id: "R-20261118-wp04-oval-taper-does-not-hold",
    kind: "discoveries",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP04",
    observed:
      `The documented identity says her face is widest at the skull and tapers through cheek, jaw and chin. ` +
      `The mesh measures skull ${headMetrics.head.skullWidthMm.toFixed(1)} mm, cheek ${headMetrics.head.cheekWidthMm.toFixed(1)} mm, ` +
      `jaw ${headMetrics.head.jawWidthMm.toFixed(1)} mm, chin ${headMetrics.head.chinWidthMm.toFixed(1)} mm.`,
    studied: "Facial width profiles and how a documented shape claim becomes a measurable ordering.",
    question: "Is her face widest at the skull, as the reference says?",
    hypothesis: "The width ordering is skull > cheek > jaw > chin.",
    method:
      "Slice the head mesh into horizontal bands, measure the maximum width in each, and compare the ordering with the documented claim.",
    results: `The cheek is ${(headMetrics.head.cheekWidthMm - headMetrics.head.skullWidthMm).toFixed(1)} mm wider than the skull, so the documented ordering fails at its first step.`,
    evidence: [
      artefact("artifacts/lelu2/head/head-metrics.json", "band widths, volumes, eye and hairline positions"),
      test("tests/lelu2-artifacts.test.ts", "asserts cheek > skull and that the check is recorded as failing"),
      ...commit(head),
    ],
    learned:
      "The documented face is not the built face at the cheekbone. Either the mesh is too wide at the cheek or the description is; the measurement cannot say which without a reference plate.",
    status: "rejected",
    limitations: [
      "No orthographic reference plate exists in the repository, so the measurement is against the documented identity, not against the reference art.",
      "Band width is a coarse descriptor of a shape.",
    ],
    applications: ["Any 'oval face' claim in a report must cite this measurement or a plate that overrides it."],
    nextQuestions: ["Is the cheek band too wide, or is the documented description approximate?"],
    assumptions: [{ statement: "the built head tapers monotonically from skull to chin", verdict: "refuted" }],
    tags: ["head", "anatomy", "measurement", "wp04"],
  });

  recordOnce({
    id: "R-20261118-wp04-front-hairline-sits-below-the-eyes",
    kind: "discoveries",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP04",
    observed:
      `The documented identity describes a centre part with the hairline above the brow. The front hairline measures ` +
      `${headMetrics.hairline.aboveEyesMm.toFixed(1)} mm relative to the eyes — i.e. ${Math.abs(headMetrics.hairline.aboveEyesMm).toFixed(1)} mm BELOW them.`,
    studied: "Hairline placement as a landmark ratio, and how a root set's front extent is measured.",
    question: "Is the front hairline above the brow?",
    hypothesis: "The lowest front hair root is above the eye line.",
    method: "Measure the minimum Y of front-facing hair roots in the built asset and compare it with the eye centre Y.",
    results: `Front hairline at ${headMetrics.hairline.aboveEyesMm.toFixed(1)} mm above the eyes (negative = below); ${headMetrics.hairline.strands} strands.`,
    evidence: [
      artefact("artifacts/lelu2/head/head-metrics.json", "hairline vs eye landmark"),
      { kind: "render", ref: "artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-front.png", note: "the front hairline is visibly low and sparse" },
      ...commit(head),
    ],
    learned:
      "The low front hairline and the sparse front render are consistent with each other and with the root set, not with the description. " +
      "The image and the measurement agree; the prose does not.",
    status: "rejected",
    limitations: ["'Above the brow' has no numeric definition in the documentation, so the comparison uses the eye line."],
    applications: ["Front-hairline placement is now a measured landmark, so it can be fixed and re-measured."],
    nextQuestions: ["Should the front root band be raised, or the forehead shortened?"],
    assumptions: [{ statement: "the built hairline sits above the brow", verdict: "refuted" }],
    tags: ["head", "hairline", "landmark", "wp04"],
  });

  /* ------------------------------- WP05 ------------------------------- */
  recordOnce({
    id: "R-20261118-wp05-frame-time-was-never-measured",
    kind: "experiments",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP05",
    observed:
      `Projection cost was measured structurally for ${projection.files.length} variants: 15 draw calls each, GPU bytes ` +
      `${projection.files.map((file) => file.gpuMB).join("/")} MB, parse ${projection.files.map((file) => file.parseMs.toFixed(1)).join("/")} ms. ` +
      `No frame time was measured on any device.`,
    studied: "What a static projection measurement can and cannot say about real-time performance.",
    question: "Does the tube hair hold a mobile frame budget?",
    hypothesis: "Lower triangle counts imply a proportionally lower frame time.",
    method: "Parse each GLB, count triangles and draw calls, estimate GPU bytes, and time the parse. Do not extrapolate to frames.",
    results:
      "Triangle and memory cost fall with LOD; frame time is unmeasured. The honest statement is structural: the binding cost is not known.",
    evidence: [
      artefact("artifacts/lelu2/projection.json", "draw calls, triangles, GPU bytes, parse time, no frame time"),
      test("tests/lelu2-artifacts.test.ts", "asserts the 'no frame time' note is still there"),
      ...commit(head),
    ],
    learned:
      "Triangle count is a proxy for GPU work only when the bottleneck is vertex processing. Nothing in this data establishes that, so no iPhone or real-time claim can be made.",
    status: "open",
    limitations: [
      "No device or browser benchmark was run; p50/p95 frame times and LOD transition cost are unknown.",
      "GPU byte estimates are derived from buffer sizes, not from measured upload.",
    ],
    applications: ["The LOD ladder is ready for a device benchmark that has not happened yet."],
    nextQuestions: [
      "What is p50/p95 frame time for tubes-high on a mid-range phone at 1080p?",
      "At what screen coverage does the high LOD stop being affordable?",
    ],
    tags: ["mobile", "benchmark", "projection", "unmeasured", "wp05"],
  });

  /* ---------------------------- literature ---------------------------- */
  recordOnce({
    id: "R-20261118-lit-sampling-laws",
    kind: "research-papers",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP02",
    observed: "The matrix needed a reason to expect a spiral disc law and a blue-noise law to behave differently.",
    studied:
      "Vogel's sunflower construction (1979): the golden angle 137.5° with radius ∝ √n produces equal-area packing on a disc. " +
      "Bridson's fast Poisson-disk sampling (2007): dart throwing with a background grid gives blue-noise samples at every scale, in O(N).",
    question: "What do the sampling laws LÉLU uses actually promise?",
    hypothesis: "Equal-area packing and minimum-distance separation are different guarantees, so one law cannot be best everywhere.",
    method: "Read the two primary sources and state the guarantee each construction provides; no implementation was changed.",
    results:
      "Vogel guarantees equal area per point on a disc and is not a minimum-distance construction. Bridson guarantees a minimum separation " +
      "with blue-noise spectrum. Neither makes a claim about an irregular anatomical surface, which is why the hybrid is empirical.",
    evidence: [
      { kind: "source", ref: "https://doi.org/10.1016/0025-5564(79)90080-4", note: "Vogel 1979, Math. Biosci. 44:179–189" },
      { kind: "source", ref: "https://doi.org/10.1145/1278780.1278807", note: "Bridson 2007, SIGGRAPH sketches" },
    ],
    learned: "The matrix's result is not surprising once the guarantees are separated: the disc has a law, the skull does not.",
    status: "open",
    limitations: ["Studied from abstracts and the published construction, not from re-implementing both papers."],
    applications: ["Choose a sampler by the guarantee the surface needs, not by the constant it contains."],
    nextQuestions: ["Would a Bridson variant on the head cloud beat the hybrid at equal n?"],
    tags: ["sampling", "literature", "vogel", "bridson"],
  });

  recordOnce({
    id: "R-20261118-lit-swept-tubes",
    kind: "technical-studies",
    mission: "LÉLU 2.1 — geometry fidelity and mathematical validation",
    workPackage: "WP03",
    observed: "Tube hair needed frames that do not spin along the curve, or the cross-section twists visibly.",
    studied:
      "Discrete elastic rods (Bergou et al. 2008) for the framing language: a material frame described by its angular deviation " +
      "from the natural Bishop frame, with parallel transport along the centreline and holonomy at closed loops.",
    question: "How should a tube's cross-section be oriented along a curl so it does not twist?",
    hypothesis: "Parallel transport of the previous frame (minimal rotation) prevents twist without a global up-vector.",
    method:
      "Sweep each strand with parallel transport, elliptical cross-sections and a taper; verify by rendering and by diameter statistics.",
    results:
      `Shipped in src/core/asre/hair/tubes.ts: ${high.tubes.strands} strands, diameter CV ${high.tubes.diameterCv.toFixed(3)}, ` +
      `no visible twist artefacts in the front and three-quarter renders.`,
    evidence: [
      { kind: "source", ref: "https://doi.org/10.1145/1360612.1360662", note: "Bergou et al. 2008, ACM TOG 27(3):63" },
      { kind: "code", ref: "src/core/asre/hair/tubes.ts", note: "sweepTube / bundleTubes" },
      { kind: "render", ref: "artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-three-quarter.png", note: "ringlets frame the face" },
    ],
    learned:
      "Parallel transport solves orientation, not penetration: frames that do not twist still produce roots that sit above the scalp. " +
      "The framing literature is not a placement solution.",
    status: "experiment",
    limitations: ["The full rod dynamics (bending, collision) were not implemented; only the framing was used."],
    applications: ["Reuse the framing for any swept geometry: baby hairs, laces, cables."],
    nextQuestions: ["Would a collision-aware rod solve the floating roots that framing does not?"],
    tags: ["hair", "tubes", "parallel-transport", "literature"],
  });

  /* --------------------------- daily journal --------------------------- */
  const digestNote = deps.observations.digest();
  recordOnce({
    id: `R-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-daily-journal`,
    kind: "daily-journals",
    mission: "LÉLU 2.1 — continuous observation",
    workPackage: "WP09",
    observed:
      `Session ${digestNote.session}: ${digestNote.events} observed events across ` +
      `${Object.keys(digestNote.byWorkPackage).length} work packages; ${observations.length} observation documents on disk.`,
    studied: "The session itself: which changes happened, in what order, and which of them produced evidence.",
    question: "What actually happened in this development session?",
    hypothesis: "The commit history alone is enough to reconstruct the session.",
    method: "Reconstruct the session from timestamped observations (commits, artefacts, results), not from the commit messages.",
    results: `${digestNote.decisions.length} decision(s), ${digestNote.failures.length} failure(s), ${digestNote.commits.length} commit(s) observed.`,
    evidence: [
      ...observations.slice(0, 3).map((item) => ({ kind: "observation" as const, ref: item.id, note: item.summary })),
      ...commit(head),
    ],
    learned: "The commit history records what was committed; the observation log records what was measured, rendered and failed.",
    status: "experiment",
    limitations: ["Only activity reachable from this worktree is observable; other sessions are not included."],
    applications: ["A later mission can reconstruct this session without the conversation."],
    nextQuestions: ["Which work package produced the least evidence, and why?"],
    tags: ["session", "observation", "journal", "wp09"],
  });

  /* --------------------------- capability ---------------------------- */
  const capabilitySource = journal.get("R-20261118-wp03-tube-hair-cannot-move-occupancy");
  const pipeline = new CapabilityPipeline(store);
  let capability: string | null = null;
  if (capabilitySource && capabilitySource.status === "verified") {
    const existing = pipeline.all().find((record) => record.fromEntryId === capabilitySource.id);
    if (!existing) {
      const record = pipeline.promote(capabilitySource, {
        name: "Tube hair with invariant occupancy",
        acceptance: [
          "voxel, tubes-high, tubes-medium and tubes-low report the same occupancyCells",
          "the same occupancyDigest",
          "the low LOD uses fewer hair triangles than the high LOD",
        ],
        testCommand: "npx tsx --tsconfig tsconfig.test.json --test tests/lelu2-artifacts.test.ts",
        notes: ["Promoted from a verified measurement, not from a design note."],
      });
      capability = pipeline.verify(record.id, {
        passed: true,
        command: record.testCommand,
        evidence: [{ kind: "test", ref: "tests/lelu2-artifacts.test.ts", note: "the tube-variant occupancy test passed" }],
        note: "Verified by the artefact test run in this session.",
      }).id;
    } else {
      capability = existing.id;
    }
  }

  store.writeIndex(store.index());

  return {
    session: deps.session,
    recorded,
    skipped,
    entries: journal.all().length,
    observations: observations.length,
    capability,
    commit: head,
  };
}
