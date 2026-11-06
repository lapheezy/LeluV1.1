/**
 * ==========================================================
 * LÉLU — CREATION STUDIO: READING A FILE BACK
 *
 * Opens an actual file (one LÉLU wrote, or one the user gave her)
 * and reports what is in it: its text, its structure (slides,
 * tables, charts, sheets, formulas, notes) and, where it can, a
 * spec that reopens it for editing. It reads the format's own
 * parts (OOXML XML, PDF content streams), not the writer's
 * memory, so it can contradict a writer that produced the wrong
 * thing.
 * ==========================================================
 */

import { unzlibSync } from "fflate";
import type { ArtifactSpec, Block, Cell, ChartKind, ChartSpec, ExportFormat, SheetSpec, SlideSpec, Source } from "./StudioTypes";

export interface ReadStructure {
  pages?: number;
  slides?: number;
  sheets?: string[];
  tables: number;
  charts: number;
  chartKinds: ChartKind[];
  images: number;
  formulas: string[];
  notes: string[];
  headings: string[];
}

export interface ReadResult {
  ok: boolean;
  format: ExportFormat;
  error?: string;
  title?: string;
  /** Every piece of text found, in reading order. */
  text: string;
  structure: ReadStructure;
  /** The file as a spec, to reopen and edit it. */
  spec?: ArtifactSpec;
}

const dec = new TextDecoder();

const emptyStructure = (): ReadStructure => ({ tables: 0, charts: 0, chartKinds: [], images: 0, formulas: [], notes: [], headings: [] });

export function xmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

const all = (re: RegExp, s: string) => [...s.matchAll(re)];
const runsText = (xml: string, tag: "w:t" | "a:t") => all(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g"), xml).map((m) => xmlText(m[1])).join("");

/** A relationship target as a part name: absolute ("/ppt/x.xml") or relative to the source part's folder. */
export function resolvePart(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

async function zipOf(bytes: Uint8Array) {
  const { default: JSZip } = await import("jszip");
  return JSZip.loadAsync(bytes);
}

/** A chart part (DrawingML chart XML) back into a ChartSpec, from its cached values. */
export function parseChartXml(xml: string): ChartSpec | null {
  const kind: ChartKind | null =
    xml.includes("<c:pieChart") ? "pie"
    : xml.includes("<c:doughnutChart") ? "donut"
    : xml.includes("<c:lineChart") ? "line"
    : xml.includes("<c:scatterChart") ? "scatter"
    : xml.includes("<c:barChart") ? (/<c:barDir val="bar"/.test(xml) ? "bar" : "column")
    : null;
  if (!kind) return null;
  const title = /<c:title>[\s\S]*?<\/c:title>/.exec(xml)?.[0];
  const pts = (block: string) => all(/<c:pt idx="(\d+)">\s*<c:v>([^<]*)<\/c:v>/g, block).sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => xmlText(m[2]));
  const series = all(/<c:ser>([\s\S]*?)<\/c:ser>/g, xml).map((m) => {
    const ser = m[1];
    const name = pts(/<c:tx>([\s\S]*?)<\/c:tx>/.exec(ser)?.[1] ?? "")[0] ?? runsText(/<c:tx>([\s\S]*?)<\/c:tx>/.exec(ser)?.[1] ?? "", "a:t") ?? "";
    const cat = pts(/<c:(?:cat|xVal)>([\s\S]*?)<\/c:(?:cat|xVal)>/.exec(ser)?.[1] ?? "");
    const val = pts(/<c:(?:val|yVal)>([\s\S]*?)<\/c:(?:val|yVal)>/.exec(ser)?.[1] ?? "").map(Number);
    return { name, cat, val };
  });
  const labels = series[0]?.cat ?? [];
  return {
    kind,
    title: title ? runsText(title, "a:t") || undefined : undefined,
    labels: kind === "scatter" ? [] : labels,
    x: kind === "scatter" ? labels.map(Number) : undefined,
    series: series.map((s) => ({ name: s.name, values: s.val })),
  };
}

/* ---------------- DOCX ---------------- */

async function readDocx(bytes: Uint8Array): Promise<ReadResult> {
  const zip = await zipOf(bytes);
  const body = await zip.file("word/document.xml")?.async("string");
  if (!body) throw new Error("not a Word document: word/document.xml is missing");
  const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const rels = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const relTarget = new Map(all(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g, rels).map((m) => [m[1], m[2]]));
  // numId → abstract numbering → level-0 format: "bullet" or a number format.
  const numbering = (await zip.file("word/numbering.xml")?.async("string")) ?? "";
  const abstractFmt = new Map(all(/<w:abstractNum [^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g, numbering).map((m) => [m[1], /<w:numFmt w:val="([^"]+)"/.exec(m[2])?.[1] ?? "bullet"]));
  const numFmt = new Map(all(/<w:num [^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g, numbering).map((m) => [m[1], abstractFmt.get(m[2]) ?? "bullet"]));
  const s = emptyStructure();
  const blocks: Block[] = [];
  const texts: string[] = [];
  let title = xmlText(/<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? "") || undefined;
  let docTitle: string | undefined;
  let subtitle: string | undefined;
  let pendingList: { items: string[]; ordered: boolean } | null = null;
  const flushList = () => { if (pendingList) { blocks.push({ type: "bullets", items: pendingList.items, ordered: pendingList.ordered }); pendingList = null; } };

  const inner = /<w:body>([\s\S]*)<\/w:body>/.exec(body)?.[1] ?? body;
  // Top-level paragraphs and tables, in order.
  for (const m of inner.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const el = m[0];
    if (el.startsWith("<w:tbl")) {
      flushList();
      s.tables += 1;
      const rows = all(/<w:tr[ >][\s\S]*?<\/w:tr>/g, el).map((r) => all(/<w:tc>[\s\S]*?<\/w:tc>/g, r[0]).map((c) => all(/<w:p[ >][\s\S]*?<\/w:p>/g, c[0]).map((p) => runsText(p[0], "w:t")).join("\n")));
      texts.push(...rows.flat());
      if (rows.length) blocks.push({ type: "table", columns: rows[0], rows: rows.slice(1) });
      continue;
    }
    const style = /<w:pStyle w:val="([^"]+)"/.exec(el)?.[1] ?? "";
    const chartRid = /<c:chart [^>]*r:id="([^"]+)"/.exec(el)?.[1];
    if (chartRid) {
      flushList();
      s.charts += 1;
      const target = relTarget.get(chartRid);
      const xml = target ? await zip.file(resolvePart("word/document.xml", target))?.async("string") : undefined;
      const chart = xml ? parseChartXml(xml) : null;
      if (chart) {
        s.chartKinds.push(chart.kind);
        if (chart.title) texts.push(chart.title);
        blocks.push({ type: "chart", chart });
      }
      continue;
    }
    if (/<a:blip /.test(el)) s.images += 1;
    const text = runsText(el, "w:t");
    if (!text) continue;
    texts.push(text);
    const heading = /^Heading([1-3])$/.exec(style);
    const isList = /<w:numPr>/.test(el);
    if (style === "Title") { flushList(); docTitle ??= text; continue; }
    if (heading) {
      flushList();
      s.headings.push(text);
      blocks.push({ type: "heading", level: Number(heading[1]) as 1 | 2 | 3, text });
    } else if (isList) {
      const ordered = (numFmt.get(/<w:numId w:val="(\d+)"/.exec(el)?.[1] ?? "") ?? "bullet") !== "bullet";
      if (pendingList && pendingList.ordered !== ordered) flushList();
      if (!pendingList) pendingList = { items: [], ordered };
      pendingList.items.push(text);
    } else {
      flushList();
      if (!subtitle && blocks.length === 0 && docTitle && /<w:i\/>/.test(el)) subtitle = text;
      else blocks.push({ type: "paragraph", text });
    }
  }
  flushList();
  title ??= docTitle;
  // A closing "Sources" heading with a numbered list is the source list the writer made.
  let sources: Source[] | undefined;
  const last = blocks[blocks.length - 1];
  if (last?.type === "bullets" && blocks[blocks.length - 2]?.type === "heading" && (blocks[blocks.length - 2] as { text: string }).text === "Sources") {
    sources = last.items.map((item, i) => {
      const m = /^\[([^\]]+)\]\s*(.*?)(?:\s+—\s+(https?:\/\/\S+))?(?:\s+\(accessed ([^)]+)\))?$/.exec(item);
      return m ? { id: m[1], title: m[2], url: m[3], accessed: m[4] } : { id: `S${i + 1}`, title: item };
    });
    blocks.splice(blocks.length - 2, 2);
  }
  return {
    ok: true,
    format: "docx",
    title,
    text: texts.join("\n"),
    structure: s,
    spec: { kind: "document", title: docTitle ?? title ?? "Document", subtitle, blocks, sources },
  };
}

/* ---------------- PPTX ---------------- */

async function readPptx(bytes: Uint8Array): Promise<ReadResult> {
  const zip = await zipOf(bytes);
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  if (!pres) throw new Error("not a PowerPoint file: ppt/presentation.xml is missing");
  const presRels = (await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")) ?? "";
  const target = new Map(all(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g, presRels).map((m) => [m[1], m[2]]));
  // Slide order is the order in presentation.xml, not file names.
  const order = all(/<p:sldId [^>]*r:id="([^"]+)"/g, pres).map((m) => target.get(m[1])).filter((t): t is string => Boolean(t)).map((t) => resolvePart("ppt/presentation.xml", t));
  const s = emptyStructure();
  const slides: SlideSpec[] = [];
  const texts: string[] = [];
  const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const title = xmlText(/<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? "") || undefined;
  for (const path of order) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const relPath = path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
    const rels = (await zip.file(relPath)?.async("string")) ?? "";
    const relMap = new Map(all(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g, rels).map((m) => [m[1], m[2]]));
    const shapes = all(/<p:sp>[\s\S]*?<\/p:sp>/g, xml).map((m) => ({
      title: /<p:ph [^>]*type="(?:title|ctrTitle)"/.test(m[0].replace(/\s+/g, " ")),
      lines: all(/<a:p>[\s\S]*?<\/a:p>/g, m[0]).map((p) => runsText(p[0], "a:t")).filter(Boolean),
    }));
    // Text shapes only; a lone number is the slide number, not content.
    const texty = shapes.filter((sh) => sh.lines.length > 0 && !(sh.lines.length === 1 && /^\d+$/.test(sh.lines[0])));
    const titleShape = texty.find((sh) => sh.title) ?? texty[0];
    const slide: SlideSpec = { title: titleShape?.lines.join(" ") ?? "" };
    const rest = texty.filter((sh) => sh !== titleShape).flatMap((sh) => sh.lines);
    if (rest.length) slide.bullets = rest;
    texts.push(slide.title, ...rest);
    const tables = all(/<a:tbl>[\s\S]*?<\/a:tbl>/g, xml);
    s.tables += tables.length;
    if (tables[0]) {
      const rows = all(/<a:tr [\s\S]*?<\/a:tr>/g, tables[0][0]).map((r) => all(/<a:tc>[\s\S]*?<\/a:tc>|<a:tc [\s\S]*?<\/a:tc>/g, r[0]).map((c) => runsText(c[0], "a:t")));
      texts.push(...rows.flat());
      if (rows.length) slide.table = { columns: rows[0], rows: rows.slice(1) };
    }
    s.images += all(/<p:pic>/g, xml).length;
    for (const [, rid] of all(/<c:chart [^>]*r:id="([^"]+)"/g, xml)) {
      s.charts += 1;
      const t = relMap.get(rid);
      const chartXml = t ? await zip.file(resolvePart(path, t))?.async("string") : undefined;
      const chart = chartXml ? parseChartXml(chartXml) : null;
      if (chart) {
        s.chartKinds.push(chart.kind);
        slide.chart = chart;
        if (chart.title) texts.push(chart.title);
      }
    }
    const notesTarget = [...relMap.values()].find((v) => /notesSlide/.test(v));
    if (notesTarget) {
      const notesXml = await zip.file(resolvePart(path, notesTarget))?.async("string");
      // The body placeholder holds the notes; the slide-number placeholder does not.
      const body = notesXml ? all(/<p:sp>[\s\S]*?<\/p:sp>/g, notesXml).find((m) => /type="body"/.test(m[0])) : undefined;
      const notes = body ? all(/<a:p>[\s\S]*?<\/a:p>/g, body[0]).map((p) => runsText(p[0], "a:t")).filter(Boolean).join("\n") : "";
      if (notes) { slide.notes = notes; s.notes.push(notes); texts.push(notes); }
    }
    slides.push(slide);
  }
  s.slides = slides.length;
  return { ok: true, format: "pptx", title, text: texts.join("\n"), structure: s, spec: { kind: "deck", title: title ?? slides[0]?.title ?? "Presentation", slides } };
}

/* ---------------- XLSX ---------------- */

async function readXlsx(bytes: Uint8Array): Promise<ReadResult> {
  const zip = await zipOf(bytes);
  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!wbXml) throw new Error("not an Excel workbook: xl/workbook.xml is missing");
  const wbRels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const target = new Map(all(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g, wbRels).map((m) => [m[1], m[2]]));
  const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const shared = all(/<si>([\s\S]*?)<\/si>/g, sharedXml).map((m) => all(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g, m[1]).map((t) => xmlText(t[1])).join(""));
  const s = emptyStructure();
  const sheets: SheetSpec[] = [];
  const texts: string[] = [];
  const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const title = xmlText(/<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? "") || undefined;
  for (const [, nameRaw, rid] of all(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g, wbXml)) {
    const name = xmlText(nameRaw);
    const path = resolvePart("xl/workbook.xml", target.get(rid) ?? "");
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const grid: Cell[][] = [];
    for (const [, rowXml] of all(/<row [^>]*>([\s\S]*?)<\/row>/g, xml)) {
      const row: Cell[] = [];
      for (const c of all(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, rowXml)) {
        const col = c[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const attrs = c[2];
        const content = c[3] ?? "";
        const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const f = /<f(?:\s[^>]*)?>([^<]*)<\/f>/.exec(content)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(content)?.[1];
        const inline = /<is>([\s\S]*?)<\/is>/.exec(content)?.[1];
        let value: Cell = null;
        if (t === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (t === "inlineStr" && inline) value = all(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g, inline).map((x) => xmlText(x[1])).join("");
        else if (t === "str" && v !== undefined) value = xmlText(v);
        else if (t === "b" && v !== undefined) value = v === "1";
        else if (v !== undefined) value = Number(v);
        if (f !== undefined) {
          const formula = xmlText(f);
          s.formulas.push(formula);
          value = { formula, result: typeof value === "number" || typeof value === "string" ? value : undefined };
        }
        row[col] = value;
      }
      grid.push(Array.from(row, (x) => x ?? null));
    }
    const columns = (grid[0] ?? []).map((c) => (c === null ? "" : typeof c === "object" ? String(c.result ?? "") : String(c)));
    texts.push(name, ...columns);
    for (const r of grid.slice(1)) for (const c of r) if (c !== null) texts.push(typeof c === "object" ? String(c.result ?? `=${c.formula}`) : String(c));
    const sheet: SheetSpec = { name, columns, rows: grid.slice(1) };
    // Charts on this sheet: sheet rels → drawing → drawing rels → chart parts.
    const relXml = (await zip.file(path.replace(/worksheets\/(sheet\d+\.xml)$/, "worksheets/_rels/$1.rels"))?.async("string")) ?? "";
    const drawingTarget = /Type="[^"]*\/drawing"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Type="[^"]*\/drawing"/.exec(relXml);
    const drawing = drawingTarget ? resolvePart(path, drawingTarget[1] ?? drawingTarget[2]) : undefined;
    if (drawing) {
      const dRels = (await zip.file(drawing.replace(/([^/]+)$/, "_rels/$1.rels"))?.async("string")) ?? "";
      for (const [, chartTarget] of all(/Target="([^"]*chart\d+\.xml)"/g, dRels)) {
        const chartXml = await zip.file(resolvePart(drawing, chartTarget))?.async("string");
        s.charts += 1;
        const chart = chartXml ? parseChartXml(chartXml) : null;
        if (chart) { s.chartKinds.push(chart.kind); (sheet.charts ??= []).push(chart); if (chart.title) texts.push(chart.title); }
      }
    }
    sheets.push(sheet);
  }
  s.sheets = sheets.map((x) => x.name);
  return { ok: true, format: "xlsx", title, text: texts.join("\n"), structure: s, spec: { kind: "workbook", title: title ?? sheets[0]?.name ?? "Workbook", sheets } };
}

/* ---------------- PDF ---------------- */

const WIN_ANSI_HIGH: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };
const winAnsi = (code: number) => WIN_ANSI_HIGH[code] ?? String.fromCharCode(code);

/** Text shown by a PDF content stream (Tj/TJ with hex or literal strings). */
export function pdfStreamText(content: string): string[] {
  const lines: string[] = [];
  for (const m of content.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    if (m[1] !== undefined) {
      const hex = m[1].replace(/\s+/g, "");
      let s = "";
      for (let i = 0; i + 1 < hex.length; i += 2) s += winAnsi(parseInt(hex.slice(i, i + 2), 16));
      lines.push(s);
    } else {
      lines.push(m[2].replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => (/^[0-7]/.test(e) ? winAnsi(parseInt(e, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[e] ?? e)));
    }
  }
  return lines;
}

async function readPdf(bytes: Uint8Array): Promise<ReadResult> {
  const head = dec.decode(bytes.subarray(0, 8));
  if (!head.startsWith("%PDF-")) throw new Error("not a PDF: the file does not start with %PDF-");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const s = emptyStructure();
  s.pages = pdf.getPageCount();
  const raw = new TextDecoder("latin1").decode(bytes);
  const texts: string[] = [];
  for (const m of raw.matchAll(/<<([^]*?)>>\s*stream\r?\n/g)) {
    const dict = m[1];
    const start = (m.index ?? 0) + m[0].length;
    const lengthMatch = /\/Length (\d+)(?!\s+\d+\s+R)/.exec(dict);
    const end = lengthMatch ? start + Number(lengthMatch[1]) : raw.indexOf("endstream", start);
    let data = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try { data = unzlibSync(data); } catch { continue; }
    } else if (/\/Filter/.test(dict)) continue;
    const content = new TextDecoder("latin1").decode(data);
    if (/\bTj\b/.test(content)) texts.push(...pdfStreamText(content));
    s.images += (content.match(/\/Image\d*\s+Do/g) ?? []).length;
  }
  const title = pdf.getTitle() || undefined;
  return { ok: true, format: "pdf", title, text: texts.join("\n"), structure: s };
}

/* ---------------- Text formats ---------------- */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function readText(bytes: Uint8Array, format: ExportFormat): ReadResult {
  const raw = dec.decode(bytes);
  const s = emptyStructure();
  if (format === "csv") {
    const rows = parseCsv(raw);
    s.tables = 1;
    s.sheets = ["Sheet1"];
    s.formulas = rows.flat().filter((c) => c.startsWith("=")).map((c) => c.slice(1));
    const toCell = (c: string): Cell => (c.startsWith("=") ? { formula: c.slice(1) } : c !== "" && !Number.isNaN(Number(c)) ? Number(c) : c);
    return { ok: true, format, text: rows.flat().join("\n"), structure: s, spec: { kind: "workbook", title: "CSV", sheets: [{ name: "Sheet1", columns: rows[0] ?? [], rows: rows.slice(1).map((r) => r.map(toCell)) }] } };
  }
  if (format === "html") {
    const title = xmlText(/<title>([^<]*)<\/title>/i.exec(raw)?.[1] ?? "") || undefined;
    s.tables = (raw.match(/<table[\s>]/gi) ?? []).length;
    s.charts = (raw.match(/<svg[\s>]/gi) ?? []).length;
    s.images = (raw.match(/<img[\s>]/gi) ?? []).length;
    s.slides = (raw.match(/class="slide"/g) ?? []).length || undefined;
    s.headings = all(/<h[2-4]>([^<]*)<\/h[2-4]>/gi, raw).map((m) => xmlText(m[1]));
    const body = raw.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<head[\s\S]*?<\/head>/i, "").replace(/<svg[\s\S]*?<\/svg>/gi, (svg) => ` ${all(/<text[^>]*>([^<]*)<\/text>/g, svg).map((m) => m[1]).join(" ")} `);
    return { ok: true, format, title, text: xmlText(body.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|h\d|li|tr|td|th|caption|figcaption|section)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " "), structure: s };
  }
  if (format === "md") {
    s.headings = all(/^#{2,4} (.+)$/gm, raw).map((m) => m[1]);
    s.tables = (raw.match(/^\|(?: ?---+ ?\|)+$/gm) ?? []).length;
    s.slides = (raw.match(/^## Slide \d+:/gm) ?? []).length || undefined;
    s.notes = all(/^> Speaker notes: (.+)$/gm, raw).map((m) => m[1]);
    return { ok: true, format, title: /^# (.+)$/m.exec(raw)?.[1], text: raw.replace(/\\\|/g, "|"), structure: s };
  }
  if (format === "rtf") {
    if (!raw.startsWith("{\\rtf")) throw new Error("not an RTF file: it does not start with {\\rtf");
    const text = raw
      .replace(/\{\\fonttbl[^}]*\}\}/, "")
      .replace(/\\u(-?\d+)\?/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
      .replace(/\\(line|par|cell|row)\b ?/g, "\n")
      .replace(/\\([{}\\])/g, "$1")
      .replace(/\\[a-z]+-?\d* ?/g, "")
      .replace(/[{}]/g, "");
    s.tables = (raw.match(/\\trowd/g) ?? []).length > 0 ? 1 : 0;
    return { ok: true, format, text, structure: s };
  }
  return { ok: true, format, text: raw, structure: s };
}

/** Open a file and report what is actually in it. Never throws. */
export async function readArtifact(bytes: Uint8Array, format: ExportFormat): Promise<ReadResult> {
  try {
    if (format === "docx") return await readDocx(bytes);
    if (format === "pptx") return await readPptx(bytes);
    if (format === "xlsx") return await readXlsx(bytes);
    if (format === "pdf") return await readPdf(bytes);
    return readText(bytes, format);
  } catch (error) {
    return { ok: false, format, error: error instanceof Error ? error.message : String(error), text: "", structure: emptyStructure() };
  }
}

/** The format a file name or MIME type means. */
export function formatOf(name: string, mime = ""): ExportFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const byExt: Record<string, ExportFormat> = { docx: "docx", pptx: "pptx", xlsx: "xlsx", pdf: "pdf", md: "md", markdown: "md", html: "html", htm: "html", txt: "txt", rtf: "rtf", csv: "csv" };
  if (ext && byExt[ext]) return byExt[ext];
  if (/wordprocessingml/.test(mime)) return "docx";
  if (/presentationml/.test(mime)) return "pptx";
  if (/spreadsheetml/.test(mime)) return "xlsx";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/csv") return "csv";
  if (mime === "text/html") return "html";
  if (mime === "text/markdown") return "md";
  if (mime.startsWith("text/")) return "txt";
  return null;
}

