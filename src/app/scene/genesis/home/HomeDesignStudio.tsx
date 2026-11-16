/**
 * ==========================================================
 * LÉLU HOME — DESIGN STUDIO (Mission 15 · 15.1)
 *
 * Where she looks at, researches, changes and makes Home layouts:
 *
 *   Library    the twelve compositions, all SIXTY concepts (each a
 *              working layout), and her own layouts — searchable,
 *              filterable by category; "LÉLU suggests" proposes one
 *   Preview    the real HomeComposition with the live modules at the
 *              real width of an iPhone (390), a tablet (834) and a
 *              desktop (1280); "Try it" makes the frames editable
 *   Research   the concept's notes (composition, strengths,
 *              weaknesses, accessibility, references), her own notes,
 *              and "Research with LÉLU" (the chat's /research command,
 *              put in the composer for her to send)
 *   Layout     family per device, parameters, and every module's size,
 *              visibility, dock and pin — or a brand-new layout
 *   Look       theme, fonts and elemental borders (water, fire, snow…)
 *   Blend      mix two layouts by a weight, or merge them per device
 *
 * Nothing here changes her Home until she presses "Use as a new
 * presentation" (a NEW presentation) or "Apply to my Home" (undoable,
 * with a restore point). Layouts she saves go to "My layouts".
 *
 * Loaded lazily from the Home's edit bar or `?homeStudio`.
 * ==========================================================
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import HomeComposition from "./HomeComposition";
import HomeStore from "./homeStore";
import { HomeIcon, useHomeSignals } from "./HomeModules";
import { useHomeStore } from "./useHomeLive";
import {
  COMPOSITION_KINDS,
  DEVICE_CLASSES,
  HOME_MODULES,
  MODULE_LABEL,
  SIZES,
  TEMPLATES,
  applyHomeOp,
  cloneLayout,
  layoutFromPresentation,
  layoutOf,
  paramsFor,
  presentationFromLayout,
  type CompositionKind,
  type DeviceClass,
  type HomeOp,
  type HomePresentation,
  type HomeTemplate,
  type LayoutParams,
  type ModuleSize,
} from "./homeComposition";
import { CONCEPTS, CONCEPT_CATEGORIES, conceptFor, researchPrompt, searchConcepts, suggestConcept, type Concept } from "./homeConcepts";
import { DEFAULT_MERGE, blendLayouts, mergeLayouts, newLayoutId, type MergePlan, type Side } from "./homeBlend";
import { BORDER_EFFECTS, DEFAULT_STYLE, FONTS, GENERATIVE, THEMES, contrast, mixColor, readStyle, resolveStyle, themeFor, withTheme, type BorderEffect, type HomeStyle } from "./homeStyle";
import "./homeStudio.css";

const FRAME: Record<DeviceClass, { width: number; height: number; label: string; icon: string }> = {
  phone: { width: 390, height: 844, label: "iPhone", icon: "Smartphone" },
  tablet: { width: 834, height: 1194, label: "Tablet", icon: "Tablet" },
  desktop: { width: 1280, height: 860, label: "Desktop", icon: "Monitor" },
};

type View = DeviceClass | "all";
type Tab = "preview" | "research" | "layout" | "look" | "blend";
const YOURS = "__yours__";
const SCRATCH = "__scratch__";

/** Every layout the studio can show, by key. */
interface Entry {
  key: string;
  layout: HomeTemplate;
  concept?: Concept;
  group: "composition" | "concept" | "mine" | "scratch";
}

export default function HomeDesignStudio({ onClose }: { onClose: () => void }) {
  const home = useHomeStore();
  const signals = useHomeSignals();
  const { layouts: mine, notes } = home.presentations;
  const [selected, setSelected] = useState<string>(() => {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("homeStudio") : null;
    return q && (TEMPLATES.some((t) => t.id === q) || conceptFor(q)) ? q : "bento-universe";
  });
  const [view, setView] = useState<View>(() => (window.innerWidth < 700 ? "phone" : "all"));
  const [tab, setTab] = useState<Tab>("preview");
  const [trying, setTrying] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, HomePresentation>>({});
  const [scratch, setScratch] = useState<HomeTemplate | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [suggestion, setSuggestion] = useState<string>("");

  const yours = home.presentations.list.find((p) => p.id === home.presentations.activeId) ?? home.presentations.list[0];

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = TEMPLATES.map((t) => ({ key: t.id, layout: t, group: "composition" }));
    for (const c of CONCEPTS) list.push({ key: c.id, layout: c.layout, concept: c, group: "concept" });
    for (const l of mine) list.push({ key: l.id, layout: l, group: "mine" });
    if (scratch) list.push({ key: SCRATCH, layout: scratch, group: "scratch" });
    return list;
  }, [mine, scratch]);
  const entry = selected === YOURS ? null : (entries.find((e) => e.key === selected) ?? entries[0]);

  const base = useMemo<HomePresentation>(
    () => (selected === YOURS || !entry ? yours : presentationFromLayout(entry.layout, undefined, 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, yours, entry?.layout],
  );
  const presentation = drafts[selected] ?? base;
  const layout = layoutOf(presentation);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setDraft = (next: HomePresentation) => setDrafts((d) => ({ ...d, [selected]: next }));
  const edit = (device: DeviceClass, op: HomeOp) => setDrafts((d) => ({ ...d, [selected]: applyHomeOp(d[selected] ?? base, device, op) }));
  /** Change the draft's layout recipe (kind, params, name); the arrangement is kept. */
  const editLayout = (patch: (l: HomeTemplate) => HomeTemplate) => {
    const current = cloneLayout(layoutOf(presentation));
    const custom = current.custom ? current : { ...current, id: newLayoutId(), custom: true, parents: [...new Set([...(current.parents ?? []), current.id])], name: current.name };
    setDraft({ ...presentation, recipe: patch(custom), updatedAt: Date.now() });
  };
  const setLook = (style: HomeStyle | undefined) => {
    const { style: _old, ...rest } = presentation;
    setDraft(style ? { ...rest, style } : rest);
  };

  const flash = (text: string) => setNote(text);

  const use = () => {
    if (selected === YOURS) {
      HomeStore.updateActive(presentation);
      setDrafts(({ [YOURS]: _gone, ...rest }) => rest);
      flash("Applied to your Home. Undo is on the edit bar; the previous arrangement is also kept as a restore point.");
      return;
    }
    const created = HomeStore.adoptPresentation(presentation, layout.name);
    flash(`Saved as a new presentation, “${created.name}”, and switched to it. Your previous one is kept — switch back from the edit bar.`);
  };
  const saveToMine = () => {
    const saved = HomeStore.saveLayout(layoutFromPresentation(presentation, entry?.group === "mine" ? entry.key : newLayoutId(), layout.name));
    if (entry?.group === "scratch") setScratch(null);
    setDrafts(({ [selected]: _gone, ...rest }) => rest);
    setSelected(saved.id);
    flash(`Saved to My layouts as “${saved.name}”.`);
  };
  const applyLookToHome = () => {
    HomeStore.setStyle(presentation.style ?? null);
    flash(presentation.style ? "This look is now on your Home (undo from the edit bar)." : "Your Home is back to the original LÉLU look.");
  };
  const newLayout = () => {
    const blank: HomeTemplate = {
      id: newLayoutId(),
      name: "New layout",
      blurb: "Your own layout.",
      kind: { phone: "column", tablet: "bento", desktop: "bento" },
      order: ["lelu", "now", "apps", "workspaces", "notifications", "activity", "library", "weather"],
      sizes: { lelu: "m", now: "m", apps: "xl", workspaces: "l", notifications: "m", activity: "m", library: "s", weather: "s" },
      custom: true,
    };
    setScratch(blank);
    setSelected(SCRATCH);
    setDrafts(({ [SCRATCH]: _gone, ...rest }) => rest);
    setTab("layout");
    flash("A new layout — pick its families and parameters, arrange the modules, choose a look, then save it.");
  };
  const showMade = (made: HomeTemplate, text: string) => {
    setScratch(made);
    setDrafts(({ [SCRATCH]: _gone, ...rest }) => rest);
    setSelected(SCRATCH);
    setTab("preview");
    flash(text);
  };
  const suggest = () => {
    const s = suggestConcept({ device: window.innerWidth < 700 ? "phone" : window.innerWidth < 1100 ? "tablet" : "desktop", hour: new Date().getHours(), signals });
    setSelected(s.concept.id);
    setSuggestion(`LÉLU suggests #${s.concept.n} ${s.concept.notes.name}: ${s.reason} Nothing changes until you press “Use”.`);
  };

  const filtered = useMemo(() => {
    const concepts = searchConcepts(query).filter((c) => category === "all" || category === "mine" || c.notes.category === category);
    const q = query.toLowerCase();
    const textMatch = (l: HomeTemplate) => !q || `${l.name} ${l.blurb}`.toLowerCase().includes(q);
    return {
      compositions: category === "all" ? TEMPLATES.filter(textMatch) : [],
      concepts: category === "mine" ? [] : concepts,
      mine: category === "all" || category === "mine" ? mine.filter(textMatch) : [],
    };
  }, [query, category, mine]);

  const devices: DeviceClass[] = view === "all" ? ["phone", "tablet", "desktop"] : [view];
  const editDevice: DeviceClass = view === "all" ? "desktop" : view;
  const dirty = Boolean(drafts[selected]);
  const title = selected === YOURS ? `Your Home — ${yours.name}` : entry?.concept ? `#${entry.concept.n} ${layout.name}` : layout.name;

  return createPortal(
    <div className="hs" role="dialog" aria-modal="true" aria-label="Home Design Studio" data-home-studio>
      <header className="hs-head">
        <div className="hs-title">
          <strong>Home Design Studio</strong>
          <small>60 concepts · 12 compositions · {mine.length} of yours · blend, merge, themes, fonts, borders</small>
        </div>
        <div className="hs-seg" role="radiogroup" aria-label="Device">
          {(["phone", "tablet", "desktop", "all"] as View[]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
              {v === "all" ? "All three" : FRAME[v].label}
            </button>
          ))}
        </div>
        <button type="button" className="hs-close" onClick={onClose} aria-label="Close the studio">
          <HomeIcon name="X" size={18} />
        </button>
      </header>

      <nav className="hs-list" aria-label="Layouts">
        <div className="hs-search">
          <HomeIcon name="Search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 60 concepts, references…" aria-label="Search layouts" />
        </div>
        <select className="hs-cat" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {CONCEPT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="mine">My layouts only</option>
        </select>
        <div className="hs-list-actions">
          <button type="button" onClick={newLayout} data-home-studio-new>
            <HomeIcon name="Plus" size={14} /> New layout
          </button>
          <button type="button" onClick={suggest} data-home-studio-suggest>
            <HomeIcon name="Wand2" size={14} /> LÉLU suggests
          </button>
        </div>
        <ListButton on={selected === YOURS} onClick={() => setSelected(YOURS)} title="Your Home" sub={yours.name} />
        {scratch ? <ListButton on={selected === SCRATCH} onClick={() => setSelected(SCRATCH)} title={`✦ ${scratch.name}`} sub="Not saved yet" tag="draft" /> : null}
        {filtered.mine.length ? <h4>My layouts</h4> : null}
        {filtered.mine.map((l) => (
          <ListButton key={l.id} on={selected === l.id} onClick={() => setSelected(l.id)} title={l.name} sub={l.blurb || kindsLine(l)} tag="mine" data={l.id} />
        ))}
        {filtered.compositions.length ? <h4>Compositions</h4> : null}
        {filtered.compositions.map((t, i) => (
          <ListButton key={t.id} on={selected === t.id} onClick={() => setSelected(t.id)} title={`${i + 1}. ${t.name}`} sub={t.blurb} data={t.id} />
        ))}
        {filtered.concepts.length ? <h4>The sixty concepts</h4> : null}
        {filtered.concepts.map((c) => (
          <ListButton key={c.id} on={selected === c.id} onClick={() => setSelected(c.id)} title={`#${c.n} ${c.notes.name}`} sub={c.layout.blurb} tag={c.notes.catalogStatus === "BUILT" ? "built" : "working"} data={c.id} />
        ))}
        {!filtered.compositions.length && !filtered.concepts.length && !filtered.mine.length ? <p className="hs-empty">Nothing matches “{query}”.</p> : null}
      </nav>

      <section className="hs-main">
        <div className="hs-crumb">
          <h2>{title}</h2>
          <span className="hs-kinds">
            {DEVICE_CLASSES.map((d) => (
              <span key={d}>
                {FRAME[d].label}: <b>{layout.kind[d]}</b>
              </span>
            ))}
          </span>
        </div>
        <div className="hs-tabs" role="tablist" aria-label="Studio">
          {(
            [
              ["preview", "Preview", "LayoutGrid"],
              ["research", "Research", "BookMarked"],
              ["layout", "Layout", "Settings2"],
              ["look", "Look", "Palette"],
              ["blend", "Blend & merge", "Combine"],
            ] as Array<[Tab, string, string]>
          ).map(([id, label, icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-studio-tab={id}>
              <HomeIcon name={icon} size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="hs-bar">
          <label className="hs-try">
            <input type="checkbox" checked={trying} onChange={(e) => setTrying(e.target.checked)} /> Try it (drag, resize, float, dock)
          </label>
          {dirty ? (
            <button type="button" onClick={() => setDrafts(({ [selected]: _gone, ...rest }) => rest)}>
              <HomeIcon name="RotateCcw" size={14} /> Discard changes
            </button>
          ) : null}
          <button type="button" onClick={saveToMine} data-home-studio-save>
            <HomeIcon name="Save" size={14} /> Save to My layouts
          </button>
          <button type="button" onClick={applyLookToHome} data-home-studio-look>
            <HomeIcon name="Palette" size={14} /> Put this look on my Home
          </button>
          <button type="button" className="hs-use" onClick={use} data-home-studio-use disabled={selected === YOURS && !dirty}>
            <HomeIcon name="Check" size={14} /> {selected === YOURS ? "Apply to my Home" : "Use as a new presentation"}
          </button>
        </div>
        {suggestion ? (
          <p className="hs-note hs-suggest" role="status">
            {suggestion}
          </p>
        ) : null}
        {note ? (
          <p className="hs-note" role="status">
            {note}
          </p>
        ) : null}

        {tab === "research" ? (
          <Research entry={entry} layout={layout} notes={notes} onClose={onClose} />
        ) : tab === "layout" ? (
          <LayoutEditor layout={layout} presentation={presentation} device={editDevice} onLayout={editLayout} onOp={(op) => edit(editDevice, op)} />
        ) : tab === "look" ? (
          <LookEditor style={presentation.style} onStyle={setLook} />
        ) : tab === "blend" ? (
          <BlendPanel a={layout} aStyle={presentation.style} entries={entries} onMade={showMade} />
        ) : null}

        <div className="hs-frames" data-view={view}>
          {devices.map((device) => (
            <Frame key={device} device={device} share={devices.length} styleVars={resolveStyle(presentation.style).vars}>
              <HomeComposition presentation={presentation} device={device} preview editing={trying} signals={signals} onOp={(op) => edit(device, op)} label={`${presentation.name} on ${FRAME[device].label}`} />
            </Frame>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function kindsLine(l: HomeTemplate): string {
  return DEVICE_CLASSES.map((d) => l.kind[d]).join(" · ");
}

function ListButton({ on, onClick, title, sub, tag, data }: { on: boolean; onClick: () => void; title: string; sub: string; tag?: string; data?: string }) {
  return (
    <button type="button" data-on={on} onClick={onClick} data-template={data}>
      <strong>
        {title}
        {tag ? <em data-tag={tag}>{tag}</em> : null}
      </strong>
      <small>{sub}</small>
    </button>
  );
}

/* ---------------------------------------------------------------
 * Research
 * ------------------------------------------------------------- */

function Research({ entry, layout, notes, onClose }: { entry: Entry | null; layout: HomeTemplate; notes: Record<string, string>; onClose: () => void }) {
  const key = entry?.concept?.id ?? layout.id;
  const [text, setText] = useState(notes[key] ?? "");
  useEffect(() => setText(notes[key] ?? ""), [key, notes]);
  const c = entry?.concept?.notes;
  const prompt = researchPrompt(c ?? { name: layout.name, refs: "", refKind: "original" });
  const rows: Array<[string, string]> = c
    ? [
        ["Composition", c.composition],
        ["Where modules sit", c.position],
        ["Hierarchy", c.hierarchy],
        ["Navigation", c.navigation],
        ["Input", c.input],
        ["Phone / desktop", c.devices],
        ["Strengths", c.strengths],
        ["Weaknesses", c.weaknesses],
        ["Accessibility", c.a11y],
        ["Performance", c.perf],
        ["Complexity", c.complexity],
        ["References", c.refs],
      ]
    : [
        ["About", layout.blurb || "Your own layout."],
        ["Families", kindsLine(layout)],
        ["Made from", (layout.parents ?? []).map((p) => conceptFor(p)?.notes.name ?? TEMPLATES.find((t) => t.id === p)?.name ?? p).join(", ") || "—"],
      ];
  const research = () => {
    window.dispatchEvent(new CustomEvent("lelu-open-universe", { detail: { draft: prompt } }));
    onClose();
  };
  return (
    <div className="hs-panel hs-research" data-studio-panel="research">
      {c ? (
        <p className="hs-verdict">
          <span data-status={c.catalogStatus}>Mission 15 catalog: {c.catalogStatus}</span> — {c.catalogVerdict}.{" "}
          <b>Now a working layout</b> ({kindsLine(layout)}){entry?.concept?.source === "built-in" ? ", realised by a built-in composition" : ""}.
          {c.n === 40 ? " The day column works with today’s modules; a calendar source is still not wired, so it shows no appointments." : ""}
        </p>
      ) : null}
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {c?.refKind === "product" ? <p className="hs-fine">Product descriptions come from general knowledge and were not re-verified here — use “Research with LÉLU” to check them against live sources.</p> : null}
      <label className="hs-notes">
        <span>
          <HomeIcon name="NotebookPen" size={14} /> Your notes
        </span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => HomeStore.setNote(key, text)} placeholder="What you like, what to change, ideas to blend…" rows={4} data-studio-notes />
      </label>
      <div className="hs-row">
        <button type="button" onClick={research} data-studio-research>
          <HomeIcon name="Search" size={14} /> Research with LÉLU
        </button>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(prompt)}>
          <HomeIcon name="Copy" size={14} /> Copy the research prompt
        </button>
        <code className="hs-prompt">{prompt}</code>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
 * Layout editor
 * ------------------------------------------------------------- */

const PARAM_SLIDERS: Array<{ key: keyof LayoutParams; label: string; min: number; max: number; step: number; for: CompositionKind[] | "all" }> = [
  { key: "density", label: "Density (compact → airy)", min: 0, max: 1, step: 0.05, for: "all" },
  { key: "lanes", label: "Lanes / rows", min: 1, max: 6, step: 1, for: ["masonry", "lanes", "rows"] },
  { key: "ratio", label: "Main pane share", min: 0.2, max: 0.9, step: 0.01, for: ["split", "stage"] },
  { key: "maxWidth", label: "Column width (px, 0 = full)", min: 0, max: 1400, step: 20, for: ["column", "focus"] },
  { key: "tilt", label: "Card tilt (°)", min: 0, max: 20, step: 1, for: ["scatter"] },
  { key: "depth", label: "Depth", min: 0, max: 1, step: 0.05, for: ["spatial", "layered"] },
  { key: "window", label: "Window onto the Cosmos", min: 0, max: 0.6, step: 0.02, for: "all" },
];

function LayoutEditor({ layout, presentation, device, onLayout, onOp }: { layout: HomeTemplate; presentation: HomePresentation; device: DeviceClass; onLayout: (patch: (l: HomeTemplate) => HomeTemplate) => void; onOp: (op: HomeOp) => void }) {
  const params = paramsFor(layout, device);
  const profile = presentation.profiles[device];
  const setParam = (key: keyof LayoutParams, value: LayoutParams[keyof LayoutParams]) =>
    onLayout((l) => ({ ...l, deviceParams: { ...(l.deviceParams ?? {}), [device]: { ...(l.deviceParams?.[device] ?? {}), [key]: value } } }));
  const setAllParams = (key: keyof LayoutParams, value: LayoutParams[keyof LayoutParams]) =>
    onLayout((l) => {
      const deviceParams = { ...(l.deviceParams ?? {}) };
      for (const d of DEVICE_CLASSES) if (deviceParams[d]) deviceParams[d] = { ...deviceParams[d], [key]: value };
      return { ...l, params: { ...(l.params ?? {}), [key]: value }, deviceParams };
    });
  return (
    <div className="hs-panel hs-layout" data-studio-panel="layout">
      <div className="hs-grid2">
        <label className="hs-field">
          <span>Name</span>
          <input value={layout.name} maxLength={60} onChange={(e) => onLayout((l) => ({ ...l, name: e.target.value }))} data-studio-name />
        </label>
        <label className="hs-field">
          <span>About</span>
          <input value={layout.blurb} maxLength={200} onChange={(e) => onLayout((l) => ({ ...l, blurb: e.target.value }))} />
        </label>
      </div>
      <h3>Family on each device</h3>
      <div className="hs-grid3">
        {DEVICE_CLASSES.map((d) => (
          <label key={d} className="hs-field">
            <span>{FRAME[d].label}</span>
            <select value={layout.kind[d]} onChange={(e) => onLayout((l) => ({ ...l, kind: { ...l.kind, [d]: e.target.value as CompositionKind } }))} data-studio-kind={d}>
              {COMPOSITION_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} — {k.blurb}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <h3>
        Parameters <small>for the {FRAME[device].label.toLowerCase()} (pick a device above to tune another)</small>
      </h3>
      <div className="hs-grid3">
        {PARAM_SLIDERS.filter((p) => p.for === "all" || p.for.includes(layout.kind[device])).map((p) => {
          const value = (params[p.key] as number | undefined) ?? (p.key === "density" ? 0.5 : p.key === "window" ? 0 : p.min);
          return (
            <label key={p.key} className="hs-field">
              <span>
                {p.label}: <b>{p.step < 1 ? value.toFixed(2) : value}</b>
              </span>
              <input type="range" min={p.min} max={p.max} step={p.step} value={value} onChange={(e) => setParam(p.key, Number(e.target.value))} data-studio-param={p.key} />
            </label>
          );
        })}
        <label className="hs-field">
          <span>Reorders itself by</span>
          <select value={params.adaptive ?? "none"} onChange={(e) => setAllParams("adaptive", e.target.value as LayoutParams["adaptive"])}>
            <option value="none">Nothing — her order</option>
            <option value="signals">What needs her (approvals, live work)</option>
            <option value="time">Time of day</option>
            <option value="usage">What she opens most</option>
          </select>
        </label>
        <label className="hs-field">
          <span>Grouped modules</span>
          <select value={params.groupView ?? "tabs"} onChange={(e) => setAllParams("groupView", e.target.value as LayoutParams["groupView"])}>
            <option value="tabs">As tabs</option>
            <option value="stack">Stacked, all visible</option>
          </select>
        </label>
        <label className="hs-field">
          <span>Lane / row names (comma-separated)</span>
          <input value={(params.laneNames ?? []).join(", ")} onChange={(e) => setAllParams("laneNames", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
        </label>
        {(
          [
            ["links", "Constellation links"],
            ["stacked", "Deck cards overlap (stack)"],
            ["rail", "Timeline rail"],
            ["rings", "Story rings"],
          ] as Array<[keyof LayoutParams, string]>
        ).map(([k, label]) => (
          <label key={k} className="hs-check">
            <input type="checkbox" checked={Boolean(params[k] ?? (k === "links"))} onChange={(e) => setAllParams(k, e.target.checked)} /> {label}
          </label>
        ))}
      </div>
      <h3>
        Modules <small>on the {FRAME[device].label.toLowerCase()}</small>
      </h3>
      <table className="hs-modules">
        <thead>
          <tr>
            <th>Module</th>
            <th>Size</th>
            <th>Shown</th>
            <th>In the dock</th>
            <th>Pinned first</th>
            <th>Order</th>
          </tr>
        </thead>
        <tbody>
          {profile.order.filter((id) => (HOME_MODULES as readonly string[]).includes(id)).map((id) => {
            const m = profile.modules[id];
            return (
              <tr key={id}>
                <th scope="row">{MODULE_LABEL[id]}</th>
                <td>
                  <select value={m.size} disabled={m.locked} onChange={(e) => onOp({ op: "resize", id, size: e.target.value as ModuleSize })} aria-label={`${MODULE_LABEL[id]} size`}>
                    {SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={!m.hidden} onChange={() => onOp({ op: "toggle", id, flag: "hidden" })} aria-label={`Show ${MODULE_LABEL[id]}`} />
                </td>
                <td>
                  <input type="checkbox" checked={m.mode === "dock"} disabled={m.locked} onChange={() => onOp(m.mode === "dock" ? { op: "restore", id } : { op: "dock", id })} aria-label={`Dock ${MODULE_LABEL[id]}`} />
                </td>
                <td>
                  <input type="checkbox" checked={m.pinned} onChange={() => onOp({ op: "toggle", id, flag: "pinned" })} aria-label={`Pin ${MODULE_LABEL[id]}`} />
                </td>
                <td className="hs-order">
                  <button type="button" onClick={() => onOp({ op: "shift", id, delta: -1 })} aria-label={`Move ${MODULE_LABEL[id]} earlier`}>
                    <HomeIcon name="ChevronUp" size={13} />
                  </button>
                  <button type="button" onClick={() => onOp({ op: "shift", id, delta: 1 })} aria-label={`Move ${MODULE_LABEL[id]} later`}>
                    <HomeIcon name="ChevronDown" size={13} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------
 * Look: themes, fonts, borders
 * ------------------------------------------------------------- */

/** Ink against the glass laid over a dark backdrop (what the eye actually sees). */
function inkContrast(style: HomeStyle): number {
  const r = resolveStyle(style);
  const glass = r.vars["--glass"];
  const alpha = Number(/,\s*([\d.]+)\)$/.exec(glass)?.[1] ?? 0.5);
  const seen = mixColor("#12052a", glass.replace(/,\s*[\d.]+\)$/, ", 1)"), alpha);
  return contrast(r.palette.ink, seen);
}

function LookEditor({ style: raw, onStyle }: { style?: HomeStyle; onStyle: (s: HomeStyle | undefined) => void }) {
  const style = readStyle(raw) ?? DEFAULT_STYLE;
  const set = (patch: Partial<HomeStyle>) => onStyle({ ...style, ...patch });
  const ratio = inkContrast(style);
  return (
    <div className="hs-panel hs-look" data-studio-panel="look">
      <h3>Theme</h3>
      <div className="hs-themes" role="radiogroup" aria-label="Theme">
        {[...THEMES, themeFor(GENERATIVE, style.seed)].map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={style.theme === t.id}
            onClick={() => onStyle(withTheme(style, t.id))}
            style={{ background: `linear-gradient(135deg, ${t.palette.accent}, ${t.palette.accent2})`, color: t.palette.ink }}
            data-theme={t.id}
          >
            <span style={{ background: t.palette.glass, borderColor: t.palette.edge }}>{t.name}</span>
          </button>
        ))}
      </div>
      {style.theme === GENERATIVE ? (
        <div className="hs-row">
          <label className="hs-field hs-grow">
            <span>Generative hue: {Math.round(style.seed)}°</span>
            <input type="range" min={0} max={359} value={style.seed} onChange={(e) => set({ seed: Number(e.target.value), accent: undefined, ink: undefined })} />
          </label>
          <button type="button" onClick={() => set({ seed: Math.floor(Math.random() * 360), accent: undefined, ink: undefined })}>
            <HomeIcon name="Shuffle" size={14} /> Shuffle
          </button>
        </div>
      ) : null}

      <h3>Borders</h3>
      <div className="hs-effects" role="radiogroup" aria-label="Border effect">
        {BORDER_EFFECTS.map((e) => (
          <button key={e.id} type="button" role="radio" aria-checked={style.border === e.id} onClick={() => set({ border: e.id })} title={e.blurb} data-effect={e.id}>
            <span className="hs-fx-swatch hc-module">{e.id !== "none" ? <span className="hc-fx" data-fx={e.id} aria-hidden /> : null}</span>
            {e.name}
          </button>
        ))}
      </div>
      <div className="hs-grid3">
        <label className="hs-field">
          <span>Second border (layered inside)</span>
          <select value={style.border2} onChange={(e) => set({ border2: e.target.value as BorderEffect })} data-studio-border2>
            {BORDER_EFFECTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id === "none" ? "None" : e.name}
              </option>
            ))}
          </select>
        </label>
        <Slider label="Border strength" value={style.intensity} min={0} max={1} step={0.05} onChange={(v) => set({ intensity: v })} />
        <label className="hs-check">
          <input type="checkbox" checked={style.motion} onChange={(e) => set({ motion: e.target.checked })} /> Animate the borders
        </label>
      </div>

      <h3>Fonts</h3>
      <div className="hs-grid2">
        {(
          [
            ["font", "Text"],
            ["headingFont", "Headings"],
          ] as Array<["font" | "headingFont", string]>
        ).map(([k, label]) => (
          <label key={k} className="hs-field">
            <span>{label}</span>
            <select value={style[k]} onChange={(e) => set({ [k]: e.target.value })} style={{ fontFamily: FONTS.find((f) => f.id === style[k])?.stack }} data-studio-font={k}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="hs-fine">Fonts are the ones on this device (nothing is downloaded), so a stack can look different on an iPhone and on Windows.</p>

      <h3>Glass and colour</h3>
      <div className="hs-grid3">
        <Slider label="Corner radius" value={style.radius} min={0} max={40} step={1} unit="px" onChange={(v) => set({ radius: v })} />
        <Slider label="Glass (clear → solid)" value={style.opacity} min={0} max={1} step={0.05} onChange={(v) => set({ opacity: v })} />
        <Slider label="Backdrop tint" value={style.tint} min={0} max={1} step={0.05} onChange={(v) => set({ tint: v })} />
        <label className="hs-field">
          <span>Accent</span>
          <input type="color" value={toHex(style.accent ?? resolveStyle(style).palette.accent)} onChange={(e) => set({ accent: e.target.value })} />
        </label>
        <label className="hs-field">
          <span>Text colour</span>
          <input type="color" value={toHex(style.ink ?? resolveStyle(style).palette.ink)} onChange={(e) => set({ ink: e.target.value })} />
        </label>
        <p className="hs-contrast" data-ok={ratio >= 4.5}>
          Text contrast on the glass: <b>{ratio.toFixed(1)} : 1</b> {ratio >= 4.5 ? "— readable (WCAG AA)" : "— too low for small text; make the glass more solid or the text lighter"}
        </p>
      </div>
      <div className="hs-row">
        <button type="button" onClick={() => onStyle(undefined)}>
          <HomeIcon name="RotateCcw" size={14} /> Original LÉLU look
        </button>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="hs-field">
      <span>
        {label}: <b>{step < 1 ? value.toFixed(2) : Math.round(value)}{unit ?? ""}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function toHex(color: string): string {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).replace(/./g, (c) => c + c)}`;
  const hsl = /hsla?\(([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/.exec(color);
  if (hsl) {
    const rgb = mixColor(color, color, 0);
    return toHex(rgb);
  }
  return "#e879f9";
}

/* ---------------------------------------------------------------
 * Blend & merge
 * ------------------------------------------------------------- */

function BlendPanel({ a, aStyle, entries, onMade }: { a: HomeTemplate; aStyle?: HomeStyle; entries: Entry[]; onMade: (made: HomeTemplate, text: string) => void }) {
  const options = entries.filter((e) => e.group !== "scratch");
  const [bKey, setBKey] = useState<string>(() => (options.find((e) => e.layout.id !== a.id && e.key === "concept-51")?.key ?? options[0].key));
  const [t, setT] = useState(0.5);
  const [mode, setMode] = useState<"blend" | "merge">("blend");
  const [plan, setPlan] = useState<MergePlan>(DEFAULT_MERGE);
  const [name, setName] = useState("");
  const b = options.find((e) => e.key === bKey)?.layout ?? options[0].layout;
  const aWithLook = aStyle ? { ...a, style: aStyle } : a;
  const make = () => {
    const made = mode === "blend" ? blendLayouts(aWithLook, b, t, name) : mergeLayouts(aWithLook, b, plan, name);
    onMade(made, `${mode === "blend" ? "Blended" : "Merged"} “${a.name}” and “${b.name}” into “${made.name}”. It is a draft: save it to My layouts or use it as a presentation.`);
  };
  const sideSelect = (value: Side | "follow" | "blend" | "none", onChange: (v: string) => void, choices: string[], label: string) => (
    <label className="hs-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c === "a" ? `A — ${a.name}` : c === "b" ? `B — ${b.name}` : c === "follow" ? "Same as the family" : c === "blend" ? "Blend of both" : "Original LÉLU look"}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="hs-panel hs-blend" data-studio-panel="blend">
      <div className="hs-grid2">
        <p className="hs-field">
          <span>A (the layout you are looking at)</span>
          <b>{a.name}</b>
        </p>
        <label className="hs-field">
          <span>B</span>
          <select value={bKey} onChange={(e) => setBKey(e.target.value)} data-studio-blend-b>
            {(["mine", "composition", "concept"] as const).map((g) => (
              <optgroup key={g} label={g === "mine" ? "My layouts" : g === "composition" ? "Compositions" : "Concepts"}>
                {options
                  .filter((e) => e.group === g)
                  .map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.concept ? `#${e.concept.n} ` : ""}
                      {e.layout.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <div className="hs-seg hs-seg-inline" role="radiogroup" aria-label="Blend or merge">
        <button type="button" role="radio" aria-checked={mode === "blend"} onClick={() => setMode("blend")}>
          <HomeIcon name="Combine" size={14} /> Blend
        </button>
        <button type="button" role="radio" aria-checked={mode === "merge"} onClick={() => setMode("merge")}>
          <HomeIcon name="GitMerge" size={14} /> Merge
        </button>
      </div>
      {mode === "blend" ? (
        <div className="hs-grid2">
          <label className="hs-field">
            <span>
              Mix: <b>{Math.round((1 - t) * 100)}% A</b> · <b>{Math.round(t * 100)}% B</b>
            </span>
            <input type="range" min={0} max={1} step={0.05} value={t} onChange={(e) => setT(Number(e.target.value))} data-studio-blend-t />
          </label>
          <p className="hs-fine">Order and sizes interpolate on every device; hidden, docked and pinned go by weighted vote; numbers (lanes, ratio, density…) interpolate; the family comes from the side over 50%. Looks blend too — colours mix, and two different borders are kept as an outer and inner pair.</p>
        </div>
      ) : (
        <>
          <div className="hs-grid3">
            {DEVICE_CLASSES.map((d) => (
              <label key={d} className="hs-field">
                <span>{FRAME[d].label} family</span>
                <select value={plan.kind[d]} onChange={(e) => setPlan({ ...plan, kind: { ...plan.kind, [d]: e.target.value as Side } })}>
                  <option value="a">
                    A — {a.kind[d]} ({a.name})
                  </option>
                  <option value="b">
                    B — {b.kind[d]} ({b.name})
                  </option>
                </select>
              </label>
            ))}
          </div>
          <div className="hs-grid3">
            {sideSelect(plan.arrangement, (v) => setPlan({ ...plan, arrangement: v as MergePlan["arrangement"] }), ["follow", "a", "b", "blend"], "Arrangement (order, sizes, dock)")}
            {sideSelect(plan.params, (v) => setPlan({ ...plan, params: v as MergePlan["params"] }), ["follow", "a", "b", "blend"], "Parameters")}
            {sideSelect(plan.look, (v) => setPlan({ ...plan, look: v as MergePlan["look"] }), ["a", "b", "blend", "none"], "Look")}
          </div>
        </>
      )}
      <div className="hs-row">
        <label className="hs-field hs-grow">
          <span>Name (optional)</span>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={mode === "blend" ? `${a.name} × ${b.name}` : `${a.name} + ${b.name}`} />
        </label>
        <button type="button" className="hs-use" onClick={make} data-studio-blend-make>
          <HomeIcon name={mode === "blend" ? "Combine" : "GitMerge"} size={14} /> {mode === "blend" ? "Blend them" : "Merge them"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
 * A device-sized frame scaled to the space it has (no re-layout: real widths)
 * ------------------------------------------------------------- */

function Frame({ device, share, styleVars, children }: { device: DeviceClass; share: number; styleVars: Record<string, string>; children: ReactNode }) {
  const outer = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.4);
  const f = FRAME[device];
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = Math.max(320, window.innerHeight - 190);
      setScale(Math.min(1, w / f.width, share === 1 ? h / f.height : 10));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [f.width, f.height, share]);
  return (
    <figure className="hs-frame" data-device={device} ref={outer}>
      <figcaption>
        <HomeIcon name={f.icon} size={14} /> {f.label} · {f.width}px
      </figcaption>
      <div className="hs-viewport-box" style={{ height: f.height * scale }}>
        <div className="hs-viewport" style={{ ...styleVars, width: f.width, height: f.height, transform: `scale(${scale})` }}>
          <div className="hs-cosmos" aria-hidden />
          <div className="hs-tint" aria-hidden />
          <div className="hs-home lch lch-m15" data-device={device} style={{ ["--canvas-h" as string]: `${f.height - 150}px`, ["--deck-h" as string]: `${Math.round(f.height * 0.42)}px` }}>
            <header className="lch-header">
              <span className="lch-round">
                <HomeIcon name="Menu" />
              </span>
              <div className="lch-brand">
                <span className="lch-brand-name">
                  LÉLU<sup>+</sup>
                </span>
                <span className="lch-brand-sub">Workspace</span>
              </div>
              <div className="lch-header-right">
                <span className="lch-round lch-cosmos">
                  <span className="lch-cosmos-core" />
                </span>
              </div>
            </header>
            {children}
          </div>
        </div>
      </div>
    </figure>
  );
}
