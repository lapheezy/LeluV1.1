/**
 * ==========================================================
 * LÉLU — CREATIVE KIT: INTERACTIVE VISUALIZATION
 *
 * A chart program (the Studio's ChartSpec plus area/timeline
 * and per-point detail) becomes:
 *   • an interactive, self-contained HTML page — hover/focus
 *     tooltips, legend toggles, a sortable data table, sources
 *     cited under the chart — runs offline, no script CDN;
 *   • a static SVG (for documents, decks and PNG export).
 *
 * visx was evaluated: it is React components over d3 modules.
 * The Studio already draws charts natively (ChartSvg), and an
 * exported chart must work outside React, so the renderer here
 * is plain SVG + a few lines of inline script.
 * ==========================================================
 */

import { CHART_PALETTE } from "../../studio/ChartSvg";

export const VIZ_KINDS = ["bar", "column", "line", "area", "scatter", "pie", "donut"] as const;
export type VizKind = (typeof VIZ_KINDS)[number];

export interface VizSource { title: string; url?: string; accessed?: string }

export interface VizProgram {
  kind: VizKind;
  title: string;
  subtitle?: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  /** Scatter x values. */
  x?: number[];
  /** Optional per-point detail shown in the tooltip (same index as labels / x). */
  details?: string[];
  xLabel?: string;
  yLabel?: string;
  sources: VizSource[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : Number.isInteger(n) ? String(n) : n.toFixed(2));
const numOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[,\s]/g, "")))) return Number(v.replace(/[,\s]/g, ""));
  return null;
};

export const VIZ_LIMITS = { points: 5000, series: 12 };

export function normalizeViz(input: unknown): VizProgram | string {
  if (!isObj(input)) return "a visualization needs kind, labels and series";
  const kindRaw = String(input.kind ?? "column").toLowerCase();
  const kind = (kindRaw === "doughnut" ? "donut" : kindRaw) as VizKind;
  if (!VIZ_KINDS.includes(kind)) return `kind must be one of ${VIZ_KINDS.join(", ")}`;
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 200) : "Untitled visualization";
  const rawSeries = Array.isArray(input.series) ? input.series.slice(0, VIZ_LIMITS.series) : [];
  if (rawSeries.length === 0) return "a visualization needs at least one series";
  const series: VizProgram["series"] = [];
  for (const [i, s] of rawSeries.entries()) {
    if (!isObj(s) || !Array.isArray(s.values)) return `series ${i + 1} needs values`;
    const values = s.values.slice(0, VIZ_LIMITS.points).map(numOf);
    const bad = values.findIndex((v) => v === null);
    if (bad >= 0) return `series ${i + 1} value ${bad + 1} is not a number`;
    series.push({ name: typeof s.name === "string" && s.name ? s.name.slice(0, 80) : `Series ${i + 1}`, values: values as number[] });
  }
  const labels = Array.isArray(input.labels) ? input.labels.slice(0, VIZ_LIMITS.points).map((l) => String(l).slice(0, 80)) : [];
  const x = Array.isArray(input.x) ? input.x.slice(0, VIZ_LIMITS.points).map(numOf) : undefined;
  if (kind === "scatter") {
    if (!x || x.some((n) => n === null)) return "a scatter visualization needs numeric x values";
    if (x.length !== series[0].values.length) return "a scatter visualization needs as many x values as y values";
  } else {
    if (labels.length === 0) return `a ${kind} visualization needs labels`;
    const long = series.find((s) => s.values.length > labels.length);
    if (long) return `series “${long.name}” has ${long.values.length} values for ${labels.length} labels`;
    if ((kind === "pie" || kind === "donut") && series[0].values.some((n) => n < 0)) return `a ${kind} cannot show negative values`;
  }
  const sources = (Array.isArray(input.sources) ? input.sources : []).filter(isObj).map((s) => ({
    title: String(s.title ?? s.name ?? "").slice(0, 200), url: typeof s.url === "string" && /^https?:\/\//.test(s.url) ? s.url : undefined, accessed: typeof s.accessed === "string" ? s.accessed : undefined,
  })).filter((s) => s.title);
  return {
    kind, title, subtitle: typeof input.subtitle === "string" ? input.subtitle.slice(0, 300) : undefined,
    labels, series, x: x as number[] | undefined,
    details: Array.isArray(input.details) ? input.details.slice(0, VIZ_LIMITS.points).map((d) => String(d).slice(0, 200)) : undefined,
    xLabel: typeof input.xLabel === "string" ? input.xLabel.slice(0, 80) : undefined,
    yLabel: typeof input.yLabel === "string" ? input.yLabel.slice(0, 80) : undefined,
    sources,
  };
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** SVG with one focusable, data-carrying mark per value (data-s, data-i, data-tip). */
export function vizSvg(p: VizProgram, opts: { width?: number; height?: number; ink?: string; background?: string } = {}): string {
  const W = opts.width ?? 760, H = opts.height ?? 420;
  const ink = opts.ink ?? "#2a2440";
  const bg = opts.background ? `<rect width="${W}" height="${H}" fill="${opts.background}"/>` : "";
  const left = 62, right = 18, top = 20, bottom = p.kind === "pie" || p.kind === "donut" ? 20 : 46;
  const pw = W - left - right, ph = H - top - bottom;
  const color = (i: number) => `#${CHART_PALETTE[i % CHART_PALETTE.length]}`;
  const marks: string[] = [];
  const tip = (s: number, i: number, value: number) => {
    const label = p.kind === "scatter" ? `${p.xLabel ?? "x"} ${fmt(p.x![i])}` : p.labels[i];
    const detail = p.details?.[i] ? ` — ${p.details[i]}` : "";
    return esc(`${p.series.length > 1 ? `${p.series[s].name} · ` : ""}${label}: ${fmt(value)}${detail}`);
  };
  const attrs = (s: number, i: number, v: number) => `data-s="${s}" data-i="${i}" data-tip="${tip(s, i, v)}" tabindex="0" class="mark"`;

  if (p.kind === "pie" || p.kind === "donut") {
    const values = p.series[0].values.map((v) => Math.max(0, v));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2, cy = top + ph / 2, r = Math.min(pw, ph) / 2 - 6;
    let a0 = -Math.PI / 2;
    values.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2, a1 = a0 + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const d = values.length === 1 ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0` : `M${cx},${cy} L${(cx + r * Math.cos(a0)).toFixed(2)},${(cy + r * Math.sin(a0)).toFixed(2)} A${r},${r} 0 ${large} 1 ${(cx + r * Math.cos(a1)).toFixed(2)},${(cy + r * Math.sin(a1)).toFixed(2)} Z`;
      marks.push(`<path d="${d}" fill="${color(i)}" stroke="#fff" stroke-width="1.5" ${attrs(0, i, v)}/>`);
      a0 = a1;
    });
    if (p.kind === "donut") marks.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.56}" fill="${opts.background ?? "#fff"}" pointer-events="none"/>`);
  } else {
    const all = p.series.flatMap((s) => s.values);
    const yMin = Math.min(0, ...all);
    const yMax = niceMax(Math.max(...all, 0));
    const yScale = (v: number) => top + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;
    const grid: string[] = [];
    for (let k = 0; k <= 4; k += 1) {
      const v = yMin + ((yMax - yMin) * k) / 4, y = yScale(v);
      grid.push(`<line x1="${left}" x2="${left + pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${ink}" stroke-opacity="${k === 0 ? 0.45 : 0.1}"/><text x="${left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${ink}" fill-opacity="0.75">${fmt(v)}</text>`);
    }
    if (p.kind !== "bar") marks.push(...grid);
    if (p.kind === "scatter") {
      const xs = p.x!, xMin = Math.min(...xs), xMax = Math.max(...xs);
      const xScale = (v: number) => left + ((v - xMin) / (xMax - xMin || 1)) * pw;
      for (let k = 0; k <= 4; k += 1) { const v = xMin + ((xMax - xMin) * k) / 4; marks.push(`<text x="${xScale(v).toFixed(1)}" y="${top + ph + 16}" text-anchor="middle" font-size="11" fill="${ink}" fill-opacity="0.75">${fmt(v)}</text>`); }
      p.series.forEach((s, si) => s.values.forEach((v, i) => marks.push(`<circle cx="${xScale(xs[i]).toFixed(1)}" cy="${yScale(v).toFixed(1)}" r="4.5" fill="${color(si)}" fill-opacity="0.8" ${attrs(si, i, v)}/>`)));
    } else {
      const n = p.labels.length || 1;
      const horizontal = p.kind === "bar";
      const slot = (horizontal ? ph : pw) / n;
      const every = Math.max(1, Math.ceil(n / (horizontal ? 30 : 14)));
      p.labels.forEach((label, i) => {
        if (i % every) return;
        marks.push(horizontal
          ? `<text x="${left - 8}" y="${(top + slot * i + slot / 2 + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${ink}">${esc(label.slice(0, 14))}</text>`
          : `<text x="${(left + slot * i + slot / 2).toFixed(1)}" y="${top + ph + 16}" text-anchor="middle" font-size="11" fill="${ink}">${esc(label.slice(0, 12))}</text>`);
      });
      if (p.kind === "line" || p.kind === "area") {
        p.series.forEach((s, si) => {
          const pts = s.values.map((v, i) => [left + slot * i + slot / 2, yScale(v)] as const);
          const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
          if (p.kind === "area" && pts.length) marks.push(`<path d="${path}L${pts[pts.length - 1][0].toFixed(1)},${yScale(Math.max(0, yMin)).toFixed(1)}L${pts[0][0].toFixed(1)},${yScale(Math.max(0, yMin)).toFixed(1)}Z" fill="${color(si)}" fill-opacity="0.18" data-series="${si}"/>`);
          marks.push(`<path d="${path}" fill="none" stroke="${color(si)}" stroke-width="2.4" data-series="${si}"/>`);
          pts.forEach(([x, y], i) => marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${n > 120 ? 2 : 3.6}" fill="${color(si)}" ${attrs(si, i, s.values[i])}/>`));
        });
      } else {
        const group = slot * 0.78, bw = group / p.series.length;
        p.series.forEach((s, si) => s.values.forEach((v, i) => {
          const zero = horizontal ? left : yScale(0);
          if (horizontal) {
            const len = (Math.max(0, v) / yMax) * pw, y = top + slot * i + (slot - group) / 2 + si * bw;
            marks.push(`<rect x="${left}" y="${y.toFixed(1)}" width="${len.toFixed(1)}" height="${Math.max(1, bw - 1.5).toFixed(1)}" rx="2" fill="${color(si)}" ${attrs(si, i, v)}/>`);
          } else {
            const x = left + slot * i + (slot - group) / 2 + si * bw, y = yScale(v);
            marks.push(`<rect x="${x.toFixed(1)}" y="${Math.min(y, zero).toFixed(1)}" width="${Math.max(1, bw - 1.5).toFixed(1)}" height="${Math.abs(zero - y).toFixed(1)}" rx="2" fill="${color(si)}" ${attrs(si, i, v)}/>`);
          }
        }));
      }
    }
    if (p.yLabel) marks.push(`<text transform="translate(14 ${top + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="${ink}">${esc(p.yLabel)}</text>`);
    if (p.xLabel) marks.push(`<text x="${left + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="${ink}">${esc(p.xLabel)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(p.title)}" font-family="Inter, Helvetica, Arial, sans-serif">${bg}${marks.join("")}</svg>`;
}

/** A complete, offline, interactive page: chart, legend toggles, tooltip, table, sources. */
export function vizHtml(p: VizProgram): string {
  const svg = vizSvg(p, { background: "#ffffff" });
  const color = (i: number) => `#${CHART_PALETTE[i % CHART_PALETTE.length]}`;
  const legendNames = p.kind === "pie" || p.kind === "donut" ? p.labels : p.series.map((s) => s.name);
  const legend = legendNames.length > 1 || p.kind === "pie" || p.kind === "donut"
    ? `<div class="legend">${legendNames.map((n, i) => `<button type="button" data-toggle="${i}" aria-pressed="true"><i style="background:${color(i)}"></i>${esc(n)}</button>`).join("")}</div>` : "";
  const rows = (p.kind === "scatter" ? p.x! : p.labels).map((label, i) => `<tr><td>${esc(String(label))}</td>${p.series.map((s) => `<td>${s.values[i] === undefined ? "" : esc(fmt(s.values[i]))}</td>`).join("")}${p.details ? `<td>${esc(p.details[i] ?? "")}</td>` : ""}</tr>`).join("");
  const table = `<table><thead><tr><th>${esc(p.kind === "scatter" ? p.xLabel ?? "x" : "Label")}</th>${p.series.map((s) => `<th>${esc(s.name)}</th>`).join("")}${p.details ? "<th>Detail</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>`;
  const sources = p.sources.length ? `<footer><strong>Sources</strong><ol>${p.sources.map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>` : esc(s.title)}${s.accessed ? ` <span>(retrieved ${esc(s.accessed)})</span>` : ""}</li>`).join("")}</ol></footer>` : "";
  const pie = p.kind === "pie" || p.kind === "donut";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(p.title)}</title>
<style>body{margin:0;font:14px Inter,Helvetica,Arial,sans-serif;color:#2a2440;background:#fff}main{max-width:820px;margin:0 auto;padding:18px}h1{font-size:19px;margin:0 0 2px}p.sub{margin:0 0 10px;color:#6b6585}svg{width:100%;height:auto}.mark{cursor:pointer;transition:opacity .15s}.mark:hover,.mark:focus{opacity:.75;outline:none;stroke:#2a2440;stroke-width:1.5}.off{display:none}#tip{position:fixed;pointer-events:none;background:#1b1530;color:#f4f0ff;padding:6px 9px;border-radius:6px;font-size:12px;max-width:320px;opacity:0;transition:opacity .1s}.legend{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.legend button{border:1px solid #ddd;background:#fff;border-radius:14px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px}.legend button[aria-pressed=false]{opacity:.4}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}details{margin-top:10px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #eee;padding:4px 6px;text-align:left}th{cursor:pointer;background:#faf8ff}footer{margin-top:12px;font-size:12px;color:#6b6585}footer ol{margin:4px 0 0 18px;padding:0}</style></head>
<body><main data-lelu-viz="${p.kind}"><h1>${esc(p.title)}</h1>${p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""}${legend}<div id="chart">${svg}</div><div id="tip" role="status"></div>
<details><summary>Data table (${(p.kind === "scatter" ? p.x! : p.labels).length} rows)</summary>${table}</details>${sources}</main>
<script>(function(){var tip=document.getElementById('tip');function show(e){var t=e.target.getAttribute&&e.target.getAttribute('data-tip');if(!t)return;tip.textContent=t;tip.style.opacity=1;var r=e.target.getBoundingClientRect();tip.style.left=Math.min(window.innerWidth-330,(e.clientX||r.left)+12)+'px';tip.style.top=((e.clientY||r.top)+12)+'px';}function hide(){tip.style.opacity=0}var c=document.getElementById('chart');c.addEventListener('mousemove',show);c.addEventListener('focusin',show);c.addEventListener('mouseleave',hide);c.addEventListener('focusout',hide);
document.querySelectorAll('[data-toggle]').forEach(function(b){b.addEventListener('click',function(){var on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',on);var k=b.getAttribute('data-toggle');document.querySelectorAll(${pie ? `'.mark[data-i="'+k+'"]'` : `'[data-s="'+k+'"],[data-series="'+k+'"]'`}).forEach(function(m){m.classList.toggle('off',!on)})})});
document.querySelectorAll('th').forEach(function(th,col){var asc=true;th.addEventListener('click',function(){var tb=th.closest('table').tBodies[0];var rs=[].slice.call(tb.rows);rs.sort(function(a,b){var x=a.cells[col].textContent,y=b.cells[col].textContent,nx=parseFloat(x),ny=parseFloat(y);var d=(!isNaN(nx)&&!isNaN(ny))?nx-ny:x.localeCompare(y);return asc?d:-d});asc=!asc;rs.forEach(function(r){tb.appendChild(r)})})})})();</script></body></html>`;
}
