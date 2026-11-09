/**
 * ==========================================================
 * LÉLU — CHART → SVG
 *
 * One renderer for every place a chart is SHOWN rather than
 * written natively: chat previews, Cosmos windows, HTML exports.
 * (DOCX, PPTX and PDF draw their own charts from the same spec.)
 * Pure string output, so it runs in the browser and in tests.
 * ==========================================================
 */

import type { ChartSpec } from "./StudioTypes";

export const CHART_PALETTE = ["7C5CFF", "2FB8AC", "F2A541", "E4572E", "4EA5E9", "A05195", "8FB339", "F95D6A"];

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * exp >= value) ?? 10;
  return step * exp;
}

function fmt(value: number): string {
  if (Math.abs(value) >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${+(value / 1e3).toFixed(1)}k`;
  return `${+value.toFixed(2)}`;
}

export interface ChartSvgOptions {
  width?: number;
  height?: number;
  /** Text colour, 6-digit hex without '#'. */
  ink?: string;
  background?: string;
}

export function chartToSvg(chart: ChartSpec, options: ChartSvgOptions = {}): string {
  const W = options.width ?? 640;
  const H = options.height ?? 380;
  const ink = `#${options.ink ?? "2A2440"}`;
  const bg = options.background ? `<rect width="${W}" height="${H}" fill="#${options.background}"/>` : "";
  const title = chart.title ? `<text x="${W / 2}" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="${ink}">${esc(chart.title)}</text>` : "";
  const top = chart.title ? 40 : 16;
  const series = chart.series.filter((s) => s.values.length > 0);
  const legend = series.length > 1 || chart.kind === "pie" || chart.kind === "donut";
  const bottom = legend ? 56 : 36;
  const left = 56;
  const right = 16;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const parts: string[] = [];

  const legendItems = (names: string[]) => {
    const per = Math.min(160, plotW / Math.max(1, names.length));
    return names
      .map((name, i) => {
        const x = left + i * per;
        const y = H - 14;
        return `<rect x="${x}" y="${y - 10}" width="10" height="10" rx="2" fill="#${CHART_PALETTE[i % CHART_PALETTE.length]}"/><text x="${x + 14}" y="${y}" font-size="11" fill="${ink}">${esc(name.slice(0, 22))}</text>`;
      })
      .join("");
  };

  if (chart.kind === "pie" || chart.kind === "donut") {
    const values = (series[0]?.values ?? []).map((v) => Math.max(0, v));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2;
    const cy = top + plotH / 2;
    const r = Math.min(plotW, plotH) / 2 - 4;
    let angle = -Math.PI / 2;
    values.forEach((value, i) => {
      const sweep = (value / total) * Math.PI * 2;
      const end = angle + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const color = CHART_PALETTE[i % CHART_PALETTE.length];
      parts.push(
        values.length === 1
          ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#${color}"/>`
          : `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="#${color}" stroke="#fff" stroke-width="1"/>`,
      );
      const mid = angle + sweep / 2;
      if (sweep > 0.25) {
        parts.push(`<text x="${(cx + r * 0.65 * Math.cos(mid)).toFixed(1)}" y="${(cy + r * 0.65 * Math.sin(mid)).toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff">${Math.round((value / total) * 100)}%</text>`);
      }
      angle = end;
    });
    if (chart.kind === "donut") parts.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="${options.background ? `#${options.background}` : "#fff"}"/>`);
    parts.push(legendItems(chart.labels));
  } else if (chart.kind === "scatter") {
    const xs = chart.x ?? chart.labels.map((label, i) => Number(label) || i);
    const ys = series[0]?.values ?? [];
    const xMin = Math.min(...xs, 0);
    const xMax = niceMax(Math.max(...xs, 1));
    const yMax = niceMax(Math.max(...ys, 1));
    parts.push(axes(left, top, plotW, plotH, yMax, ink));
    ys.forEach((y, i) => {
      const px = left + ((xs[i] - xMin) / (xMax - xMin || 1)) * plotW;
      const py = top + plotH - (y / yMax) * plotH;
      parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="#${CHART_PALETTE[0]}"/>`);
    });
    if (chart.xLabel) parts.push(`<text x="${left + plotW / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="${ink}">${esc(chart.xLabel)}</text>`);
  } else {
    const all = series.flatMap((s) => s.values);
    const yMax = niceMax(Math.max(...all, 0));
    const n = chart.labels.length || 1;
    const horizontal = chart.kind === "bar";
    if (!horizontal) parts.push(axes(left, top, plotW, plotH, yMax, ink));
    const slot = (horizontal ? plotH : plotW) / n;
    chart.labels.forEach((label, i) => {
      if (horizontal) {
        parts.push(`<text x="${left - 6}" y="${(top + slot * i + slot / 2 + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${ink}">${esc(label.slice(0, 10))}</text>`);
      } else {
        parts.push(`<text x="${(left + slot * i + slot / 2).toFixed(1)}" y="${top + plotH + 16}" text-anchor="middle" font-size="11" fill="${ink}">${esc(label.slice(0, 12))}</text>`);
      }
    });
    if (chart.kind === "line") {
      series.forEach((s, si) => {
        const pts = s.values.map((v, i) => `${(left + slot * i + slot / 2).toFixed(1)},${(top + plotH - (v / yMax) * plotH).toFixed(1)}`);
        const color = CHART_PALETTE[si % CHART_PALETTE.length];
        parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#${color}" stroke-width="2.5"/>`);
        pts.forEach((p) => {
          const [x, y] = p.split(",");
          parts.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="#${color}"/>`);
        });
      });
    } else {
      const group = slot * 0.75;
      const barW = group / Math.max(1, series.length);
      series.forEach((s, si) => {
        const color = CHART_PALETTE[si % CHART_PALETTE.length];
        s.values.forEach((v, i) => {
          const len = (Math.max(0, v) / yMax) * (horizontal ? plotW : plotH);
          if (horizontal) {
            const y = top + slot * i + (slot - group) / 2 + si * barW;
            parts.push(`<rect x="${left}" y="${y.toFixed(1)}" width="${len.toFixed(1)}" height="${(barW - 2).toFixed(1)}" rx="2" fill="#${color}"/>`);
            parts.push(`<text x="${(left + len + 4).toFixed(1)}" y="${(y + barW / 2 + 3).toFixed(1)}" font-size="10" fill="${ink}">${fmt(v)}</text>`);
          } else {
            const x = left + slot * i + (slot - group) / 2 + si * barW;
            parts.push(`<rect x="${x.toFixed(1)}" y="${(top + plotH - len).toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${len.toFixed(1)}" rx="2" fill="#${color}"/>`);
          }
        });
      });
    }
    if (legend) parts.push(legendItems(series.map((s) => s.name)));
  }

  const label = esc(chart.title ?? `${chart.kind} chart`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}" font-family="Inter, Helvetica, Arial, sans-serif">${bg}${title}${parts.join("")}</svg>`;
}

function axes(left: number, top: number, w: number, h: number, yMax: number, ink: string): string {
  const lines: string[] = [];
  for (let i = 0; i <= 4; i += 1) {
    const y = top + h - (h * i) / 4;
    lines.push(`<line x1="${left}" y1="${y.toFixed(1)}" x2="${left + w}" y2="${y.toFixed(1)}" stroke="${ink}" stroke-opacity="${i === 0 ? 0.5 : 0.12}"/>`);
    lines.push(`<text x="${left - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="${ink}" fill-opacity="0.75">${fmt((yMax * i) / 4)}</text>`);
  }
  return lines.join("");
}
