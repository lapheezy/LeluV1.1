/**
 * ==========================================================
 * LÉLU — ATELIER TOOLS
 *
 * Research-to-production design as tools in the one registry /
 * dispatcher / autonomy gate:
 *
 *   atelier.project     risk 1  start a project from a brief, the material
 *                               actually inspected, and the sources found
 *   atelier.directions  risk 1  add design directions (refuses cosmetic variants)
 *   atelier.component   risk 1  change/add/remove one component (propagates)
 *   atelier.derive      risk 1  fork one direction or combine several
 *   atelier.select      risk 1  choose the direction to take forward
 *   atelier.sources     risk 1  add sources (inaccessible ones are recorded)
 *   atelier.assess      risk 0  BOM, mass, cost, interference, evidence level,
 *                               safety review, unsupported claims
 *   atelier.export      risk 1  design files (STL/OBJ/glTF/DXF/SVG drawings),
 *                               BOM workbook, dossier, review deck — each one
 *                               re-opened and verified
 *   atelier.open        risk 1  show the project in a Cosmos window
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import type RouterContext from "../router/RouterContext";
import StudioStore from "../studio/StudioStore";
import { summarizeVerification } from "../studio/StudioExport";
import type { ArtifactSpec, ExportFormat } from "../studio/StudioTypes";
import { ATELIER_FORMATS } from "./AtelierFiles";
import { bomWorkbook, dossierDocument, reviewDeck } from "./AtelierPackage";
import AtelierStore, { assess } from "./AtelierStore";
import type { AtelierProject } from "./AtelierTypes";

export interface AtelierExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, context: RouterContext | undefined) => Promise<ToolExecutionResult>;
}

export const ATELIER_OPEN_EVENT = "lelu-atelier-open";

const tool = (id: string, name: string, description: string, riskLevel: number, permissions: string[]): ToolDefinition =>
  ({ id, name, description, category: "Atelier", permissions, riskLevel, available: true, executionRoute: "front-end:AtelierStore", verificationMethod: "atelier.assess" }) as ToolDefinition;

export const ATELIER_TOOLS: ToolDefinition[] = [
  tool("atelier.project", "Start a Design Project", "Start an Atelier research-to-production project from the user's brief, the supplied material you actually inspected (say how and what you found; anything not inspected is recorded as not inspected) and the sources you found. Use for product, object, device or physical design requests", 1, ["WRITE"]),
  tool("atelier.directions", "Add Design Directions", "Add genuinely different design directions to a project — each with its own technical architecture, components (stable IDs like C-01, real mm dimensions and positions, materials, quantities, unit costs only when known, sources), function, limitations and validation needs. Cosmetic variations of the same design are refused", 1, ["WRITE"]),
  tool("atelier.component", "Change a Component", "Change, add or remove one component of one direction; the BOM, drawings, 3D models and production documents all follow (a new version; the old one is kept)", 1, ["WRITE"]),
  tool("atelier.derive", "Fork or Combine Directions", "Make a new direction from one (fork) or several (combine) existing directions; originals are kept", 1, ["WRITE"]),
  tool("atelier.select", "Select a Direction", "Choose the direction to take forward", 1, ["WRITE"]),
  tool("atelier.sources", "Add Sources", "Add research sources to a project (products, papers, patents, standards, suppliers, datasheets); mark ones that could not be opened as inaccessible", 1, ["WRITE"]),
  tool("atelier.assess", "Assess a Design", "Calculate a direction's BOM, cost (unknown prices stay unknown), mass, interferences between parts, the evidence level it can honestly claim, the qualified reviews it needs, and claims without support; or compare all directions", 0, ["READ"]),
  tool("atelier.export", "Export Design Files and Documents", "Write design files for a direction — STL, OBJ, glTF (3D), DXF, orthographic/exploded/wiring/workflow SVG drawings — and production documents: a BOM spreadsheet, an engineering dossier (DOCX/PDF) and a review presentation (PPTX). Every file is re-opened and checked. STEP is not supported", 1, ["WRITE"]),
  tool("atelier.open", "Open a Design Project", "Show a project in a Cosmos window: the directions side by side with their drawings, 3D model, BOM and evidence", 1, ["WRITE"]),
];

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const str = (a: Record<string, unknown>, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");

const COMPONENT_SCHEMA = OBJ({
  id: { type: "string", description: "stable ID, e.g. C-01" },
  name: { type: "string" },
  shape: { type: "string", enum: ["box", "cylinder", "sphere"] },
  size: OBJ({ width: { type: "number", description: "mm (cylinder/sphere: diameter)" }, depth: { type: "number" }, height: { type: "number" } }),
  position: OBJ({ x: { type: "number" }, y: { type: "number" }, z: { type: "number", description: "centre, mm; z is up" } }),
  material: { type: "string" },
  quantity: { type: "number" },
  unitCost: { type: "number", description: "only when known from a source or the user" },
  sources: { type: "array", items: { type: "string" } },
  supplier: { type: "string" },
  make: { type: "string", enum: ["buy", "fabricate"] },
  tolerance: { type: "number", description: "± mm" },
  notes: { type: "string" },
  connects: { type: "array", items: OBJ({ to: { type: "string" }, signal: { type: "string" } }) },
});
const DIRECTION_SCHEMA = OBJ({
  id: { type: "string" }, name: { type: "string" }, identity: { type: "string" }, concept: { type: "string" },
  function: { type: "string" }, architecture: { type: "string", description: "the working principle that makes it different" },
  components: { type: "array", items: COMPONENT_SCHEMA },
  claims: { type: "array", items: OBJ({ text: { type: "string" }, level: { type: "string", enum: ["conceptual", "research-supported", "calculated"] }, sources: { type: "array", items: { type: "string" } } }) },
  limitations: { type: "array", items: { type: "string" } },
  validationRequired: { type: "array", items: { type: "string" } },
  complexity: OBJ({ score: { type: "number" }, reason: { type: "string" } }),
}, ["name", "architecture", "components"]);
const SOURCE_SCHEMA = OBJ({ id: { type: "string" }, title: { type: "string" }, url: { type: "string" }, kind: { type: "string", enum: ["product", "paper", "patent", "standard", "supplier", "datasheet", "article", "other"] }, supports: { type: "string" }, inaccessible: { type: "boolean" } });

function announce(context: RouterContext | undefined, p: AtelierProject, action: "created" | "revised" | "exported" | "opened", exports?: Array<{ format: string; filename: string; ok: boolean; size: number }>) {
  AgentEventBus.getInstance().emit({ type: "studio_artifact", taskId: String(context?.request?.timestamp ?? Date.now()), artifactId: p.id, rev: p.versions[p.versions.length - 1].version, title: p.title, kind: "design", action, exports });
}

export function openAtelier(projectId: string): boolean {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new CustomEvent(ATELIER_OPEN_EVENT, { detail: { id: projectId } }));
  return true;
}

function project(args: Record<string, unknown>, context: RouterContext | undefined): AtelierProject | undefined {
  return AtelierStore.getInstance().resolve(str(args, "project"), context?.request?.conversationId);
}

function describeAssessment(p: AtelierProject, id?: string): string {
  const store = AtelierStore.getInstance();
  const d = store.direction(p, id);
  if (!d) return "No direction.";
  const a = assess(p, d);
  return [
    `${d.id} ${d.name} — evidence level: ${a.level} (${a.why.join("; ")})`,
    `BOM: ${a.bom.rows.length} lines; cost ${a.bom.totalCost} ${p.currency}${a.bom.uncosted.length ? ` for costed parts only (no price: ${a.bom.uncosted.join(", ")})` : ""}; mass ${a.bom.totalMass} g${a.bom.unweighed.length ? ` (unknown density: ${a.bom.unweighed.join(", ")})` : ""}`,
    ...a.bom.rows.map((r) => `  ${r.id} ${r.name} · ${r.material} · ${r.size} ×${r.quantity} · ${r.lineCost ?? "no price"} · ${r.mass ?? "?"} g · ${r.costBasis}`),
    a.interferences.length ? `Interferences: ${a.interferences.map((x) => `${x.a}/${x.b} ${x.overlap} mm³${x.exact ? "" : " (bounding boxes)"}`).join("; ")}` : "Interferences: none (bounding-box check)",
    a.safety.length ? `Needs qualified review: ${a.safety.map((x) => `${x.domain} — ${x.reviewer}`).join("; ")}` : "No regulated domain detected",
    a.unsupportedClaims.length ? `Claims citing unavailable sources: ${a.unsupportedClaims.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

const DOCUMENTS = ["bom-xlsx", "bom-csv", "dossier-docx", "dossier-pdf", "review-pptx", "review-pdf"] as const;

export const ATELIER_EXECUTORS: AtelierExecutor[] = [
  {
    id: "atelier.project",
    parameters: OBJ({
      title: { type: "string" }, brief: { type: "string" }, currency: { type: "string" },
      inputs: { type: "array", description: "supplied material: {kind: image|photo|video|document|pdf|sketch|audio|cad|url|text, name, method (how YOU inspected it), findings (what you actually found)}. Leave method/findings empty for anything you could not inspect", items: OBJ({ kind: { type: "string" }, name: { type: "string" }, method: { type: "string" }, findings: { type: "string" } }) },
      sources: { type: "array", items: SOURCE_SCHEMA },
      materials: { type: "array", description: "materials not in the built-in library: {name, density g/cm³, source}", items: OBJ({ name: { type: "string" }, density: { type: "number" }, source: { type: "string" } }) },
    }, ["title", "brief"]),
    run: async (args, context) => {
      const r = AtelierStore.getInstance().create({ ...args, title: args.title, brief: args.brief, conversationId: context?.request?.conversationId });
      if (!r.ok) return { ok: false, content: `No project was created: ${r.reason}.` };
      announce(context, r.project, "created");
      openAtelier(r.project.id);
      const notInspected = r.project.inputs.filter((i) => !i.inspected);
      return { ok: true, content: `Started project [${r.project.id}] “${r.project.title}” with ${r.project.sources.length} sources.${notInspected.length ? ` Not inspected (recorded as such): ${notInspected.map((i) => i.name).join(", ")}.` : ""} Next: atelier_directions with genuinely different architectures.`, data: { id: r.project.id } };
    },
  },
  {
    id: "atelier.directions",
    parameters: OBJ({ project: { type: "string" }, directions: { type: "array", items: DIRECTION_SCHEMA } }, ["directions"]),
    run: async (args, context) => {
      const p = project(args, context);
      if (!p) return { ok: false, content: "No project matches; start one with atelier_project." };
      const r = AtelierStore.getInstance().addDirections(p.id, Array.isArray(args.directions) ? args.directions : []);
      if (!r.ok) return { ok: false, content: r.reason };
      announce(context, p, "revised");
      openAtelier(p.id);
      return { ok: true, content: `Version ${r.version.version}: ${r.version.note}.\n\n${r.version.directions.map((d) => describeAssessment(p, d.id)).join("\n\n")}` };
    },
  },
  {
    id: "atelier.component",
    parameters: OBJ({ project: { type: "string" }, direction: { type: "string" }, component: { type: "string" }, changes: COMPONENT_SCHEMA, remove: { type: "boolean" } }, ["direction", "component"]),
    run: async (args, context) => {
      const p = project(args, context);
      if (!p) return { ok: false, content: "No project matches." };
      const changes = (typeof args.changes === "object" && args.changes) ? { ...(args.changes as Record<string, unknown>) } : {};
      if (args.remove === true) changes.remove = true;
      const r = AtelierStore.getInstance().updateComponent(p.id, str(args, "direction"), str(args, "component"), changes);
      if (!r.ok) return { ok: false, content: r.reason };
      announce(context, p, "revised");
      return { ok: true, content: `Version ${r.version.version}: ${r.version.note}. Everything made from the components (BOM, drawings, models, dossier) now uses the change; export again to write it.\n${describeAssessment(p, str(args, "direction"))}` };
    },
  },
  {
    id: "atelier.derive",
    parameters: OBJ({ project: { type: "string" }, from: { type: "array", items: { type: "string" } }, name: { type: "string" }, architecture: { type: "string" }, identity: { type: "string" }, components: { type: "array", items: COMPONENT_SCHEMA } }, ["from", "name"]),
    run: async (args, context) => {
      const p = project(args, context);
      if (!p) return { ok: false, content: "No project matches." };
      const r = AtelierStore.getInstance().derive(p.id, Array.isArray(args.from) ? args.from.map(String) : [], { name: str(args, "name"), architecture: str(args, "architecture") || undefined, identity: str(args, "identity") || undefined, components: Array.isArray(args.components) ? args.components : undefined });
      if (!r.ok) return { ok: false, content: r.reason };
      announce(context, p, "revised");
      return { ok: true, content: `Version ${r.version.version}: ${r.version.note}; the originals are kept.\n${describeAssessment(p, r.direction.id)}` };
    },
  },
  {
    id: "atelier.select",
    parameters: OBJ({ project: { type: "string" }, direction: { type: "string" } }, ["direction"]),
    run: async (args, context) => {
      const p = project(args, context);
      if (!p) return { ok: false, content: "No project matches." };
      const r = AtelierStore.getInstance().select(p.id, str(args, "direction"));
      if (!r.ok) return { ok: false, content: r.reason };
      announce(context, p, "revised");
      return { ok: true, content: `Selected ${str(args, "direction")} (version ${r.version.version}).` };
    },
  },
  {
    id: "atelier.sources",
    parameters: OBJ({ project: { type: "string" }, sources: { type: "array", items: SOURCE_SCHEMA } }, ["sources"]),
    run: async (args, context) => {
      const p = project(args, context);
      if (!p) return { ok: false, content: "No project matches." };
      const r = AtelierStore.getInstance().addSources(p.id, Array.isArray(args.sources) ? args.sources : []);
      return r.ok ? { ok: true, content: `Added ${r.added} source(s); the project has ${p.sources.length}.` } : { ok: false, content: r.reason };
    },
  },
  {
    id: "atelier.assess",
    parameters: OBJ({ project: { type: "string" }, direction: { type: "string", description: "omit to compare every direction" } }),
    run: async (args, context) => {
      const p = project(args, context);
      if (!p) return { ok: false, content: "No project matches." };
      const dirs = AtelierStore.getInstance().latest(p).directions;
      if (dirs.length === 0) return { ok: true, content: "The project has no directions yet." };
      const ids = str(args, "direction") ? [str(args, "direction")] : dirs.map((d) => d.id);
      return { ok: true, content: ids.map((id) => describeAssessment(p, id)).join("\n\n") };
    },
  },
  {
    id: "atelier.export",
    parameters: OBJ({
      project: { type: "string" },
      direction: { type: "string", description: "default: the selected one" },
      files: { type: "array", items: { type: "string", enum: [...ATELIER_FORMATS, "step"] }, description: "design files" },
      documents: { type: "array", items: { type: "string", enum: [...DOCUMENTS] }, description: "production documents (Creation Studio artifacts)" },
    }),
    run: async (args, context) => {
      const store = AtelierStore.getInstance();
      const p = project(args, context);
      if (!p) return { ok: false, content: "No project matches." };
      const d = store.direction(p, str(args, "direction") || undefined);
      if (!d) return { ok: false, content: "The project has no such direction." };
      const lines: string[] = [];
      let ok = true;
      const files = Array.isArray(args.files) ? args.files.map(String) : [];
      const fileCards: Array<{ format: string; filename: string; ok: boolean; size: number }> = [];
      if (files.length) {
        const r = store.exportFiles(p.id, d.id, files);
        if (!r.ok) return { ok: false, content: r.reason };
        for (const f of r.files) {
          fileCards.push({ format: f.format, filename: f.filename, ok: f.verification.ok, size: f.bytes.length });
          if (!f.verification.ok) ok = false;
          lines.push(`${f.verification.ok ? "✓" : "✗ FAILED"} ${f.filename} (${f.bytes.length} bytes): ${f.verification.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` ${c.detail}` : ""}`).join("; ")}`);
        }
        for (const x of r.refused) { ok = false; lines.push(`✗ ${x.format}: ${x.reason}`); }
        announce(context, p, "exported", fileCards);
      }
      const docs = Array.isArray(args.documents) ? args.documents.map(String) : [];
      const v = store.latest(p).version;
      const made = new Map<string, { spec: ArtifactSpec; formats: ExportFormat[] }>();
      for (const doc of docs) {
        const [what, format] = doc.split("-") as [string, ExportFormat];
        const key = what;
        const spec = what === "bom" ? bomWorkbook(p, d, v) : what === "dossier" ? dossierDocument(p, d, v) : what === "review" ? reviewDeck(p, store.latest(p).directions, store.latest(p).selected, v) : null;
        if (!spec) { lines.push(`✗ ${doc}: unknown document`); ok = false; continue; }
        const entry = made.get(key) ?? { spec, formats: [] };
        entry.formats.push(format);
        made.set(key, entry);
      }
      const studio = StudioStore.getInstance();
      for (const [, entry] of made) {
        const created = studio.create(entry.spec, { by: "lelu", note: `from Atelier ${p.title} ${d.id} v${v}`, conversationId: context?.request?.conversationId });
        if (!created.ok) { ok = false; lines.push(`✗ ${entry.spec.title}: ${created.reason}`); continue; }
        const a = created.artifact;
        const records: Array<{ format: string; filename: string; ok: boolean; size: number }> = [];
        for (const format of entry.formats) {
          const r = await studio.export(a.id, format);
          if (!r.ok) { ok = false; lines.push(`✗ ${a.title} ${format}: ${r.reason}`); continue; }
          records.push({ format, filename: r.record.filename, ok: r.record.ok, size: r.record.size });
          if (!r.record.ok) ok = false;
          lines.push(`${r.record.ok ? "✓" : "✗ FAILED"} ${r.record.filename} (Creation Studio [${a.id}])\n${summarizeVerification(r.result.verification).replace(/^/gm, "    ")}`);
        }
        AgentEventBus.getInstance().emit({ type: "studio_artifact", taskId: String(context?.request?.timestamp ?? Date.now()), artifactId: a.id, rev: 1, title: a.title, kind: a.kind, action: "created", exports: records });
      }
      if (!files.length && !docs.length) return { ok: false, content: `Nothing was exported: name files (${ATELIER_FORMATS.join(", ")}) and/or documents (${DOCUMENTS.join(", ")}).` };
      openAtelier(p.id);
      return { ok, content: `${d.id} ${d.name}, design version ${v}:\n${lines.join("\n")}` };
    },
  },
  {
    id: "atelier.open",
    parameters: OBJ({ project: { type: "string" } }),
    run: async (args, context) => {
      const p = project(args, context);
      if (!p) return { ok: false, content: "No project matches." };
      const opened = openAtelier(p.id);
      announce(context, p, "opened");
      return { ok: opened, content: opened ? `Opened “${p.title}” in Cosmos.` : "No interface is attached, so nothing was opened." };
    },
  },
];

export function registerAtelierTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const definition of ATELIER_TOOLS) registry.register(definition);
}
