/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — THREE SOURCES, ONE IDENTITY
 *
 * The Foundry was built around the CC0 anatomical base. That was wrong in one
 * specific way: the project already owns a LÉLU character — a Meshy body and
 * auto-rig, a Meshy head bust head-swapped onto it in Blender, twelve ARKit face
 * keys and thirty-one animation clips. It is not a placeholder; it is the
 * asset the app ships. This module makes the hierarchy explicit, so no
 * component can be rebuilt from the wrong authority by accident.
 *
 *   A  MESHY LÉLU        geometry, appearance, silhouette, spatial proportion,
 *                        rig, shape keys, animation, preservation target
 *   B  PHOTOGRAPHS (39)  facial identity, hair appearance, anatomy, expression,
 *                        jewellery and clothing — the authority A is corrected against
 *   C  CC0 ANATOMY       supplementary scaffold, rigging reference, comparison
 *                        model only; never an identity source
 *
 * Precedence is a function, not a paragraph: `authorityFor(component)` returns
 * which source decides, and both `reconcile.ts` and the report read it.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type SourceId = "meshy" | "photographs" | "cc0";

export interface SourceProvenance {
  pipeline: string;
  jobs: { id: string; tool: string; what: string; credits: number | null }[];
  built: string | null;
  notes: string[];
}

export interface CharacterSource {
  id: SourceId;
  label: string;
  role: string;
  /** Components this source is allowed to author. */
  authority: string[];
  /** Components this source may never decide. */
  mustNotAuthor: string[];
  location: string;
  /** Single file for the 3D sources; the directory for the photographs. */
  sha256: string | null;
  bytes: number | null;
  files: number;
  provenance: SourceProvenance | null;
  facts: Record<string, string | number | null>;
  usable: boolean;
  blockedReason: string | null;
}

export interface SourceSet {
  precedence: SourceId[];
  sources: CharacterSource[];
  /** component → the single source that decides it. */
  authority: Record<string, SourceId>;
  conflicts: { component: string; between: SourceId[]; resolution: string }[];
  notes: string[];
}

export const MESHY_BASELINE = "leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb";
export const MESHY_PROVENANCE = "leluverse/assets/characters/lelu_character/rig/v001_rigging_01a18f4e/provenance.json";
export const CC0_BASELINE = "artifacts/lelu2/m23/youth/lelu2-m23-youth.glb";
export const REFERENCE_DIR = "reference-39";

/**
 * Who decides what. The photographs win identity; the Meshy asset wins anything
 * that is about the existing character's own geometry, rig and continuity.
 * CC0 is never first for a component a human can see.
 */
export const AUTHORITY: Record<string, SourceId> = {
  "face.shape": "photographs",
  "face.skin": "photographs",
  "face.brows": "photographs",
  "face.lips": "photographs",
  "face.eyes": "photographs",
  "face.markings": "photographs",
  hairline: "photographs",
  "hair.style": "photographs",
  "hair.strands": "photographs",
  "head.proportions": "photographs",
  "neck.proportions": "photographs",
  "body.proportions": "meshy",
  "body.silhouette": "meshy",
  clothing: "photographs",
  jewelry: "photographs",
  rig: "meshy",
  "rig.shapekeys": "meshy",
  animation: "meshy",
  topology: "meshy",
  "anatomy.scaffold": "cc0",
  "anatomy.reference": "cc0",
};

function digest(file: string): { sha256: string; bytes: number } | null {
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

export interface LocateOptions {
  /** Path to the `lelu2/` project root. */
  root: string;
  /** Path to the git worktree that holds `leluverse/` (the parent of `lelu2/` by default). */
  workspace?: string;
}

export function locateSources(options: LocateOptions): SourceSet {
  const root = path.resolve(options.root);
  const workspace = path.resolve(options.workspace ?? path.join(root, ".."));
  const rel = (p: string) => path.relative(workspace, p);

  const meshyFile = path.join(workspace, MESHY_BASELINE);
  const meshyDigest = digest(meshyFile);
  const meshyProvenanceFile = path.join(workspace, MESHY_PROVENANCE);
  let meshyProvenance: SourceProvenance | null = null;
  if (existsSync(meshyProvenanceFile)) {
    const p = JSON.parse(readFileSync(meshyProvenanceFile, "utf8")) as Record<string, unknown>;
    meshyProvenance = {
      pipeline: "Meshy multi-image body → Meshy auto-rig → Meshy head bust → Blender head swap + eye projection → Blender ARKit shape keys",
      jobs: [
        { id: "fj_mvvfg2o3_ebd9c0", tool: "Meshy", what: "multi-image-to-3D body (ref11 + ref09), 60k tris", credits: 30 },
        { id: "fj_mvvnf4v9_1ded97", tool: "Meshy", what: "auto-rig, 24 joints, walk/run clips", credits: 5 },
        { id: "fj_mvvnvqa1_b5672e", tool: "Meshy", what: "head-and-shoulders bust (ref10 + ref18 + ref19), 8k texture, 300k tris", credits: 40 },
        { id: "fj_mvwaqbim_55226d", tool: "Blender", what: "head swap, eye-only face projection, walk check", credits: 0 },
      ],
      built: typeof p.finishedAt === "number" ? new Date(p.finishedAt).toISOString() : null,
      notes: ["the first full-body model was withdrawn: its face collapsed in the 60k remesh", "spent 75 Meshy credits in total, none in this pass"],
    };
  }

  const photographs = path.join(root, REFERENCE_DIR);
  const cc0File = path.join(root, CC0_BASELINE);
  const cc0Digest = digest(cc0File);

  const sources: CharacterSource[] = [
    {
      id: "meshy",
      label: "Meshy LÉLU (owned character)",
      role: "existing geometry, appearance, silhouette, proportion, rig, shape keys and animation; the preservation target",
      authority: Object.entries(AUTHORITY).filter(([, s]) => s === "meshy").map(([c]) => c),
      mustNotAuthor: ["face.shape", "hairline"],
      location: rel(meshyFile),
      sha256: meshyDigest?.sha256 ?? null,
      bytes: meshyDigest?.bytes ?? null,
      files: 1,
      provenance: meshyProvenance,
      facts: {
        format: "GLB (glTF 2.0 binary)",
        heightM: 1.7185012779564204,
        triangles: 224155,
        vertices: 443528,
        materials: 6,
        textures: 8,
        joints: 24,
        morphTargets: 36,
        animationClips: 31,
        credits: 75,
      },
      usable: Boolean(meshyDigest),
      blockedReason: meshyDigest ? null : `not found at ${rel(meshyFile)}`,
    },
    {
      id: "photographs",
      label: "The 39 committed photographs",
      role: "facial identity, hair appearance, anatomy, expression, jewellery and clothing — the authority everything is corrected against",
      authority: Object.entries(AUTHORITY).filter(([, s]) => s === "photographs").map(([c]) => c),
      mustNotAuthor: ["topology", "rig"],
      location: rel(photographs),
      sha256: null,
      bytes: null,
      files: existsSync(photographs) ? 39 : 0,
      provenance: { pipeline: "reference-39 collection, measured by scripts/lelu2/measure-references.py", jobs: [], built: null, notes: ["read-only; 39/39 hashes verified by the reference library"] },
      facts: { photographs: 39, collections: "facial expressions, hair, anatomy, looks", readOnly: "true" },
      usable: existsSync(photographs),
      blockedReason: existsSync(photographs) ? null : "reference-39 is missing",
    },
    {
      id: "cc0",
      label: "CC0 anatomical base (the 2.3.1 foundry build)",
      role: "supplementary scaffold, rigging reference and comparison model — no longer an identity source",
      authority: Object.entries(AUTHORITY).filter(([, s]) => s === "cc0").map(([c]) => c),
      mustNotAuthor: ["face.shape", "face.skin", "face.eyes", "hairline", "hair.style", "jewelry", "clothing", "body.proportions"],
      location: rel(cc0File),
      sha256: cc0Digest?.sha256 ?? null,
      bytes: cc0Digest?.bytes ?? null,
      files: 1,
      provenance: { pipeline: "PCI-FR parametric reconstruction measured against the photographs (2.3.1)", jobs: [], built: null, notes: ["keeps the measured landmark targets; renders show it does not carry her identity"] },
      facts: { format: "GLB", triangles: 1289906, identity: "lelu-canonical (parametric)" },
      usable: Boolean(cc0Digest),
      blockedReason: cc0Digest ? null : `not found at ${rel(cc0File)}`,
    },
  ];

  return {
    precedence: ["photographs", "meshy", "cc0"],
    sources,
    authority: AUTHORITY,
    conflicts: [
      { component: "hairline", between: ["cc0", "photographs"], resolution: "the CC0 build measures 52.38 mm above the eye line against the photographs' 87.68 mm (−35.3 mm); the Meshy asset's hairline is not rebuilt from CC0" },
      { component: "face.skin", between: ["cc0", "meshy"], resolution: "the photographs decide; the Meshy texture already matches the deep warm tone, the CC0 vertex colour does not" },
      { component: "body.proportions", between: ["cc0", "meshy"], resolution: "the Meshy body is the one the app animates and the one her measurements were taken for" },
    ],
    notes: [
      "precedence is per component, not per source: the Meshy asset is first for continuity and rig, the photographs are first for identity",
      "the CC0 model is kept because its landmark targets are measured and usable, not because it looks like her",
    ],
  };
}

export function authorityFor(component: string): SourceId | null {
  return AUTHORITY[component] ?? null;
}

export function describeSources(set: SourceSet): string {
  const lines: string[] = [];
  for (const source of set.sources) {
    lines.push(`${source.id.padEnd(12)} ${source.usable ? "usable" : "BLOCKED"}  ${source.location}`);
    if (source.sha256) lines.push(`${"".padEnd(12)} sha256 ${source.sha256}`);
    lines.push(`${"".padEnd(12)} decides: ${source.authority.join(", ") || "—"}`);
  }
  return lines.join("\n");
}
