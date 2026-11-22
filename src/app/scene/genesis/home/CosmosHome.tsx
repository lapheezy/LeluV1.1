/**
 * ==========================================================
 * LÉLU HOME — THE COSMOS WORKSPACE
 *
 * The home of the app, painted ON the live Cosmos (the scene keeps
 * rendering behind these glass surfaces; nothing here hides it):
 *
 *   header        menu · LÉLU identity · cloud · notifications · Cosmos
 *   hero          weather (Open-Meteo) · LÉLU herself (her 3D face, the
 *                 companion's hero presence) · what she is doing now
 *   apps          Chat · Browser · Studio · Workspaces · Agents · Files
 *   workspaces    the windows you left (resumable) and your projects
 *   notifications · app library (every registered panel, by group)
 *   activity      her live work: task, action, tool, voice
 *
 * Every entry opens an EXISTING panel through GenesisCore.openPanel;
 * every number and line is read from the system that owns it.
 * ==========================================================
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { useGenesis, type GenesisPanel } from "../GenesisCore";
import { PRIMARY, APPS, type AppGroup } from "./homeCatalog";
import { NeuralEmbedSlot, NeuralToggle } from "../neural/NeuralEmbedSlot";
import HomeStore from "./homeStore";
import { useCloud, useHomeStore, useNotifications } from "./useHomeLive";
import { launch } from "./homeActions";
import { announceHome } from "./homePresence";
import { HomeIcon, useHomeSignals } from "./HomeModules";
import HomeComposition from "./HomeComposition";
import { TEMPLATES, deviceClassFor, layoutOf, type DeviceClass, type TemplateId } from "./homeComposition";
import { resolveStyle } from "./homeStyle";
import "./cosmosHome.css";

// The studio is only for arranging: it loads when opened, never with the Home.
const HomeDesignStudio = lazy(() => import("./HomeDesignStudio"));
// The Retro Terminal layout (kind "terminal") loads only when a presentation uses it.
const RetroTerminal = lazy(() => import("./RetroTerminal"));

export { HomeIcon };

/** The Home's own width class (phone · tablet · desktop), followed live. */
export function useDeviceClass(): DeviceClass {
  const read = () => (typeof window === "undefined" ? "desktop" : deviceClassFor(window.visualViewport?.width ?? window.innerWidth));
  const [device, setDevice] = useState<DeviceClass>(read);
  useEffect(() => {
    const update = () => setDevice(read());
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return device;
}

export default function CosmosHome({ onOpenLibrary, onOpenWindows }: { onOpenLibrary: (group?: AppGroup) => void; onOpenWindows: () => void }) {
  const genesis = useGenesis();
  const notes = useNotifications();
  const cloud = useCloud();
  const home = useHomeStore();
  const signals = useHomeSignals();
  const device = useDeviceClass();
  const [studio, setStudio] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).has("homeStudio"));
  const [neural, setNeural] = useState(false);
  // While the home is in front, the scene's portal name chips stay hidden (they showed through the cards).
  useEffect(() => announceHome(), []);
  // Arranging belongs to this visit: leaving Home (a window, the Universe) ends it.
  useEffect(() => () => HomeStore.setEditing(false), []);

  const open = (id: GenesisPanel, from?: Element | null) => launch(genesis, id, from ?? null);
  const cloudOn = cloud.status === "connected" && Boolean(cloud.session);
  const { editing } = home.presentations;
  const presentation = HomeStore.activePresentation();
  // The presentation's look (theme, fonts): its CSS variables go on the Home itself,
  // so the header and edit bar follow it as well as the modules.
  const look = presentation.style ? resolveStyle(presentation.style) : null;
  // The Retro Terminal is one more layout of this same Home: same presentation,
  // same modules, same stores — only its frame and its own appearance differ.
  const terminal = layoutOf(presentation).kind[device] === "terminal";

  const neuralSlot = (
    <NeuralEmbedSlot
      open={neural}
      host="home"
      hostLabel="Home"
      focus="app:home"
      context={[{ id: "app:home", label: "Home" }, ...PRIMARY.filter((p) => p !== "workspaces").map((p) => ({ id: `app:${p}`, label: APPS.find((a) => a.id === p)?.label ?? p })), { id: "interface:cosmos", label: "Cosmos" }, { id: "interface:lelu-room", label: "LÉLU's Room" }]}
      hostActions={[{ id: "open-app", label: "Open app", when: (e) => e.type === "app" && APPS.some((a) => a.id === e.sourceId), run: (e) => open(e.sourceId as GenesisPanel) }]}
      unindexed="the Home's arrangement (presentations, module positions) — presentation state, kept out of the map on purpose"
      onClose={() => setNeural(false)}
      style={{ position: "fixed", top: 74, right: 12, zIndex: terminal ? 61 : 41 }}
    />
  );
  const designStudio = studio ? (
    <Suspense fallback={null}>
      <HomeDesignStudio onClose={() => setStudio(false)} />
    </Suspense>
  ) : null;

  if (terminal) {
    return (
      <>
        <Suspense fallback={null}>
          <RetroTerminal
            presentation={presentation}
            device={device}
            editing={editing}
            signals={signals}
            editBar={editing ? <HomeEditBar device={device} onStudio={() => setStudio(true)} /> : null}
            neural={<NeuralToggle host="home" open={neural} onToggle={() => setNeural(!neural)} style={{ alignSelf: "center" }} />}
            onOpenLibrary={() => onOpenLibrary()}
            onOpenWindows={onOpenWindows}
          />
        </Suspense>
        {neuralSlot}
        {designStudio}
      </>
    );
  }

  return (
    <>
    {/* The Cosmos stays alive behind; this haze only quiets it, like the
        reference's atmosphere — no labels of the scene fighting the text. */}
    <div className="lch-scrim" aria-hidden />
    {look ? <div className="lch-tint" aria-hidden style={look.vars} /> : null}
    <div className="lch lch-m15" data-lelu-home data-device={device} data-editing={editing ? "true" : "false"} role="main" aria-label="LÉLU home" style={look ? { ...look.vars, fontFamily: look.vars["--hc-font"] } : undefined}>
      <header className="lch-header">
        <button type="button" className="lch-round" aria-label="Open the app library" onClick={() => onOpenLibrary()}>
          <HomeIcon name="Menu" />
        </button>
        <div className="lch-brand">
          <span className="lch-brand-name">
            LÉLU<sup>+</sup>
          </span>
          <span className="lch-brand-sub">{presentation.name}</span>
        </div>
        <div className="lch-header-right">
          <button
            type="button"
            className="lch-round"
            aria-label={editing ? "Finish arranging the home" : "Arrange the home"}
            aria-pressed={editing}
            title={editing ? "Done" : "Arrange"}
            data-home-customize
            onClick={() => HomeStore.setEditing(!editing)}
          >
            <HomeIcon name={editing ? "Check" : "Pencil"} />
          </button>
          <button
            type="button"
            className="lch-round"
            aria-label={cloudOn ? `Cloud sync on${cloud.email ? ` — ${cloud.email}` : ""}` : "Cloud sync off — open settings"}
            title={cloudOn ? "Cloud sync on" : "Cloud sync off"}
            onClick={(e) => open("settings", e.currentTarget)}
          >
            <HomeIcon name={cloudOn ? "Cloud" : "CloudOff"} />
            <span className="lch-dot" data-on={cloudOn ? "true" : "false"} />
          </button>
          <button type="button" className="lch-round" aria-label={`Notifications${notes.unread ? `, ${notes.unread} unread` : ""}`} onClick={(e) => open("notifications", e.currentTarget)}>
            <HomeIcon name="Bell" />
            {notes.unread ? <span className="lch-badge">{notes.unread > 9 ? "9+" : notes.unread}</span> : null}
          </button>
          <NeuralToggle host="home" open={neural} onToggle={() => setNeural(!neural)} style={{ alignSelf: "center" }} />
          <button type="button" className="lch-round lch-cosmos" aria-label="Look at the Cosmos" title="Look at the Cosmos" onClick={() => HomeStore.setImmersive(true)}>
            <span className="lch-cosmos-core" />
          </button>
        </div>
      </header>

      {editing ? <HomeEditBar device={device} onStudio={() => setStudio(true)} /> : null}

      <HomeComposition
        presentation={presentation}
        device={device}
        editing={editing}
        signals={signals}
        onOp={(op) => HomeStore.applyHomeOp(device, op)}
        onOpenLibrary={onOpenLibrary}
        onOpenWindows={onOpenWindows}
      />
    </div>
    {/* M17.2-WP02: the Home's place in the Neural Map — the Home, its apps
        and the interfaces it leads to — in the Home itself. */}
    {neuralSlot}
    {designStudio}
    </>
  );
}

/** Presentations: switch · new from a composition · rename · duplicate · undo/redo · reset · restore · delete. */
function HomeEditBar({ device, onStudio }: { device: DeviceClass; onStudio: () => void }) {
  const home = useHomeStore();
  const { list, activeId, restorePoint, canUndo, canRedo } = home.presentations;
  const active = list.find((p) => p.id === activeId) ?? list[0];
  const [name, setName] = useState(active.name);
  useEffect(() => setName(active.name), [active.id, active.name]);
  return (
    <div className="lch-glass hc-editbar" role="toolbar" aria-label="Arrange the home" data-home-editbar>
      <label className="hc-field">
        <span>Presentation</span>
        <select value={activeId} onChange={(e) => HomeStore.applyPresentation(e.target.value)} aria-label="Switch presentation">
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="hc-field">
        <span>Name</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => HomeStore.renamePresentation(active.id, name)} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} aria-label="Rename presentation" />
      </label>
      <label className="hc-field">
        <span>New from</span>
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__concepts__") onStudio();
            else if (v) HomeStore.createPresentation(v as TemplateId);
          }}
          aria-label="New presentation from a composition or layout"
        >
          <option value="">Composition…</option>
          <optgroup label="Compositions">
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
          {home.presentations.layouts.length ? (
            <optgroup label="My layouts">
              {home.presentations.layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value="__concepts__">Browse the 60 concepts…</option>
        </select>
      </label>
      <span className="hc-actions">
        <button type="button" onClick={() => HomeStore.undo()} disabled={!canUndo} aria-label="Undo">
          <HomeIcon name="Undo2" size={15} />
        </button>
        <button type="button" onClick={() => HomeStore.redo()} disabled={!canRedo} aria-label="Redo">
          <HomeIcon name="Redo2" size={15} />
        </button>
        <button type="button" onClick={() => HomeStore.duplicatePresentation(active.id)} aria-label="Duplicate presentation">
          <HomeIcon name="Copy" size={15} />
        </button>
        <button type="button" onClick={() => HomeStore.resetPresentation(device)} aria-label={`Reset the ${device} layout to its composition`} title={`Reset ${device}`}>
          <HomeIcon name="RotateCcw" size={15} />
        </button>
        {restorePoint ? (
          <button type="button" onClick={() => HomeStore.restorePresentation()} aria-label={`Restore ${restorePoint.name}`} title="Restore">
            <HomeIcon name="History" size={15} />
          </button>
        ) : null}
        <button type="button" onClick={() => HomeStore.deletePresentation(active.id)} disabled={list.length < 2} aria-label="Delete presentation">
          <HomeIcon name="X" size={15} />
        </button>
        <button type="button" onClick={() => HomeStore.saveActiveAsLayout()} aria-label="Save this arrangement to My layouts" title="Save to My layouts">
          <HomeIcon name="Save" size={15} />
        </button>
        <button type="button" className="hc-studio-btn" onClick={onStudio} data-home-studio-open>
          <HomeIcon name="LayoutGrid" size={15} /> Design Studio
        </button>
      </span>
      <small className="hc-device">Editing the {device} layout · phone, tablet and desktop are saved separately</small>
    </div>
  );
}
