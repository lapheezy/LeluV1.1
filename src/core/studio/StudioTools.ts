/**
 * ==========================================================
 * LÉLU — CREATION STUDIO TOOLS
 *
 * Documents, presentations and spreadsheets as tools in the same
 * ToolRegistry / ToolDispatcher / AutonomyGate as every other one,
 * so an ordinary chat turn can make, change, export and re-open
 * real files:
 *
 *   studio.create   risk 1  make an artifact (and export it)
 *   studio.revise   risk 1  a new revision from changes; the old stays
 *   studio.export   risk 1  write a file, re-open it, verify it
 *   studio.read     risk 0  what an artifact (or its exported file) holds
 *   studio.list     risk 0  every artifact, newest first
 *   studio.compare  risk 0  what changed between two revisions
 *   studio.restore  risk 1  bring an old revision back as a new one
 *   studio.open     risk 1  show artifacts as Cosmos windows (side by side)
 *
 * A file is reported as exported only when its read-back passed;
 * a failed check is reported as a failure with what was missing.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import type RouterContext from "../router/RouterContext";
import { summarizeVerification } from "./StudioExport";
import type { StudioOp } from "./StudioOps";
import StudioStore, { type StudioArtifact } from "./StudioStore";
import { FORMATS_BY_KIND, type ArtifactSpec, type ExportFormat } from "./StudioTypes";
import { ownerForTask } from "../multichat/TurnOwnership";

/**
 * The conversation this tool call belongs to. The request carries it on most
 * paths; where a router layer rebuilt the request without it, the turn's
 * task id is still bound to its conversation (multichat/TurnOwnership) — the
 * same binding the chat cards use — so the artifact stays with the chat that
 * asked for it.
 */
function conversationOf(context: RouterContext | undefined): string | undefined {
  return context?.request?.conversationId ?? ownerForTask(String(context?.request?.timestamp ?? "")) ?? undefined;
}


export interface StudioExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, context: RouterContext | undefined) => Promise<ToolExecutionResult>;
}

/** Window events the Cosmos interface listens for (see GenesisInterface). */
export const STUDIO_OPEN_EVENT = "lelu-studio-open";

const tool = (id: string, name: string, description: string, riskLevel: number, permissions: string[]): ToolDefinition =>
  ({ id, name, description, category: "Creation Studio", permissions, riskLevel, available: true, executionRoute: "front-end:StudioStore", verificationMethod: "studio.read" }) as ToolDefinition;

export const STUDIO_TOOLS: ToolDefinition[] = [
  tool("studio.create", "Create a Document, Presentation or Spreadsheet",
    "Make a real artifact the user can open, revise and download: a document (exports DOCX, PDF, Markdown, HTML, TXT, RTF), a presentation (PPTX with native charts, tables and speaker notes; PDF, HTML) or a workbook (XLSX with formulas and native charts; CSV). Optionally export it at once; every exported file is re-opened and checked before it is reported. Use for 'make this into a PowerPoint', 'write a report', 'put this data in a spreadsheet', 'show the data as a chart'. Only include facts, numbers and sources you actually have", 1, ["WRITE"]),
  tool("studio.revise", "Revise an Artifact",
    "Change an existing artifact as a NEW revision (earlier revisions are kept): change a chart's type or data, add/move/remove slides or blocks, set cells or formulas, add sheets or sources, or replace the whole spec. Use for 'make the chart a line chart', 'move slide 4 to the front', 'add a column for tax'", 1, ["WRITE"]),
  tool("studio.export", "Export an Artifact to a File",
    "Write an artifact revision as a file (docx, pptx, xlsx, pdf, csv, md, html, txt, rtf), re-open the written bytes and verify that its contents are really there. Reports each check, the size and the SHA-256", 1, ["WRITE"]),
  tool("studio.read", "Read an Artifact",
    "Read an artifact's content, revisions and exports — or re-open one of its exported files and report what the file itself contains. Use to answer questions about a document, deck or spreadsheet, to explain a chart, or before revising one", 0, ["READ"]),
  tool("studio.list", "List Artifacts", "Every Creation Studio artifact (documents, presentations, spreadsheets), newest first, with its id, revision and exports", 0, ["READ"]),
  tool("studio.compare", "Compare Revisions", "What changed between two revisions of an artifact", 0, ["READ"]),
  tool("studio.restore", "Restore a Revision", "Bring an earlier revision back as a new revision; nothing in between is lost", 1, ["WRITE"]),
  tool("studio.open", "Open Artifacts in Cosmos", "Open one or more artifacts as Cosmos windows; two or more are placed side by side (e.g. 'open the report and the spreadsheet next to each other')", 1, ["WRITE"]),
];

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const str = (args: Record<string, unknown>, key: string) => (typeof args[key] === "string" ? (args[key] as string).trim() : "");
const ALL_FORMATS: ExportFormat[] = ["docx", "pptx", "xlsx", "pdf", "csv", "md", "html", "txt", "rtf"];


const SPEC_PROPERTIES = {
  kind: { type: "string", enum: ["document", "deck", "workbook"], description: "document = report/brief/letter; deck = presentation; workbook = spreadsheet" },
  title: { type: "string" },
  subtitle: { type: "string" },
  author: { type: "string" },
  blocks: {
    type: "array",
    description: "document: in order. {type:'heading',level:1-3,text} {type:'paragraph',text} {type:'bullets',items:[],ordered?} {type:'table',caption?,columns:[],rows:[[...]]} {type:'chart',chart:{kind,title,labels,series:[{name,values}]},caption?} {type:'quote',text,cite?} {type:'image',dataUrl:'data:image/...',caption?}",
    items: { type: "object" },
  },
  slides: {
    type: "array",
    description: "deck: {title, subtitle?, layout?: title|section|content|two-column|chart|table|image, bullets?:[], right?:[] (two-column), chart?, table?:{columns,rows}, notes?: speaker notes}",
    items: { type: "object" },
  },
  sheets: {
    type: "array",
    description: "workbook: {name, columns:[headers], rows:[[values]], charts?:[chart]}. A cell starting with '=' is a formula (A1 refs; row 1 is the header row, data starts at row 2). A chart's series names must be column headers; its labels come from the first column",
    items: { type: "object" },
  },
  sources: { type: "array", description: "sources actually used: {id:'S1', title, url?, accessed?}", items: OBJ({ id: { type: "string" }, title: { type: "string" }, url: { type: "string" }, accessed: { type: "string" } }) },
  theme: OBJ({ background: { type: "string" }, text: { type: "string" }, accent: { type: "string" }, font: { type: "string" } }),
};

function specFrom(args: Record<string, unknown>): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  for (const key of Object.keys(SPEC_PROPERTIES)) if (args[key] !== undefined) spec[key] = args[key];
  return spec;
}

function formatsFrom(args: Record<string, unknown>, kind: ArtifactSpec["kind"]): { formats: ExportFormat[]; refused: string[] } {
  const raw = Array.isArray(args.export) ? args.export : typeof args.export === "string" ? [args.export] : Array.isArray(args.formats) ? args.formats : typeof args.format === "string" ? [args.format] : [];
  const formats: ExportFormat[] = [];
  const refused: string[] = [];
  for (const f of raw.map((x) => String(x).toLowerCase().replace(/^\./, ""))) {
    if ((ALL_FORMATS as string[]).includes(f) && FORMATS_BY_KIND[kind].includes(f as ExportFormat)) formats.push(f as ExportFormat);
    else refused.push(f);
  }
  return { formats: [...new Set(formats)], refused };
}

function taskOf(context: RouterContext | undefined): string {
  return String(context?.request?.timestamp ?? Date.now());
}

function announce(context: RouterContext | undefined, a: StudioArtifact, action: "created" | "revised" | "exported" | "restored" | "opened", exports?: Array<{ format: string; filename: string; ok: boolean; size: number }>): void {
  AgentEventBus.getInstance().emit({
    type: "studio_artifact",
    taskId: taskOf(context),
    artifactId: a.id,
    rev: a.revisions[a.revisions.length - 1].rev,
    title: a.title,
    kind: a.kind,
    action,
    exports,
  });
}

/** Ask the interface to show artifacts as windows. A no-op outside a browser. */
export function openInCosmos(ids: string[], layout: "single" | "side-by-side" = ids.length > 1 ? "side-by-side" : "single"): boolean {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new CustomEvent(STUDIO_OPEN_EVENT, { detail: { ids, layout } }));
  return true;
}

export function describeArtifactSpec(spec: ArtifactSpec, max = 5000): string {
  const lines: string[] = [`${spec.kind} “${spec.title}”`];
  if (spec.kind === "document") {
    spec.blocks.forEach((b, i) => {
      const n = `${i + 1}.`;
      if (b.type === "heading") lines.push(`${n} [H${b.level}] ${b.text}`);
      else if (b.type === "paragraph") lines.push(`${n} ${b.text}`);
      else if (b.type === "bullets") lines.push(`${n} [${b.ordered ? "numbered" : "bullets"}] ${b.items.join(" | ")}`);
      else if (b.type === "table") lines.push(`${n} [table${b.caption ? ` “${b.caption}”` : ""}] ${b.columns.join(" | ")}; ${b.rows.map((r) => r.join(" | ")).join("; ")}`);
      else if (b.type === "chart") lines.push(`${n} [${b.chart.kind} chart “${b.chart.title ?? ""}”] labels ${b.chart.labels.join(", ")}; ${b.chart.series.map((s) => `${s.name}: ${s.values.join(", ")}`).join("; ")}`);
      else if (b.type === "quote") lines.push(`${n} [quote] ${b.text}${b.cite ? ` — ${b.cite}` : ""}`);
      else lines.push(`${n} [image] ${b.caption ?? ""}`);
    });
  } else if (spec.kind === "deck") {
    spec.slides.forEach((s, i) => lines.push(`slide ${i + 1}: ${s.title}${s.layout ? ` (${s.layout})` : ""}${s.bullets ? ` — ${s.bullets.join(" | ")}` : ""}${s.right ? ` || ${s.right.join(" | ")}` : ""}${s.chart ? ` [${s.chart.kind} chart: ${s.chart.series.map((x) => `${x.name} ${x.values.join("/")}`).join("; ")} over ${s.chart.labels.join("/")}]` : ""}${s.table ? ` [table ${s.table.columns.join("|")} ×${s.table.rows.length}]` : ""}${s.notes ? ` (notes: ${s.notes})` : ""}`));
  } else {
    for (const sh of spec.sheets) {
      lines.push(`sheet ${sh.name}: ${sh.columns.join(" | ")}`);
      sh.rows.slice(0, 40).forEach((r, i) => lines.push(`  row ${i + 2}: ${r.map((c) => (c && typeof c === "object" ? `=${c.formula}${c.result !== undefined ? ` (${c.result})` : ""}` : String(c ?? ""))).join(" | ")}`));
      if (sh.rows.length > 40) lines.push(`  … ${sh.rows.length - 40} more rows`);
      for (const c of sh.charts ?? []) lines.push(`  [${c.kind} chart “${c.title ?? ""}”: ${c.series.map((s) => s.name).join(", ")}]`);
    }
  }
  if ("sources" in spec && spec.sources?.length) lines.push(`sources: ${spec.sources.map((s) => `[${s.id}] ${s.title}${s.url ? ` ${s.url}` : ""}`).join("; ")}`);
  const text = lines.join("\n");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function exportAll(store: StudioStore, a: StudioArtifact, formats: ExportFormat[], context: RouterContext | undefined): Promise<{ lines: string[]; ok: boolean; records: Array<{ format: string; filename: string; ok: boolean; size: number }> }> {
  const lines: string[] = [];
  const records: Array<{ format: string; filename: string; ok: boolean; size: number }> = [];
  let ok = true;
  for (const format of formats) {
    const r = await store.export(a.id, format);
    if (!r.ok) {
      ok = false;
      lines.push(`✗ ${format.toUpperCase()}: not written — ${r.reason}`);
      continue;
    }
    records.push({ format, filename: r.record.filename, ok: r.record.ok, size: r.record.size });
    if (!r.record.ok) ok = false;
    lines.push(
      r.record.ok
        ? `✓ ${r.record.filename} (${(r.record.size / 1024).toFixed(1)} KB, sha256 ${r.record.sha256.slice(0, 12)}…) — re-opened and verified:\n${summarizeVerification(r.result.verification).replace(/^/gm, "    ")}`
        : `✗ ${r.record.filename} was written but FAILED verification — do not tell the user it is ready:\n${summarizeVerification(r.result.verification).replace(/^/gm, "    ")}`,
    );
  }
  if (records.length) announce(context, a, "exported", records);
  return { lines, ok, records };
}

export const STUDIO_EXECUTORS: StudioExecutor[] = [
  {
    id: "studio.create",
    parameters: OBJ({
      ...SPEC_PROPERTIES,
      export: { type: "array", items: { type: "string", enum: ALL_FORMATS }, description: "formats to write now (e.g. ['pptx','pdf']); each is verified" },
      open: { type: "boolean", description: "show it as a Cosmos window (default true)" },
    }, ["kind", "title"]),
    run: async (args, context) => {
      const store = StudioStore.getInstance();
      const created = store.create(specFrom(args), { by: "lelu", conversationId: conversationOf(context) });
      if (!created.ok) return { ok: false, content: `Nothing was created: ${created.reason}.` };
      const a = created.artifact;
      announce(context, a, "created");
      const { formats, refused } = formatsFrom(args, a.kind);
      const exported = await exportAll(store, a, formats, context);
      const opened = args.open === false ? false : openInCosmos([a.id]);
      return {
        ok: exported.ok,
        content: [
          `Created [${a.id}] ${a.kind} “${a.title}” (revision 1)${opened ? "; it is open in a Cosmos window and shown as a card in the chat" : ""}.`,
          ...exported.lines,
          refused.length ? `Not exported: ${refused.join(", ")} (a ${a.kind} can be ${FORMATS_BY_KIND[a.kind].join(", ")}).` : "",
          `Change it with studio_revise (artifact: "${a.id}"). The user can download each verified file from the card.`,
        ].filter(Boolean).join("\n"),
        data: { id: a.id, rev: 1, exports: exported.records },
      };
    },
  },
  {
    id: "studio.revise",
    parameters: OBJ({
      artifact: { type: "string", description: "its [id] or part of its title; omit for the latest in this chat" },
      ops: {
        type: "array",
        description:
          "changes, applied in order (1-based indexes): setTitle{title} | addBlock{block,at?} replaceBlock{index,block} removeBlock{index} moveBlock{from,to} | " +
          "updateChart{index? (document: nth chart), slide? (deck), sheet? (workbook), chart:{kind?,title?,labels?,series?}} | addSlide{slide,at?} updateSlide{index,slide} removeSlide{index} moveSlide{from,to} | " +
          "setCell{sheet,ref:'C3',value (or '=FORMULA')} addRow{sheet,row:[]} addSheet{sheet} | addSource{source}",
        items: OBJ({ op: { type: "string" } }, ["op"]),
      },
      spec: OBJ(SPEC_PROPERTIES, ["kind", "title"]),
      note: { type: "string", description: "what this revision is, in a few words" },
      export: { type: "array", items: { type: "string", enum: ALL_FORMATS } },
    }),
    run: async (args, context) => {
      const store = StudioStore.getInstance();
      const a = store.resolve(str(args, "artifact"), conversationOf(context));
      if (!a) return { ok: false, content: `No artifact matches${str(args, "artifact") ? ` “${str(args, "artifact")}”` : ""}. studio_list shows what exists.` };
      const r = store.revise(a.id, { ops: Array.isArray(args.ops) ? (args.ops as StudioOp[]) : undefined, spec: args.spec, note: str(args, "note") || undefined, by: "lelu" });
      if (!r.ok) return { ok: false, content: r.reason };
      announce(context, a, "revised");
      const { formats } = formatsFrom(args, a.kind);
      const exported = await exportAll(store, a, formats, context);
      openInCosmos([a.id]);
      return {
        ok: exported.ok,
        content: [`Revised [${a.id}] “${a.title}”: revision ${r.revision.rev} (from ${r.revision.basedOn}; earlier revisions are kept).`, `Changes: ${r.changes.join("; ") || "none"}`, ...exported.lines].join("\n"),
        data: { id: a.id, rev: r.revision.rev, changes: r.changes },
      };
    },
  },
  {
    id: "studio.export",
    parameters: OBJ({
      artifact: { type: "string" },
      formats: { type: "array", items: { type: "string", enum: ALL_FORMATS } },
      rev: { type: "number", description: "a past revision; default the latest" },
    }, ["formats"]),
    run: async (args, context) => {
      const store = StudioStore.getInstance();
      const a = store.resolve(str(args, "artifact"), conversationOf(context));
      if (!a) return { ok: false, content: "No artifact matches; nothing was exported." };
      const { formats, refused } = formatsFrom(args, a.kind);
      if (formats.length === 0) return { ok: false, content: `Nothing was exported: a ${a.kind} can be ${FORMATS_BY_KIND[a.kind].join(", ")}${refused.length ? ` (not ${refused.join(", ")})` : ""}.` };
      const rev = typeof args.rev === "number" ? args.rev : undefined;
      const lines: string[] = [];
      const records: Array<{ format: string; filename: string; ok: boolean; size: number }> = [];
      for (const format of formats) {
        const r = await store.export(a.id, format, rev);
        if (!r.ok) { lines.push(`✗ ${format}: ${r.reason}`); continue; }
        records.push({ format, filename: r.record.filename, ok: r.record.ok, size: r.record.size });
        lines.push(`${r.record.ok ? "✓" : "✗ FAILED"} ${r.record.filename} (revision ${r.record.rev}, ${r.record.size} bytes)\n${summarizeVerification(r.result.verification).replace(/^/gm, "    ")}`);
      }
      if (records.length) announce(context, a, "exported", records);
      return { ok: records.length > 0 && records.every((x) => x.ok), content: lines.join("\n"), data: { id: a.id, exports: records } };
    },
  },
  {
    id: "studio.read",
    parameters: OBJ({
      artifact: { type: "string" },
      rev: { type: "number" },
      file: { type: "string", enum: ALL_FORMATS, description: "re-open this exported file and report what the FILE contains" },
    }),
    run: async (args, context) => {
      const store = StudioStore.getInstance();
      const a = store.resolve(str(args, "artifact"), conversationOf(context));
      if (!a) return { ok: false, content: "No artifact matches." };
      const r = store.revision(a, typeof args.rev === "number" ? args.rev : undefined);
      if (!r) return { ok: false, content: `Revision ${String(args.rev)} does not exist (1–${store.latest(a).rev}).` };
      const file = str(args, "file") as ExportFormat;
      if (file) {
        const read = await store.reopen(a.id, r.rev, file);
        if (!read) return { ok: false, content: `${file} could not be produced for revision ${r.rev}.` };
        return {
          ok: read.ok,
          content: read.ok
            ? `Re-opened the ${file.toUpperCase()} of [${a.id}] revision ${r.rev} from its bytes. Structure: ${JSON.stringify(read.structure)}\nText:\n${read.text.slice(0, 5000)}`
            : `The ${file} file did not open: ${read.error}`,
        };
      }
      const revs = a.revisions.map((x) => `r${x.rev} ${new Date(x.at).toISOString().slice(0, 16)} ${x.by}: ${x.note}`).join("\n");
      const exps = a.exports.slice(-8).map((e) => `r${e.rev} ${e.filename} ${e.ok ? "verified" : "FAILED"}`).join("\n") || "none";
      return { ok: true, content: `[${a.id}] revision ${r.rev} of ${store.latest(a).rev}\n${describeArtifactSpec(r.spec)}\n\nRevisions:\n${revs}\nExports:\n${exps}`, data: { id: a.id, rev: r.rev } };
    },
  },
  {
    id: "studio.list",
    parameters: OBJ({}),
    run: async () => {
      const list = StudioStore.getInstance().list();
      if (list.length === 0) return { ok: true, content: "No artifacts yet." };
      return { ok: true, content: list.slice(0, 40).map((a) => `[${a.id}] ${a.kind} “${a.title}” · r${a.revisions[a.revisions.length - 1].rev} · ${a.exports.filter((e) => e.ok).map((e) => e.format).filter((f, i, all) => all.indexOf(f) === i).join(", ") || "not exported"}${a.original ? ` · imported from ${a.original.name}` : ""}`).join("\n") };
    },
  },
  {
    id: "studio.compare",
    parameters: OBJ({ artifact: { type: "string" }, from: { type: "number" }, to: { type: "number" } }, ["from", "to"]),
    run: async (args, context) => {
      const store = StudioStore.getInstance();
      const a = store.resolve(str(args, "artifact"), conversationOf(context));
      if (!a) return { ok: false, content: "No artifact matches." };
      const r = store.compare(a.id, Number(args.from), Number(args.to));
      return r.ok ? { ok: true, content: `“${a.title}” r${args.from} → r${args.to}:\n${r.changes.join("\n") || "no differences"}` } : { ok: false, content: r.reason };
    },
  },
  {
    id: "studio.restore",
    parameters: OBJ({ artifact: { type: "string" }, rev: { type: "number" } }, ["rev"]),
    run: async (args, context) => {
      const store = StudioStore.getInstance();
      const a = store.resolve(str(args, "artifact"), conversationOf(context));
      if (!a) return { ok: false, content: "No artifact matches." };
      const r = store.restore(a.id, Number(args.rev), "lelu");
      if (!r.ok) return { ok: false, content: r.reason };
      announce(context, a, "restored");
      return { ok: true, content: `Restored revision ${args.rev} of “${a.title}” as revision ${r.revision.rev}; nothing was deleted.` };
    },
  },
  {
    id: "studio.open",
    parameters: OBJ({ artifacts: { type: "array", items: { type: "string" }, description: "ids or titles; two or more open side by side" } }, ["artifacts"]),
    run: async (args, context) => {
      const store = StudioStore.getInstance();
      const refs = Array.isArray(args.artifacts) ? args.artifacts.map(String) : [];
      const found = refs.map((ref) => ({ ref, a: store.resolve(ref, conversationOf(context)) }));
      const missing = found.filter((f) => !f.a).map((f) => f.ref);
      const ids = found.flatMap((f) => (f.a ? [f.a.id] : []));
      if (ids.length === 0) return { ok: false, content: `Nothing was opened: no artifact matches ${missing.map((m) => `“${m}”`).join(", ")}.` };
      const opened = openInCosmos([...new Set(ids)]);
      for (const f of found) if (f.a) announce(context, f.a, "opened");
      return {
        ok: opened && missing.length === 0,
        content: opened
          ? `Opened ${ids.length} window${ids.length > 1 ? "s side by side" : ""}: ${found.filter((f) => f.a).map((f) => `“${f.a!.title}”`).join(", ")}.${missing.length ? ` Not found: ${missing.join(", ")}.` : ""}`
          : "No interface is attached to this runtime, so no window was opened.",
      };
    },
  },
];

export function registerStudioTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const definition of STUDIO_TOOLS) registry.register(definition);
}
