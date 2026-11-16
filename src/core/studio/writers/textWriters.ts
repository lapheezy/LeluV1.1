/**
 * LÉLU — Creation Studio text writers: Markdown, HTML, TXT, RTF, CSV.
 * Each renders the same spec the binary writers use.
 */

import { chartToSvg } from "../ChartSvg";
import {
  cellText,
  isFormula,
  type Block,
  type ChartSpec,
  type DeckSpec,
  type DocumentSpec,
  type SheetSpec,
  type Source,
  type WorkbookSpec,
} from "../StudioTypes";

const enc = new TextEncoder();
const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdCell = (t: string | number) => String(t).replace(/\|/g, "\\|").replace(/\n/g, " ");

function chartDataTable(chart: ChartSpec): { columns: string[]; rows: Array<Array<string | number>> } {
  if (chart.kind === "scatter") {
    return { columns: [chart.xLabel ?? "x", chart.yLabel ?? chart.series[0]?.name ?? "y"], rows: (chart.series[0]?.values ?? []).map((v, i) => [chart.x?.[i] ?? i, v]) };
  }
  return {
    columns: ["", ...chart.series.map((s) => s.name)],
    rows: chart.labels.map((label, i) => [label, ...chart.series.map((s) => s.values[i] ?? "")]),
  };
}

/* ---------------- Markdown ---------------- */

function mdTable(columns: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${columns.map(mdCell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${columns.map((_, i) => mdCell(r[i] ?? "")).join(" | ")} |`),
  ].join("\n");
}

function mdBlock(block: Block): string {
  switch (block.type) {
    case "heading": return `${"#".repeat(block.level + 1)} ${block.text}`;
    case "paragraph": return block.text;
    case "bullets": return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${item}`).join("\n");
    case "table": return `${block.caption ? `**${block.caption}**\n\n` : ""}${mdTable(block.columns, block.rows)}`;
    case "chart": {
      const t = chartDataTable(block.chart);
      return `**${block.chart.title ?? "Chart"}** (${block.chart.kind} chart)\n\n${mdTable(t.columns, t.rows)}${block.caption ? `\n\n*${block.caption}*` : ""}`;
    }
    case "image": return `![${block.caption ?? "image"}](${block.dataUrl.startsWith("data:") ? "embedded-image" : block.dataUrl})${block.caption ? `\n\n*${block.caption}*` : ""}`;
    case "quote": return `> ${block.text}${block.cite ? `\n> — ${block.cite}` : ""}`;
  }
}

function mdSources(sources?: Source[]): string {
  if (!sources?.length) return "";
  return `\n\n## Sources\n\n${sources.map((s, i) => `${i + 1}. [${s.id}] ${s.title}${s.url ? ` — ${s.url}` : ""}${s.accessed ? ` (accessed ${s.accessed})` : ""}${s.note ? ` — ${s.note}` : ""}`).join("\n")}`;
}

export function documentToMarkdown(doc: DocumentSpec): string {
  const head = [`# ${doc.title}`, doc.subtitle ? `*${doc.subtitle}*` : "", doc.author ? `By ${doc.author}` : ""].filter(Boolean).join("\n\n");
  return `${head}\n\n${doc.blocks.map(mdBlock).join("\n\n")}${mdSources(doc.sources)}\n`;
}

export function deckToMarkdown(deck: DeckSpec): string {
  const slides = deck.slides.map((slide, i) => {
    const parts = [`## Slide ${i + 1}: ${slide.title}`];
    if (slide.subtitle) parts.push(`*${slide.subtitle}*`);
    if (slide.bullets?.length) parts.push(slide.bullets.map((b) => `- ${b}`).join("\n"));
    if (slide.right?.length) parts.push(slide.right.map((b) => `- ${b}`).join("\n"));
    if (slide.table) parts.push(mdTable(slide.table.columns, slide.table.rows));
    if (slide.chart) parts.push(mdBlock({ type: "chart", chart: slide.chart }));
    if (slide.notes) parts.push(`> Speaker notes: ${slide.notes}`);
    return parts.join("\n\n");
  });
  return `# ${deck.title}\n\n${slides.join("\n\n---\n\n")}${mdSources(deck.sources)}\n`;
}

export function workbookToMarkdown(book: WorkbookSpec): string {
  return `# ${book.title}\n\n${book.sheets.map((s) => `## ${s.name}\n\n${mdTable(s.columns, s.rows.map((r) => r.map(cellText)))}`).join("\n\n")}\n`;
}

/* ---------------- HTML ---------------- */

const HTML_STYLE = `body{font-family:Inter,Helvetica,Arial,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#221d33;line-height:1.55}
h1{font-size:2em;margin-bottom:.2em}h2{margin-top:1.6em}table{border-collapse:collapse;margin:1em 0;width:100%}
th,td{border:1px solid #d9d4e8;padding:6px 10px;text-align:left}th{background:#f1edfb}figure{margin:1.2em 0}
figcaption{color:#6b6480;font-size:.9em}blockquote{border-left:3px solid #b98cff;margin:1em 0;padding:.2em 1em;color:#4a4360}
section.slide{border:1px solid #d9d4e8;border-radius:12px;padding:24px;margin:24px 0}.notes{color:#6b6480;font-size:.9em}`;

function htmlTable(columns: string[], rows: Array<Array<string | number>>, caption?: string): string {
  return `<table>${caption ? `<caption>${escHtml(caption)}</caption>` : ""}<thead><tr>${columns.map((c) => `<th>${escHtml(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${columns.map((_, i) => `<td>${escHtml(String(r[i] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function htmlBlock(block: Block): string {
  switch (block.type) {
    case "heading": return `<h${block.level + 1}>${escHtml(block.text)}</h${block.level + 1}>`;
    case "paragraph": return `<p>${escHtml(block.text)}</p>`;
    case "bullets": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${block.items.map((i) => `<li>${escHtml(i)}</li>`).join("")}</${tag}>`;
    }
    case "table": return htmlTable(block.columns, block.rows, block.caption);
    case "chart": return `<figure>${chartToSvg(block.chart)}${block.caption ? `<figcaption>${escHtml(block.caption)}</figcaption>` : ""}</figure>`;
    case "image": return `<figure><img src="${escHtml(block.dataUrl)}" alt="${escHtml(block.caption ?? "")}" style="max-width:100%"/>${block.caption ? `<figcaption>${escHtml(block.caption)}</figcaption>` : ""}</figure>`;
    case "quote": return `<blockquote>${escHtml(block.text)}${block.cite ? `<br/>— ${escHtml(block.cite)}` : ""}</blockquote>`;
  }
}

function htmlSources(sources?: Source[]): string {
  if (!sources?.length) return "";
  return `<h2>Sources</h2><ol>${sources.map((s) => `<li id="src-${escHtml(s.id)}">${escHtml(s.title)}${s.url ? ` — <a href="${escHtml(s.url)}">${escHtml(s.url)}</a>` : ""}${s.accessed ? ` (accessed ${escHtml(s.accessed)})` : ""}</li>`).join("")}</ol>`;
}

const page = (title: string, body: string) =>
  `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escHtml(title)}</title><style>${HTML_STYLE}</style></head><body>${body}</body></html>\n`;

export function documentToHtml(doc: DocumentSpec): string {
  return page(doc.title, `<h1>${escHtml(doc.title)}</h1>${doc.subtitle ? `<p><em>${escHtml(doc.subtitle)}</em></p>` : ""}${doc.author ? `<p>By ${escHtml(doc.author)}</p>` : ""}${doc.blocks.map(htmlBlock).join("\n")}${htmlSources(doc.sources)}`);
}

export function deckToHtml(deck: DeckSpec): string {
  const slides = deck.slides.map((s, i) => `<section class="slide" data-slide="${i + 1}"><h2>${escHtml(s.title)}</h2>${s.subtitle ? `<p><em>${escHtml(s.subtitle)}</em></p>` : ""}${s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>` : ""}${s.right?.length ? `<ul>${s.right.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>` : ""}${s.table ? htmlTable(s.table.columns, s.table.rows) : ""}${s.chart ? `<figure>${chartToSvg(s.chart)}</figure>` : ""}${s.image ? `<img src="${escHtml(s.image.dataUrl)}" style="max-width:100%"/>` : ""}${s.notes ? `<p class="notes">Notes: ${escHtml(s.notes)}</p>` : ""}</section>`);
  return page(deck.title, `<h1>${escHtml(deck.title)}</h1>${slides.join("\n")}${htmlSources(deck.sources)}`);
}

export function workbookToHtml(book: WorkbookSpec): string {
  return page(book.title, `<h1>${escHtml(book.title)}</h1>${book.sheets.map((s) => `<h2>${escHtml(s.name)}</h2>${htmlTable(s.columns, s.rows.map((r) => r.map(cellText)))}${(s.charts ?? []).map((c) => `<figure>${chartToSvg(c)}</figure>`).join("")}`).join("\n")}`);
}

/* ---------------- TXT ---------------- */

export function documentToText(doc: DocumentSpec): string {
  const lines = [doc.title, "=".repeat(Math.min(72, doc.title.length)), doc.subtitle ?? "", ""];
  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading": lines.push("", block.text, "-".repeat(Math.min(60, block.text.length))); break;
      case "paragraph": lines.push(block.text, ""); break;
      case "bullets": block.items.forEach((item, i) => lines.push(`${block.ordered ? `${i + 1}.` : "*"} ${item}`)); lines.push(""); break;
      case "table": if (block.caption) lines.push(block.caption); lines.push(block.columns.join("\t"), ...block.rows.map((r) => r.join("\t")), ""); break;
      case "chart": { const t = chartDataTable(block.chart); lines.push(`${block.chart.title ?? "Chart"} (${block.chart.kind} chart)`, t.columns.join("\t"), ...t.rows.map((r) => r.join("\t")), ""); break; }
      case "image": lines.push(`[Image${block.caption ? `: ${block.caption}` : ""}]`, ""); break;
      case "quote": lines.push(`"${block.text}"${block.cite ? ` — ${block.cite}` : ""}`, ""); break;
    }
  }
  if (doc.sources?.length) lines.push("", "SOURCES", ...doc.sources.map((s, i) => `${i + 1}. ${s.title}${s.url ? ` ${s.url}` : ""}`));
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/* ---------------- RTF ---------------- */

function rtfEscape(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`;
    else if (ch === "\n") out += "\\line ";
    else if (code > 127) {
      // RTF \u takes a signed 16-bit value; astral characters become a surrogate pair.
      const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code];
      for (const u of units) out += `\\u${u > 32767 ? u - 65536 : u}?`;
    } else out += ch;
  }
  return out;
}

export function documentToRtf(doc: DocumentSpec): string {
  const p = (text: string, size = 24, bold = false) => `{\\pard\\sa180\\fs${size}${bold ? "\\b" : ""} ${rtfEscape(text)}\\par}`;
  const body: string[] = [p(doc.title, 44, true)];
  if (doc.subtitle) body.push(p(doc.subtitle, 28));
  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading": body.push(p(block.text, block.level === 1 ? 34 : block.level === 2 ? 30 : 26, true)); break;
      case "paragraph": body.push(p(block.text)); break;
      case "bullets": block.items.forEach((item, i) => body.push(p(`${block.ordered ? `${i + 1}.` : "\\bullet"} ${item}`.replace("\\bullet", "•")))); break;
      case "table": {
        const width = Math.floor(9000 / Math.max(1, block.columns.length));
        const row = (cells: Array<string | number>, bold: boolean) =>
          `{\\trowd${cells.map((_, i) => `\\cellx${width * (i + 1)}`).join("")}${cells.map((c) => `\\intbl${bold ? "\\b" : ""} ${rtfEscape(String(c))}${bold ? "\\b0" : ""}\\cell`).join("")}\\row}`;
        if (block.caption) body.push(p(block.caption, 22, true));
        body.push(row(block.columns, true), ...block.rows.map((r) => row(block.columns.map((_, i) => r[i] ?? ""), false)));
        break;
      }
      case "chart": { const t = chartDataTable(block.chart); body.push(p(`${block.chart.title ?? "Chart"} (${block.chart.kind} chart)`, 22, true), ...t.rows.map((r) => p(r.join("   ")))); break; }
      case "image": body.push(p(`[Image${block.caption ? `: ${block.caption}` : ""}]`)); break;
      case "quote": body.push(p(`“${block.text}”${block.cite ? ` — ${block.cite}` : ""}`)); break;
    }
  }
  if (doc.sources?.length) body.push(p("Sources", 30, true), ...doc.sources.map((s, i) => p(`${i + 1}. ${s.title}${s.url ? ` ${s.url}` : ""}`)));
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\n${body.join("\n")}\n}`;
}

/* ---------------- CSV ---------------- */

const csvCell = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

export function sheetToCsv(sheet: SheetSpec): string {
  const rows = [sheet.columns, ...sheet.rows.map((r) => r.map((c) => (isFormula(c) && c.result === undefined ? `=${c.formula}` : cellText(c))))];
  return `${rows.map((r) => r.map((c) => csvCell(String(c))).join(",")).join("\r\n")}\r\n`;
}

export const utf8 = (text: string) => enc.encode(text);
