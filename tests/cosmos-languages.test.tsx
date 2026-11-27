/**
 * Infinite Cosmos — layout design languages.
 *
 * Proves the rules the browser script (scripts/verify-cosmos-languages.mjs)
 * then proves in the real app: the one layout registry names each layout's
 * language; the original layouts keep the original look (and the Retro
 * Terminal its console); every registered window has a place in the window
 * matrix; switching layout propagates to every window through ONE authority
 * (HomeStore); and Browser, Settings, the Neural Map, the window chrome and
 * panel headings genuinely render differently per composition.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  COMPOSITIONS,
  DEFAULT_LANGUAGE,
  LANGUAGES,
  WINDOW_MATRIX,
  compositionFor,
  languageFor,
  languageOfLayout,
  languageVariables,
  participationFor,
  terminalPalette,
} from "../src/core/interface/CosmosLanguages";
import { TEMPLATES, layoutOf, readLayout, cloneLayout } from "../src/app/scene/genesis/home/homeComposition";
import HomeStore from "../src/app/scene/genesis/home/homeStore";
import { activeLanguageId } from "../src/app/scene/genesis/cosmosLanguage/useCosmosLanguage";
import { languageStylesheet } from "../src/app/scene/genesis/cosmosLanguage/CosmosLanguageRuntime";
import LanguageWindowChrome from "../src/app/scene/genesis/cosmosLanguage/LanguageWindowChrome";
import SettingsNav, { SETTINGS_SECTIONS } from "../src/app/scene/genesis/cosmosLanguage/SettingsNav";
import { neuralGeometry, neuralLinkPath } from "../src/app/scene/genesis/neural/neuralLanguage";
import { APPS } from "../src/app/scene/genesis/home/homeCatalog";

const ORIGINAL = ["lelu-central", "bento-universe", "cosmos-orbit", "spatial-home", "executive-command", "organic-asymmetry", "creative-gallery", "project-hub", "minimal-focus", "adaptive-intelligence", "workspace-deck", "living-ecosystem", "retro-terminal"];

/* ---------------- registry ---------------- */

test("every original layout id is still valid and keeps its original language", () => {
  for (const id of ORIGINAL) {
    const t = TEMPLATES.find((x) => x.id === id);
    assert.ok(t, `${id} exists`);
    assert.equal(languageOfLayout(t), id === "retro-terminal" ? "terminal" : DEFAULT_LANGUAGE, `${id} speaks its original language`);
  }
});

test("the Retro Terminal stays a terminal composition on every device and speaks the console", () => {
  const rt = TEMPLATES.find((t) => t.id === "retro-terminal")!;
  assert.deepEqual(rt.kind, { phone: "terminal", tablet: "terminal", desktop: "terminal" });
  assert.equal(languageOfLayout(rt), "terminal");
  assert.equal(compositionFor("terminal").id, "console");
});

test("each new layout names a real language, and no two new layouts share one", () => {
  const added = TEMPLATES.filter((t) => !ORIGINAL.includes(t.id));
  assert.equal(added.length, 14);
  const langs = added.map((t) => t.language);
  for (const l of langs) assert.ok(LANGUAGES.some((x) => x.id === l), `${l} is a language`);
  assert.equal(new Set(langs).size, added.length, "one language per layout — no padded near-duplicates");
});

test("a language survives a saved custom layout (readLayout), and junk is refused", () => {
  const swiss = TEMPLATES.find((t) => t.id === "swiss-international")!;
  const read = readLayout({ ...cloneLayout(swiss), id: "mine", custom: true });
  assert.equal(read?.language, "swiss");
  const junk = readLayout({ ...cloneLayout(swiss), id: "x", language: "<script>" });
  assert.equal(junk?.language, undefined);
});

test("compositions are structurally different, not recolours", () => {
  const specs = Object.values(COMPOSITIONS);
  assert.equal(specs.length, 9);
  const shapes = specs.map((c) => JSON.stringify({ chrome: c.chrome, browser: c.browser, settings: c.settings, neural: c.neural, heading: c.heading }));
  assert.equal(new Set(shapes).size, specs.length);
  // Browser tab placement, settings navigation and neural layout each take several distinct forms.
  assert.ok(new Set(specs.map((c) => c.browser.tabs)).size >= 5);
  assert.ok(new Set(specs.map((c) => c.settings.nav)).size >= 8);
  assert.ok(new Set(specs.map((c) => c.neural.layout)).size >= 8);
});

test("languages are distinct looks; compatible looks share a composition engine", () => {
  assert.equal(LANGUAGES.length, 16);
  assert.equal(new Set(LANGUAGES.map((l) => JSON.stringify(l.palette))).size, LANGUAGES.length);
  const byComposition = new Map<string, number>();
  for (const l of LANGUAGES) byComposition.set(l.composition, (byComposition.get(l.composition) ?? 0) + 1);
  assert.ok([...byComposition.values()].some((n) => n > 1), "some compositions are shared");
  assert.ok(LANGUAGES.filter((l) => l.tone === "light").length >= 5, "not everything is dark glass");
});

test("the default language emits nothing; every other language compiles through the design-token compiler", () => {
  assert.deepEqual(languageVariables(DEFAULT_LANGUAGE), {});
  assert.equal(languageStylesheet(DEFAULT_LANGUAGE), "");
  for (const l of LANGUAGES.filter((x) => x.id !== DEFAULT_LANGUAGE)) {
    const v = languageVariables(l.id);
    for (const key of ["--lelu-surface-bg", "--lelu-color-text", "--lelu-font-body", "--cl-paper", "--cl-ink", "--cl-accent", "--cl-radius"]) assert.ok(v[key], `${l.id} sets ${key}`);
    assert.equal(v["--cl-paper"], l.palette.paper);
    const sheet = languageStylesheet(l.id);
    assert.match(sheet, new RegExp(`data-cosmos-language="${l.id}"`));
    assert.match(sheet, /data-lelu-module-window/);
  }
});

test("the terminal language follows her own terminal theme colours", () => {
  const p = terminalPalette(languageFor("terminal").palette, { bg: "#101010", text: "#33ff66", accent1: "#ffaa00" });
  assert.equal(p.paper, "#101010");
  assert.equal(p.ink, "#33ff66");
  assert.equal(p.accent, "#ffaa00");
  const v = languageVariables("terminal", { terminal: { bg: "#101010", text: "#33ff66" } });
  assert.equal(v["--cl-paper"], "#101010");
  // Non-colours are ignored, never injected.
  assert.equal(terminalPalette(languageFor("terminal").palette, { bg: "red; x: y" }).paper, languageFor("terminal").palette.paper);
});

/* ---------------- window matrix ---------------- */

test("every registered window has a layout-aware implementation or a documented exception", () => {
  const source = readFileSync(new URL("../src/app/scene/genesis/GenesisInterface.tsx", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("const MODULE_RENDERERS"), source.indexOf("};", source.indexOf("const MODULE_RENDERERS")));
  const ids = [...block.matchAll(/^\s+"?([a-z0-9-]+)"?: \(\{ onClose \}\)/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 30, `found ${ids.length} registered windows`);
  for (const id of [...ids, "chat:abc", "artifact:abc", "atelier:abc", "neural-map"]) {
    const key = id.includes(":") ? `${id.split(":")[0]}:*` : id;
    assert.ok(WINDOW_MATRIX[key], `${id} is in the window matrix`);
    const p = participationFor(id);
    assert.ok(p.implementation === "dedicated" || p.implementation === "shared");
  }
  for (const app of APPS) assert.ok(WINDOW_MATRIX[app.id], `home app ${app.id} is in the window matrix`);
  for (const id of ["browser", "neural-map", "settings"]) assert.equal(participationFor(id).implementation, "dedicated");
});

/* ---------------- propagation ---------------- */

test("switching layout propagates the language through HomeStore and never overwrites an arrangement", () => {
  const start = HomeStore.activePresentation();
  const before = HomeStore.get().presentations.list.length;
  HomeStore.switchLayout("swiss-international");
  assert.equal(activeLanguageId(), "swiss");
  const swissId = HomeStore.activePresentation().id;
  // Arrange the Swiss home, then leave and come back: the arrangement is the one she left.
  assert.ok(HomeStore.applyHomeOp("desktop", { op: "resize", id: "weather", size: "xl" }), "the arrangement changed");
  const arranged = JSON.stringify(HomeStore.activePresentation().profiles.desktop);
  HomeStore.switchLayout("futurist-hud");
  assert.equal(activeLanguageId(), "scifi");
  HomeStore.switchLayout("retro-terminal");
  assert.equal(activeLanguageId(), "terminal");
  assert.equal(layoutOf(HomeStore.activePresentation()).kind.desktop, "terminal");
  HomeStore.switchLayout("swiss-international");
  assert.equal(HomeStore.activePresentation().id, swissId, "the existing Swiss presentation is reused");
  assert.equal(JSON.stringify(HomeStore.activePresentation().profiles.desktop), arranged, "her arrangement survived");
  assert.equal(HomeStore.get().presentations.list.length, before + 3, "one presentation per layout, created once");
  HomeStore.applyPresentation(start.id);
  assert.equal(activeLanguageId(), languageOfLayout(layoutOf(start)));
});

/* ---------------- window-specific rendering ---------------- */

const noop = () => {};
function chrome(compositionId: keyof typeof COMPOSITIONS) {
  return renderToStaticMarkup(
    <LanguageWindowChrome
      id="browser"
      label="Browser"
      composition={COMPOSITIONS[compositionId]}
      role="browser"
      index={3}
      status="active"
      pinned={false}
      isExpanded={false}
      compactScreen={false}
      actionsHandle={<button type="button" aria-label="Browser window actions">◫</button>}
      onPointerDown={noop}
      onPointerMove={noop}
      onPointerUp={noop}
      onPin={noop}
      onMinimize={noop}
      onToggleExpand={noop}
      onClose={noop}
      onBackToChat={noop}
    />,
  );
}

test("window chrome: each composition draws a different bar with the same controls and names", () => {
  const ids = (Object.keys(COMPOSITIONS) as Array<keyof typeof COMPOSITIONS>).filter((c) => c !== "glass");
  const marks = ids.map((c) => chrome(c));
  assert.equal(new Set(marks).size, ids.length);
  for (const m of marks) {
    assert.match(m, /aria-label="Close Browser"/);
    assert.match(m, /aria-label="Minimize Browser"/);
    assert.match(m, /data-lelu-module-pin="browser"/);
    assert.match(m, /data-lelu-module-chrome="browser"/);
    assert.match(m, /aria-label="Browser window actions"/);
  }
  assert.match(chrome("console"), /lelu@cosmos:~\/browser\$/);
  assert.match(chrome("grid"), /class="clc-index">03</);
  assert.match(chrome("editorial"), /No\. 03/);
  assert.match(chrome("bezel"), /UNIT 03/);
});

test("Settings navigation: one form per composition, every section reachable", () => {
  const kinds = [...new Set(Object.values(COMPOSITIONS).map((c) => c.settings.nav).filter((k) => k !== "none"))];
  const marks = kinds.map((k) => renderToStaticMarkup(<SettingsNav kind={k} sections={SETTINGS_SECTIONS} current="runtime" onSelect={noop} />));
  assert.equal(new Set(marks).size, kinds.length);
  for (const m of marks) {
    for (const s of SETTINGS_SECTIONS) assert.match(m, new RegExp(`data-settings-nav="${s.id}"`));
    assert.match(m, /data-settings-nav="runtime" data-on="true"/);
  }
});

test("Neural Map geometry: every composition lays the same relations out differently", () => {
  const dirs = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? "in" : "out")) as Array<"in" | "out">;
  const layouts = [...new Set(Object.values(COMPOSITIONS).map((c) => c.neural.layout))];
  const shapes = layouts.map((l) => JSON.stringify(neuralGeometry(l, 12, 520, dirs)));
  assert.equal(new Set(shapes).size, layouts.length);
  for (const l of layouts) {
    const g = neuralGeometry(l, 12, 520, dirs);
    assert.equal(g.nodes.length, 12);
    for (const p of [g.focus, ...g.nodes]) assert.ok(p.x >= 0 && p.x <= 520 && p.y >= 0 && p.y <= 520, `${l} stays inside the map`);
  }
  const a = { x: 10, y: 10 };
  const b = { x: 100, y: 60 };
  const links = ["straight", "orthogonal", "wire", "curve"].map((k) => neuralLinkPath(k as never, a, b));
  assert.equal(new Set(links).size, 4);
});

async function withLayout<T>(templateId: string, fn: () => T | Promise<T>): Promise<T> {
  const start = HomeStore.activePresentation().id;
  HomeStore.switchLayout(templateId);
  try {
    return await fn();
  } finally {
    HomeStore.applyPresentation(start);
  }
}

test("Browser renders a different structure per composition and keeps its navigation controls", async () => {
  const { default: GenesisCore } = await import("../src/app/scene/genesis/GenesisCore");
  const { default: GenesisBrowserPanel } = await import("../src/app/scene/genesis/GenesisBrowserPanel");
  const render = () =>
    renderToStaticMarkup(
      <GenesisCore>
        <GenesisBrowserPanel onClose={noop} />
      </GenesisCore>,
    );
  const glass = render();
  assert.match(glass, /data-cl-browser="glass"/);
  assert.match(glass, /placeholder="Search or enter a web address"/);
  const seen = new Set<string>([glass]);
  for (const [layout, comp, marker] of [
    ["retro-terminal", "console", /lelu@cosmos:~\/browser\$ open/],
    ["swiss-international", "grid", /data-cl-mast="grid"/],
    ["editorial-magazine", "editorial", /The Browser/],
    ["neo-brutalist", "slab", /TYPE AN ADDRESS!/],
    ["japanese-ma", "scroll", /「Reader」/],
    ["futurist-hud", "hud", /TGT ▸/],
    ["industrial-control", "bezel", /class="lbr-led"/],
    ["organic-biome", "organic", /Where shall we wander\?/],
  ] as const) {
    const m = await withLayout(layout, render);
    assert.match(m, new RegExp(`data-cl-browser="${comp}"`), layout);
    assert.match(m, marker, `${layout} speaks its composition`);
    for (const name of ["Back", "Forward", "Reload", "Go", "Browser address", "New tab", "Reader", "Read for Lélu", "Beside chat", "To board"]) {
      assert.match(m, new RegExp(`aria-label="${name}"`), `${layout}: ${name} is still there`);
    }
    seen.add(m);
  }
  assert.equal(seen.size, 9);
});

test("Settings keeps every section and control under every composition; paged ones show one section", async () => {
  const { default: GenesisCore } = await import("../src/app/scene/genesis/GenesisCore");
  const { default: GenesisSettingsPanel } = await import("../src/app/scene/genesis/GenesisSettingsPanel");
  const render = () =>
    renderToStaticMarkup(
      <GenesisCore>
        <GenesisSettingsPanel onClose={noop} />
      </GenesisCore>,
    );
  const base = render();
  const controls = (base.match(/<(button|input|select|textarea)\b/g) ?? []).length;
  assert.doesNotMatch(base, /data-cl-settings-paged/);
  for (const [layout, nav, paged] of [
    ["retro-terminal", "command", true],
    ["swiss-international", "index", false],
    ["editorial-magazine", "contents", false],
    ["neo-brutalist", "tabs", true],
    ["japanese-ma", "vertical", true],
    ["futurist-hud", "dial", true],
    ["industrial-control", "switchboard", true],
    ["organic-biome", "pebbles", false],
  ] as const) {
    const m = await withLayout(layout, render);
    assert.match(m, new RegExp(`data-cl-settings="${nav}"`), layout);
    for (const s of SETTINGS_SECTIONS) assert.match(m, new RegExp(`data-settings-section="${s.id}"`), `${layout}: ${s.id} kept`);
    const own = (m.match(/<(button|input|select|textarea)\b/g) ?? []).length;
    assert.equal(own - SETTINGS_SECTIONS.length, controls, `${layout}: every original control is still rendered (plus the section navigation)`);
    if (paged) assert.equal((m.match(/data-cl-current="true"/g) ?? []).length, 1, `${layout}: one section on show`);
  }
});

test("the Neural Map draws the same entity in each composition's layout", async () => {
  const { default: NeuralMapView } = await import("../src/app/scene/genesis/neural/NeuralMapView");
  const render = () => renderToStaticMarkup(<NeuralMapView embedded />);
  const glass = render();
  assert.match(glass, /data-neural-layout="ring"/);
  for (const [layout, kind] of [
    ["retro-terminal", "list"],
    ["swiss-international", "grid"],
    ["editorial-magazine", "columns"],
    ["neo-brutalist", "matrix"],
    ["japanese-ma", "vertical"],
    ["futurist-hud", "radar"],
    ["organic-biome", "cluster"],
  ] as const) {
    const m = await withLayout(layout, render);
    assert.match(m, new RegExp(`data-neural-layout="${kind}"`), layout);
    assert.match(m, /aria-label="Find in the Neural Map"/, `${layout}: search is still there`);
    assert.match(m, /aria-label="Back to the previous entity"/);
  }
});

test("panel headings inside windows follow the composition (GenesisWindowFrame)", async () => {
  const { default: GenesisWindowFrame } = await import("../src/app/scene/genesis/GenesisWindowFrame");
  const { InModuleWindow, ModuleWindowMeta } = await import("../src/app/scene/genesis/moduleWindowContext");
  const render = () =>
    renderToStaticMarkup(
      <InModuleWindow.Provider value={true}>
        <ModuleWindowMeta.Provider value={{ id: "memory", index: 2, role: "list", label: "Memory" }}>
          <GenesisWindowFrame title="Memory · 6 stored" onClose={noop}>
            <p>body</p>
          </GenesisWindowFrame>
        </ModuleWindowMeta.Provider>
      </InModuleWindow.Provider>,
    );
  const plain = render();
  assert.doesNotMatch(plain, /data-cl-heading/);
  const swiss = await withLayout("swiss-international", render);
  assert.match(swiss, /data-cl-heading="numbered"/);
  assert.match(swiss, /class="clh-num">02</);
  const editorial = await withLayout("editorial-magazine", render);
  assert.match(editorial, /data-cl-heading="headline"/);
  assert.match(editorial, /class="clh-dek">6 stored</);
  const hud = await withLayout("futurist-hud", render);
  assert.match(hud, /SYS\.02 · LIST · 6 STORED/);
});
