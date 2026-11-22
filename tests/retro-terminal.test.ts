/**
 * ==========================================================
 * RETRO TERMINAL — layout, appearance, persistence, state preservation
 *
 * CATEGORY: unit. The real HomeStore, CosmosNavigation, CosmosFocus and
 * InfiniteCosmos with the storage shim the rest of the suite uses.
 * The browser script (scripts/home/verify-retro-terminal.mjs) proves the
 * same through the real UI on phone, tablet and desktop.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { test } from "node:test";

if (typeof globalThis.window === "undefined") (globalThis as Record<string, unknown>).window = globalThis;
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import {
  COMPOSITION_KINDS,
  DEVICE_CLASSES,
  HOME_MODULES,
  TEMPLATES,
  presentationFromTemplate,
  solveHome,
  type GridCell,
} from "../src/app/scene/genesis/home/homeComposition";
import {
  GRADIENT_ROLES,
  MAX_SWATCHES,
  MIN_SWATCHES,
  ROLE_IDS,
  TERMINAL_PRESETS,
  addSwatch,
  contrastReport,
  contrastSummary,
  exportTheme,
  hexToHsl,
  hslToHex,
  importTheme,
  normalizeHex,
  presetTheme,
  readTerminalTheme,
  removeSwatch,
  resetRole,
  resetTheme,
  roleColor,
  setEffects,
  setGradient,
  setRole,
  setSwatch,
  terminalVars,
  homeSkinVars,
} from "../src/app/scene/genesis/home/homeTerminal";
import { runCommand, parseCommand, completeCommand, type TerminalContext } from "../src/app/scene/genesis/home/terminalCommands";

/* ---------------- the layout ---------------- */

test("Retro Terminal is an additional built-in layout; the twelve before it are unchanged", () => {
  const t = TEMPLATES.find((x) => x.id === "retro-terminal");
  assert.ok(t, "retro-terminal is a composition");
  assert.deepEqual(t!.kind, { phone: "terminal", tablet: "terminal", desktop: "terminal" });
  assert.ok(COMPOSITION_KINDS.some((k) => k.id === "terminal"));
  for (const id of ["lelu-central", "bento-universe", "cosmos-orbit", "spatial-home", "executive-command", "organic-asymmetry", "creative-gallery", "project-hub", "minimal-focus", "adaptive-intelligence", "workspace-deck", "living-ecosystem"]) {
    assert.ok(TEMPLATES.some((x) => x.id === id), `${id} still exists`);
  }
});

test("the terminal's panes solve on every device: every module placed or hidden, no overlaps", () => {
  const p = presentationFromTemplate("retro-terminal", undefined, 0);
  for (const device of DEVICE_CLASSES) {
    const solved = solveHome(p, device);
    assert.equal(solved.kind, "terminal");
    const shown = new Set([...solved.placed.flatMap((m) => m.members), ...solved.floating.map((m) => m.id), ...solved.docked, ...solved.hidden]);
    assert.deepEqual([...shown].sort(), [...HOME_MODULES].sort(), device);
    assert.ok(solved.hidden.includes("ask"), "the command line replaces Ask LÉLU (still reachable from the dock)");
    const cells = solved.placed.map((m) => m.cell).filter((c): c is GridCell => Boolean(c));
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) {
        const [a, b] = [cells[i], cells[j]];
        assert.ok(!(a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h), `${device}: ${a.id} overlaps ${b.id}`);
      }
  }
});

/* ---------------- colours and palettes ---------------- */

test("HEX input: #rgb, #rrggbb, bare hex, rgb() and hsl() are accepted; nonsense is refused", () => {
  assert.equal(normalizeHex("#FA0"), "#ffaa00");
  assert.equal(normalizeHex("ffaa00"), "#ffaa00");
  assert.equal(normalizeHex("  #1E90FF "), "#1e90ff");
  assert.equal(normalizeHex("rgb(255, 170, 0)"), "#ffaa00");
  assert.equal(normalizeHex("hsl(0, 100%, 50%)"), "#ff0000");
  assert.equal(normalizeHex("#ggg"), null);
  assert.equal(normalizeHex("orange"), null);
  assert.equal(normalizeHex(""), null);
  assert.equal(hslToHex(...hexToHsl("#3d8bff")).slice(0, 4), "#3d8"); // HSL round-trip within rounding
});

test("eight presets, each a complete theme; selecting one never stops it being edited", () => {
  assert.deepEqual(
    TERMINAL_PRESETS.map((p) => p.id),
    ["classic-retro", "cybernetic", "cosmic-violet", "solar-flare", "emerald", "arctic", "monochrome", "custom"],
  );
  for (const p of TERMINAL_PRESETS) {
    const t = presetTheme(p.id);
    for (const r of ROLE_IDS) assert.match(roleColor(t, r), /^#[0-9a-f]{6}$/, `${p.id}.${r}`);
    const edited = setRole(t, "text", "#00ff00", 1);
    assert.equal(roleColor(edited, "text"), "#00ff00", `${p.id} is editable`);
    assert.notEqual(roleColor(presetTheme(p.id), "text"), "#00ff00", "the preset itself is untouched");
  }
  const classic = presetTheme("classic-retro");
  assert.equal(roleColor(classic, "bg"), "#12100e", "Classic Retro: charcoal");
  assert.equal(roleColor(classic, "text"), "#ffb000", "Classic Retro: amber type");
});

test("every built-in preset is readable: no contrast pair below its minimum", () => {
  for (const p of TERMINAL_PRESETS) {
    const failing = contrastReport(presetTheme(p.id)).filter((c) => c.level !== "pass");
    assert.deepEqual(failing.map((c) => `${c.id} ${c.ratio}`), [], p.id);
  }
});

test("backgrounds, typography and accents change independently, even roles sharing a swatch", () => {
  const t = presetTheme("classic-retro");
  assert.equal(t.roles.bg, t.roles.input, "bg and input share swatch @0 in the preset");
  const a = setRole(t, "bg", "#000814", 1);
  assert.equal(roleColor(a, "bg"), "#000814");
  assert.equal(roleColor(a, "input"), roleColor(t, "input"), "input did not follow");
  const b = setRole(setRole(a, "heading", "#ff00aa", 1), "numeric", "#00e5ff", 1);
  assert.equal(roleColor(b, "heading"), "#ff00aa");
  assert.equal(roleColor(b, "numeric"), "#00e5ff");
  assert.equal(roleColor(b, "text"), roleColor(t, "text"), "primary text untouched");
  const regions = ["sidebar", "header", "footer", "panel", "selected"] as const;
  const c = regions.reduce((acc, r, i) => setRole(acc, r, `#0${i}0${i}0${i}`, 1), b);
  assert.equal(new Set(regions.map((r) => roleColor(c, r))).size, regions.length, "each region its own colour");
});

test("multicolour: a palette of swatches assigned to roles; editing a swatch recolours its roles", () => {
  let t = presetTheme("custom");
  t = setRole(setRole(setRole(t, "accent1", "@3", 1), "accent2", "@5", 1), "accent3", "@6", 1);
  const accents = ["accent1", "accent2", "accent3"].map((r) => roleColor(t, r as "accent1"));
  assert.equal(new Set(accents).size, 3, "three accents, three colours, together");
  const before = ROLE_IDS.filter((r) => t.roles[r] === "@5");
  t = setSwatch(t, 5, "#9b5cff", 2);
  for (const r of before) assert.equal(roleColor(t, r), "#9b5cff", `${r} follows swatch 6`);
  assert.equal(setSwatch(t, 5, "not a colour", 3), t, "invalid input changes nothing");
});

test("palette size limits; removing a swatch keeps its roles' colour and shifts later refs", () => {
  let t = presetTheme("classic-retro");
  while (t.palette.length < MAX_SWATCHES) t = addSwatch(t, "#123456", 1);
  assert.equal(addSwatch(t, "#654321", 1), t, "at most eight");
  const base = presetTheme("classic-retro");
  const colorOf3 = base.palette[3];
  const usersOf3 = ROLE_IDS.filter((r) => base.roles[r] === "@3");
  const usersOf5 = ROLE_IDS.filter((r) => base.roles[r] === "@5");
  const r = removeSwatch(base, 3, 1);
  assert.equal(r.palette.length, base.palette.length - 1);
  for (const id of usersOf3) assert.equal(r.roles[id], colorOf3, `${id} keeps the removed colour`);
  for (const id of usersOf5) assert.equal(r.roles[id], "@4", `${id} shifted to the new index`);
  for (const id of ROLE_IDS) assert.equal(roleColor(r, id), roleColor(base, id), `${id} looks the same`);
  let small = presetTheme("monochrome");
  while (small.palette.length > MIN_SWATCHES) small = removeSwatch(small, small.palette.length - 1, 1);
  assert.equal(removeSwatch(small, 0, 1), small, "at least two");
});

test("reset one colour, reset the whole theme", () => {
  const t = setRole(setRole(presetTheme("cybernetic"), "error", "#00ff00", 1), "bg", "#ffffff", 1);
  const one = resetRole(t, "error", 2);
  assert.equal(roleColor(one, "error"), roleColor(presetTheme("cybernetic"), "error"));
  assert.equal(roleColor(one, "bg"), "#ffffff", "only that role");
  const all = resetTheme({ ...t, name: "Mine", custom: true }, 3);
  assert.equal(all.name, "Mine");
  for (const r of ROLE_IDS) assert.equal(roleColor(all, r), roleColor(presetTheme("cybernetic"), r));
});

test("CSS: every role becomes a variable; gradients and effects are expressed", () => {
  let t = setGradient(presetTheme("classic-retro"), "sidebar", { to: "@5", angle: 90 }, 1);
  t = setEffects(t, { scanlines: 0, glow: 0, radius: 12, fontSize: 18, monoFont: "courier", panelOpacity: 1 }, 1);
  const { vars } = terminalVars(t);
  for (const r of ROLE_IDS) assert.match(vars[`--rt-${r}`], /^#[0-9a-f]{6}$/);
  assert.match(vars["--rt-sidebar-fill"], /^linear-gradient\(90deg/);
  assert.match(vars["--rt-bg-fill"], /^rgba\(/);
  assert.equal(vars["--rt-scan"], "0.000");
  assert.equal(vars["--rt-glow"], "0.0px");
  assert.equal(vars["--rt-radius"], "12px");
  assert.equal(vars["--rt-size"], "18px");
  assert.match(vars["--rt-mono"], /Courier/);
  assert.equal(setGradient(t, "sidebar", { to: "zzz", angle: 0 }, 2), t, "a bad gradient colour changes nothing");
  assert.ok(GRADIENT_ROLES.every((r) => vars[`--rt-${r}-fill`]));
  const skin = homeSkinVars(t);
  assert.equal(skin["--ink"], roleColor(t, "text"), "the Home's modules wear the terminal's text colour");
  assert.equal(skin["--accent"], roleColor(t, "accent1"));
});

test("contrast warnings report bad pairs and never change the palette", () => {
  const t = setRole(presetTheme("classic-retro"), "text", roleColor(presetTheme("classic-retro"), "panel"), 1);
  const s = contrastSummary(t);
  assert.ok(s.fails >= 1);
  const pair = contrastReport(t).find((c) => c.id === "text/panel")!;
  assert.equal(pair.level, "fail");
  assert.equal(pair.ratio, 1);
  assert.equal(roleColor(t, "text"), roleColor(presetTheme("classic-retro"), "panel"), "her choice stands");
  const low = setRole(presetTheme("classic-retro"), "text2", "#6b5a3a", 1);
  assert.ok(["large", "fail"].includes(contrastReport(low).find((c) => c.id === "text2/panel")!.level));
});

test("import/export round-trips; bad input is refused with a reason; saved data is read defensively", () => {
  const t = setGradient(setRole(presetTheme("cosmic-violet"), "warning", "#ffee00", 1), "header", { to: "#000000", angle: 45 }, 1);
  const json = exportTheme({ ...t, name: "Violet mine" });
  const back = importTheme(json);
  assert.ok(back.ok);
  if (back.ok) {
    assert.equal(back.theme.name, "Violet mine");
    for (const r of ROLE_IDS) assert.equal(roleColor(back.theme, r), roleColor(t, r));
    assert.deepEqual(back.theme.gradients.header, { to: "#000000", angle: 45 });
  }
  assert.equal(importTheme("{nope").ok, false);
  assert.equal(importTheme(JSON.stringify({ format: "other", theme: {} })).ok, false);
  assert.equal(importTheme("42").ok, false);
  const fixed = readTerminalTheme({ base: "nope", palette: ["#fff", "not-a-colour", "#000"], roles: { text: "@9", bg: "chartreuse", panel: "@1" }, effects: { fontSize: 99, glow: -1, monoFont: "comic" } })!;
  assert.equal(fixed.base, "classic-retro");
  assert.deepEqual(fixed.palette, ["#ffffff", "#000000"]);
  assert.equal(fixed.roles.panel, "@1");
  assert.match(fixed.roles.text, /^#/, "a ref past the palette falls back to a colour");
  assert.equal(fixed.effects.fontSize, 20);
  assert.equal(fixed.effects.glow, 0);
  assert.equal(fixed.effects.monoFont, "system-mono");
});

/* ---------------- the store: drafts, saving, persistence ---------------- */

test("HomeStore: live draft, undo/redo/revert, save (never over a preset), rename/duplicate/delete, persistence", async () => {
  const { default: HomeStore, loadTerminalAppearance, TERMINAL_KEY } = await import("../src/app/scene/genesis/home/homeStore");
  const { default: KvStore } = await import("../src/core/storage/KvStore");

  assert.equal(HomeStore.get().terminal.activeId, "preset:classic-retro", "the default is Classic Retro");
  assert.ok(HomeStore.selectTerminalTheme("preset:arctic"));
  assert.equal(HomeStore.terminalTheme().base, "arctic");
  assert.equal(HomeStore.selectTerminalTheme("preset:nope"), false);

  // Live preview: the draft is what the terminal shows; the saved theme is untouched.
  HomeStore.editTerminal((t) => setRole(t, "bg", "#000000"));
  HomeStore.editTerminal((t) => setRole(t, "text", "#ffffff"));
  assert.equal(roleColor(HomeStore.terminalTheme(), "bg"), "#000000");
  assert.equal(roleColor(HomeStore.savedTerminalTheme(), "bg"), roleColor(presetTheme("arctic"), "bg"), "experimenting does not touch the saved theme");
  assert.ok(HomeStore.get().terminal.canUndo);
  HomeStore.undoTerminal();
  assert.equal(roleColor(HomeStore.terminalTheme(), "text"), roleColor(presetTheme("arctic"), "text"));
  assert.equal(roleColor(HomeStore.terminalTheme(), "bg"), "#000000");
  HomeStore.redoTerminal();
  assert.equal(roleColor(HomeStore.terminalTheme(), "text"), "#ffffff");
  assert.ok(HomeStore.revertTerminal());
  assert.equal(HomeStore.get().terminal.draft, null);
  assert.equal(roleColor(HomeStore.terminalTheme(), "bg"), roleColor(presetTheme("arctic"), "bg"));

  // A drag of a colour picker is ONE undo step.
  for (const hex of ["#100000", "#200000", "#300000"]) HomeStore.editTerminal((t) => setRole(t, "bg", hex), "role:bg:picker");
  HomeStore.undoTerminal();
  assert.equal(HomeStore.get().terminal.draft, null, "one undo takes the whole drag back");

  // Saving an edited preset makes a theme of hers; the preset stays.
  HomeStore.editTerminal((t) => setRole(t, "accent1", "#ff0066"));
  const saved = HomeStore.saveTerminalTheme();
  assert.ok(saved.custom);
  assert.equal(saved.name, "Arctic Interface (custom)");
  assert.equal(HomeStore.get().terminal.activeId, saved.id);
  assert.equal(roleColor(presetTheme("arctic"), "accent1"), roleColor(presetTheme("arctic"), "accent1"));
  assert.notEqual(roleColor(presetTheme("arctic"), "accent1"), "#ff0066");

  // Editing her own theme and saving updates it in place.
  HomeStore.editTerminal((t) => setRole(t, "heading", "#abcdef"));
  const again = HomeStore.saveTerminalTheme();
  assert.equal(again.id, saved.id);
  assert.equal(HomeStore.get().terminal.themes.length, 1);

  assert.ok(HomeStore.renameTerminalTheme(saved.id, "Night Shift"));
  const copy = HomeStore.duplicateTerminalTheme(saved.id)!;
  assert.equal(copy.name, "Night Shift copy");
  assert.equal(HomeStore.get().terminal.activeId, copy.id);
  const imported = HomeStore.importTerminalTheme(HomeStore.exportTerminalTheme("preset:emerald"));
  assert.ok(imported.ok);
  assert.equal(HomeStore.get().terminal.themes.length, 3);
  assert.ok(HomeStore.deleteTerminalTheme(copy.id));
  assert.equal(HomeStore.deleteTerminalTheme("preset:emerald"), false, "presets cannot be deleted");

  // Persistence: what is stored reads back to the same themes, active theme and draft.
  HomeStore.selectTerminalTheme(saved.id);
  HomeStore.editTerminal((t) => setEffects(t, { scanlines: 0 }));
  const raw = KvStore.getInstance().get<{ themes: unknown[] }>(TERMINAL_KEY);
  assert.ok(raw && raw.themes.length === 2);
  const reloaded = loadTerminalAppearance();
  assert.equal(reloaded.activeId, saved.id);
  assert.deepEqual(reloaded.themes.map((t) => t.name).sort(), ["Emerald Terminal", "Night Shift"]);
  assert.equal(roleColor(reloaded.themes.find((t) => t.id === saved.id)!, "heading"), "#abcdef");
  assert.equal(reloaded.draft?.effects.scanlines, 0, "unsaved changes survive a reload as a draft");
  HomeStore.revertTerminal();
  assert.equal(loadTerminalAppearance().draft, null);
});

test("switching layouts and editing the theme never touch the universe; the theme survives layout switches", async () => {
  const { default: HomeStore } = await import("../src/app/scene/genesis/home/homeStore");
  const { default: CosmosNavigation } = await import("../src/core/cosmos/CosmosNavigation");
  const { default: CosmosFocus } = await import("../src/core/cosmos/CosmosFocus");
  const { default: InfiniteCosmos } = await import("../src/app/scene/genesis/engines/InfiniteCosmos");

  const nav = CosmosNavigation.getInstance();
  nav.registerAll([
    { id: "cosmos-core", level: "core", label: "LÉLU CORE", parentId: null },
    { id: "g-eng", level: "galaxy", label: "Engineering", parentId: "cosmos-core" },
    { id: "p-kernel", level: "planet", label: "Kernel", parentId: "g-eng" },
  ]);
  nav.navigateTo("g-eng");
  nav.navigateTo("p-kernel");
  CosmosFocus.getInstance().set({ kind: "node", id: "p-kernel" });
  const cosmos = InfiniteCosmos.getInstance();
  cosmos.updateCameraPosition(123.5, -40, 980);
  const snapshot = () => ({
    current: nav.getState().currentId,
    trail: [...nav.getState().trail],
    version: nav.getState().version,
    focus: CosmosFocus.getInstance().get(),
    camera: cosmos.getCameraPosition(),
    chunk: cosmos.getCameraChunk(),
  });
  const before = snapshot();

  const startTheme = JSON.stringify(HomeStore.terminalTheme());
  const original = HomeStore.activePresentation().id;
  const term = HomeStore.createPresentation("retro-terminal");
  assert.equal(solveHome(HomeStore.activePresentation(), "desktop").kind, "terminal");
  HomeStore.editTerminal((t) => setRole(t, "panel", "#202040"));
  HomeStore.saveTerminalThemeAs("Layout test");
  const chosen = JSON.stringify(HomeStore.terminalTheme());
  assert.notEqual(chosen, startTheme);

  HomeStore.applyPresentation(original);
  assert.notEqual(solveHome(HomeStore.activePresentation(), "desktop").kind, "terminal");
  assert.equal(JSON.stringify(HomeStore.terminalTheme()), chosen, "leaving the terminal keeps its theme");
  HomeStore.createPresentation("cosmos-orbit");
  HomeStore.applyPresentation(term.id);
  assert.equal(JSON.stringify(HomeStore.terminalTheme()), chosen, "coming back restores the selected appearance");

  for (const preset of TERMINAL_PRESETS) {
    HomeStore.selectTerminalTheme(`preset:${preset.id}`);
    HomeStore.editTerminal((t) => setEffects(t, { glow: 0.9 }));
    HomeStore.revertTerminal();
  }
  assert.deepEqual(snapshot(), before, "camera, chunk, region, trail, selection: all unchanged");
});

/* ---------------- the command line ---------------- */

function fakeContext() {
  const calls: string[] = [];
  const nodes = [
    { id: "cosmos-core", label: "LÉLU CORE", level: "core", parentId: null },
    { id: "g-eng", label: "Engineering & Systems", level: "galaxy", parentId: "cosmos-core" },
    { id: "p-kernel", label: "Kernel", level: "planet", parentId: "g-eng" },
  ];
  let current = "cosmos-core";
  let focused: { kind: "node" | "object"; id: string } | null = null;
  let unsaved = false;
  const ctx: TerminalContext = {
    nodes: () => nodes,
    currentNodeId: () => current,
    navigateTo: (id) => {
      calls.push(`nav:${id}`);
      current = id;
      return true;
    },
    back: () => {
      calls.push("back");
      current = "cosmos-core";
      return true;
    },
    objects: () => [{ id: "obj-1", name: "Blue Cube" }],
    focus: (t) => {
      focused = t;
      calls.push(`focus:${t ? t.id : "none"}`);
    },
    focused: () => focused,
    flyScale: (s) => calls.push(`scale:${s}`),
    scale: () => "planet",
    camera: () => ({ x: 1, y: 2, z: 3 }),
    sector: () => ({ x: 0, y: 0, z: 0 }),
    world: () => ({ phase: "LIFE", progress: 0.42, cycle: 3 }),
    panels: () => [
      { id: "browser", label: "Browser" },
      { id: "settings", label: "Settings" },
    ],
    openPanel: (id) => calls.push(`open:${id}`),
    immersive: () => calls.push("look"),
    openStudio: () => calls.push("studio"),
    arrange: () => calls.push("arrange"),
    themes: () => [{ id: "preset:arctic", name: "Arctic Interface" }],
    selectTheme: (id) => (calls.push(`theme:${id}`), true),
    hasUnsavedTheme: () => unsaved,
    ask: (text) => calls.push(`ask:${text}`),
  };
  return { ctx, calls, setUnsaved: (v: boolean) => (unsaved = v) };
}

test("terminal commands invoke the real systems they name (no fake telemetry)", () => {
  const { ctx, calls, setUnsaved } = fakeContext();
  assert.deepEqual(parseCommand("  GoTo   kernel  "), { cmd: "goto", arg: "kernel" });
  assert.deepEqual(completeCommand("se"), ["select"]);
  assert.match(runCommand("help", ctx).lines.map((l) => l.text).join("\n"), /goto <name>/);
  runCommand("goto kern", ctx);
  assert.deepEqual(calls.splice(0), ["nav:p-kernel", "focus:p-kernel"]);
  runCommand("select blue", ctx);
  assert.deepEqual(calls.splice(0), ["focus:obj-1"]);
  runCommand("scale gal", ctx);
  assert.deepEqual(calls.splice(0), ["scale:galactic"]);
  assert.equal(runCommand("scale nowhere", ctx).lines[0].tone, "warn");
  runCommand("open browser", ctx);
  assert.deepEqual(calls.splice(0), ["open:browser"]);
  assert.equal(runCommand("open toaster", ctx).lines[0].tone, "error");
  const where = runCommand("where", ctx).lines.map((l) => l.text).join("\n");
  assert.match(where, /x 1\.00\s+y 2\.00\s+z 3\.00/);
  assert.match(where, /LIFE 42% · cycle 3/);
  setUnsaved(true);
  assert.equal(runCommand("theme arctic", ctx).lines[0].tone, "warn", "unsaved edits are never thrown away by a command");
  setUnsaved(false);
  runCommand("theme arctic", ctx);
  assert.deepEqual(calls.splice(0), ["theme:preset:arctic"]);
  runCommand("what is in this sector?", ctx);
  assert.deepEqual(calls.splice(0), ["ask:what is in this sector?"]);
  assert.equal(runCommand("goto nowhere-at-all", ctx).lines[0].tone, "error");
  assert.ok(runCommand("clear", ctx).clear);
});
