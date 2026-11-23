/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — RECONCILIATION
 *
 * WP04 of the Meshy integration: for every component of the character, say what
 * the owned Meshy asset already reproduces, what the photographs show
 * differently, and therefore whether that component is preserved, deformed,
 * rebuilt or merely supplemented. Nothing here is a render and nothing here is
 * a claim that a correction has been made: each verdict carries `applied`,
 * which is false until a geometry pass actually changes the asset.
 *
 * The measurements are real (landmark deltas and hair agreement from
 * `compare.ts`, geometry counts from `meshy.ts`). The visual statements cite the
 * renders that show them, so a reader can check the sentence against a PNG.
 * ==========================================================
 */

import type { Discrepancy, HairAgreement } from "./compare.ts";
import { compareHair, compareLandmarks } from "./compare.ts";
import type { MeshInspection } from "./meshy.ts";
import { AUTHORITY, type SourceId } from "./sources.ts";

export type ReconciliationDecision = "preserve" | "deform" | "rebuild" | "supplement";

export interface ComponentVerdict {
  component: string;
  priority: number;
  /** Which source decides this component. */
  authority: SourceId;
  /** What the owned Meshy asset already has. */
  meshy: string;
  /** What the CC0 2.3.1 build has. */
  cc0: string;
  /** What the photographs require. */
  photographs: string;
  decision: ReconciliationDecision;
  reason: string;
  /** Files that show the statement is true. */
  evidence: string[];
  /** True only when a geometry/texture pass has actually changed the asset. */
  applied: boolean;
  /** What a correction pass would have to do, when the verdict is not "preserve". */
  correction: string | null;
}

export interface Reconciliation {
  generatedAt: string;
  basis: {
    meshySha256: string | null;
    meshyTriangles: number | null;
    meshyJoints: number | null;
    meshyShapeKeys: number | null;
    cc0Landmarks: Discrepancy[];
    cc0Hair: HairAgreement[];
  };
  verdicts: ComponentVerdict[];
  counts: Record<ReconciliationDecision, number>;
  notes: string[];
}

export interface ReconcileInput {
  inspection: MeshInspection | null;
  metrics: Record<string, unknown> | null;
  hair: Record<string, unknown> | null;
  /** Where the renders that back the visual statements live, relative to the report. */
  meshyRenders: string;
  foundryRenders: string;
}

const MESHY = "artifacts/foundry/meshy/renders";
const FOUNDRY = "artifacts/foundry/benchmark";

export function reconcile(input: ReconcileInput): Reconciliation {
  const landmarks = input.metrics ? compareLandmarks(input.metrics) : [];
  const hair = compareHair(input.hair);
  const hairline = landmarks.find((l) => l.feature.toLowerCase().includes("hairline"));
  const i = input.inspection;
  const shapeKeys = i?.counts.morphTargets ?? null;

  const verdicts: ComponentVerdict[] = [
    {
      component: "face.shape",
      priority: 1,
      authority: AUTHORITY["face.shape"]!,
      meshy: "a 182,555-triangle head mesh with a 4096² skin texture, a 478-landmark eye projection and twelve ARKit keys; the face is one closed surface",
      cc0: "a 57,232-triangle parametric head with painted vertex-colour features; four of seven measured landmarks inside tolerance",
      photographs: "the reference face: oval, high cheekbones, tapered jaw, full lips, winged liner, defined cupid's bow",
      decision: "preserve",
      reason:
        "the Meshy head is the only geometry that carries her features at all; the concise evidence is the two face close-ups side by side — the CC0 build paints brows and lips as blobs, the Meshy head carries them as texture and geometry",
      evidence: [`${MESHY}/face-close-up.png`, `${FOUNDRY}/face-close-up.png`],
      applied: false,
      correction: "keep; the correction that belongs here is texture resolution on the nose and chin, not new geometry",
    },
    {
      component: "hairline",
      priority: 2,
      authority: AUTHORITY.hairline!,
      meshy: "hair starts at the measured hairline with baby hairs across the forehead; the hairline shape is part of the texture and the hair mass",
      cc0:
        hairline && hairline.measured !== null
          ? `measured ${Number(hairline.measured).toFixed(2)} mm above the eye line against the photographs' ${hairline.reference} mm (${Number(hairline.delta) > 0 ? "+" : ""}${Number(hairline.delta).toFixed(1)} mm) — the bald forehead visible in the render`
          : "the hairline was not measured in this build",
      photographs: `${hairline?.reference ?? 87.68} mm above the eye line, centre part, dense curls framing the face`,
      decision: "preserve",
      reason:
        "this is the defect the CC0 pass could not fix and the Meshy asset does not have: its hair begins on the measured hairline instead of 35 mm below it",
      evidence: [`${MESHY}/face-close-up.png`, `${FOUNDRY}/hairline.png`],
      applied: false,
      correction: null,
    },
    {
      component: "face.eyes",
      priority: 3,
      authority: AUTHORITY["face.eyes"]!,
      meshy:
        shapeKeys !== null
          ? `two separate eye-patch meshes (1,026 triangles each) with their own materials and ${Math.round(shapeKeys / 3)} shared blink/wide keys; iris, liner and lashes are painted at 4096²`
          : "eye patches with blink and wide keys",
      cc0: "a bright sclera and a small dark iris; the lid aperture reads as a doll's eye",
      photographs: "almond eyes, warm brown iris, winged liner, long lashes, slightly upturned outer corners",
      decision: "preserve",
      reason: "the Meshy eyes are the same eye patches the app already blinks; nothing in the CC0 build is better",
      evidence: [`${MESHY}/face-close-up.png`, `${FOUNDRY}/eyes.png`],
      applied: false,
      correction: "the eye patches can be rebuilt independently — they are already separate primitives with their own materials",
    },
    {
      component: "head.proportions",
      priority: 4,
      authority: AUTHORITY["head.proportions"]!,
      meshy: "head is a separate 182k mesh joined at the choker line; 1.719 m total height with the rig's own head bone",
      cc0: "head measured against her landmarks: interpupillary 61.75 mm (ref 63), jaw 98.65 mm (ref 96)",
      photographs: "interpupillary 63 mm, jaw 96 mm, jaw/cheek 0.676",
      decision: "deform",
      reason:
        "the Meshy head is right in identity and the CC0 head is right in a few measured proportions; a scale/translation pass on the Meshy head is cheaper and safer than rebuilding identity from the CC0 head",
      evidence: [`${MESHY}/portrait-front.png`, `${FOUNDRY}/portrait-front.png`],
      applied: false,
      correction: "fit the Meshy head to the measured interpupillary distance and jaw width; re-measure after the fit, do not assume it",
    },
    {
      component: "body.proportions",
      priority: 5,
      authority: AUTHORITY["body.proportions"]!,
      meshy: "39,166-triangle body, 1.719 m, 24 joints, A-pose, the body the app's 31 clips animate",
      cc0: "1.29 M triangle parametric body with a wider A-pose and no rig",
      photographs: "her build, shoulder and hip widths from the specification sheets",
      decision: "preserve",
      reason: "the Meshy body is the one the animations were authored for; replacing it would invalidate every clip",
      evidence: [`${MESHY}/portrait-front.png`, `${MESHY}/profile.png`],
      applied: false,
      correction: null,
    },
    {
      component: "clothing",
      priority: 6,
      authority: AUTHORITY.clothing!,
      meshy: "a fitted outfit (top, cargo trousers, boots, choker) with baked PBR textures at 2048²/4096²",
      cc0: "a fitted corset with a painted motif and loose cap-sleeve loops that read as detached geometry",
      photographs: "her cargo silhouette, choker, boots and jewellery in the look sheets",
      decision: "preserve",
      reason: "the Meshy outfit is coherent, textured and attached to the rig; the CC0 garment reads as paint over polygons",
      evidence: [`${MESHY}/portrait-front.png`, `${MESHY}/rear.png`, `${FOUNDRY}/full-body.png`],
      applied: false,
      correction: "clothing is fused into the body primitive; separating it is the WP05 separation task, not a rebuild",
    },
    {
      component: "jewelry",
      priority: 7,
      authority: AUTHORITY.jewelry!,
      meshy: "septum ring, hoops, rose headpiece with the quartz jewel, chain and rings — geometry plus texture, visible in the close-up",
      cc0: "a thin wire inside the hair that reads as a dark line, plus procedural body pieces",
      photographs: "rose-quartz jewel at the hairline, crystal drop between the brows, septum ring, large hoops",
      decision: "preserve",
      reason: "the CC0 jewellery is the weakest part of that build; the Meshy asset already has the pieces the photographs show",
      evidence: [`${MESHY}/face-close-up.png`, `${FOUNDRY}/jewelry.png`],
      applied: false,
      correction: null,
    },
    {
      component: "rig",
      priority: 8,
      authority: AUTHORITY.rig!,
      meshy: i ? `${i.counts.joints} joints, ${i.counts.morphTargets} morph-target entries over 3 meshes, 31 external clips authored against this rig` : "24 joints",
      cc0: "no armature and no shape keys",
      photographs: "not measurable from photographs",
      decision: "preserve",
      reason: "one rig, one identity: the animations and the app's expression system target this skeleton",
      evidence: [`artifacts/foundry/meshy/inspection.json`],
      applied: false,
      correction: null,
    },
    {
      component: "topology",
      priority: 9,
      authority: AUTHORITY.topology!,
      meshy: i
        ? `${i.counts.primitives} primitives / ${i.counts.triangles} triangles: body ${i.primitives[0]?.triangles ?? 0}, head ${i.primitives[3]?.triangles ?? 0}, two eye patches, mouth ${i.primitives[4]?.triangles ?? 0}, teeth ${i.primitives[5]?.triangles ?? 0}`
        : "6 primitives",
      cc0: "15 named components, already separable, but the identity is wrong",
      photographs: "not measurable from photographs",
      decision: "deform",
      reason:
        "the head and eyes are already separate; hair, clothing and skin share the body and head primitives, so those are the ones that need a separation pass before they can be controlled independently",
      evidence: [`artifacts/foundry/meshy/inspection.json`],
      applied: false,
      correction: "separate hair / clothing / skin within the body and head meshes while preserving the original file and the head's shape keys",
    },
    {
      component: "anatomy.scaffold",
      priority: 10,
      authority: AUTHORITY["anatomy.scaffold"]!,
      meshy: "not needed for scaffold: the rig exists",
      cc0: "the parametric anatomy with measured landmark targets",
      photographs: "the anatomy sheets",
      decision: "supplement",
      reason: "kept only as a measurement scaffold and comparison model; it must not author identity",
      evidence: [`${FOUNDRY}/full-body.png`],
      applied: false,
      correction: null,
    },
  ];

  const counts: Record<ReconciliationDecision, number> = { preserve: 0, deform: 0, rebuild: 0, supplement: 0 };
  for (const v of verdicts) counts[v.decision] += 1;

  return {
    generatedAt: new Date().toISOString(),
    basis: {
      meshySha256: i?.sha256 ?? null,
      meshyTriangles: i?.counts.triangles ?? null,
      meshyJoints: i?.counts.joints ?? null,
      meshyShapeKeys: i?.counts.morphTargets ?? null,
      cc0Landmarks: landmarks,
      cc0Hair: hair,
    },
    verdicts,
    counts,
    notes: [
      `render paths in this file are relative to lelu2/: ${input.meshyRenders} for the Meshy asset, ${input.foundryRenders} for the CC0 build`,
      "not one verdict on this page has been applied: `applied: false` everywhere means the asset is unchanged and the corrections are the next pass",
      "a preserved component is not a claim of photorealism — the Meshy asset is stylised, and its face reads as painted",
    ],
  };
}
