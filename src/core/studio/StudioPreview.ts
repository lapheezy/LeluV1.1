/**
 * LÉLU — Creation Studio previews (pure HTML strings).
 *
 * What the chat card and the Cosmos window show: the same spec the
 * files are written from, drawn as pages, 16:9 slides or sheets. Shown
 * in a sandboxed iframe (no scripts), so nothing in an artifact can run.
 */

import { chartToSvg } from "./ChartSvg";
import { cellText, DEFAULT_THEME, type ArtifactSpec, type ChartSpec, type DeckSpec, type SlideSpec } from "./StudioTypes";
import { documentToHtml, workbookToHtml } from "./writers/textWriters";
import { slideLayoutOf } from "./writers/pptxWriter";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function slideHtml(slide: SlideSpec, index: number, deck: DeckSpec): string {
  const t = { ...DEFAULT_THEME, ...(deck.theme ?? {}) };
  const layout = slideLayoutOf(slide);
  const bullets = (items?: string[]) => (items?.length ? `<ul>${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "");
  let body = "";
  if (layout === "title" || layout === "section") {
    body = `<div class="center"><h1>${esc(slide.title)}</h1>${slide.subtitle ? `<p class="sub">${esc(slide.subtitle)}</p>` : ""}</div>`;
  } else {
    body = `<h2>${esc(slide.title)}</h2>${slide.subtitle ? `<p class="sub">${esc(slide.subtitle)}</p>` : ""}`;
    if (layout === "two-column") body += `<div class="cols"><div>${bullets(slide.bullets)}</div><div>${bullets(slide.right)}</div></div>`;
    else if (slide.chart) body += `<div class="${slide.bullets?.length ? "cols chart-cols" : ""}">${slide.bullets?.length ? `<div>${bullets(slide.bullets)}</div>` : ""}<div class="chart">${chartToSvg(slide.chart, { ink: t.text, width: 640, height: 340 })}</div></div>`;
    else if (slide.table) body += `<table><thead><tr>${slide.table.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${slide.table.rows.map((r) => `<tr>${slide.table!.columns.map((_, i) => `<td>${esc(String(r[i] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    else if (slide.image) body += `<img src="${esc(slide.image.dataUrl)}" alt="${esc(slide.image.caption ?? "")}"/>`;
    else body += bullets(slide.bullets);
  }
  return `<section class="slide" aria-label="Slide ${index + 1}">${body}<span class="num">${index + 1}</span>${slide.notes ? `<aside class="notes"><b>Notes</b> ${esc(slide.notes)}</aside>` : ""}</section>`;
}

export function deckPreviewHtml(deck: DeckSpec): string {
  const t = { ...DEFAULT_THEME, ...(deck.theme ?? {}) };
  const css = `body{margin:0;padding:14px;background:#0b0918;font-family:${esc(t.font)},Inter,Helvetica,Arial,sans-serif;color:#${t.text}}
.slide{position:relative;aspect-ratio:16/9;background:#${t.background};border-radius:10px;margin:0 auto 18px;max-width:960px;padding:4% 5%;box-sizing:border-box;overflow:hidden;border-bottom:6px solid #${t.accent};box-shadow:0 8px 30px rgba(0,0,0,.45)}
.slide h1{font-size:clamp(20px,4.4vw,44px);margin:0}.slide h2{font-size:clamp(15px,2.8vw,28px);margin:0 0 2%}
.sub{color:#${t.accent};margin:.4em 0 0;font-size:clamp(11px,1.6vw,18px)}.center{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
ul{margin:.5em 0;padding-left:1.2em;font-size:clamp(11px,1.9vw,20px);line-height:1.5}.cols{display:grid;grid-template-columns:1fr 1fr;gap:4%}.chart-cols{grid-template-columns:1fr 2fr}
.chart svg{width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:clamp(10px,1.5vw,15px)}th{background:#${t.accent};color:#${t.background};text-align:left}th,td{border:1px solid #${t.accent}55;padding:.4em .6em}
img{max-width:100%;max-height:70%;display:block;margin:auto}.num{position:absolute;right:2.5%;bottom:3%;font-size:11px;opacity:.7}
.notes{position:absolute;left:5%;right:12%;bottom:3%;font-size:11px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${css}</style></head><body>${deck.slides.map((s, i) => slideHtml(s, i, deck)).join("")}</body></html>`;
}

/** The preview document for any artifact. */
export function previewHtml(spec: ArtifactSpec): string {
  if (spec.kind === "deck") return deckPreviewHtml(spec);
  if (spec.kind === "workbook") return workbookToHtml(spec);
  return documentToHtml(spec);
}

/** A one-line, text-only gist for compact cards. */
export function artifactGist(spec: ArtifactSpec): string {
  if (spec.kind === "deck") return `${spec.slides.length} slide${spec.slides.length === 1 ? "" : "s"} · ${spec.slides.map((s) => s.title).slice(0, 3).join(" · ")}`;
  if (spec.kind === "workbook") return `${spec.sheets.length} sheet${spec.sheets.length === 1 ? "" : "s"} · ${spec.sheets.map((s) => `${s.name} (${s.rows.length} rows)`).join(" · ")}`;
  const headings = spec.blocks.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text);
  const charts = spec.blocks.filter((b) => b.type === "chart").length;
  const tables = spec.blocks.filter((b) => b.type === "table").length;
  return [headings.slice(0, 3).join(" · "), charts ? `${charts} chart${charts > 1 ? "s" : ""}` : "", tables ? `${tables} table${tables > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ") || `${spec.blocks.length} blocks`;
}

/** The first chart in an artifact, for a thumbnail. */
export function firstChartSvg(spec: ArtifactSpec, ink = "2A2440"): string | null {
  let chart: ChartSpec | undefined;
  if (spec.kind === "document") {
    const block = spec.blocks.find((b) => b.type === "chart");
    chart = block?.type === "chart" ? block.chart : undefined;
  } else if (spec.kind === "deck") {
    chart = spec.slides.find((s) => s.chart)?.chart;
  } else {
    chart = spec.sheets.find((s) => s.charts?.length)?.charts?.[0];
  }
  return chart ? chartToSvg(chart, { ink, width: 320, height: 190 }) : null;
}

export { cellText };
