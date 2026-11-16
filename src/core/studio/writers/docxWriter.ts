/**
 * LÉLU — Creation Studio: DOCX writer.
 * Native Word headings, lists, tables and charts (the chart is a real
 * chart part with its data embedded, editable in Word), images, and a
 * numbered source list. Loaded lazily: the library stays out of the
 * main bundle until a document is written.
 */

import type { Block, ChartSpec, DocumentSpec } from "../StudioTypes";
import { CHART_PALETTE } from "../ChartSvg";
import { dataUrlBytes } from "./bytes";

export async function writeDocx(doc: DocumentSpec): Promise<Uint8Array> {
  const d = await import("docx");
  const { ChartRun } = await import("docx/charts");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, ImageRun, AlignmentType, ExternalHyperlink, LevelFormat } = d;

  const headingFor = (level: 1 | 2 | 3) => (level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3);

  const tableOf = (columns: string[], rows: Array<Array<string | number>>) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: columns.map((c) => new TableCell({
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "EDE7FB" },
            children: [new Paragraph({ children: [new TextRun({ text: String(c), bold: true })] })],
          })),
        }),
        ...rows.map((r) => new TableRow({
          children: columns.map((_, i) => new TableCell({ children: [new Paragraph(String(r[i] ?? ""))] })),
        })),
      ],
    });

  const chartRun = (chart: ChartSpec) => {
    const size = { width: 560, height: 320 };
    const title = chart.title;
    if (chart.kind === "pie" || chart.kind === "donut") {
      const s = chart.series[0] ?? { name: "Values", values: [] };
      return new ChartRun({
        type: chart.kind === "pie" ? "pie" : "doughnut",
        title,
        categories: chart.labels,
        series: [{ name: s.name, values: s.values.map((v) => Math.max(0, v)) }],
        transformation: size,
      } as never);
    }
    if (chart.kind === "scatter") {
      const s = chart.series[0] ?? { name: "Values", values: [] };
      return new ChartRun({
        type: "scatter",
        title,
        series: [{ name: s.name, points: s.values.map((y, i) => ({ x: chart.x?.[i] ?? i, y })) }],
        transformation: size,
      } as never);
    }
    return new ChartRun({
      type: chart.kind === "bar" ? "bar" : chart.kind === "line" ? "line" : "column",
      title,
      categories: chart.labels,
      series: chart.series.map((s, i) => ({ name: s.name, values: s.values, color: CHART_PALETTE[i % CHART_PALETTE.length] })),
      transformation: size,
    } as never);
  };

  const caption = (text: string) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, italics: true, size: 20, color: "6B6480" })] });

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(doc.title)] }),
  ];
  if (doc.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: doc.subtitle, italics: true, size: 28 })] }));
  if (doc.author) children.push(new Paragraph({ children: [new TextRun({ text: `By ${doc.author}`, color: "6B6480" })] }));

  // Each ordered list (and the source list) is its own numbering instance,
  // so every one starts again at 1.
  let listInstance = 0;
  const push = (block: Block) => {
    switch (block.type) {
      case "heading": children.push(new Paragraph({ heading: headingFor(block.level), children: [new TextRun(block.text)] })); break;
      case "paragraph": children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun(block.text)] })); break;
      case "bullets": {
        const instance = block.ordered ? ++listInstance : 0;
        for (const item of block.items) {
          children.push(new Paragraph(block.ordered ? { numbering: { reference: "lelu-ordered", level: 0, instance }, children: [new TextRun(item)] } : { bullet: { level: 0 }, children: [new TextRun(item)] }));
        }
        break;
      }
      case "table":
        if (block.caption) children.push(new Paragraph({ children: [new TextRun({ text: block.caption, bold: true })] }));
        children.push(tableOf(block.columns, block.rows));
        children.push(new Paragraph(""));
        break;
      case "chart":
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [chartRun(block.chart)] }));
        if (block.caption) children.push(caption(block.caption));
        break;
      case "image": {
        const img = dataUrlBytes(block.dataUrl);
        if (img && (img.type === "png" || img.type === "jpg" || img.type === "gif" || img.type === "bmp")) {
          const w = block.width ?? 480;
          const h = block.height ?? Math.round(w * 0.6);
          children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: img.type, data: img.bytes, transformation: { width: w, height: h } })] }));
        } else {
          children.push(new Paragraph({ children: [new TextRun({ text: `[Image not embedded: ${img ? img.type : "not a data URL"}]`, italics: true })] }));
        }
        if (block.caption) children.push(caption(block.caption));
        break;
      }
      case "quote":
        children.push(new Paragraph({ indent: { left: 720 }, children: [new TextRun({ text: `“${block.text}”`, italics: true }), ...(block.cite ? [new TextRun({ text: ` — ${block.cite}` })] : [])] }));
        break;
    }
  };
  doc.blocks.forEach(push);

  if (doc.sources?.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Sources")] }));
    const instance = ++listInstance;
    for (const s of doc.sources) {
      const tail = `${s.accessed ? ` (accessed ${s.accessed})` : ""}${s.note ? ` — ${s.note}` : ""}`;
      children.push(new Paragraph({
        numbering: { reference: "lelu-ordered", level: 0, instance },
        children: [
          new TextRun(`[${s.id}] ${s.title}`),
          ...(s.url ? [new TextRun(" — "), new ExternalHyperlink({ link: s.url, children: [new TextRun({ text: s.url, style: "Hyperlink" })] })] : []),
          ...(tail ? [new TextRun(tail)] : []),
        ],
      }));
    }
  }

  const file = new Document({
    creator: doc.author ?? "LÉLU",
    title: doc.title,
    description: doc.subtitle,
    numbering: { config: [{ reference: "lelu-ordered", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }] }] },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(file));
}
