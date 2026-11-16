/**
 * Mission 15.1 — every one of the sixty Home concepts is a working layout;
 * layouts can be blended, merged, saved and made from scratch; looks
 * (themes, fonts, elemental borders) are data that survive a reload.
 * The browser script (scripts/home/verify-concepts.mjs) proves the same
 * through the real UI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ABSOLUTE_KINDS,
  COLUMNS,
  DEVICE_CLASSES,
  HOME_MODULES,
  TEMPLATES,
  applyHomeOp,
  layoutFromPresentation,
  presentationFromLayout,
  readLayout,
  readPresentation,
  solveHome,
  timeKind,
  timeOrder,
  usageOrder,
  type GridCell,
  type HomeTemplate,
} from "../src/app/scene/genesis/home/homeComposition";
import { CONCEPTS, conceptFor, researchPrompt, searchConcepts, suggestConcept } from "../src/app/scene/genesis/home/homeConcepts";
import { CONCEPT_NOTES } from "../src/app/scene/genesis/home/homeConceptNotes";
import { blendLayouts, mergeLayouts } from "../src/app/scene/genesis/home/homeBlend";
import { BORDER_EFFECTS, FONTS, THEMES, blendStyles, contrast, generativeTheme, mixColor, readStyle, resolveStyle, withTheme, DEFAULT_STYLE } from "../src/app/scene/genesis/home/homeStyle";

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const overlaps = (a: GridCell, b: GridCell) => a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;

test("there are sixty concepts, numbered 1–60, with the catalog's counted statuses", () => {
  assert.equal(CONCEPTS.length, 60);
  assert.deepEqual(CONCEPTS.map((c) => c.n), Array.from({ length: 60 }, (_, i) => i + 1));
  assert.equal(new Set(CONCEPTS.map((c) => c.id)).size, 60);
  const count = (s: string) => CONCEPT_NOTES.filter((n) => n.catalogStatus === s).length;
  assert.deepEqual([count("BUILT"), count("SUPPORTED"), count("PROPOSED"), count("REJECT"), count("BLOCKED")], [11, 21, 15, 12, 1]);
  for (const c of CONCEPTS) {
    assert.ok(c.notes.composition && c.notes.strengths && c.notes.refs, `#${c.n} has research notes`);
    assert.ok(c.layout.blurb, `#${c.n} has a one-line description`);
  }
});

test("every concept solves on phone, tablet and desktop with every module accounted for and nothing overlapping", () => {
  for (const c of CONCEPTS) {
    const p = presentationFromLayout(c.layout, undefined, 0);
    for (const device of DEVICE_CLASSES) {
      const solved = solveHome(p, device);
      const where = `#${c.n} ${c.notes.name}/${device} (${solved.kind})`;
      const shown = new Set<string>([...solved.placed.flatMap((m) => m.members), ...solved.floating.map((m) => m.id), ...solved.docked, ...solved.hidden]);
      assert.deepEqual([...shown].sort(), [...HOME_MODULES].sort(), `${where}: every module placed, floating, docked or hidden`);
      assert.ok(solved.placed.length > 0, `${where}: something is on the Home`);
      if (ABSOLUTE_KINDS.has(solved.kind)) {
        for (const m of solved.placed) {
          const r = m.rect!;
          assert.ok(r && r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, `${where}: ${m.id} inside the canvas`);
        }
      } else if (solved.kind !== "deck" && solved.kind !== "rows") {
        const cells = solved.placed.map((m) => m.cell!).filter(Boolean);
        for (const cell of cells) assert.ok(cell.col >= 1 && cell.col + cell.w - 1 <= solved.columns, `${where}: ${cell.id} inside ${solved.columns} columns`);
        for (let i = 0; i < cells.length; i += 1) for (let j = i + 1; j < cells.length; j += 1) assert.ok(!overlaps(cells[i], cells[j]), `${where}: ${cells[i].id} and ${cells[j].id} overlap`);
      }
    }
  }
});

test("the sixty layouts are sixty different layouts", () => {
  const signature = (l: HomeTemplate) => JSON.stringify([l.kind, l.order, l.sizes, l.params, l.deviceParams, l.style, l.groups, l.docked, l.pinned, l.collapsed, l.floats, l.device]);
  const seen = new Map<string, number>();
  for (const c of CONCEPTS) {
    const sig = signature(c.layout);
    assert.ok(!seen.has(sig), `#${c.n} has the same layout as #${seen.get(sig)}`);
    seen.set(sig, c.n);
  }
});

test("eleven concepts are the built-in compositions; the other forty-nine carry their own recipe and survive a reload", () => {
  const builtins = CONCEPTS.filter((c) => c.source === "built-in");
  assert.equal(builtins.length, 11);
  for (const c of builtins) assert.ok(TEMPLATES.some((t) => t.id === c.layout.id));
  for (const c of CONCEPTS.filter((x) => x.source === "recipe")) {
    const p = presentationFromLayout(c.layout, undefined, 0);
    assert.ok(p.recipe, `#${c.n} keeps its recipe on the presentation`);
    const back = readPresentation(JSON.parse(JSON.stringify(p)))!;
    for (const d of DEVICE_CLASSES) assert.deepEqual(plain(solveHome(back, d)), plain(solveHome(p, d)), `#${c.n}/${d} solves identically after a reload`);
    if (c.layout.style) assert.deepEqual(back.style, p.style, `#${c.n} keeps its look`);
  }
});

test("the optional Ask module stays hidden unless a layout asks for it", () => {
  const central = presentationFromLayout(TEMPLATES[0], undefined, 0);
  for (const d of DEVICE_CLASSES) assert.ok(central.profiles[d].modules.ask.hidden);
  const commandBar = presentationFromLayout(conceptFor(10)!.layout, undefined, 0);
  assert.ok(!commandBar.profiles.desktop.modules.ask.hidden);
  assert.equal(solveHome(commandBar, "desktop").placed[0].id, "ask", "#10 Command-bar home leads with the field");
});

test("concept features: rows, lanes, links, tilt, the Cosmos window, stacked decks and floating palettes", () => {
  const solve = (n: number, d: "phone" | "tablet" | "desktop" = "desktop") => solveHome(presentationFromLayout(conceptFor(n)!.layout, undefined, 0), d);
  assert.equal(solve(22).kind, "rows");
  assert.equal(new Set(solve(22).placed.map((m) => m.cell!.row)).size, 3, "#22 has three rows");
  assert.equal(solve(36).columns, 3, "#36 Kanban has three lanes");
  assert.deepEqual(solve(36).params.laneNames, ["Now", "Next", "Later"]);
  assert.ok(solve(14).links!.length >= 5, "#14 draws links");
  assert.deepEqual(solve(13).links, [], "#13 planets are not linked");
  assert.ok(solve(58).placed.some((m) => Math.abs(m.tilt ?? 0) > 1), "#58 cards are dealt at angles");
  assert.equal(solve(60).params.window, 0.42, "#60 keeps a window onto the Cosmos on desktop");
  assert.equal(solve(60, "phone").params.window, 0, "…but not on a phone");
  assert.ok(solve(24).params.stacked);
  assert.deepEqual(solve(39).floating.map((m) => m.id).sort(), ["now", "weather"], "#39 starts with two floating palettes");
  assert.equal(solve(51).kind, "twozone");
  assert.equal(solve(57).kind, "radial");
  assert.equal(solve(52).params.groupView, "stack");
});

test("time-of-day and usage layouts reorder at render time only", () => {
  const order = [...HOME_MODULES];
  assert.equal(timeOrder(order, 8)[0], "weather", "morning leads with the weather");
  assert.equal(timeOrder(order, 14)[0], "workspaces", "the day leads with work");
  assert.equal(timeOrder(order, 23)[0], "lelu", "night leads with her");
  assert.equal(timeKind("bento", 23), "focus");
  assert.equal(timeKind("bento", 10), "bento");
  assert.deepEqual(usageOrder(order, { library: 5, now: 2 }).slice(0, 2), ["library", "now"]);
  assert.deepEqual(usageOrder(order, {}), order);
});

test("blend interpolates two layouts by weight; both ends reproduce their parents", () => {
  const a = conceptFor(4)!.layout; // column briefing
  const b = conceptFor(2)!.layout; // executive command (split)
  const at0 = blendLayouts(a, b, 0);
  const at1 = blendLayouts(a, b, 1);
  const pa = presentationFromLayout(a, undefined, 0);
  const pb = presentationFromLayout(b, undefined, 0);
  for (const d of DEVICE_CLASSES) {
    assert.deepEqual(solveHome(presentationFromLayout(at0, undefined, 0), d).placed.map((m) => m.id), solveHome(pa, d).placed.map((m) => m.id), `t=0 is A on ${d}`);
    assert.deepEqual(solveHome(presentationFromLayout(at1, undefined, 0), d).placed.map((m) => m.id), solveHome(pb, d).placed.map((m) => m.id), `t=1 is B on ${d}`);
  }
  const mid = blendLayouts(a, b, 0.6, "Briefing × Command");
  assert.equal(mid.name, "Briefing × Command");
  assert.deepEqual(mid.parents, [a.id, b.id]);
  assert.ok(mid.custom);
  assert.equal(mid.kind.desktop, b.kind.desktop, "over 50% B → B's family");
  assert.equal(blendLayouts(a, b, 0.4).kind.desktop, a.kind.desktop);
  // numbers interpolate: lanes 2 (A? none) — use two masonry concepts
  const m1 = blendLayouts(conceptFor(32)!.layout, { ...conceptFor(49)!.layout, params: { lanes: 6 } }, 0.5);
  assert.equal(m1.deviceParams!.tablet!.lanes, 4, "lanes 2 and 6 blend to 4");
});

test("blending looks mixes colours and keeps two different borders as a pair", () => {
  const fire = withTheme(DEFAULT_STYLE, "ember");
  const water = withTheme(DEFAULT_STYLE, "ocean");
  const steam = blendStyles(fire, water, 0.5);
  assert.deepEqual([steam.border, steam.border2].sort(), ["fire", "water"]);
  assert.ok(steam.accent && steam.accent !== resolveStyle(fire).palette.accent && steam.accent !== resolveStyle(water).palette.accent);
  assert.equal(blendStyles(fire, water, 0.5, false).border2, "none");
  const layouts = blendLayouts({ ...conceptFor(1)!.layout, style: fire }, { ...conceptFor(21)!.layout, style: water }, 0.5);
  assert.ok(layouts.style);
});

test("merge takes each device's family from the side chosen", () => {
  const a = conceptFor(57)!.layout; // radial
  const b = conceptFor(36)!.layout; // lanes
  const m = mergeLayouts(a, b, { kind: { phone: "b", tablet: "a", desktop: "b" }, arrangement: "follow", params: "follow", look: "none" });
  assert.deepEqual(m.kind, { phone: b.kind.phone, tablet: a.kind.tablet, desktop: b.kind.desktop });
  const p = presentationFromLayout(m, undefined, 0);
  assert.deepEqual(solveHome(p, "desktop").params.laneNames, ["Now", "Next", "Later"], "the desktop takes B's parameters");
  for (const d of DEVICE_CLASSES) assert.ok(solveHome(p, d).placed.length > 0);
});

test("a hand-arranged Home saved as a layout reproduces exactly on every device", () => {
  let p = presentationFromLayout(conceptFor(8)!.layout, "Mine", 0);
  p = applyHomeOp(p, "desktop", { op: "resize", id: "weather", size: "xl" }, 1);
  p = applyHomeOp(p, "desktop", { op: "dock", id: "library" }, 2);
  p = applyHomeOp(p, "phone", { op: "toggle", id: "ask", flag: "hidden" }, 3);
  p = applyHomeOp(p, "tablet", { op: "float", id: "now", rect: { x: 0.5, y: 0.1, w: 0.4, h: 0.3 } }, 4);
  p = applyHomeOp(p, "desktop", { op: "group", id: "activity", with: "notifications" }, 5);
  p = { ...p, style: withTheme(DEFAULT_STYLE, "frost") };
  const layout = layoutFromPresentation(p, "layout-test", "My stage");
  const again = presentationFromLayout(JSON.parse(JSON.stringify(readLayout(JSON.parse(JSON.stringify(layout))))), undefined, 0);
  for (const d of DEVICE_CLASSES) assert.deepEqual(plain(solveHome(again, d)), plain(solveHome(p, d)), `${d} reproduces`);
  assert.equal(again.style?.border, "snow");
});

test("readLayout rejects junk and repairs what it can", () => {
  assert.equal(readLayout(null), null);
  assert.equal(readLayout({ id: 4 }), null);
  const fixed = readLayout({ id: "x", name: "Y", kind: { phone: "teleport", tablet: "rows" }, order: ["bogus", "now"], params: { lanes: 99, ratio: -3, adaptive: "magic" } })!;
  assert.deepEqual(fixed.kind, { phone: "bento", tablet: "rows", desktop: "bento" });
  assert.equal(fixed.params!.lanes, 6);
  assert.equal(fixed.params!.ratio, 0.2);
  assert.equal(fixed.params!.adaptive, undefined);
  assert.equal(fixed.order[0], "now");
});

test("looks: every theme, font and border resolves; text stays readable on every theme", () => {
  assert.equal(BORDER_EFFECTS.length, 13);
  for (const fx of ["water", "fire", "snow", "ice", "aurora", "lightning", "neon", "nature", "gold", "lava", "stardust", "sakura"]) assert.ok(BORDER_EFFECTS.some((e) => e.id === fx), fx);
  assert.ok(FONTS.length >= 10);
  const seen = (style: typeof DEFAULT_STYLE) => {
    const r = resolveStyle(style);
    const alpha = Number(/,\s*([\d.]+)\)$/.exec(r.vars["--glass"])![1]);
    return contrast(r.palette.ink, mixColor("#12052a", r.vars["--glass"].replace(/,\s*[\d.]+\)$/, ", 1)"), alpha));
  };
  for (const t of [...THEMES.map((x) => x.id), "generative"]) {
    const style = withTheme(DEFAULT_STYLE, t);
    assert.ok(seen(style) >= 4.5, `${t}: contrast ${seen(style).toFixed(2)}`);
    assert.equal(resolveStyle(style).vars["--hc-font"] === undefined, style.font === "lelu");
  }
  for (let h = 0; h < 360; h += 30) assert.ok(seen({ ...DEFAULT_STYLE, theme: "generative", seed: h }) >= 4.5, `generative hue ${h}`);
  assert.notEqual(generativeTheme(10).palette.accent, generativeTheme(200).palette.accent);
});

test("readStyle keeps valid looks and drops what it cannot read", () => {
  assert.equal(readStyle(null), undefined);
  const s = readStyle({ theme: "nope", border: "plasma", border2: "fire", intensity: 9, radius: -2, accent: "not-a-colour", ink: "#fff" })!;
  assert.equal(s.theme, "cosmic");
  assert.equal(s.border, "none");
  assert.equal(s.border2, "fire");
  assert.equal(s.intensity, 1);
  assert.equal(s.radius, 0);
  assert.equal(s.accent, undefined);
  assert.equal(s.ink, "#fff");
});

test("search, research prompts and LÉLU's suggestion", () => {
  assert.ok(searchConcepts("kanban").some((c) => c.n === 36));
  assert.ok(searchConcepts("pinterest").some((c) => c.n === 21));
  assert.equal(searchConcepts("").length, 60);
  assert.match(researchPrompt(conceptFor(36)!.notes), /^\/research "Kanban hub"/);
  const sig = { working: false, unread: 0, approvals: 0, openWindows: 0 };
  assert.equal(suggestConcept({ device: "desktop", hour: 14, signals: { ...sig, approvals: 2 } }).concept.n, 46);
  assert.equal(suggestConcept({ device: "desktop", hour: 14, signals: { ...sig, working: true } }).concept.n, 44);
  assert.equal(suggestConcept({ device: "desktop", hour: 23, signals: sig }).concept.n, 50);
  assert.equal(suggestConcept({ device: "phone", hour: 15, signals: sig }).concept.n, 47);
});

test("HomeStore: looks are undoable, layouts are saved and deleted, the studio can apply to the Home", async () => {
  const { default: HomeStore } = await import("../src/app/scene/genesis/home/homeStore");
  const start = HomeStore.activePresentation();
  HomeStore.setStyle(withTheme(DEFAULT_STYLE, "ember"));
  assert.equal(HomeStore.activePresentation().style?.border, "fire");
  HomeStore.undo();
  assert.equal(HomeStore.activePresentation().style, start.style, "the look change is undone");

  const fromConcept = HomeStore.createPresentation(conceptFor(36)!.layout, "My board");
  assert.equal(HomeStore.activePresentation().id, fromConcept.id);
  assert.equal(solveHome(HomeStore.activePresentation(), "desktop").kind, "lanes");

  const saved = HomeStore.saveActiveAsLayout("Board layout");
  assert.ok(HomeStore.get().presentations.layouts.some((l) => l.id === saved.id && l.custom));
  const fromMine = HomeStore.createPresentation(saved.id);
  assert.equal(solveHome(fromMine, "desktop").kind, "lanes", "a presentation from her own layout follows it");

  const blend = HomeStore.saveLayout(blendLayouts(conceptFor(57)!.layout, conceptFor(22)!.layout, 0.5));
  assert.ok(blend.custom);
  assert.ok(HomeStore.deleteLayout(blend.id));
  assert.ok(!HomeStore.get().presentations.layouts.some((l) => l.id === blend.id));

  const before = HomeStore.activePresentation();
  HomeStore.updateActive(presentationFromLayout(conceptFor(58)!.layout, "ignored", 0));
  assert.equal(HomeStore.activePresentation().id, before.id, "applying keeps the presentation's identity");
  assert.equal(HomeStore.activePresentation().name, before.name);
  assert.equal(solveHome(HomeStore.activePresentation(), "desktop").kind, "scatter");
  assert.ok(HomeStore.get().presentations.restorePoint, "a restore point is kept");
  HomeStore.undo();
  assert.equal(solveHome(HomeStore.activePresentation(), "desktop").kind, "lanes");

  HomeStore.setNote("concept-36", "Try with a fire border");
  assert.equal(HomeStore.get().presentations.notes["concept-36"], "Try with a fire border");
  HomeStore.noteUse("library");
  HomeStore.noteUse("library");
  assert.equal(HomeStore.get().presentations.usage.library, 2);
});

test("every built-in composition still solves the way Mission 15 left it (no columns beyond the grid)", () => {
  for (const t of TEMPLATES) {
    const p = presentationFromLayout(t, undefined, 0);
    assert.equal(p.recipe, undefined, `${t.id} needs no recipe`);
    for (const d of DEVICE_CLASSES) {
      const solved = solveHome(p, d);
      if (!ABSOLUTE_KINDS.has(solved.kind) && solved.kind !== "deck") for (const m of solved.placed) assert.ok(m.cell!.col + m.cell!.w - 1 <= COLUMNS[d] || solved.kind === "masonry");
    }
  }
});
