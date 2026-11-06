/**
 * ==========================================================
 * LÉLU — CREATION STUDIO: WHAT AN ARTIFACT IS
 *
 * One neutral description per kind of artifact. Every writer
 * (DOCX, PPTX, XLSX, PDF, HTML, Markdown, CSV, TXT, RTF) renders
 * from it, every reader turns a file back into it, and the
 * verifier compares the two. A revision is a new spec; the old
 * one is kept.
 * ==========================================================
 */

export type ChartKind = "bar" | "column" | "line" | "pie" | "donut" | "scatter";

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSpec {
  kind: ChartKind;
  title?: string;
  /** Category labels (bar/column/line/pie/donut). */
  labels: string[];
  /** One or more series. Pie/donut use the first. Scatter: values are y, `x` holds the x values. */
  series: ChartSeries[];
  /** Scatter only: the x value of each point. */
  x?: number[];
  xLabel?: string;
  yLabel?: string;
}

export interface Source {
  id: string;
  title: string;
  url?: string;
  accessed?: string;
  note?: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[]; ordered?: boolean }
  | { type: "table"; caption?: string; columns: string[]; rows: Array<Array<string | number>> }
  | { type: "chart"; chart: ChartSpec; caption?: string }
  | { type: "image"; dataUrl: string; caption?: string; width?: number; height?: number }
  | { type: "quote"; text: string; cite?: string };

export interface DocumentSpec {
  kind: "document";
  title: string;
  subtitle?: string;
  author?: string;
  blocks: Block[];
  sources?: Source[];
}

export type SlideLayout = "title" | "content" | "two-column" | "chart" | "table" | "image" | "section";

export interface SlideSpec {
  title: string;
  subtitle?: string;
  layout?: SlideLayout;
  bullets?: string[];
  /** Two-column layout: the right column's bullets. */
  right?: string[];
  chart?: ChartSpec;
  table?: { columns: string[]; rows: Array<Array<string | number>> };
  image?: { dataUrl: string; caption?: string };
  notes?: string;
}

export interface DeckTheme {
  /** 6-digit hex without '#'. */
  background: string;
  text: string;
  accent: string;
  font: string;
}

export interface DeckSpec {
  kind: "deck";
  title: string;
  author?: string;
  theme?: Partial<DeckTheme>;
  slides: SlideSpec[];
  sources?: Source[];
}

/** A cell: a value, or a formula (without the leading '='), with an optional cached result. */
export type Cell = string | number | boolean | null | { formula: string; result?: number | string };

export interface SheetSpec {
  name: string;
  columns: string[];
  rows: Cell[][];
  /** Charts drawn from this sheet's data (written where the format can carry them). */
  charts?: ChartSpec[];
  /** Column widths in characters. */
  widths?: number[];
}

export interface WorkbookSpec {
  kind: "workbook";
  title: string;
  author?: string;
  sheets: SheetSpec[];
}

export type ArtifactSpec = DocumentSpec | DeckSpec | WorkbookSpec;

export type ExportFormat = "docx" | "pdf" | "md" | "html" | "txt" | "rtf" | "pptx" | "xlsx" | "csv";

/** Which formats each kind can be written as. */
export const FORMATS_BY_KIND: Record<ArtifactSpec["kind"], ExportFormat[]> = {
  document: ["docx", "pdf", "md", "html", "txt", "rtf"],
  deck: ["pptx", "pdf", "html", "md"],
  workbook: ["xlsx", "csv", "html", "md"],
};

export const MIME: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  md: "text/markdown",
  html: "text/html",
  txt: "text/plain",
  rtf: "application/rtf",
  csv: "text/csv",
};

export function isFormula(cell: Cell): cell is { formula: string; result?: number | string } {
  return typeof cell === "object" && cell !== null && "formula" in cell;
}

/** The text a cell shows, for text formats. */
export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (isFormula(cell)) return cell.result !== undefined ? String(cell.result) : `=${cell.formula}`;
  return String(cell);
}

export const DEFAULT_THEME: DeckTheme = {
  background: "14102A",
  text: "F4F0FF",
  accent: "B98CFF",
  font: "Calibri",
};
