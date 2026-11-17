/**
 * ==========================================================
 * LÉLU ASRE — TOOLS (her native spatial capability)
 *
 * Registered in the SAME ToolRegistry and executed by the SAME
 * ToolDispatcher and AutonomyGate as every other tool; offered to a model
 * only when ToolSchemas selects them (FAMILY_HINTS routes spatial turns
 * here). Seven tools cover the operations she needs, so the schema budget
 * stays small; each executor calls the real service through AsreClient.
 *
 *   asre.status       risk 0  which engines run here (TS, TripoSR, Blender)
 *   asre.reconstruct  risk 1  analyse image(s) → hypotheses → geometry job
 *   asre.job          risk 0  inspect a job: summary | hypotheses |
 *                             uncertainty | geometry; what to ask for next
 *   asre.observe      risk 1  add a further view (incremental refinement)
 *   asre.character    risk 1  persistent character: preview the impact of
 *                             a change, apply it (only affected components
 *                             rebuild), or create the character
 *   asre.history      risk 1  versions: list, compare, undo, redo,
 *                             checkout, restore (all or by group)
 *   asre.export       risk 1  file a version / reconstruction in the Forge
 *                             and export it through the Forge's Blender gate
 *
 * Honesty contract: every answer names what is OBSERVED, INFERRED,
 * GENERATED, INTERPOLATED or UNKNOWN (contracts.ts), never presents
 * inferred or generated geometry as confirmed, and says which input would
 * help most when the evidence is thin. Nothing here spends money.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry.ts";
import type { ToolExecutionResult } from "../tools/ToolDispatcher.ts";
import AsreClient from "./AsreClient.ts";
import { describeEvidence, type AsreJobView } from "./contracts.ts";
import type { RestorableGroup, SpecPatch } from "./character/identity.ts";

const OBJECT = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });
const HONEST = "Always report what is OBSERVED vs INFERRED vs GENERATED; never present inferred geometry as confirmed.";

export const ASRE_TOOLS: ToolDefinition[] = [
  {
    id: "asre.status",
    name: "Spatial Engine Status",
    description: "Which of LÉLU's local 3D reconstruction engines run on this machine (TS silhouette engine, TripoSR CPU, Blender). Zero spend.",
    category: "3D Reconstruction",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "GET /api/asre/status",
  },
  {
    id: "asre.reconstruct",
    name: "Reconstruct 3D From Images",
    description: `Analyse one or more views of an object (front/back/left/right PNG) and reconstruct it locally: competing geometry hypotheses, a numerical voxel record with confidence and provenance, a validated GLB filed in the 3D Forge. Returns a job id. ${HONEST}`,
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { images: "[{ view, image | imageBase64 }]", engine: "auto | silhouette | triposr" },
    executionRoute: "POST /api/asre/reconstruct",
  },
  {
    id: "asre.job",
    name: "Inspect Reconstruction",
    description: `Inspect a reconstruction job: progress, the ranked competing hypotheses, uncertainty (evidence classes per side), geometry facts, and which additional view would help most. ${HONEST}`,
    category: "3D Reconstruction",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { jobId: "string", focus: "summary | hypotheses | uncertainty | geometry" },
    executionRoute: "GET /api/asre/jobs/<id>",
  },
  {
    id: "asre.observe",
    name: "Add A View To A Reconstruction",
    description: "Refine a finished reconstruction with one more view of the same object (incremental: only touched regions change; contradictions are kept on record).",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { jobId: "string", view: "front | back | left | right", image: "string", imageBase64: "string" },
    executionRoute: "POST /api/asre/jobs/<id>/observe",
  },
  {
    id: "asre.character",
    name: "Change A Persistent Character",
    description:
      "Change LÉLU's persistent 3D character (hairstyle, clothing, accessories, materials, body proportions, pose) as a new version that keeps her identity. preview=true says which components would rebuild and why without building. Only affected components are rebuilt.",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { characterId: "string", patch: "object", preview: "boolean", base: "version", create: "boolean" },
    executionRoute: "POST /api/asre/characters/<id>/edit | impact",
  },
  {
    id: "asre.history",
    name: "Character Versions",
    description: "A persistent character's version history: list, compare two versions (component and voxel differences), undo, redo, checkout a version, or restore an earlier version entirely or only some groups (e.g. the hairstyle).",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { characterId: "string", action: "list | compare | undo | redo | checkout | restore", a: "version", b: "version", version: "version", groups: "string[]" },
    executionRoute: "/api/asre/characters/<id>/…",
  },
  {
    id: "asre.export",
    name: "Export A 3D Asset",
    description: "File a character version or a reconstruction in the 3D Forge (inspected, zero credits) and export it with Blender (glb, obj, stl, fbx, blend) through the Forge's own export gate.",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { characterId: "string", version: "string", jobId: "string", forgeJobId: "string", formats: "string[]" },
    executionRoute: "POST /api/forge/jobs/<id>/export",
  },
];

interface AsreExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const fail = (e: unknown): ToolExecutionResult => ({ ok: false, content: `ASRE: ${e instanceof Error ? e.message : String(e)}` });
const guard = (fn: (a: Record<string, unknown>) => Promise<ToolExecutionResult>) => async (a: Record<string, unknown>) => {
  try {
    return await fn(a);
  } catch (e) {
    return fail(e);
  }
};

/** What she says about a job — never upgrading evidence. Exported for tests and the UI. */
export function explainJob(job: AsreJobView, focus = "summary"): string {
  if (job.state !== "succeeded" || !job.result) {
    const steps = job.steps.map((s) => `${s.step} ${s.state}`).join(", ");
    return `Job ${job.id} is ${job.state}${steps ? ` (${steps})` : ""}${job.error ? `. Error: ${job.error}` : ""}. Nothing about the geometry is known yet.`;
  }
  const r = job.result;
  const sel = r.hypotheses.find((h) => h.selected);
  const next = r.coverage.requests[0];
  const ask = next ? ` The most useful additional input is the ${next.view} view: ${next.reason}.` : "";
  if (focus === "hypotheses") {
    return `${r.hypotheses.length} competing hypotheses, ranked by agreement with the others: ${r.hypotheses.map((h) => `${h.rank}. ${h.label} (${h.evidence}, mean IoU ${h.agreement.toFixed(2)}, ${h.cells} cells)`).join("; ")}. ${(r.disagreementFraction * 100).toFixed(0)}% of all claimed cells are claimed by only one hypothesis — that is where the shape is genuinely uncertain. Selected: ${sel?.label ?? "none"}. These are hypotheses, not measurements.`;
  }
  if (focus === "uncertainty") {
    const sides = r.coverage.sides.filter((s) => s.cells).map((s) => `${s.side} ${(100 * (1 - s.unsupported)).toFixed(0)}% supported`).join(", ");
    return `${describeEvidence(r.evidence, "the reconstruction")} By side: ${sides}. Mean fused confidence ${r.grid.meanConfidence.toFixed(2)}.${ask}`;
  }
  if (focus === "geometry") {
    return `${r.grid.cells} occupied cells (${r.grid.boundary} boundary, ${r.grid.interior} interior) at ${(r.grid.resolution * 1000).toFixed(1)} mm; mesh ${r.mesh.triangles} triangles, ${r.mesh.meshValid ? "passes" : "FAILS"} the Forge inspection${r.forgeJobId ? `; in the Forge as ${r.forgeJobId}` : ""}. Real-world scale is UNKNOWN from images: it was assumed.`;
  }
  return `Reconstruction ${job.id} (${r.engine}, ${job.input.images.map((i) => i.view).join(" + ")} view${job.input.images.length > 1 ? "s" : ""}) succeeded. ${r.evidenceText} Selected hypothesis: ${sel?.label ?? "—"} of ${r.hypotheses.length}.${ask}`;
}

export const ASRE_EXECUTORS: AsreExecutor[] = [
  {
    id: "asre.status",
    parameters: OBJECT({}, []),
    run: guard(async () => {
      const r = await AsreClient.status();
      return { ok: true, content: `Spatial engines here: silhouette (always)${r.engines.triposr ? ", TripoSR (CPU)" : ", TripoSR NOT installed"}${r.blender ? ", Blender export/render" : ", no Blender"}. ${r.spend}.`, data: r };
    }),
  },
  {
    id: "asre.reconstruct",
    parameters: OBJECT(
      {
        images: { type: "array", items: { type: "object", properties: { view: { type: "string", enum: ["front", "back", "left", "right"] }, image: { type: "string" }, imageBase64: { type: "string" } } } },
        image: { type: "string", description: "path inside the ASRE asset root (single front view)" },
        imageBase64: { type: "string" },
        engine: { type: "string", enum: ["auto", "silhouette", "triposr"] },
      },
      [],
    ),
    run: guard(async (a) => {
      const images = Array.isArray(a.images) && a.images.length ? (a.images as Array<{ view: string; image?: string; imageBase64?: string }>) : [{ view: "front", image: str(a.image), imageBase64: str(a.imageBase64) }];
      if (!images.some((i) => i.image || i.imageBase64)) return { ok: false, content: "ASRE: I need at least one image of the object (ideally a plain or transparent background)." };
      const { job } = await AsreClient.reconstruct({ images, engine: str(a.engine) ?? "auto" });
      return { ok: true, content: `Reconstruction ${job.id} started locally (${job.engine}) from the ${images.map((i) => i.view).join(" + ")} view${images.length > 1 ? "s" : ""}. Inspect it with asre.job; until it finishes nothing about the shape is known.`, data: { job } };
    }),
  },
  {
    id: "asre.job",
    parameters: OBJECT({ jobId: { type: "string" }, focus: { type: "string", enum: ["summary", "hypotheses", "uncertainty", "geometry"] } }, ["jobId"]),
    run: guard(async (a) => {
      const { job } = await AsreClient.job(String(a.jobId ?? ""));
      return { ok: true, content: explainJob(job, str(a.focus) ?? "summary"), data: job };
    }),
  },
  {
    id: "asre.observe",
    parameters: OBJECT({ jobId: { type: "string" }, view: { type: "string", enum: ["front", "back", "left", "right"] }, image: { type: "string" }, imageBase64: { type: "string" } }, ["jobId", "view"]),
    run: guard(async (a) => {
      const b64 = str(a.imageBase64);
      if (!b64 && !str(a.image)) return { ok: false, content: "ASRE: the new view's image is required." };
      const res = await fetch(`/api/asre/jobs/${encodeURIComponent(String(a.jobId))}/observe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view: a.view, image: str(a.image), imageBase64: b64 }) });
      const j = (await res.json()) as { ok: boolean; error?: string; job?: AsreJobView };
      if (!j.ok || !j.job) return fail(j.error ?? `HTTP ${res.status}`);
      return { ok: true, content: `Refinement ${j.job.id} started: the ${String(a.view)} view is being fused into ${String(a.jobId)}. Inspect it with asre.job.`, data: j };
    }),
  },
  {
    id: "asre.character",
    parameters: OBJECT(
      {
        characterId: { type: "string" },
        create: { type: "boolean", description: "create the character first if it does not exist" },
        preview: { type: "boolean", description: "only say what would rebuild, build nothing" },
        base: { type: "string", description: "version to branch from (default: head)" },
        patch: {
          type: "object",
          properties: {
            hair: { type: "object", properties: { style: { type: "string" }, length: { type: "number" }, volume: { type: "number" } } },
            clothing: { type: "object", properties: { top: { type: "string", enum: ["none", "tank", "tshirt", "longsleeve", "jacket"] }, bottom: { type: "string", enum: ["none", "shorts", "pants", "skirt"] }, shoes: { type: "boolean" } } },
            body: { type: "object", properties: { height: { type: "number" }, shoulderWidth: { type: "number" }, hipWidth: { type: "number" }, build: { type: "number" }, legRatio: { type: "number" } } },
            materials: { type: "object", description: "skin/hair/top/bottom/shoes/accessory/eyes as [r,g,b] 0..1" },
            accessories: { type: "object", properties: { head: { type: "array", items: { type: "string" } }, body: { type: "array", items: { type: "string" } } } },
            pose: { type: "string", enum: ["relaxed", "a-pose", "t-pose", "wave", "stride"] },
          },
        },
      },
      ["characterId"],
    ),
    run: guard(async (a) => {
      const id = String(a.characterId);
      const patch = (a.patch ?? {}) as SpecPatch;
      if (a.create) {
        const existing = (await AsreClient.characters()).characters.some((c) => c.id === id);
        if (!existing) await AsreClient.createCharacter(id, id === "lelu" ? "LÉLU" : id);
      }
      if (!Object.keys(patch).length) {
        const h = await AsreClient.history(id);
        return { ok: true, content: `Character ${id}: head ${h.character.head}, ${h.versions.length} version(s). Every cell is GENERATED (procedural).`, data: h };
      }
      if (a.preview) {
        const { base, impact } = await AsreClient.impact(id, patch, str(a.base));
        const changed = impact.filter((c) => c.action !== "keep");
        return { ok: true, content: `From ${base}: ${changed.map((c) => `${c.action} ${c.id} (${c.reason})`).join("; ") || "nothing would change"}; ${impact.length - changed.length} components kept as they are.`, data: { base, impact } };
      }
      const { version } = await AsreClient.edit(id, patch, str(a.base));
      return {
        ok: true,
        content: `New version ${version.id} of ${id} (${version.label}): rebuilt ${version.build.regenerated.join(", ") || "nothing"}, recoloured ${version.build.recolored.join(", ") || "nothing"}, reused ${version.build.reused.length} components, ${version.build.ms} ms. Identity unchanged. All geometry is GENERATED.`,
        data: { version: { id: version.id, parentId: version.parentId, label: version.label, build: version.build, glb: version.glb } },
      };
    }),
  },
  {
    id: "asre.history",
    parameters: OBJECT(
      {
        characterId: { type: "string" },
        action: { type: "string", enum: ["list", "compare", "undo", "redo", "checkout", "restore"] },
        a: { type: "string" },
        b: { type: "string" },
        version: { type: "string" },
        groups: { type: "array", items: { type: "string", enum: ["hair", "clothing", "body", "face", "accessories", "materials", "pose"] } },
      },
      ["characterId", "action"],
    ),
    run: guard(async (a) => {
      const id = String(a.characterId);
      const action = String(a.action);
      if (action === "compare") {
        const h = await AsreClient.history(id);
        const x = str(a.a) ?? h.versions[0].id, y = str(a.b) ?? h.character.head;
        const { comparison: c } = await AsreClient.compare(id, x, y);
        const changed = c.components.filter((d) => d.change !== "same");
        return { ok: true, content: `${x} → ${y}: ${changed.map((d) => `${d.id} ${d.change}`).join(", ") || "no component changed"}; voxel IoU ${c.geometry.iou.toFixed(3)} (+${c.geometry.added} / −${c.geometry.removed} cells); spec changes: ${c.specChanges.join(", ") || "none"}.`, data: c };
      }
      if (action === "undo" || action === "redo") {
        const h = action === "undo" ? await AsreClient.undo(id) : await AsreClient.redo(id);
        return { ok: true, content: `${action === "undo" ? "Undone" : "Redone"}: the head of ${id} is now ${h.character.head}. Nothing was deleted.`, data: h };
      }
      if (action === "checkout") {
        const h = await AsreClient.checkout(id, String(a.version ?? ""));
        return { ok: true, content: `The head of ${id} is now ${h.character.head}.`, data: h };
      }
      if (action === "restore") {
        const groups = Array.isArray(a.groups) ? (a.groups as RestorableGroup[]) : undefined;
        const { version } = await AsreClient.restore(id, String(a.version ?? ""), groups);
        return { ok: true, content: `Restored ${groups?.length ? groups.join(", ") + " from " : ""}${String(a.version)} as new version ${version.id} (earlier versions are untouched; rebuilt ${version.build.regenerated.join(", ") || "nothing"}).`, data: { id: version.id, label: version.label, build: version.build } };
      }
      const h = await AsreClient.history(id);
      return { ok: true, content: `${id}: ${h.versions.map((v) => `${v.isHead ? "▶" : ""}${v.id} ${v.label}`).join("; ")}.`, data: h };
    }),
  },
  {
    id: "asre.export",
    parameters: OBJECT({ characterId: { type: "string" }, version: { type: "string" }, jobId: { type: "string" }, forgeJobId: { type: "string" }, formats: { type: "array", items: { type: "string", enum: ["glb", "obj", "stl", "fbx", "blend"] } } }, []),
    run: guard(async (a) => {
      let forgeJobId = str(a.forgeJobId);
      if (!forgeJobId && str(a.characterId)) {
        const id = String(a.characterId);
        const version = str(a.version) ?? (await AsreClient.history(id)).character.head;
        forgeJobId = (await AsreClient.exportCharacter(id, version)).forgeJobId;
      }
      if (!forgeJobId && str(a.jobId)) forgeJobId = (await AsreClient.job(String(a.jobId))).job.result?.forgeJobId ?? undefined;
      if (!forgeJobId) return { ok: false, content: "ASRE: name a characterId (+version), a reconstruction jobId or a forgeJobId to export." };
      const formats = Array.isArray(a.formats) && a.formats.length ? (a.formats as string[]) : ["glb", "obj", "stl"];
      const { job } = await AsreClient.forgeExport(forgeJobId, formats);
      const files = job.output?.files.map((f) => f.file.split("/").pop()).join(", ") ?? "";
      return { ok: true, content: `Exported Forge asset ${forgeJobId} with Blender as ${job.id}: ${files}.`, data: { forgeJobId, export: job } };
    }),
  },
];

export function registerAsreTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of ASRE_TOOLS) registry.register(tool);
}
