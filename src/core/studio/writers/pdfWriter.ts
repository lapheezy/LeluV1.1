/**
 * LÉLU — Creation Studio: PDF writer (documents and decks).
 * Wrapped, paginated text; tables and charts drawn as vector
 * graphics; PNG/JPEG images embedded. Uses the standard PDF fonts,
 * which cover Windows-1252 only: any other character is replaced
 * and counted, and the count is returned so the verifier can report
 * it rather than pretend the text survived.
 */

import { CHART_PALETTE } from "../ChartSvg";
import { DEFAULT_THEME, type Block, type ChartSpec, type DeckSpec, type DocumentSpec } from "../StudioTypes";
import { dataUrlBytes } from "./bytes";

type PdfLib = typeof import("pdf-lib");
type PDFFont = import("pdf-lib").PDFFont;
type PDFPage = import("pdf-lib").PDFPage;
type PDFDocument = import("pdf-lib").PDFDocument;

const REPLACEMENTS: Record<string, string> = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "✓": "v", "✗": "x", "×": "x", "−": "-", "·": "·", " ": " " };

export interface PdfResult {
  bytes: Uint8Array;
  /** Characters the standard fonts could not draw, replaced with '?'. */
  replacedChars: string[];
}

class Writer {
  page!: PDFPage;
  y = 0;
  replaced = new Set<string>();
  constructor(
    readonly lib: PdfLib,
    readonly pdf: PDFDocument,
    readonly fonts: { regular: PDFFont; bold: PDFFont; italic: PDFFont },
    readonly size: [number, number],
    readonly margin = 56,
  ) {}

  get width() { return this.size[0] - this.margin * 2; }

  newPage() {
    this.page = this.pdf.addPage(this.size);
    this.y = this.size[1] - this.margin;
  }

  ensure(height: number) {
    if (this.y - height < this.margin) this.newPage();
  }

  clean(text: string, font: PDFFont): string {
    let out = "";
    for (const ch of text) {
      const mapped = REPLACEMENTS[ch] ?? ch;
      try {
        font.encodeText(mapped);
        out += mapped;
      } catch {
        this.replaced.add(ch);
        out += "?";
      }
    }
    return out;
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of this.clean(text, font).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  text(text: string, opts: { size?: number; font?: PDFFont; color?: [number, number, number]; indent?: number; after?: number; width?: number } = {}) {
    const size = opts.size ?? 11;
    const font = opts.font ?? this.fonts.regular;
    const lead = size * 1.4;
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(text, font, size, (opts.width ?? this.width) - indent)) {
      this.ensure(lead);
      this.page.drawText(line, { x: this.margin + indent, y: this.y - size, size, font, color: this.lib.rgb(...(opts.color ?? [0.13, 0.11, 0.2])) });
      this.y -= lead;
    }
    this.y -= opts.after ?? 6;
  }

  table(columns: string[], rows: Array<Array<string | number>>) {
    const size = 9.5;
    const colW = this.width / Math.max(1, columns.length);
    const drawRow = (cells: Array<string | number>, header: boolean) => {
      const font = header ? this.fonts.bold : this.fonts.regular;
      const wrapped = cells.map((c) => this.wrap(String(c ?? ""), font, size, colW - 8));
      const h = Math.max(...wrapped.map((w) => w.length)) * size * 1.3 + 8;
      this.ensure(h);
      // Every row is filled, so the table stays legible on a dark slide too.
      this.page.drawRectangle({ x: this.margin, y: this.y - h, width: this.width, height: h, color: header ? this.lib.rgb(0.93, 0.91, 0.98) : this.lib.rgb(1, 1, 1) });
      wrapped.forEach((lines, i) => {
        lines.forEach((line, li) => this.page.drawText(line, { x: this.margin + i * colW + 4, y: this.y - 4 - size - li * size * 1.3, size, font, color: this.lib.rgb(0.13, 0.11, 0.2) }));
        this.page.drawRectangle({ x: this.margin + i * colW, y: this.y - h, width: colW, height: h, borderColor: this.lib.rgb(0.8, 0.77, 0.9), borderWidth: 0.6 });
      });
      this.y -= h;
    };
    drawRow(columns, true);
    for (const r of rows) drawRow(columns.map((_, i) => r[i] ?? ""), false);
    this.y -= 10;
  }

  chart(chart: ChartSpec, box?: { x: number; w: number; h: number }) {
    const { rgb } = this.lib;
    const w = box?.w ?? this.width;
    const h = box?.h ?? 240;
    // A chart given a box was already placed by its caller; only free-flowing charts paginate.
    if (!box) this.ensure(h + 24);
    const x0 = box?.x ?? this.margin;
    const top = this.y;
    const hex = (c: string) => rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255);
    const ink = rgb(0.13, 0.11, 0.2);
    if (chart.title) {
      const t = this.clean(chart.title, this.fonts.bold);
      this.page.drawText(t, { x: x0 + (w - this.fonts.bold.widthOfTextAtSize(t, 12)) / 2, y: top - 12, size: 12, font: this.fonts.bold, color: ink });
    }
    const plotTop = top - 24;
    const left = x0 + 40;
    const plotW = w - 50;
    const plotH = h - 60;
    const base = plotTop - plotH;
    const series = chart.series;
    if (chart.kind === "pie" || chart.kind === "donut") {
      const values = (series[0]?.values ?? []).map((v) => Math.max(0, v));
      const total = values.reduce((a, b) => a + b, 0) || 1;
      const r = Math.min(plotW, plotH) / 2;
      const cx = x0 + w / 2;
      const cy = base + plotH / 2;
      let a0 = Math.PI / 2;
      values.forEach((v, i) => {
        const sweep = (v / total) * Math.PI * 2;
        const steps = Math.max(2, Math.ceil(sweep / 0.1));
        let path = `M 0 0`;
        for (let s = 0; s <= steps; s += 1) {
          const a = a0 - (sweep * s) / steps;
          path += ` L ${(r * Math.cos(a)).toFixed(2)} ${(-r * Math.sin(a)).toFixed(2)}`;
        }
        this.page.drawSvgPath(`${path} Z`, { x: cx, y: cy, color: hex(CHART_PALETTE[i % CHART_PALETTE.length]), borderColor: rgb(1, 1, 1), borderWidth: 0.5 });
        a0 -= sweep;
      });
      if (chart.kind === "donut") this.page.drawCircle({ x: cx, y: cy, size: r * 0.55, color: rgb(1, 1, 1) });
      this.legend(chart.labels, x0, base - 22, w);
    } else {
      const all = series.flatMap((s) => s.values);
      const max = Math.max(...all, 0) || 1;
      this.page.drawLine({ start: { x: left, y: base }, end: { x: left + plotW, y: base }, color: ink, thickness: 0.6 });
      this.page.drawLine({ start: { x: left, y: base }, end: { x: left, y: plotTop }, color: ink, thickness: 0.6 });
      for (let g = 1; g <= 4; g += 1) {
        const gy = base + (plotH * g) / 4;
        this.page.drawLine({ start: { x: left, y: gy }, end: { x: left + plotW, y: gy }, color: rgb(0.85, 0.83, 0.92), thickness: 0.4 });
        this.page.drawText(`${+((max * g) / 4).toFixed(1)}`, { x: x0, y: gy - 3, size: 7, font: this.fonts.regular, color: ink });
      }
      if (chart.kind === "scatter") {
        const xs = chart.x ?? (series[0]?.values ?? []).map((_, i) => i);
        const xMax = Math.max(...xs, 1);
        (series[0]?.values ?? []).forEach((v, i) => this.page.drawCircle({ x: left + (xs[i] / xMax) * plotW, y: base + (v / max) * plotH, size: 3, color: hex(CHART_PALETTE[0]) }));
      } else {
        const n = chart.labels.length || 1;
        const slot = plotW / n;
        chart.labels.forEach((label, i) => {
          const t = this.clean(label.slice(0, 14), this.fonts.regular);
          this.page.drawText(t, { x: left + slot * i + (slot - this.fonts.regular.widthOfTextAtSize(t, 7.5)) / 2, y: base - 11, size: 7.5, font: this.fonts.regular, color: ink });
        });
        series.forEach((s, si) => {
          const color = hex(CHART_PALETTE[si % CHART_PALETTE.length]);
          if (chart.kind === "line") {
            s.values.forEach((v, i) => {
              const px = left + slot * i + slot / 2;
              const py = base + (v / max) * plotH;
              this.page.drawCircle({ x: px, y: py, size: 2.5, color });
              if (i > 0) this.page.drawLine({ start: { x: left + slot * (i - 1) + slot / 2, y: base + (s.values[i - 1] / max) * plotH }, end: { x: px, y: py }, color, thickness: 1.8 });
            });
          } else {
            const group = slot * 0.75;
            const bw = group / Math.max(1, series.length);
            s.values.forEach((v, i) => this.page.drawRectangle({ x: left + slot * i + (slot - group) / 2 + si * bw, y: base, width: bw - 1.5, height: (Math.max(0, v) / max) * plotH, color }));
          }
        });
        if (series.length > 1) this.legend(series.map((s) => s.name), x0, base - 26, w);
      }
    }
    this.y = top - h - 8;
  }

  legend(names: string[], x0: number, y: number, w: number) {
    const per = Math.min(130, w / Math.max(1, names.length));
    names.forEach((name, i) => {
      const x = x0 + i * per;
      this.page.drawRectangle({ x, y, width: 7, height: 7, color: this.lib.rgb(parseInt(CHART_PALETTE[i % 8].slice(0, 2), 16) / 255, parseInt(CHART_PALETTE[i % 8].slice(2, 4), 16) / 255, parseInt(CHART_PALETTE[i % 8].slice(4, 6), 16) / 255) });
      this.page.drawText(this.clean(name.slice(0, 20), this.fonts.regular), { x: x + 10, y, size: 7.5, font: this.fonts.regular, color: this.lib.rgb(0.13, 0.11, 0.2) });
    });
  }

  async image(dataUrl: string, caption?: string) {
    const img = dataUrlBytes(dataUrl);
    if (!img || (img.type !== "png" && img.type !== "jpg")) {
      this.text(`[Image not embedded: ${img?.type ?? "not a data URL"}]`, { font: this.fonts.italic });
      return;
    }
    const embedded = img.type === "png" ? await this.pdf.embedPng(img.bytes) : await this.pdf.embedJpg(img.bytes);
    const scale = Math.min(1, this.width / embedded.width, 320 / embedded.height);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    this.ensure(h + 10);
    this.page.drawImage(embedded, { x: this.margin + (this.width - w) / 2, y: this.y - h, width: w, height: h });
    this.y -= h + 8;
    if (caption) this.text(caption, { size: 9, font: this.fonts.italic });
  }
}

async function open(size: [number, number], title: string, author?: string) {
  const lib = await import("pdf-lib");
  const pdf = await lib.PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor(author ?? "LÉLU");
  pdf.setCreator("LÉLU Creation Studio");
  pdf.setProducer("LÉLU Creation Studio (pdf-lib)");
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const fonts = {
    regular: await pdf.embedFont(lib.StandardFonts.Helvetica),
    bold: await pdf.embedFont(lib.StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(lib.StandardFonts.HelveticaOblique),
  };
  return new Writer(lib, pdf, fonts, size);
}

export async function writeDocumentPdf(doc: DocumentSpec): Promise<PdfResult> {
  const w = await open([612, 792], doc.title, doc.author);
  w.newPage();
  w.text(doc.title, { size: 24, font: w.fonts.bold, after: 4 });
  if (doc.subtitle) w.text(doc.subtitle, { size: 13, font: w.fonts.italic });
  if (doc.author) w.text(`By ${doc.author}`, { size: 10, color: [0.42, 0.39, 0.5] });
  w.y -= 8;
  const draw = async (block: Block) => {
    switch (block.type) {
      case "heading": w.y -= 6; w.text(block.text, { size: block.level === 1 ? 17 : block.level === 2 ? 14 : 12, font: w.fonts.bold }); break;
      case "paragraph": w.text(block.text, { after: 8 }); break;
      case "bullets": block.items.forEach((item, i) => w.text(`${block.ordered ? `${i + 1}.` : "•"} ${item}`, { indent: 14, after: 2 })); w.y -= 6; break;
      case "table": if (block.caption) w.text(block.caption, { font: w.fonts.bold, size: 10 }); w.table(block.columns, block.rows); break;
      case "chart": w.chart(block.chart); if (block.caption) w.text(block.caption, { size: 9, font: w.fonts.italic }); break;
      case "image": await w.image(block.dataUrl, block.caption); break;
      case "quote": w.text(`“${block.text}”${block.cite ? ` — ${block.cite}` : ""}`, { font: w.fonts.italic, indent: 20 }); break;
    }
  };
  for (const block of doc.blocks) await draw(block);
  if (doc.sources?.length) {
    w.y -= 6;
    w.text("Sources", { size: 17, font: w.fonts.bold });
    doc.sources.forEach((s, i) => w.text(`${i + 1}. [${s.id}] ${s.title}${s.url ? ` — ${s.url}` : ""}${s.accessed ? ` (accessed ${s.accessed})` : ""}`, { size: 9.5, after: 2 }));
  }
  return { bytes: await w.pdf.save({ useObjectStreams: false }), replacedChars: [...w.replaced] };
}

export async function writeDeckPdf(deck: DeckSpec): Promise<PdfResult> {
  const theme = { ...DEFAULT_THEME, ...(deck.theme ?? {}) };
  const w = await open([960, 540], deck.title, deck.author);
  const hex = (c: string) => w.lib.rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255);
  const ink = [parseInt(theme.text.slice(0, 2), 16) / 255, parseInt(theme.text.slice(2, 4), 16) / 255, parseInt(theme.text.slice(4, 6), 16) / 255] as [number, number, number];
  const slides = [...deck.slides];
  if (deck.sources?.length) slides.push({ title: "Sources", bullets: deck.sources.map((s) => `[${s.id}] ${s.title}${s.url ? ` — ${s.url}` : ""}`) });
  slides.forEach((slide, index) => {
    w.newPage();
    w.page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: hex(theme.background) });
    w.page.drawRectangle({ x: 0, y: 0, width: 960, height: 8, color: hex(theme.accent) });
    w.page.drawText(String(index + 1), { x: 920, y: 18, size: 10, font: w.fonts.regular, color: hex(theme.text) });
    const isTitle = slide.layout === "title" || slide.layout === "section";
    w.y = isTitle ? 330 : 500;
    w.text(slide.title, { size: isTitle ? 36 : 26, font: w.fonts.bold, color: ink });
    if (slide.subtitle) w.text(slide.subtitle, { size: 15, color: [0.73, 0.55, 1] });
    // Bullets come first on every layout, a chart slide's included, so none is dropped.
    const bulletSize = slide.chart ? 15 : 17;
    if (slide.right?.length) {
      const top = w.y;
      const half = w.width / 2;
      (slide.bullets ?? []).forEach((b) => w.text(`•  ${b}`, { size: bulletSize, color: ink, indent: 8, after: 4, width: half }));
      const leftEnd = w.y;
      w.y = top;
      slide.right.forEach((b) => w.text(`•  ${b}`, { size: bulletSize, color: ink, indent: half + 8, after: 4 }));
      w.y = Math.min(w.y, leftEnd);
    } else {
      (slide.bullets ?? []).forEach((b) => w.text(`•  ${b}`, { size: bulletSize, color: ink, indent: 8, after: 4 }));
    }
    if (slide.chart) {
      // Charts are drawn on a light card so the default ink stays legible on dark themes.
      const cardTop = w.y;
      w.page.drawRectangle({ x: w.margin - 8, y: w.margin - 8, width: w.width + 16, height: cardTop - w.margin + 8, color: w.lib.rgb(1, 1, 1), opacity: 0.94 });
      w.chart(slide.chart, { x: w.margin, w: w.width, h: Math.min(360, cardTop - w.margin - 4) });
    }
    if (slide.table) w.table(slide.table.columns, slide.table.rows);
  });
  return { bytes: await w.pdf.save({ useObjectStreams: false }), replacedChars: [...w.replaced] };
}
