/**
 * LÉLU — Creation Studio: XLSX writer.
 * Real cells, number types and formulas (with cached results where
 * given), a styled frozen header with filters, column widths, and
 * native Excel charts that reference the sheet's own cells (added
 * as chart parts after exceljs writes the workbook — exceljs has no
 * chart support). Loaded lazily.
 */

import { isFormula, type ChartSpec, type SheetSpec, type WorkbookSpec } from "../StudioTypes";
import { CHART_PALETTE } from "../ChartSvg";

export async function writeXlsx(book: WorkbookSpec): Promise<Uint8Array> {
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = book.author ?? "LÉLU";
  wb.title = book.title;
  wb.created = new Date(0); // deterministic output: the same spec writes the same bytes

  for (const sheet of book.sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheet.name), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(sheet.columns);
    for (const row of sheet.rows) {
      ws.addRow(row.map((cell) => (isFormula(cell) ? { formula: cell.formula, result: cell.result } : cell)));
    }
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B3FD1" } };
    });
    sheet.columns.forEach((name, i) => {
      const longest = Math.max(name.length, ...sheet.rows.map((r) => String(cellDisplay(r[i])).length));
      ws.getColumn(i + 1).width = sheet.widths?.[i] ?? Math.min(48, Math.max(10, longest + 2));
    });
    if (sheet.columns.length > 0 && sheet.rows.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    }
  }

  const written = new Uint8Array(await wb.xlsx.writeBuffer());
  const charted = book.sheets.some((s) => (s.charts?.length ?? 0) > 0);
  return charted ? addCharts(written, book) : written;
}

function cellDisplay(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object" && cell && "formula" in cell) return String((cell as { result?: unknown }).result ?? "");
  return String(cell);
}

export function safeSheetName(name: string): string {
  return (name.replace(/[\\/?*[\]:]/g, " ").trim() || "Sheet").slice(0, 31);
}

/* ------------------------------------------------------------------ *
 * Native charts
 * ------------------------------------------------------------------ */

const colLetter = (index: number) => {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const xmlEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Where a chart's data lives on its sheet. A chart names its series by
 * column header; labels come from the first column. When a series name
 * is not a column header, the chart is not written (rather than
 * pointing it at the wrong cells).
 */
export function chartRanges(sheet: SheetSpec, chart: ChartSpec): { cat: string; series: Array<{ name: string; ref: string; nameRef: string; values: Array<number | null> }>; labels: string[] } | null {
  const n = sheet.rows.length;
  if (n === 0) return null;
  const quoted = `'${safeSheetName(sheet.name).replace(/'/g, "''")}'`;
  const series = chart.series.map((s) => {
    const col = sheet.columns.indexOf(s.name);
    if (col < 0) return null;
    // The cached values Excel stores with a chart: the cells' values (a formula's cached result).
    const values = sheet.rows.map((r) => {
      const c = r[col];
      const v = typeof c === "object" && c !== null ? (c as { result?: unknown }).result : c;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    });
    return { name: s.name, ref: `${quoted}!$${colLetter(col)}$2:$${colLetter(col)}$${n + 1}`, nameRef: `${quoted}!$${colLetter(col)}$1`, values };
  });
  if (series.some((s) => s === null) || series.length === 0) return null;
  const labels = sheet.rows.map((r) => {
    const c = r[0];
    return c === null || c === undefined ? "" : typeof c === "object" ? String((c as { result?: unknown }).result ?? "") : String(c);
  });
  return { cat: `${quoted}!$A$2:$A$${n + 1}`, series: series as Array<{ name: string; ref: string; nameRef: string; values: Array<number | null> }>, labels };
}

function chartXml(chart: ChartSpec, ranges: NonNullable<ReturnType<typeof chartRanges>>): string {
  const kind = chart.kind;
  const ser = ranges.series.map((s, i) => {
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    const sp = kind === "line"
      ? `<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>`
      : kind === "pie" || kind === "donut" ? "" : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;
    const points = kind === "pie" || kind === "donut"
      ? chart.labels.map((_, p) => `<c:dPt><c:idx val="${p}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${CHART_PALETTE[p % CHART_PALETTE.length]}"/></a:solidFill></c:spPr></c:dPt>`).join("")
      : "";
    const strCache = (items: string[]) => `<c:strCache><c:ptCount val="${items.length}"/>${items.map((t, p) => `<c:pt idx="${p}"><c:v>${xmlEsc(t)}</c:v></c:pt>`).join("")}</c:strCache>`;
    const numCache = (items: Array<number | null>) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${items.length}"/>${items.map((v, p) => (v === null ? "" : `<c:pt idx="${p}"><c:v>${v}</c:v></c:pt>`)).join("")}</c:numCache>`;
    const xs = ranges.labels.map((l) => (Number.isFinite(Number(l)) && l !== "" ? Number(l) : null));
    const data = kind === "scatter"
      ? `<c:xVal><c:numRef><c:f>${xmlEsc(ranges.cat)}</c:f>${numCache(xs)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${xmlEsc(s.ref)}</c:f>${numCache(s.values)}</c:numRef></c:yVal>`
      : `<c:cat><c:strRef><c:f>${xmlEsc(ranges.cat)}</c:f>${strCache(ranges.labels)}</c:strRef></c:cat><c:val><c:numRef><c:f>${xmlEsc(s.ref)}</c:f>${numCache(s.values)}</c:numRef></c:val>`;
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${xmlEsc(s.nameRef)}</c:f>${strCache([s.name])}</c:strRef></c:tx>${sp}${points}${kind === "scatter" ? `<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/></c:marker>` : ""}${data}${kind === "line" ? `<c:smooth val="0"/>` : ""}</c:ser>`;
  }).join("");
  const axes = `<c:axId val="111"/><c:axId val="222"/>`;
  const catAx = kind === "scatter"
    ? `<c:valAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222"/></c:valAx>`
    : `<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${kind === "bar" ? "l" : "b"}"/><c:crossAx val="222"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${kind === "bar" ? "b" : "l"}"/><c:majorGridlines/><c:crossAx val="111"/></c:valAx>`;
  const plot =
    kind === "pie" ? `<c:pieChart><c:varyColors val="1"/>${ser}</c:pieChart>`
    : kind === "donut" ? `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:holeSize val="55"/></c:doughnutChart>`
    : kind === "line" ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/>${axes}</c:lineChart>${catAx}${valAx}`
    : kind === "scatter" ? `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ser}${axes}</c:scatterChart>${catAx}${valAx}`
    : `<c:barChart><c:barDir val="${kind === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="80"/>${axes}</c:barChart>${catAx}${valAx}`;
  const title = chart.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${xmlEsc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : `<c:autoTitleDeleted val="1"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}

function anchorXml(index: number, chartRid: string, fromCol: number, fromRow: number): string {
  return `<xdr:twoCellAnchor><xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${fromCol + 8}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow + 16}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${chartRid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

async function addCharts(bytes: Uint8Array, book: WorkbookSpec): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  let types = await zip.file("[Content_Types].xml")!.async("string");
  let chartNo = 0;
  for (let s = 0; s < book.sheets.length; s += 1) {
    const sheet = book.sheets[s];
    const charts = (sheet.charts ?? []).map((c) => ({ chart: c, ranges: chartRanges(sheet, c) })).filter((c) => c.ranges);
    if (charts.length === 0) continue;
    const sheetPath = `xl/worksheets/sheet${s + 1}.xml`;
    const drawingNo = s + 1;
    const anchors: string[] = [];
    const drawingRels: string[] = [];
    charts.forEach(({ chart, ranges }, i) => {
      chartNo += 1;
      zip.file(`xl/charts/chart${chartNo}.xml`, chartXml(chart, ranges!));
      types = types.replace("</Types>", `<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
      drawingRels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/>`);
      anchors.push(anchorXml(i, `rId${i + 1}`, sheet.columns.length + 1, 1 + i * 18));
    });
    zip.file(`xl/drawings/drawing${drawingNo}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${drawingNo}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join("")}</Relationships>`);
    types = types.replace("</Types>", `<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);

    const relsPath = `xl/worksheets/_rels/sheet${s + 1}.xml.rels`;
    const existing = zip.file(relsPath) ? await zip.file(relsPath)!.async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const rid = "rIdLeluDrawing1";
    zip.file(relsPath, existing.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`));
    let xml = await zip.file(sheetPath)!.async("string");
    if (!/xmlns:r=/.test(xml.slice(0, 600))) xml = xml.replace("<worksheet ", `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `);
    // <drawing> belongs after pageMargins/pageSetup/headerFooter and before tableParts/extLst.
    const drawing = `<drawing r:id="${rid}"/>`;
    if (xml.includes("<tableParts")) xml = xml.replace("<tableParts", `${drawing}<tableParts`);
    else if (xml.includes("<extLst")) xml = xml.replace("<extLst", `${drawing}<extLst`);
    else xml = xml.replace("</worksheet>", `${drawing}</worksheet>`);
    zip.file(sheetPath, xml);
  }
  zip.file("[Content_Types].xml", types);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
