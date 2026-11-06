/**
 * ==========================================================
 * LÉLU — CREATION STUDIO: EXPORT AND VERIFY
 *
 * Writing bytes is not exporting. An export here is:
 *   1. render the spec with the format's writer;
 *   2. open the bytes again with StudioReader (the format's own
 *      parts, not the writer's memory);
 *   3. check that what the spec promised is really in the file:
 *      title, headings, text, table cells, chart count and kind,
 *      slide count and notes, sheets and formulas;
 *   4. hash the bytes.
 * Only a file whose every check passed is reported as exported.
 * ==========================================================
 */

import { readArtifact, type ReadResult } from "./StudioReader";
import { cellText, FORMATS_BY_KIND, isFormula, MIME, type ArtifactSpec, type ChartKind, type ExportFormat } from "./StudioTypes";
import { sha256Hex } from "./writers/bytes";
import { deckToHtml, deckToMarkdown, documentToHtml, documentToMarkdown, documentToRtf, documentToText, sheetToCsv, utf8, workbookToHtml, workbookToMarkdown } from "./writers/textWriters";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface Verification {
  ok: boolean;
  checks: Check[];
  /** Expected text that was not found in the file. */
  missing: string[];
  /** Characters a format could not carry (PDF standard fonts). */
  replacedChars: string[];
  read: Pick<ReadResult, "ok" | "error" | "title" | "structure">;
}

export interface ExportResult {
  format: ExportFormat;
  mime: string;
  filename: string;
  bytes: Uint8Array;
  size: number;
  sha256: string;
  verification: Verification;
}

export function fileNameFor(title: string, format: ExportFormat): string {
  const base = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "lelu-artifact";
  return `${base}.${format}`;
}

async function render(spec: ArtifactSpec, format: ExportFormat): Promise<{ bytes: Uint8Array; replacedChars: string[] }> {
  if (!FORMATS_BY_KIND[spec.kind].includes(format)) {
    throw new Error(`A ${spec.kind} cannot be written as ${format.toUpperCase()}; it can be ${FORMATS_BY_KIND[spec.kind].join(", ")}.`);
  }
  const plain = (bytes: Uint8Array) => ({ bytes, replacedChars: [] as string[] });
  switch (spec.kind) {
    case "document":
      if (format === "docx") return plain(await (await import("./writers/docxWriter")).writeDocx(spec));
      if (format === "pdf") return (await import("./writers/pdfWriter")).writeDocumentPdf(spec);
      if (format === "md") return plain(utf8(documentToMarkdown(spec)));
      if (format === "html") return plain(utf8(documentToHtml(spec)));
      if (format === "txt") return plain(utf8(documentToText(spec)));
      return plain(utf8(documentToRtf(spec)));
    case "deck":
      if (format === "pptx") return plain(await (await import("./writers/pptxWriter")).writePptx(spec));
      if (format === "pdf") return (await import("./writers/pdfWriter")).writeDeckPdf(spec);
      if (format === "html") return plain(utf8(deckToHtml(spec)));
      return plain(utf8(deckToMarkdown(spec)));
    case "workbook":
      if (format === "xlsx") return plain(await (await import("./writers/xlsxWriter")).writeXlsx(spec));
      if (format === "csv") return plain(utf8(sheetToCsv(spec.sheets[0] ?? { name: "Sheet1", columns: [], rows: [] })));
      if (format === "html") return plain(utf8(workbookToHtml(spec)));
      return plain(utf8(workbookToMarkdown(spec)));
  }
}

/* ------------------------------------------------------------------ *
 * What a file must contain
 * ------------------------------------------------------------------ */

interface Expectation {
  title?: string;
  texts: string[];
  tables?: number;
  charts?: ChartKind[];
  slides?: number;
  notes?: string[];
  sheets?: string[];
  formulas?: string[];
}

/** Formats that carry charts as real chart objects (and can be checked for them). */
const NATIVE_CHARTS: ExportFormat[] = ["docx", "pptx", "xlsx", "html"];

function expectationOf(spec: ArtifactSpec, format: ExportFormat): Expectation {
  const texts: string[] = [];
  const charts: ChartKind[] = [];
  let tables = 0;
  if (spec.kind === "document") {
    for (const b of spec.blocks) {
      if (b.type === "heading" || b.type === "paragraph") texts.push(b.text);
      else if (b.type === "bullets") texts.push(...b.items);
      else if (b.type === "quote") texts.push(b.text);
      else if (b.type === "table") { tables += 1; texts.push(...b.columns, ...b.rows.flat().map(String)); }
      else if (b.type === "chart") { charts.push(b.chart.kind); if (b.chart.title) texts.push(b.chart.title); }
    }
    for (const s of spec.sources ?? []) texts.push(s.title);
    return { title: spec.title, texts, tables: format === "md" || format === "html" || format === "docx" || format === "rtf" ? tables : undefined, charts: NATIVE_CHARTS.includes(format) ? charts : undefined };
  }
  if (spec.kind === "deck") {
    const notes: string[] = [];
    for (const s of spec.slides) {
      texts.push(s.title, ...(s.bullets ?? []), ...(s.right ?? []));
      if (s.table) { tables += 1; texts.push(...s.table.columns, ...s.table.rows.flat().map(String)); }
      if (s.chart) { charts.push(s.chart.kind); }
      if (s.notes) notes.push(s.notes);
    }
    const sourceSlide = spec.sources?.length ? 1 : 0;
    return {
      title: format === "pptx" || format === "pdf" || format === "html" ? spec.title : undefined,
      texts,
      tables: format === "pptx" ? tables : undefined,
      charts: NATIVE_CHARTS.includes(format) ? charts : undefined,
      slides: format === "pptx" ? spec.slides.length + sourceSlide : format === "html" || format === "md" ? spec.slides.length : undefined,
      notes: format === "pptx" || format === "md" ? notes : undefined,
    };
  }
  const sheets = format === "csv" ? [spec.sheets[0]] : spec.sheets;
  const formulas: string[] = [];
  const csvFormulas: string[] = [];
  for (const sheet of sheets.filter(Boolean)) {
    texts.push(...sheet.columns);
    for (const row of sheet.rows) for (const c of row) {
      if (isFormula(c)) {
        formulas.push(c.formula);
        // CSV stores a formula's cached result when it has one, the formula itself otherwise.
        if (c.result !== undefined) texts.push(String(c.result)); else csvFormulas.push(c.formula);
      }
      else if (c !== null && c !== "") texts.push(cellText(c));
    }
    if (format === "xlsx" || format === "html") for (const ch of sheet.charts ?? []) charts.push(ch.kind);
  }
  return {
    title: format === "xlsx" || format === "html" || format === "md" ? spec.title : undefined,
    texts: format === "xlsx" || format === "html" || format === "md" ? [...spec.sheets.map((s) => s.name), ...texts] : texts,
    sheets: format === "xlsx" ? spec.sheets.map((s) => s.name.slice(0, 31)) : undefined,
    formulas: format === "xlsx" ? formulas : format === "csv" ? csvFormulas : undefined,
    charts: format === "xlsx" || format === "html" ? charts : undefined,
  };
}

const normalize = (t: string) => t.normalize("NFC").replace(/\s+/g, " ").trim();

/** How the PDF standard fonts spell a text (the same substitutions the writer makes). */
function pdfSpelling(text: string, replaced: Set<string>): string {
  const map: Record<string, string> = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "✓": "v", "✗": "x", "×": "x", "−": "-", " ": " " };
  return [...text].map((ch) => (replaced.has(ch) ? "?" : map[ch] ?? ch)).join("");
}

export function verifyRead(spec: ArtifactSpec, format: ExportFormat, read: ReadResult, replacedChars: string[] = []): Verification {
  const checks: Check[] = [];
  const missing: string[] = [];
  checks.push({ name: "opens", ok: read.ok, detail: read.ok ? `read as ${format.toUpperCase()}` : read.error });
  if (!read.ok) return { ok: false, checks, missing, replacedChars, read };
  const exp = expectationOf(spec, format);
  const replaced = new Set(replacedChars);
  const spell = (t: string) => normalize(format === "pdf" ? pdfSpelling(t, replaced) : t);
  // Text formats escape/wrap differently; compare on whitespace-normalised text.
  const haystack = normalize(read.text);
  const haystackNoSpace = haystack.replace(/ /g, "");

  if (exp.title) {
    const found = normalize(read.title ?? "") === spell(exp.title) || haystack.includes(spell(exp.title));
    checks.push({ name: "title", ok: found, detail: found ? exp.title : `expected “${exp.title}”, found “${read.title ?? "(none)"}”` });
  }
  const wanted = [...new Set(exp.texts.map((t) => t.trim()).filter((t) => t.length > 0))];
  for (const t of wanted) {
    const s = spell(t);
    // A PDF wraps lines; its words are kept in order, so compare without spaces as a fallback.
    if (!haystack.includes(s) && !(format === "pdf" && haystackNoSpace.includes(s.replace(/ /g, "")))) missing.push(t);
  }
  checks.push({ name: "content", ok: missing.length === 0, detail: `${wanted.length - missing.length}/${wanted.length} expected passages found${missing.length ? `; missing: ${missing.slice(0, 5).map((m) => `“${m.slice(0, 60)}”`).join(", ")}` : ""}` });

  const st = read.structure;
  if (exp.tables !== undefined && exp.tables > 0) checks.push({ name: "tables", ok: st.tables >= exp.tables, detail: `${st.tables} found, ${exp.tables} expected` });
  if (exp.charts !== undefined && exp.charts.length > 0) {
    const kinds = [...st.chartKinds];
    const htmlCount = format === "html" ? st.charts : undefined;
    const ok = htmlCount !== undefined ? htmlCount >= exp.charts.length : exp.charts.every((k) => { const i = kinds.indexOf(k); if (i < 0) return false; kinds.splice(i, 1); return true; });
    checks.push({ name: "charts", ok, detail: `${htmlCount ?? st.charts} found (${st.chartKinds.join(", ") || "drawn as SVG"}), ${exp.charts.length} expected (${exp.charts.join(", ")})` });
  }
  if (exp.slides !== undefined) checks.push({ name: "slides", ok: st.slides === exp.slides, detail: `${st.slides ?? 0} found, ${exp.slides} expected` });
  if (exp.notes?.length) {
    const found = exp.notes.filter((n) => normalize(st.notes.join(" ")).includes(normalize(n)) || haystack.includes(normalize(n)));
    checks.push({ name: "speaker notes", ok: found.length === exp.notes.length, detail: `${found.length}/${exp.notes.length}` });
  }
  if (exp.sheets) checks.push({ name: "sheets", ok: exp.sheets.every((s) => st.sheets?.includes(s)), detail: `${(st.sheets ?? []).join(", ")}` });
  if (exp.formulas?.length) {
    const found = exp.formulas.filter((f) => st.formulas.some((g) => g.replace(/\s+/g, "").toUpperCase() === f.replace(/\s+/g, "").toUpperCase()));
    checks.push({ name: "formulas", ok: found.length === exp.formulas.length, detail: `${found.length}/${exp.formulas.length} formulas present` });
  }
  if (format === "pdf") checks.push({ name: "pages", ok: (st.pages ?? 0) > 0, detail: `${st.pages ?? 0} pages` });
  if (replacedChars.length) checks.push({ name: "characters", ok: true, detail: `the PDF standard fonts cannot draw ${replacedChars.map((c) => `“${c}”`).join(" ")}; shown as “?”` });
  return { ok: checks.every((c) => c.ok), checks, missing, replacedChars, read: { ok: read.ok, error: read.error, title: read.title, structure: read.structure } };
}

/** Write, re-open and verify. Throws only when the spec cannot be written in that format. */
export async function exportArtifact(spec: ArtifactSpec, format: ExportFormat): Promise<ExportResult> {
  const { bytes, replacedChars } = await render(spec, format);
  const read = await readArtifact(bytes, format);
  const verification = verifyRead(spec, format, read, replacedChars);
  return {
    format,
    mime: MIME[format],
    filename: fileNameFor(spec.title, format),
    bytes,
    size: bytes.length,
    sha256: await sha256Hex(bytes),
    verification,
  };
}

export function summarizeVerification(v: Verification): string {
  return v.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`).join("\n");
}
