/**
 * ==========================================================
 * LÉLU — CREATION STUDIO: REAL FILES, READ BACK
 *
 * CATEGORY: integration. The real writers (docx, pptxgenjs,
 * exceljs, pdf-lib, the text writers), the real reader and the
 * real store. Every export is re-opened from its bytes; the
 * assertions are about what is IN the file. Independent checks
 * (LibreOffice, python-docx/pptx, openpyxl) are in
 * scripts/verify-studio-exports.ts.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { exportArtifact } from "../src/core/studio/StudioExport";
import { applyOps, normalizeSpec } from "../src/core/studio/StudioOps";
import { readArtifact, resolvePart } from "../src/core/studio/StudioReader";
import StudioStore from "../src/core/studio/StudioStore";
import { FORMATS_BY_KIND, type DeckSpec, type DocumentSpec, type WorkbookSpec } from "../src/core/studio/StudioTypes";

const chart = { kind: "column" as const, title: "Units by quarter", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "2025", values: [120, 150, 170, 210] }, { name: "2026", values: [140, 180, 205, 260] }] };

const doc: DocumentSpec = {
  kind: "document", title: "Solar Lantern — Research Brief", subtitle: "Comparable products", author: "LÉLU",
  blocks: [
    { type: "heading", level: 1, text: "Summary" },
    { type: "paragraph", text: "Battery capacity ranges from 2000 to 5200 mAh; prices from €18 to €64 → see table." },
    { type: "bullets", items: ["LiFePO4 tolerates more cycles", "IP65 is common"] },
    { type: "bullets", ordered: true, items: ["Select the cell", "Size the panel"] },
    { type: "table", columns: ["Product", "Price (€)"], rows: [["Lumo A", 18], ["Brite X", 64]] },
    { type: "chart", chart },
    { type: "chart", chart: { kind: "pie", title: "Cost split", labels: ["Cell", "Panel"], series: [{ name: "Cost", values: [60, 40] }] } },
  ],
  sources: [{ id: "S1", title: "Cell datasheet", url: "https://example.org/cell.pdf" }],
};
const deck: DeckSpec = {
  kind: "deck", title: "Lantern Review",
  slides: [
    { title: "Lantern", subtitle: "Concept review", layout: "title" },
    { title: "Why now", bullets: ["Demand rising", "Cells cheaper"], notes: "Mention the 2026 price drop." },
    { title: "Shipments", chart, notes: "Q4 is seasonal." },
    { title: "Comparison", table: { columns: ["Product", "Price"], rows: [["Lumo A", 18]] } },
  ],
};
const book: WorkbookSpec = {
  kind: "workbook", title: "Cost model",
  sheets: [{
    name: "BOM", columns: ["Part", "Qty", "Unit", "Line"],
    rows: [["Cell", 1, 4.2, { formula: "B2*C2", result: 4.2 }], ["LED", 6, 0.12, { formula: "B3*C3", result: 0.72 }], ["Total", null, null, { formula: "SUM(D2:D3)", result: 4.92 }]],
    charts: [{ kind: "bar", title: "Line cost", labels: ["Cell", "LED"], series: [{ name: "Line", values: [4.2, 0.72] }] }],
  }],
};

for (const spec of [doc, deck, book]) {
  for (const format of FORMATS_BY_KIND[spec.kind]) {
    test(`${spec.kind} → ${format}: written, re-opened from its bytes, every check passes`, async () => {
      const r = await exportArtifact(spec, format);
      assert.ok(r.size > 0);
      assert.match(r.sha256, /^[0-9a-f]{64}$/);
      const failed = r.verification.checks.filter((c) => !c.ok);
      assert.deepEqual(failed, [], JSON.stringify(failed));
    });
  }
}

test("DOCX: native charts, real heading styles, the table and numbered lists that restart", async () => {
  const r = await exportArtifact(doc, "docx");
  const read = await readArtifact(r.bytes, "docx");
  assert.deepEqual(read.structure.chartKinds, ["column", "pie"]);
  assert.equal(read.structure.tables, 1);
  assert.deepEqual(read.structure.headings, ["Summary", "Sources"]);
  assert.deepEqual(read.spec!.kind === "document" ? read.spec!.sources : null, [{ id: "S1", title: "Cell datasheet", url: "https://example.org/cell.pdf", accessed: undefined }], "the source list reopens as sources");
  const lists = read.spec!.kind === "document" ? read.spec!.blocks.filter((b) => b.type === "bullets") : [];
  assert.deepEqual(lists.map((l) => (l.type === "bullets" ? l.ordered : null)), [false, true], "bullets, then the ordered list (the source list became sources)");
});

test("PPTX: slide count and order, native chart, table and speaker notes", async () => {
  const read = await readArtifact((await exportArtifact(deck, "pptx")).bytes, "pptx");
  assert.equal(read.structure.slides, 4);
  assert.deepEqual(read.spec!.kind === "deck" ? read.spec!.slides.map((s) => s.title) : [], ["Lantern", "Why now", "Shipments", "Comparison"]);
  assert.deepEqual(read.structure.chartKinds, ["column"]);
  assert.equal(read.structure.tables, 1);
  assert.deepEqual(read.structure.notes, ["Mention the 2026 price drop.", "Q4 is seasonal."]);
});

test("XLSX: formulas with cached results, and a native chart pointing at the sheet's own cells", async () => {
  const r = await exportArtifact(book, "xlsx");
  const read = await readArtifact(r.bytes, "xlsx");
  assert.deepEqual(read.structure.formulas, ["B2*C2", "B3*C3", "SUM(D2:D3)"]);
  assert.deepEqual(read.structure.chartKinds, ["bar"]);
  const { default: JSZip } = await import("jszip");
  const chartXml = await (await JSZip.loadAsync(r.bytes)).file("xl/charts/chart1.xml")!.async("string");
  assert.match(chartXml, /'BOM'!\$D\$2:\$D\$4/, "the chart reads the Line column of the sheet");
});

test("PDF: text is really in the content streams; characters the standard fonts lack are reported, not hidden", async () => {
  const r = await exportArtifact({ ...doc, blocks: [...doc.blocks, { type: "paragraph", text: "Status ✓ done 日本" }] }, "pdf");
  assert.equal(r.verification.ok, true, JSON.stringify(r.verification.checks));
  assert.ok(r.verification.replacedChars.includes("日"), "unsupported characters are listed");
  const read = await readArtifact(r.bytes, "pdf");
  assert.ok(read.text.includes("Solar Lantern"));
  assert.ok(read.text.includes("->"), "→ is spelled as ->, as the writer promises");
});

test("the verifier fails a file that does not contain what the spec promised", async () => {
  const r = await exportArtifact(doc, "md");
  const tampered = new TextEncoder().encode(new TextDecoder().decode(r.bytes).replace("Select the cell", ""));
  const { verifyRead } = await import("../src/core/studio/StudioExport");
  const v = verifyRead(doc, "md", await readArtifact(tampered, "md"));
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ["Select the cell"]);
  const broken = await readArtifact(new Uint8Array([1, 2, 3]), "docx");
  assert.equal(broken.ok, false);
  assert.equal(verifyRead(doc, "docx", broken).checks[0].name, "opens");
});

test("a spec is checked, never filled in: precise reasons for what is wrong", () => {
  assert.deepEqual(normalizeSpec({ kind: "deck", title: "x", slides: [] }), { ok: false, reason: "a presentation needs at least one slide" });
  const bad = normalizeSpec({ kind: "document", title: "x", blocks: [{ type: "chart", chart: { kind: "line", labels: ["a"], series: [{ name: "s", values: ["n/a"] }] } }] });
  assert.equal(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /series 1 value 1 \(.n\/a.\) is not a number/);
  assert.equal(normalizeSpec({ kind: "document", title: "x", blocks: [{ type: "image", dataUrl: "https://x/y.png" }] }).ok, false, "only images LÉLU actually holds");
  assert.equal(normalizeSpec({ kind: "workbook", title: "x", sheets: [{ name: "A", columns: ["a"] }, { name: "a", columns: ["b"] }] }).ok, false, "duplicate sheet names");
});

test("a blank corner header is a column: no row loses its last value", async () => {
  const n = normalizeSpec({ kind: "deck", title: "x", slides: [{ title: "Compare", table: { columns: ["", "A", "B"], rows: [["cost", 1, 2]] } }] });
  assert.ok(n.ok);
  const r = await exportArtifact(n.ok ? n.spec : deck, "pptx");
  assert.equal(r.verification.ok, true, JSON.stringify(r.verification.missing));
  const read = await readArtifact(r.bytes, "pptx");
  assert.deepEqual(read.spec!.kind === "deck" ? read.spec!.slides[0].table?.rows : null, [["cost", "1", "2"]]);
});

test("revisions as operations: chart kind change, slide move, cell formula — the old spec is untouched", () => {
  const r1 = applyOps(doc, [{ op: "updateChart", index: 1, chart: { kind: "line" } }]);
  assert.ok(r1.ok);
  assert.equal(r1.ok && r1.spec.kind === "document" && r1.spec.blocks[5].type === "chart" ? r1.spec.blocks[5].chart.kind : "", "line");
  assert.equal(doc.blocks[5].type === "chart" ? doc.blocks[5].chart.kind : "", "column", "the original is not mutated");
  const r2 = applyOps(deck, [{ op: "moveSlide", from: 3, to: 2 }]);
  assert.deepEqual(r2.ok && r2.spec.kind === "deck" ? r2.spec.slides.map((s) => s.title) : [], ["Lantern", "Shipments", "Why now", "Comparison"]);
  const r3 = applyOps(book, [{ op: "setCell", sheet: "BOM", ref: "C3", value: 0.15 }, { op: "setCell", sheet: "BOM", ref: "E2", value: "=D2*1.2" }]);
  assert.ok(r3.ok);
  const out = applyOps(deck, [{ op: "removeSlide", index: 9 }]);
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /slide 9 does not exist .*Nothing was changed/);
});

test("the store: revisions are kept, restore adds a copy, compare names the change, exports are recorded and re-open", async () => {
  const store = StudioStore.createIsolated();
  const created = store.create(deck, { conversationId: "c1" });
  assert.ok(created.ok);
  const id = created.artifact.id;
  const revised = store.revise(id, { ops: [{ op: "updateSlide", index: 2, slide: { bullets: ["Demand rising", "Cells cheaper", "Policy support"] } }] });
  assert.ok(revised.ok);
  assert.equal(revised.revision.rev, 2);
  assert.equal(store.get(id)!.revisions.length, 2, "revision 1 is still there");
  const diff = store.compare(id, 1, 2);
  assert.ok(diff.ok && diff.changes.some((c) => c.startsWith("+ slide 2: Why now") && c.includes("Policy support")));
  const restored = store.restore(id, 1);
  assert.ok(restored.ok);
  assert.equal(store.get(id)!.revisions.length, 3, "restoring adds a revision instead of erasing one");

  const exported = await store.export(id, "pptx", 2);
  assert.ok(exported.ok && exported.record.ok);
  const reopened = await store.reopen(id, 2, "pptx");
  assert.ok(reopened?.text.includes("Policy support"));
  assert.equal(store.resolve("this", "c1")?.id, id, "“this” in the chat means the artifact made there");
  assert.equal(store.resolve("lantern")?.id, id);
  assert.equal(store.remove(id, false).ok, false, "deleting needs confirmation");
});

test("importing a file keeps its original bytes and makes it editable", async () => {
  const store = StudioStore.createIsolated();
  const bytes = (await exportArtifact(book, "xlsx")).bytes;
  const imported = await store.importFile("costs.xlsx", bytes);
  assert.ok(imported.ok, imported.ok ? "" : imported.reason);
  assert.deepEqual(store.original(imported.artifact.id), bytes);
  assert.equal(imported.artifact.original?.size, bytes.length);
  const revised = store.revise(imported.artifact.id, { ops: [{ op: "setCell", sheet: "BOM", ref: "B3", value: 8 }] });
  assert.ok(revised.ok, revised.ok ? "" : revised.reason);
  assert.equal((await store.importFile("notes.exe", bytes)).ok, false);
});

test("relationship targets resolve whether absolute or relative", () => {
  assert.equal(resolvePart("ppt/slides/slide4.xml", "/ppt/charts/chart1.xml"), "ppt/charts/chart1.xml");
  assert.equal(resolvePart("ppt/slides/slide4.xml", "../charts/chart1.xml"), "ppt/charts/chart1.xml");
  assert.equal(resolvePart("word/document.xml", "charts/chart1.xml"), "word/charts/chart1.xml");
});
