/**
 * ==========================================================
 * LÉLU — CREATION STUDIO: CHECKING AND CHANGING A SPEC
 *
 * normalizeSpec: what a model (or a file) hands over becomes a
 * valid spec or a precise reason it is not one. Nothing is
 * silently invented to fill a gap.
 *
 * applyOps: a revision as a list of small, named changes
 * ("make chart 1 a line chart", "move slide 4 to 2", "set
 * BOM!C3 to 3.4"). The result is a NEW spec; the old one stays
 * in the store as the previous revision.
 * ==========================================================
 */

import type { ArtifactSpec, Block, Cell, ChartKind, ChartSpec, DeckSpec, DocumentSpec, SheetSpec, SlideSpec, Source, WorkbookSpec } from "./StudioTypes";

export type Normalized = { ok: true; spec: ArtifactSpec } | { ok: false; reason: string };

const CHART_KINDS: ChartKind[] = ["bar", "column", "line", "pie", "donut", "scatter"];
const LIMITS = { blocks: 400, slides: 120, sheets: 30, rows: 20000, cols: 200, text: 20000 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = LIMITS.text) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter((x) => x.length > 0) : []);
const tableCell = (v: unknown): string | number => (typeof v === "number" && Number.isFinite(v) ? v : str(v));

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[,\s]/g, "")))) return Number(v.replace(/[,\s]/g, ""));
  return null;
}

export function normalizeChart(v: unknown, where: string): ChartSpec | string {
  if (!isObj(v)) return `${where}: a chart needs kind, labels and series`;
  const kind = (str(v.kind) === "doughnut" ? "donut" : str(v.kind)) as ChartKind;
  if (!CHART_KINDS.includes(kind)) return `${where}: chart kind must be one of ${CHART_KINDS.join(", ")}`;
  const labels = Array.isArray(v.labels) ? v.labels.map((l) => str(l)) : [];
  if (!Array.isArray(v.series) || v.series.length === 0) return `${where}: a chart needs at least one series`;
  const series = [];
  for (const [i, s] of v.series.entries()) {
    if (!isObj(s) || !Array.isArray(s.values)) return `${where}: series ${i + 1} needs values`;
    const values = s.values.map(num);
    const bad = values.findIndex((x) => x === null);
    if (bad >= 0) return `${where}: series ${i + 1} value ${bad + 1} (“${String(s.values[bad])}”) is not a number`;
    series.push({ name: str(s.name) || `Series ${i + 1}`, values: values as number[] });
  }
  const x = Array.isArray(v.x) ? v.x.map(num) : undefined;
  if (kind === "scatter") {
    if (!x || x.some((n) => n === null)) return `${where}: a scatter chart needs numeric x values`;
    if (x.length !== series[0].values.length) return `${where}: a scatter chart needs as many x values as y values`;
  } else {
    if (labels.length === 0) return `${where}: a ${kind} chart needs labels`;
    const long = series.find((s) => s.values.length > labels.length);
    if (long) return `${where}: series “${long.name}” has ${long.values.length} values for ${labels.length} labels`;
    if ((kind === "pie" || kind === "donut") && series[0].values.some((n) => n < 0)) return `${where}: a ${kind} chart cannot show negative values`;
  }
  return { kind, title: str(v.title) || undefined, labels, series, x: x as number[] | undefined, xLabel: str(v.xLabel) || undefined, yLabel: str(v.yLabel) || undefined };
}

function normalizeTable(v: Record<string, unknown>, where: string): { columns: string[]; rows: Array<Array<string | number>> } | string {
  // A blank header (a table's top-left corner) is a real column: dropping it
  // shifted every row and lost the last column of data.
  const columns = Array.isArray(v.columns) ? v.columns.map((c) => str(c)) : [];
  if (columns.length === 0 || columns.every((c) => c === "")) return `${where}: a table needs columns`;
  if (columns.length > LIMITS.cols) return `${where}: at most ${LIMITS.cols} columns`;
  const rawRows = Array.isArray(v.rows) ? v.rows : [];
  const rows = rawRows.slice(0, LIMITS.rows).map((r) =>
    Array.isArray(r) ? r.map(tableCell) : isObj(r) ? columns.map((c) => tableCell(r[c])) : [tableCell(r)],
  );
  return { columns, rows };
}

function normalizeSources(v: unknown): Source[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(isObj).map((s, i) => ({ id: str(s.id) || `S${i + 1}`, title: str(s.title), url: str(s.url) || undefined, accessed: str(s.accessed) || undefined, note: str(s.note) || undefined })).filter((s) => s.title);
  return out.length ? out : undefined;
}

function normalizeBlock(v: unknown, i: number): Block | string {
  const where = `block ${i + 1}`;
  if (!isObj(v)) return `${where} is not an object`;
  const type = str(v.type);
  switch (type) {
    case "heading": {
      const level = Number(v.level ?? 1);
      return str(v.text) ? { type, level: (level === 2 || level === 3 ? level : 1) as 1 | 2 | 3, text: str(v.text) } : `${where}: a heading needs text`;
    }
    case "paragraph": return str(v.text) ? { type, text: str(v.text) } : `${where}: a paragraph needs text`;
    case "bullets": { const items = strList(v.items); return items.length ? { type, items, ordered: v.ordered === true } : `${where}: a list needs items`; }
    case "quote": return str(v.text) ? { type, text: str(v.text), cite: str(v.cite) || undefined } : `${where}: a quote needs text`;
    case "table": { const t = normalizeTable(v, where); return typeof t === "string" ? t : { type, caption: str(v.caption) || undefined, ...t }; }
    case "chart": { const c = normalizeChart(v.chart ?? v, where); return typeof c === "string" ? c : { type, chart: c, caption: str(v.caption) || undefined }; }
    case "image": {
      const url = str(v.dataUrl ?? v.src, 30_000_000);
      return /^data:image\//.test(url) ? { type, dataUrl: url, caption: str(v.caption) || undefined } : `${where}: an image must be a data:image URL (a file or capture LÉLU actually has)`;
    }
    default: return `${where}: unknown block type “${type}” (heading, paragraph, bullets, table, chart, image, quote)`;
  }
}

function normalizeSlide(v: unknown, i: number): SlideSpec | string {
  const where = `slide ${i + 1}`;
  if (!isObj(v)) return `${where} is not an object`;
  const slide: SlideSpec = { title: str(v.title) };
  if (!slide.title) return `${where}: a slide needs a title`;
  const layout = str(v.layout);
  if (layout) {
    if (!["title", "content", "two-column", "chart", "table", "image", "section"].includes(layout)) return `${where}: unknown layout “${layout}”`;
    slide.layout = layout as SlideSpec["layout"];
  }
  if (str(v.subtitle)) slide.subtitle = str(v.subtitle);
  const bullets = strList(v.bullets);
  if (bullets.length) slide.bullets = bullets;
  const right = strList(v.right);
  if (right.length) slide.right = right;
  if (v.chart !== undefined) { const c = normalizeChart(v.chart, where); if (typeof c === "string") return c; slide.chart = c; }
  if (isObj(v.table)) { const t = normalizeTable(v.table, where); if (typeof t === "string") return t; slide.table = t; }
  if (isObj(v.image)) {
    const url = str(v.image.dataUrl, 30_000_000);
    if (!/^data:image\//.test(url)) return `${where}: an image must be a data:image URL`;
    slide.image = { dataUrl: url, caption: str(v.image.caption) || undefined };
  }
  if (str(v.notes)) slide.notes = str(v.notes);
  return slide;
}

function normalizeCell(v: unknown): Cell {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.startsWith("=")) return { formula: v.slice(1) };
    return v.slice(0, 32767);
  }
  if (isObj(v) && typeof v.formula === "string") {
    const result = typeof v.result === "number" || typeof v.result === "string" ? v.result : undefined;
    return { formula: v.formula.replace(/^=/, ""), result };
  }
  return str(v);
}

function normalizeSheet(v: unknown, i: number): SheetSpec | string {
  const where = `sheet ${i + 1}`;
  if (!isObj(v)) return `${where} is not an object`;
  const columns = strList(v.columns);
  if (columns.length === 0) return `${where}: a sheet needs column headers`;
  const rows = (Array.isArray(v.rows) ? v.rows : []).slice(0, LIMITS.rows).map((r) => (Array.isArray(r) ? r.map(normalizeCell) : isObj(r) ? columns.map((c) => normalizeCell(r[c])) : [normalizeCell(r)]));
  const charts: ChartSpec[] = [];
  for (const [ci, c] of (Array.isArray(v.charts) ? v.charts : []).entries()) {
    const chart = normalizeChart(c, `${where} chart ${ci + 1}`);
    if (typeof chart === "string") return chart;
    charts.push(chart);
  }
  return { name: str(v.name) || `Sheet${i + 1}`, columns, rows, charts: charts.length ? charts : undefined };
}

export function normalizeSpec(input: unknown): Normalized {
  if (!isObj(input)) return { ok: false, reason: "the artifact must be an object with a kind" };
  const kind = str(input.kind);
  const title = str(input.title, 300).trim();
  if (!title) return { ok: false, reason: "the artifact needs a title" };
  const author = str(input.author) || undefined;
  if (kind === "document") {
    const raw = Array.isArray(input.blocks) ? input.blocks.slice(0, LIMITS.blocks) : [];
    if (raw.length === 0) return { ok: false, reason: "a document needs at least one block" };
    const blocks: Block[] = [];
    for (const [i, b] of raw.entries()) { const n = normalizeBlock(b, i); if (typeof n === "string") return { ok: false, reason: n }; blocks.push(n); }
    const spec: DocumentSpec = { kind, title, subtitle: str(input.subtitle) || undefined, author, blocks, sources: normalizeSources(input.sources) };
    return { ok: true, spec };
  }
  if (kind === "deck") {
    const raw = Array.isArray(input.slides) ? input.slides.slice(0, LIMITS.slides) : [];
    if (raw.length === 0) return { ok: false, reason: "a presentation needs at least one slide" };
    const slides: SlideSpec[] = [];
    for (const [i, s] of raw.entries()) { const n = normalizeSlide(s, i); if (typeof n === "string") return { ok: false, reason: n }; slides.push(n); }
    const theme = isObj(input.theme) ? Object.fromEntries(Object.entries(input.theme).filter(([k, val]) => ["background", "text", "accent", "font"].includes(k) && typeof val === "string").map(([k, val]) => [k, k === "font" ? val : String(val).replace(/^#/, "").slice(0, 6)])) : undefined;
    const spec: DeckSpec = { kind, title, author, theme, slides, sources: normalizeSources(input.sources) };
    return { ok: true, spec };
  }
  if (kind === "workbook") {
    const raw = Array.isArray(input.sheets) ? input.sheets.slice(0, LIMITS.sheets) : [];
    if (raw.length === 0) return { ok: false, reason: "a workbook needs at least one sheet" };
    const sheets: SheetSpec[] = [];
    for (const [i, s] of raw.entries()) { const n = normalizeSheet(s, i); if (typeof n === "string") return { ok: false, reason: n }; sheets.push(n); }
    const names = new Set<string>();
    for (const s of sheets) {
      const key = s.name.slice(0, 31).toLowerCase();
      if (names.has(key)) return { ok: false, reason: `two sheets are named “${s.name}”` };
      names.add(key);
    }
    const spec: WorkbookSpec = { kind, title, author, sheets };
    return { ok: true, spec };
  }
  return { ok: false, reason: `unknown kind “${kind}”: use document, deck or workbook` };
}

/* ------------------------------------------------------------------ *
 * Revisions as operations
 * ------------------------------------------------------------------ */

export type StudioOp =
  | { op: "setTitle"; title: string }
  | { op: "addBlock"; block: unknown; at?: number }
  | { op: "replaceBlock"; index: number; block: unknown }
  | { op: "removeBlock"; index: number }
  | { op: "moveBlock"; from: number; to: number }
  | { op: "updateChart"; index?: number; slide?: number; sheet?: string; chart: Record<string, unknown> }
  | { op: "addSlide"; slide: unknown; at?: number }
  | { op: "updateSlide"; index: number; slide: Record<string, unknown> }
  | { op: "removeSlide"; index: number }
  | { op: "moveSlide"; from: number; to: number }
  | { op: "setCell"; sheet: string; ref: string; value: unknown }
  | { op: "addRow"; sheet: string; row: unknown[] }
  | { op: "addSheet"; sheet: unknown }
  | { op: "addSource"; source: unknown };

export type OpsResult = { ok: true; spec: ArtifactSpec; changes: string[] } | { ok: false; reason: string };

/** 1-based (as people say it) → 0-based; out of range is an error, not a clamp. */
function idx(n: unknown, length: number, what: string, allowEnd = false): number | string {
  const i = Number(n);
  if (!Number.isInteger(i) || i < 1 || i > length + (allowEnd ? 1 : 0)) return `${what} ${String(n)} does not exist (there ${length === 1 ? "is 1" : `are ${length}`})`;
  return i - 1;
}

function cellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]{1,3})(\d{1,6})$/i.exec(ref.trim());
  if (!m) return null;
  const col = m[1].toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { row: Number(m[2]) - 1, col };
}

function mergeChart(base: ChartSpec, patch: Record<string, unknown>, where: string): ChartSpec | string {
  return normalizeChart({ ...base, ...patch }, where);
}

export function applyOps(spec: ArtifactSpec, ops: StudioOp[]): OpsResult {
  const next = JSON.parse(JSON.stringify(spec)) as ArtifactSpec;
  const changes: string[] = [];
  for (const [n, op] of ops.entries()) {
    const fail = (reason: string): OpsResult => ({ ok: false, reason: `change ${n + 1} (${op.op}): ${reason}. Nothing was changed.` });
    switch (op.op) {
      case "setTitle":
        if (!str(op.title).trim()) return fail("the title is empty");
        next.title = str(op.title, 300).trim();
        changes.push(`title → “${next.title}”`);
        break;
      case "addBlock": case "replaceBlock": case "removeBlock": case "moveBlock": {
        if (next.kind !== "document") return fail("blocks belong to documents");
        if (op.op === "removeBlock") {
          const i = idx(op.index, next.blocks.length, "block"); if (typeof i === "string") return fail(i);
          next.blocks.splice(i, 1); changes.push(`removed block ${i + 1}`);
        } else if (op.op === "moveBlock") {
          const a = idx(op.from, next.blocks.length, "block"); if (typeof a === "string") return fail(a);
          const b = idx(op.to, next.blocks.length, "position"); if (typeof b === "string") return fail(b);
          const [moved] = next.blocks.splice(a, 1); next.blocks.splice(b, 0, moved); changes.push(`moved block ${a + 1} → ${b + 1}`);
        } else {
          const block = normalizeBlock(op.block, op.op === "replaceBlock" ? Number(op.index) - 1 : next.blocks.length);
          if (typeof block === "string") return fail(block);
          if (op.op === "replaceBlock") {
            const i = idx(op.index, next.blocks.length, "block"); if (typeof i === "string") return fail(i);
            next.blocks[i] = block; changes.push(`replaced block ${i + 1} (${block.type})`);
          } else {
            const at = op.at === undefined ? next.blocks.length : idx(op.at, next.blocks.length, "position", true);
            if (typeof at === "string") return fail(at);
            next.blocks.splice(at, 0, block); changes.push(`added a ${block.type} at ${at + 1}`);
          }
        }
        break;
      }
      case "updateChart": {
        if (next.kind === "document") {
          const charts = next.blocks.map((b, i) => (b.type === "chart" ? i : -1)).filter((i) => i >= 0);
          const which = idx(op.index ?? 1, charts.length, "chart"); if (typeof which === "string") return fail(which);
          const block = next.blocks[charts[which]] as Extract<Block, { type: "chart" }>;
          const merged = mergeChart(block.chart, op.chart, `chart ${which + 1}`); if (typeof merged === "string") return fail(merged);
          block.chart = merged; changes.push(`chart ${which + 1} → ${merged.kind}${merged.title ? ` “${merged.title}”` : ""}`);
        } else if (next.kind === "deck") {
          const i = idx(op.slide ?? op.index, next.slides.length, "slide"); if (typeof i === "string") return fail(i);
          const slide = next.slides[i];
          const merged = slide.chart ? mergeChart(slide.chart, op.chart, `slide ${i + 1} chart`) : normalizeChart(op.chart, `slide ${i + 1} chart`);
          if (typeof merged === "string") return fail(merged);
          slide.chart = merged; changes.push(`slide ${i + 1} chart → ${merged.kind}`);
        } else {
          const sheet = next.sheets.find((s) => s.name === op.sheet) ?? (op.sheet ? undefined : next.sheets[0]);
          if (!sheet) return fail(`no sheet named “${op.sheet}”`);
          const list = sheet.charts ?? [];
          const i = op.index === undefined && list.length === 0 ? 0 : idx(op.index ?? 1, list.length, "chart", true);
          if (typeof i === "string") return fail(i);
          const merged = list[i] ? mergeChart(list[i], op.chart, `${sheet.name} chart`) : normalizeChart(op.chart, `${sheet.name} chart`);
          if (typeof merged === "string") return fail(merged);
          list[i] = merged; sheet.charts = list; changes.push(`${sheet.name} chart ${i + 1} → ${merged.kind}`);
        }
        break;
      }
      case "addSlide": case "updateSlide": case "removeSlide": case "moveSlide": {
        if (next.kind !== "deck") return fail("slides belong to presentations");
        if (op.op === "addSlide") {
          const slide = normalizeSlide(op.slide, next.slides.length); if (typeof slide === "string") return fail(slide);
          const at = op.at === undefined ? next.slides.length : idx(op.at, next.slides.length, "position", true);
          if (typeof at === "string") return fail(at);
          next.slides.splice(at, 0, slide); changes.push(`added slide “${slide.title}” at ${at + 1}`);
        } else if (op.op === "updateSlide") {
          const i = idx(op.index, next.slides.length, "slide"); if (typeof i === "string") return fail(i);
          const slide = normalizeSlide({ ...next.slides[i], ...op.slide }, i); if (typeof slide === "string") return fail(slide);
          next.slides[i] = slide; changes.push(`updated slide ${i + 1}`);
        } else if (op.op === "removeSlide") {
          const i = idx(op.index, next.slides.length, "slide"); if (typeof i === "string") return fail(i);
          if (next.slides.length === 1) return fail("a presentation keeps at least one slide");
          next.slides.splice(i, 1); changes.push(`removed slide ${i + 1}`);
        } else {
          const a = idx(op.from, next.slides.length, "slide"); if (typeof a === "string") return fail(a);
          const b = idx(op.to, next.slides.length, "position"); if (typeof b === "string") return fail(b);
          const [moved] = next.slides.splice(a, 1); next.slides.splice(b, 0, moved); changes.push(`moved slide ${a + 1} → ${b + 1}`);
        }
        break;
      }
      case "setCell": case "addRow": {
        if (next.kind !== "workbook") return fail("cells belong to workbooks");
        const sheet = next.sheets.find((s) => s.name === op.sheet);
        if (!sheet) return fail(`no sheet named “${op.sheet}” (sheets: ${next.sheets.map((s) => s.name).join(", ")})`);
        if (op.op === "addRow") {
          if (!Array.isArray(op.row)) return fail("a row is a list of values");
          sheet.rows.push(op.row.map(normalizeCell)); changes.push(`${sheet.name}: added row ${sheet.rows.length + 1}`);
        } else {
          const at = cellRef(str(op.ref));
          if (!at) return fail(`“${op.ref}” is not a cell reference like B3`);
          const value = normalizeCell(op.value);
          if (at.row === 0) {
            if (typeof value !== "string") return fail("row 1 holds the column headers; a header is text");
            sheet.columns[at.col] = value;
          } else {
            while (sheet.rows.length < at.row) sheet.rows.push([]);
            const row = sheet.rows[at.row - 1];
            while (row.length <= at.col) row.push(null);
            row[at.col] = value;
          }
          changes.push(`${sheet.name}!${str(op.ref).toUpperCase()} → ${typeof value === "object" && value ? `=${(value as { formula: string }).formula}` : String(value)}`);
        }
        break;
      }
      case "addSheet": {
        if (next.kind !== "workbook") return fail("sheets belong to workbooks");
        const sheet = normalizeSheet(op.sheet, next.sheets.length); if (typeof sheet === "string") return fail(sheet);
        if (next.sheets.some((s) => s.name.toLowerCase() === sheet.name.toLowerCase())) return fail(`a sheet named “${sheet.name}” exists`);
        next.sheets.push(sheet); changes.push(`added sheet “${sheet.name}”`);
        break;
      }
      case "addSource": {
        if (next.kind === "workbook") return fail("a workbook has no source list");
        const [source] = normalizeSources([op.source]) ?? [];
        if (!source) return fail("a source needs a title");
        next.sources = [...(next.sources ?? []), source]; changes.push(`added source “${source.title}”`);
        break;
      }
      default:
        return fail(`unknown operation “${(op as { op: string }).op}”`);
    }
  }
  const checked = normalizeSpec(next);
  if (!checked.ok) return { ok: false, reason: `the revision would not be valid: ${checked.reason}. Nothing was changed.` };
  return { ok: true, spec: checked.spec, changes };
}

/** What changed between two revisions, in words. */
export function compareSpecs(a: ArtifactSpec, b: ArtifactSpec): string[] {
  const out: string[] = [];
  if (a.kind !== b.kind) return [`kind ${a.kind} → ${b.kind}`];
  if (a.title !== b.title) out.push(`title “${a.title}” → “${b.title}”`);
  const lines = (s: ArtifactSpec): string[] =>
    s.kind === "document" ? s.blocks.map((x) => `${x.type}: ${x.type === "chart" ? `${x.chart.kind} ${x.chart.title ?? ""} ${x.chart.series.map((se) => `${se.name}=${se.values.join("/")}`).join(" ")}` : x.type === "table" ? `${x.columns.join("|")} ×${x.rows.length}` : x.type === "bullets" ? x.items.join(" · ") : x.type === "image" ? x.caption ?? "image" : x.text}`)
    : s.kind === "deck" ? s.slides.map((x, i) => `slide ${i + 1}: ${x.title}${x.bullets ? ` — ${x.bullets.join(" · ")}` : ""}${x.chart ? ` [${x.chart.kind} chart]` : ""}${x.table ? " [table]" : ""}${x.notes ? ` (notes: ${x.notes})` : ""}`)
    : s.sheets.flatMap((sh) => [`sheet ${sh.name}: ${sh.columns.join("|")}`, ...sh.rows.map((r, i) => `${sh.name} row ${i + 2}: ${r.map((c) => (typeof c === "object" && c ? `=${(c as { formula: string }).formula}` : String(c ?? ""))).join("|")}`), ...(sh.charts ?? []).map((c) => `${sh.name} chart: ${c.kind}`)]);
  const la = lines(a);
  const lb = lines(b);
  const sa = new Set(la);
  const sb = new Set(lb);
  for (const l of la) if (!sb.has(l)) out.push(`− ${l}`);
  for (const l of lb) if (!sa.has(l)) out.push(`+ ${l}`);
  if (out.length === 0 && la.join("\n") !== lb.join("\n")) out.push("same content, reordered");
  return out;
}
