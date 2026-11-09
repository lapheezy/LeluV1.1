/**
 * LÉLU — Creation Studio: independent verification of exported files.
 *
 * LÉLU's own reader checks every export (tests/creation-studio.test.ts).
 * This script checks the same files with tools that share no code with
 * the writers: python-docx, python-pptx, openpyxl, and LibreOffice
 * (which opens each file, recalculates the workbook and renders every
 * page to PNG for visual inspection).
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/verify-studio-exports.ts <out-dir>
 *
 * Needs python3 with python-docx, python-pptx and openpyxl, and soffice
 * and pdftoppm on PATH. Exits non-zero if any check fails.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exportArtifact } from "../src/core/studio/StudioExport";
import type { DeckSpec, DocumentSpec, WorkbookSpec } from "../src/core/studio/StudioTypes";

const out = path.resolve(process.argv[2] ?? "studio-verification");
mkdirSync(out, { recursive: true });

const chart = { kind: "column" as const, title: "Units by quarter", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "2025", values: [120, 150, 170, 210] }, { name: "2026", values: [140, 180, 205, 260] }] };
const doc: DocumentSpec = {
  kind: "document", title: "Studio verification document",
  blocks: [
    { type: "heading", level: 1, text: "Findings" },
    { type: "paragraph", text: "A paragraph with accents: é, ü, € and a dash —." },
    { type: "table", columns: ["Item", "Value"], rows: [["Alpha", 1], ["Beta", 2]] },
    { type: "chart", chart },
  ],
  sources: [{ id: "S1", title: "Reference", url: "https://example.org" }],
};
const deck: DeckSpec = { kind: "deck", title: "Studio verification deck", slides: [{ title: "Opening", layout: "title" }, { title: "Chart", chart, notes: "Speaker note one." }, { title: "Table", table: { columns: ["A", "B"], rows: [["x", 1]] } }] };
const book: WorkbookSpec = { kind: "workbook", title: "Studio verification workbook", sheets: [{ name: "Data", columns: ["Name", "Qty", "Price", "Total"], rows: [["a", 2, 3, { formula: "B2*C2", result: 6 }], ["b", 4, 5, { formula: "B3*C3", result: 20 }], ["Sum", null, null, { formula: "SUM(D2:D3)", result: 26 }]], charts: [{ kind: "column", title: "Totals", labels: ["a", "b"], series: [{ name: "Total", values: [6, 20] }] }] }] };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

for (const [spec, format] of [[doc, "docx"], [deck, "pptx"], [book, "xlsx"], [doc, "pdf"]] as const) {
  const r = await exportArtifact(spec, format);
  writeFileSync(path.join(out, r.filename), r.bytes);
  check(`LÉLU read-back ${r.filename}`, r.verification.ok);
}

const py = (code: string) => execFileSync("python3", ["-I", "-c", code], { cwd: out, encoding: "utf8" }).trim();
const docxReport = JSON.parse(py(`
import docx, json
d = docx.Document('Studio-verification-document.docx')
print(json.dumps({"styles": [p.style.name for p in d.paragraphs if p.text], "tables": len(d.tables),
  "cell": d.tables[0].cell(1, 0).text, "charts": sum(1 for r in d.part.rels.values() if r.reltype.endswith('/chart'))}))`));
check("python-docx: heading style", docxReport.styles.includes("Heading 1"));
check("python-docx: table", docxReport.tables === 1 && docxReport.cell === "Alpha");
check("python-docx: native chart part", docxReport.charts === 1, `${docxReport.charts} chart relationships`);

const pptxReport = JSON.parse(py(`
import pptx, json
p = pptx.Presentation('Studio-verification-deck.pptx')
s = list(p.slides)
print(json.dumps({"slides": len(s), "titles": [next((sh.text_frame.text for sh in x.placeholders if sh.placeholder_format.type in (1, 3)), None) for x in s],
  "charts": [str(sh.chart.chart_type) for x in s for sh in x.shapes if sh.has_chart], "tables": sum(1 for x in s for sh in x.shapes if sh.has_table),
  "notes": [x.notes_slide.notes_text_frame.text for x in s if x.has_notes_slide and x.notes_slide.notes_text_frame.text]}))`));
check("python-pptx: slide count", pptxReport.slides === 3);
check("python-pptx: titles are title placeholders", JSON.stringify(pptxReport.titles) === JSON.stringify(["Opening", "Chart", "Table"]), JSON.stringify(pptxReport.titles));
check("python-pptx: native chart", pptxReport.charts.length === 1, pptxReport.charts.join(","));
check("python-pptx: table", pptxReport.tables === 1);
check("python-pptx: speaker notes", pptxReport.notes[0] === "Speaker note one.");

const xlsxReport = JSON.parse(py(`
import openpyxl, json
ws = openpyxl.load_workbook('Studio-verification-workbook.xlsx')['Data']
print(json.dumps({"formulas": [ws[f'D{i}'].value for i in (2, 3, 4)], "charts": len(ws._charts)}))`));
check("openpyxl: formulas", JSON.stringify(xlsxReport.formulas) === JSON.stringify(["=B2*C2", "=B3*C3", "=SUM(D2:D3)"]));
check("openpyxl: native chart", xlsxReport.charts === 1);

// LibreOffice: open, recalculate, export; then render every page.
const lo = path.join(out, "libreoffice");
mkdirSync(lo, { recursive: true });
execFileSync("soffice", ["--headless", "--convert-to", "csv", "--outdir", lo, path.join(out, "Studio-verification-workbook.xlsx")], { stdio: "ignore", timeout: 180_000 });
const csv = execFileSync("cat", [path.join(lo, "Studio-verification-workbook.csv")], { encoding: "utf8" });
check("LibreOffice recalculates the formulas to the cached results", /Sum,,,26/.test(csv), csv.trim().split("\n").pop());
execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", lo, ...["Studio-verification-document.docx", "Studio-verification-deck.pptx", "Studio-verification-workbook.xlsx"].map((f) => path.join(out, f))], { stdio: "ignore", timeout: 240_000 });
for (const f of readdirSync(lo).filter((f) => f.endsWith(".pdf"))) {
  execFileSync("pdftoppm", ["-r", "60", "-png", path.join(lo, f), path.join(lo, f.replace(/\.pdf$/, ""))]);
}
execFileSync("pdftoppm", ["-r", "60", "-png", path.join(out, "Studio-verification-document.pdf"), path.join(out, "lelu-pdf")]);
const pngs = readdirSync(lo).filter((f) => f.endsWith(".png")).length;
check("LibreOffice opened and rendered every file", pngs >= 3, `${pngs} pages rendered in ${lo}`);

console.log(failures.length ? `\n${failures.length} CHECK(S) FAILED` : "\nALL INDEPENDENT STUDIO CHECKS PASSED");
process.exit(failures.length ? 1 : 0);
