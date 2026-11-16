/**
 * LÉLU — Creation Studio: PPTX writer.
 * Themed slide layouts, native PowerPoint charts (editable data),
 * tables, images and speaker notes. Loaded lazily.
 */

import { CHART_PALETTE } from "../ChartSvg";
import { DEFAULT_THEME, type ChartSpec, type DeckSpec, type DeckTheme, type SlideSpec } from "../StudioTypes";

export function slideLayoutOf(slide: SlideSpec): NonNullable<SlideSpec["layout"]> {
  if (slide.layout) return slide.layout;
  if (slide.chart) return "chart";
  if (slide.table) return "table";
  if (slide.image) return "image";
  if (slide.right?.length) return "two-column";
  return "content";
}

export async function writePptx(deck: DeckSpec): Promise<Uint8Array> {
  const mod = await import("pptxgenjs");
  const PptxGen = (mod as unknown as { default: new () => PptxInstance }).default ?? (mod as unknown as new () => PptxInstance);
  const pptx = new PptxGen();
  const theme: DeckTheme = { ...DEFAULT_THEME, ...(deck.theme ?? {}) };
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.author = deck.author ?? "LÉLU";
  pptx.title = deck.title;
  pptx.company = "LÉLU Creation Studio";

  const W = 13.33;
  const base = { fontFace: theme.font, color: theme.text };
  const bodyBox = { x: 0.7, y: 1.45, w: W - 1.4, h: 5.4 };

  const chartType = (chart: ChartSpec) => {
    const t = pptx.ChartType;
    return chart.kind === "line" ? t.line : chart.kind === "pie" ? t.pie : chart.kind === "donut" ? t.doughnut : chart.kind === "scatter" ? t.scatter : t.bar;
  };
  const addChart = (slide: PptxSlide, chart: ChartSpec, box: { x: number; y: number; w: number; h: number }) => {
    const data = chart.kind === "scatter"
      ? [{ name: chart.xLabel ?? "X", values: chart.x ?? chart.series[0].values.map((_, i) => i) }, { name: chart.series[0]?.name ?? "Y", values: chart.series[0]?.values ?? [] }]
      : (chart.kind === "pie" || chart.kind === "donut" ? chart.series.slice(0, 1) : chart.series).map((s) => ({ name: s.name, labels: chart.labels, values: s.values }));
    slide.addChart(chartType(chart), data, {
      ...box,
      barDir: chart.kind === "bar" ? "bar" : "col",
      chartColors: CHART_PALETTE,
      showLegend: chart.series.length > 1 || chart.kind === "pie" || chart.kind === "donut",
      legendPos: "b",
      legendColor: theme.text,
      showTitle: Boolean(chart.title),
      title: chart.title,
      titleColor: theme.text,
      catAxisLabelColor: theme.text,
      valAxisLabelColor: theme.text,
      dataLabelColor: theme.text,
      showPercent: chart.kind === "pie" || chart.kind === "donut",
      lineSize: chart.kind === "scatter" ? 0 : 2,
    });
  };
  const bullets = (items: string[]) => items.map((text) => ({ text, options: { bullet: { indent: 18 }, paraSpaceAfter: 8 } }));

  // Slide masters with a real TITLE placeholder: PowerPoint's outline
  // view, slide sorter and screen readers know each slide's title.
  const titlePlaceholder = (y: number, h: number, size: number, align: string) => ({
    placeholder: { options: { name: "title", type: "title", x: 0.6, y, w: W - 1.2, h, fontFace: theme.font, color: theme.text, fontSize: size, bold: true, align, valign: "middle" }, text: "" },
  });
  pptx.defineSlideMaster({ title: "LELU_TITLE", background: { color: theme.background }, objects: [titlePlaceholder(2.3, 1.4, 44, "center")] });
  pptx.defineSlideMaster({ title: "LELU_CONTENT", background: { color: theme.background }, objects: [titlePlaceholder(0.35, 0.9, 30, "left")] });

  deck.slides.forEach((spec, index) => {
    const layout = slideLayoutOf(spec);
    const slide = pptx.addSlide({ masterName: layout === "title" || layout === "section" ? "LELU_TITLE" : "LELU_CONTENT" });
    slide.background = { color: theme.background };
    // Accent rule and slide number on every slide.
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 7.38, w: W, h: 0.12, fill: { color: theme.accent }, line: { color: theme.accent } });
    slide.addText(String(index + 1), { ...base, x: W - 1, y: 6.9, w: 0.6, h: 0.4, fontSize: 11, align: "right" });

    if (layout === "title" || layout === "section") {
      slide.addText(spec.title, { placeholder: "title", fontSize: layout === "title" ? 44 : 36 });
      if (spec.subtitle) slide.addText(spec.subtitle, { ...base, x: 0.8, y: 3.8, w: W - 1.6, h: 0.8, fontSize: 20, color: theme.accent, align: "center" });
      if (spec.bullets?.length) slide.addText(spec.bullets.join("  ·  "), { ...base, x: 0.8, y: 4.7, w: W - 1.6, h: 0.8, fontSize: 16, align: "center" });
    } else {
      slide.addText(spec.title, { placeholder: "title" });
      if (spec.subtitle) slide.addText(spec.subtitle, { ...base, x: 0.6, y: 1.05, w: W - 1.2, h: 0.4, fontSize: 14, color: theme.accent });
      if (layout === "two-column") {
        slide.addText(bullets(spec.bullets ?? []), { ...base, x: 0.7, y: 1.6, w: 5.8, h: 5.1, fontSize: 18, valign: "top" });
        slide.addText(bullets(spec.right ?? []), { ...base, x: 6.9, y: 1.6, w: 5.8, h: 5.1, fontSize: 18, valign: "top" });
      } else if (layout === "chart" && spec.chart) {
        if (spec.bullets?.length) {
          slide.addText(bullets(spec.bullets), { ...base, x: 0.7, y: 1.6, w: 4.2, h: 5.1, fontSize: 16, valign: "top" });
          addChart(slide, spec.chart, { x: 5.1, y: 1.5, w: 7.6, h: 5.3 });
        } else addChart(slide, spec.chart, bodyBox);
      } else if (layout === "table" && spec.table) {
        const header = spec.table.columns.map((c) => ({ text: String(c), options: { bold: true, fill: { color: theme.accent }, color: theme.background } }));
        const rows = spec.table.rows.map((r) => spec.table!.columns.map((_, i) => ({ text: String(r[i] ?? "") })));
        slide.addTable([header, ...rows], { ...bodyBox, h: undefined, fontFace: theme.font, fontSize: 14, color: theme.text, border: { type: "solid", pt: 0.75, color: theme.accent }, autoPage: false });
      } else if (layout === "image" && spec.image) {
        slide.addImage({ data: spec.image.dataUrl, x: 1.5, y: 1.5, w: W - 3, h: 4.8, sizing: { type: "contain", w: W - 3, h: 4.8 } });
        if (spec.image.caption) slide.addText(spec.image.caption, { ...base, x: 0.7, y: 6.35, w: W - 1.4, h: 0.4, fontSize: 12, italic: true, align: "center" });
      } else {
        slide.addText(bullets(spec.bullets ?? []), { ...base, ...bodyBox, fontSize: 20, valign: "top" });
      }
    }
    if (spec.notes) slide.addNotes(spec.notes);
  });

  if (deck.sources?.length) {
    const slide = pptx.addSlide({ masterName: "LELU_CONTENT" });
    slide.background = { color: theme.background };
    slide.addText("Sources", { placeholder: "title" });
    slide.addText(
      deck.sources.map((s) => ({ text: `[${s.id}] ${s.title}${s.url ? ` — ${s.url}` : ""}`, options: { bullet: { type: "number" }, paraSpaceAfter: 6 } })),
      { ...base, ...bodyBox, fontSize: 13, valign: "top" },
    );
  }

  const out = await pptx.write({ outputType: "uint8array" });
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}

/* Minimal structural types for the parts of pptxgenjs used here. */
interface PptxSlide {
  background: { color: string };
  addText(text: unknown, options: Record<string, unknown>): void;
  addShape(shape: unknown, options: Record<string, unknown>): void;
  addChart(type: unknown, data: unknown[], options: Record<string, unknown>): void;
  addTable(rows: unknown[][], options: Record<string, unknown>): void;
  addImage(options: Record<string, unknown>): void;
  addNotes(text: string): void;
}
interface PptxInstance {
  layout: string;
  author: string;
  title: string;
  company: string;
  ChartType: Record<"bar" | "line" | "pie" | "doughnut" | "scatter", unknown>;
  ShapeType: Record<"rect", unknown>;
  addSlide(options?: { masterName?: string }): PptxSlide;
  defineSlideMaster(props: Record<string, unknown>): void;
  write(options: { outputType: "uint8array" }): Promise<unknown>;
}
