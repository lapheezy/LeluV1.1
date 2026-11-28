/**
 * The LÉLU outfit from measurements to sewing: real trouser, bomber and
 * bralette drafts (the bodice engine returned bodice pieces for trousers),
 * true-scale sheets, cutting layouts, fabric, materials, sewing order and
 * the couture tool's tech-pack action.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MEASUREMENTS, edgeLength } from "../src/core/couture/pattern";
import { crossoverBralette, GARMENTS, gradeMeasurements, oversizedBomber, wideCargoTrousers } from "../src/core/couture/fashionBlocks";
import { billOfMaterials, cuttingLayout, patternSheetSvg, sewingOrder, techPack, techPackMarkdown } from "../src/core/couture/sewing";

test("trousers are trousers: legs with crotch extensions, an inseam, and the stacked-hem length", () => {
  const t = wideCargoTrousers();
  const front = t.pieces.find((p) => p.id === "trouser-front")!;
  const back = t.pieces.find((p) => p.id === "trouser-back")!;
  assert.ok(!t.pieces.some((p) => /BODICE/.test(p.label)));
  assert.ok(edgeLength(front, "inseam") > 600 && edgeLength(back, "inseam") > 600);
  assert.ok(edgeLength(back, "crotch") > edgeLength(front, "crotch"), "back crotch is longer than front");
  const len = Math.max(...front.outline.map((p) => -p.y));
  assert.equal(len, t.derived.outsideLeg + 180, "outside leg plus 180 mm stacking");
  assert.ok(t.checks.every((c) => c.ok), t.checks.filter((c) => !c.ok).map((c) => c.detail).join("; "));
});

test("side and inseam lengths match between front and back (they sew together)", () => {
  const t = wideCargoTrousers();
  const [f, b] = ["trouser-front", "trouser-back"].map((id) => t.pieces.find((p) => p.id === id)!);
  assert.ok(Math.abs(edgeLength(f, "side") - edgeLength(b, "side")) <= 6);
  const bomber = oversizedBomber();
  const [bf, bb] = ["bomber-front", "bomber-back"].map((id) => bomber.pieces.find((p) => p.id === id)!);
  assert.ok(Math.abs(edgeLength(bf, "side") - edgeLength(bb, "side")) <= 6);
});

test("the bomber has zip fronts, a back on the fold, sleeves, rib trims and a lining", () => {
  const b = oversizedBomber();
  const by = (id: string) => b.pieces.find((p) => p.id === id)!;
  assert.equal(by("bomber-front").cut, 2);
  assert.equal(by("bomber-back").onFold, true);
  for (const id of ["bomber-sleeve", "rib-cuff", "rib-hem", "rib-collar", "bomber-front-lining", "bomber-back-lining", "bomber-sleeve-lining"]) assert.ok(by(id), id);
  assert.deepEqual([...new Set(b.pieces.map((p) => p.fabric))].sort(), ["lining", "rib", "shell"]);
});

test("measurements and sizes change the drafts", () => {
  const s = wideCargoTrousers(gradeMeasurements(DEFAULT_MEASUREMENTS, "S"));
  const xl = wideCargoTrousers(gradeMeasurements(DEFAULT_MEASUREMENTS, "XL"));
  const w = (t: typeof s) => t.pieces.find((p) => p.id === "trouser-front")!.areaMm2;
  assert.ok(w(xl) > w(s));
  const tall = crossoverBralette({ ...DEFAULT_MEASUREMENTS, bust: 1000 });
  assert.ok(tall.derived.cupHeight > crossoverBralette().derived.cupHeight);
});

test("true-scale sheet: sized in millimetres with a 100 mm test square", () => {
  const { svg, widthMm, heightMm } = patternSheetSvg(wideCargoTrousers());
  assert.match(svg, new RegExp(`width="${widthMm}mm"`));
  assert.ok(heightMm > 1200, "a full trouser leg fits at 1:1");
  assert.match(svg, /<rect x="\d+" y="\d+" width="100" height="100"/);
  assert.match(svg, /PLACE ON FOLD|stitch line/);
});

test("cutting layout: every cut is placed inside the fabric width, without overlaps", () => {
  const pats = Object.values(GARMENTS).map((f) => f(DEFAULT_MEASUREMENTS, {}));
  const layouts = cuttingLayout(pats);
  for (const l of layouts) {
    for (const p of l.placements) assert.ok(p.x >= 0 && p.x + p.w <= l.widthMm, `${p.label} inside ${l.fabric}`);
    for (let i = 0; i < l.placements.length; i++)
      for (let j = i + 1; j < l.placements.length; j++) {
        const a = l.placements[i], b = l.placements[j];
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.label} overlaps ${b.label}`);
      }
  }
  const expected = pats.reduce((n, p) => n + p.pieces.reduce((k, pc) => k + pc.cut, 0), 0);
  assert.equal(layouts.reduce((n, l) => n + l.placements.length, 0), expected, "every cut piece is placed once");
  const bom = billOfMaterials(pats, layouts);
  assert.ok(bom.some((b) => /Separating zip/.test(b.item)) && bom.some((b) => /Drawstring/.test(b.item)) && bom.some((b) => /elastic/i.test(b.item)));
});

test("sewing order names the pieces and finishes; the tech pack is complete", () => {
  const pats = Object.values(GARMENTS).map((f) => f(DEFAULT_MEASUREMENTS, {}));
  for (const p of pats) assert.ok(sewingOrder(p).length >= 6, p.garment);
  const tp = techPack(pats, { reference: "owner:U-09" });
  assert.equal(tp.checks.failed.length, 0, tp.checks.failed.join("; "));
  const md = techPackMarkdown(tp);
  for (const s of ["Body measurements", "Sewing order", "Cutting", "Bill of materials", "owner:U-09"]) assert.ok(md.includes(s), s);
});
