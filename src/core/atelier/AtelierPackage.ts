/**
 * ==========================================================
 * LÉLU — ATELIER → CREATION STUDIO
 *
 * The production documents for a design are Creation Studio
 * artifacts made from the same components the drawings and
 * models are made from:
 *
 *   BOM workbook     one row per component ID, real formulas for
 *                    line cost and totals, mass, cost basis
 *   dossier document brief, inspected inputs, architecture, BOM,
 *                    assembly steps, QC plan, evidence level,
 *                    limitations, required validation, safety
 *                    review, sources (inaccessible ones listed)
 *   review deck      the directions side by side, then the chosen one
 *
 * Unknown costs stay unknown: the workbook leaves the cell empty
 * and the total says how many parts it excludes.
 * ==========================================================
 */

import type { DeckSpec, DocumentSpec, WorkbookSpec } from "../studio/StudioTypes";
import { assemblyOrder, billOfMaterials } from "./AtelierGeometry";
import { workflowSteps } from "./AtelierFiles";
import { assess } from "./AtelierStore";
import type { AtelierProject, DesignDirection } from "./AtelierTypes";

export function bomWorkbook(p: AtelierProject, d: DesignDirection, version: number): WorkbookSpec {
  const bom = billOfMaterials(d, p.materials);
  const n = bom.rows.length;
  const rows = bom.rows.map((r, i) => {
    const row = i + 2;
    return [r.id, r.name, r.material, r.size, r.quantity, r.unitCost, r.unitCost === null ? null : { formula: `E${row}*F${row}`, result: r.lineCost ?? undefined }, r.mass, r.make, r.supplier, r.sources, r.costBasis] as WorkbookSpec["sheets"][number]["rows"][number];
  });
  rows.push(["TOTAL", `${bom.uncosted.length ? `excludes ${bom.uncosted.length} uncosted part(s): ${bom.uncosted.join(", ")}` : "all parts costed"}`, null, null, { formula: `SUM(E2:E${n + 1})`, result: bom.rows.reduce((s, r) => s + r.quantity, 0) }, null, { formula: `SUM(G2:G${n + 1})`, result: bom.totalCost }, { formula: `SUM(H2:H${n + 1})`, result: bom.totalMass }, null, null, null, null]);
  const costed = bom.rows.filter((r) => r.lineCost !== null);
  return {
    kind: "workbook",
    title: `${p.title} — ${d.name} BOM v${version}`,
    sheets: [
      {
        name: "BOM",
        columns: ["ID", "Part", "Material", "Size", "Qty", `Unit cost (${p.currency})`, `Line cost (${p.currency})`, "Mass (g)", "Make/Buy", "Supplier", "Sources", "Cost basis"],
        rows,
        charts: costed.length >= 2 ? [{ kind: "bar", title: `Line cost (${p.currency})`, labels: costed.map((r) => r.id), series: [{ name: `Line cost (${p.currency})`, values: costed.map((r) => r.lineCost ?? 0) }] }] : undefined,
      },
      {
        name: "Sources",
        columns: ["ID", "Title", "Kind", "URL", "Supports", "Status"],
        rows: p.sources.map((s) => [s.id, s.title, s.kind ?? "", s.url ?? "", s.supports ?? "", s.inaccessible ? "could not be accessed" : "used"]),
      },
    ],
  };
}

export function dossierDocument(p: AtelierProject, d: DesignDirection, version: number): DocumentSpec {
  const a = assess(p, d);
  const bom = a.bom;
  const steps = workflowSteps(d);
  const blocks: DocumentSpec["blocks"] = [
    { type: "heading", level: 1, text: "Status" },
    { type: "paragraph", text: `Evidence level: ${a.level}. ${a.why.join("; ")}. Nothing in this dossier has been simulated, independently reviewed or physically tested unless a section says so with a source.` },
  ];
  if (a.safety.length) {
    blocks.push({ type: "heading", level: 2, text: "Qualified review required before building" });
    blocks.push({ type: "bullets", items: a.safety.map((x) => `${x.domain}: ${x.reviewer}`) });
  }
  blocks.push({ type: "heading", level: 1, text: "Brief" }, { type: "paragraph", text: p.brief || "(no brief recorded)" });
  if (p.inputs.length) {
    blocks.push({ type: "heading", level: 2, text: "Supplied material" });
    blocks.push({ type: "table", columns: ["ID", "Kind", "Name", "Inspected", "Findings"], rows: p.inputs.map((x) => [x.id, x.kind, x.name, x.inspected ? `yes (${x.method})` : "NO — not inspected", x.findings || "—"]) });
  }
  blocks.push(
    { type: "heading", level: 1, text: `Design direction ${d.id}: ${d.name}` },
    { type: "paragraph", text: d.identity || d.name },
    { type: "heading", level: 2, text: "Concept" }, { type: "paragraph", text: d.concept || "—" },
    { type: "heading", level: 2, text: "Function" }, { type: "paragraph", text: d.function || "—" },
    { type: "heading", level: 2, text: "Technical architecture" }, { type: "paragraph", text: d.architecture },
    { type: "heading", level: 1, text: "Bill of materials" },
    { type: "table", columns: ["ID", "Part", "Material", "Size", "Qty", `Line cost (${p.currency})`, "Mass (g)", "Basis"], rows: bom.rows.map((r) => [r.id, r.name, r.material, r.size, r.quantity, r.lineCost ?? "unknown", r.mass ?? "unknown", r.costBasis]) },
    { type: "paragraph", text: `Calculated total: ${bom.totalCost} ${p.currency}${bom.uncosted.length ? ` for the costed parts only — ${bom.uncosted.length} part(s) have no known cost (${bom.uncosted.join(", ")})` : ""}; mass ${bom.totalMass} g${bom.unweighed.length ? ` excluding ${bom.unweighed.join(", ")} (material density unknown)` : ""}.` },
  );
  const costed = bom.rows.filter((r) => r.lineCost !== null);
  if (costed.length >= 2) blocks.push({ type: "chart", chart: { kind: "bar", title: `Cost by component (${p.currency})`, labels: costed.map((r) => r.id), series: [{ name: "Line cost", values: costed.map((r) => r.lineCost ?? 0) }] } });
  blocks.push(
    { type: "heading", level: 1, text: "Dimensions and tolerances" },
    { type: "table", columns: ["ID", "Shape", "Size (mm)", "Position x/y/z (mm)", "Tolerance (± mm)", "Notes"], rows: d.components.map((c) => [c.id, c.shape, `${c.size.width} × ${c.size.depth} × ${c.size.height}`, `${c.position.x} / ${c.position.y} / ${c.position.z}`, c.tolerance ?? "not specified", c.notes ?? ""]) },
    { type: "heading", level: 1, text: "Fabrication and assembly" },
    { type: "bullets", ordered: true, items: steps.map((s) => `${s.title} (${s.components.join(", ")})`) },
    { type: "heading", level: 1, text: "Quality control plan" },
    { type: "bullets", items: [
      ...assemblyOrder(d.components).map((c) => `${c.id} ${c.name}: check size ${c.size.width}×${c.size.depth}×${c.size.height} mm${c.tolerance ? ` within ±${c.tolerance} mm` : " (tolerance to be specified)"} and material ${c.material}`),
      a.interferences.length ? `Resolve interferences before build: ${a.interferences.map((x) => `${x.a}/${x.b} (${x.overlap} mm³${x.exact ? "" : ", bounding-box"})`).join("; ")}` : "Interference check (bounding boxes): no overlapping parts",
    ] },
    { type: "heading", level: 1, text: "Limitations" },
    { type: "bullets", items: d.limitations.length ? d.limitations : ["None recorded — this is itself a gap to review."] },
    { type: "heading", level: 1, text: "Validation still required" },
    { type: "bullets", items: d.validationRequired.length ? d.validationRequired : ["Define the tests that would show the design meets the brief."] },
  );
  if (d.claims.length) {
    blocks.push({ type: "heading", level: 1, text: "Claims and their evidence" });
    blocks.push({ type: "table", columns: ["Claim", "Level", "Sources"], rows: d.claims.map((c) => [c.text, c.level, (c.sources ?? []).join(", ") || "none"]) });
  }
  if (a.unsupportedClaims.length) blocks.push({ type: "paragraph", text: `Claims citing a source the project does not hold or could not access: ${a.unsupportedClaims.join("; ")}.` });
  const inaccessible = p.sources.filter((s) => s.inaccessible);
  if (inaccessible.length) blocks.push({ type: "paragraph", text: `Sources that could not be accessed: ${inaccessible.map((s) => `[${s.id}] ${s.title}`).join("; ")}.` });
  return {
    kind: "document",
    title: `${p.title} — ${d.name} production dossier v${version}`,
    subtitle: `Design direction ${d.id} · evidence level ${a.level}`,
    author: "LÉLU Atelier",
    blocks,
    sources: p.sources.filter((s) => !s.inaccessible).map((s) => ({ id: s.id, title: s.title, url: s.url, accessed: s.accessed })),
  };
}

export function reviewDeck(p: AtelierProject, directions: DesignDirection[], selected: string | undefined, version: number): DeckSpec {
  const assessed = directions.map((d) => ({ d, a: assess(p, d) }));
  const costed = assessed.filter((x) => x.a.bom.uncosted.length < x.d.components.length);
  const slides: DeckSpec["slides"] = [
    { title: p.title, subtitle: `Design review · v${version}`, layout: "title" },
    { title: "Brief", bullets: [p.brief.slice(0, 300) || "—", `${p.inputs.filter((i) => i.inspected).length} of ${p.inputs.length} supplied inputs inspected`, `${p.sources.filter((s) => !s.inaccessible).length} sources used`] },
    {
      title: "Directions compared",
      table: {
        columns: ["", ...directions.map((d) => `${d.id} ${d.name}`)],
        rows: [
          ["Architecture", ...directions.map((d) => d.architecture.slice(0, 90))],
          ["Parts", ...assessed.map((x) => x.d.components.length)],
          [`Cost (${p.currency})`, ...assessed.map((x) => `${x.a.bom.totalCost}${x.a.bom.uncosted.length ? ` + ${x.a.bom.uncosted.length} unknown` : ""}`)],
          ["Mass (g)", ...assessed.map((x) => x.a.bom.totalMass)],
          ["Complexity", ...directions.map((d) => `${d.complexity.score}/5`)],
          ["Evidence", ...assessed.map((x) => x.a.level)],
        ],
      },
    },
  ];
  if (costed.length >= 2) slides.push({ title: "Cost and mass", chart: { kind: "column", title: `Calculated cost (${p.currency})`, labels: costed.map((x) => x.d.id), series: [{ name: "Cost", values: costed.map((x) => x.a.bom.totalCost) }] }, notes: "Costs exclude parts with no known price; see each BOM." });
  for (const { d, a } of assessed) {
    slides.push({ title: `${d.id} · ${d.name}`, subtitle: d.identity, bullets: [d.architecture.slice(0, 160), `Function: ${d.function.slice(0, 140)}`, `Limitations: ${d.limitations.slice(0, 2).join("; ") || "none recorded"}`, `Evidence: ${a.level}`], notes: `Validation required: ${d.validationRequired.join("; ") || "to define"}${a.safety.length ? `. Needs qualified review: ${a.safety.map((x) => x.domain).join(", ")}` : ""}` });
  }
  if (selected) {
    const s = assessed.find((x) => x.d.id === selected);
    if (s) slides.push({ title: `Selected: ${s.d.id} ${s.d.name}`, bullets: [`${s.d.components.length} parts · ${s.a.bom.totalCost} ${p.currency}${s.a.bom.uncosted.length ? " (partial)" : ""} · ${s.a.bom.totalMass} g`, s.a.interferences.length ? `${s.a.interferences.length} interference(s) to resolve` : "No interferences (bounding boxes)", s.a.safety.length ? `Qualified review: ${s.a.safety.map((x) => x.domain).join(", ")}` : "No regulated domain detected in the brief or parts"] });
  }
  return { kind: "deck", title: `${p.title} — design review v${version}`, slides, sources: p.sources.filter((x) => !x.inaccessible).map((x) => ({ id: x.id, title: x.title, url: x.url })) };
}
