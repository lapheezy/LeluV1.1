/**
 * ==========================================================
 * LÉLU HOME — RETRO TERMINAL (a Home layout, kind "terminal")
 *
 * The same Home, the same live Cosmos behind it, presented as a
 * console:
 *
 *   header      identity · presentation · clock · world · actions
 *   directory   CosmosNavigation's destinations, spatial objects, scales
 *   viewport    a clear frame onto the LIVE scene (nothing is re-rendered)
 *   telemetry   camera, sector, region, world lifecycle, stream, selection
 *   panes       the Home's own live modules (HomeComposition), skinned
 *   command     a prompt that drives the existing systems (terminalCommands)
 *
 * Every number is read from the system that owns it and every control
 * calls that system. Nothing here owns Cosmos state, so switching to or
 * from this layout — or changing its colours — never moves the camera,
 * the selection, the trail or the world.
 *
 * Its look is the Terminal Appearance Studio's theme (HomeStore.terminal).
 * ==========================================================
 */

import { createPortal } from "react-dom";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGenesis, type GenesisPanel } from "../GenesisCore";
import HomeStore from "./homeStore";
import { useCloud, useHomeStore, useNotifications } from "./useHomeLive";
import { launch } from "./homeActions";
import { HomeIcon } from "./HomeModules";
import HomeComposition from "./HomeComposition";
import { APPS } from "./homeCatalog";
import type { DeviceClass, HomePresentation, HomeSignals } from "./homeComposition";
import { homeSkinVars, presetThemeId, terminalVars, TERMINAL_PRESETS, contrastSummary } from "./homeTerminal";
import { runCommand, completeCommand, type CommandResult, type ScaleName, type TerminalContext } from "./terminalCommands";
import CosmosNavigation, { type NavigationState, type NavNode } from "../../../../core/cosmos/CosmosNavigation";
import { syncCosmosMap } from "../../../../core/cosmos/CosmosLiveMap";
import CosmosFocus, { type FocusTarget } from "../../../../core/cosmos/CosmosFocus";
import CosmosObjectStore from "../../../../core/cosmos/objects/CosmosObjectStore";
import type { CosmosObject } from "../../../../core/cosmos/objects/CosmosObjectTypes";
import WorkspaceAPI from "../../../../core/workspace/WorkspaceAPI";
import InfiniteCosmos, { type ChunkCoord } from "../engines/InfiniteCosmos";
import WorldLifecycle from "../engines/WorldLifecycle";
import { cosmosScaleStore, flyCosmosScale, SCALE_ORDER, SCALE_PRESETS, type SpatialScale } from "../cosmos/CosmosScales";
import "./retroTerminal.css";

const TerminalAppearanceStudio = lazy(() => import("./TerminalAppearanceStudio"));

/** The scene draws its destinations at this depth (CosmosRooms3D.Z_OFFSET). */
const Z_OFFSET = -25;

/** Fly the existing camera to a destination exactly as the 3D rings do (CosmosRooms3D.flyTo). */
function flyToNode(node: NavNode): void {
  const [x, y, z0] = node.position;
  const z = z0 + Z_OFFSET;
  const camera = (window as unknown as { __cosmosCamera?: { navigateTo?: (pos: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void } }).__cosmosCamera;
  if (camera?.navigateTo) {
    camera.navigateTo({ x, y, z: z + 10 }, { x, y, z });
    return;
  }
  window.dispatchEvent(new CustomEvent("cosmos-navigate", { detail: { pos: { x, y, z: z + 10 }, lookAt: { x, y, z } } }));
}

/** Navigate the way the scene's rings and the workspace panel do: WorkspaceAPI, then focus, then the camera. */
function goToNode(id: string): boolean {
  const result = WorkspaceAPI.getInstance().execute({ action: "navigate", actor: "user", roomId: id });
  if (!result.ok) return false;
  CosmosFocus.getInstance().set({ kind: "node", id });
  const node = CosmosNavigation.getInstance().get(id);
  if (node) flyToNode(node);
  return true;
}

/* ---------------------------------------------------------------
 * Live readings (each subscribes to its owner; renders only on change)
 * ------------------------------------------------------------- */

function useNavigation(): { state: NavigationState; mapNote: string } {
  const [state, setState] = useState(() => CosmosNavigation.getInstance().getState());
  const [mapNote, setMapNote] = useState("syncing…");
  useEffect(() => CosmosNavigation.getInstance().subscribe(setState), []);
  // Like the Cosmos workspace panel: the directory reflects the live environment
  // when it opens (idempotent — same ids, visits kept), never a stored sketch.
  useEffect(() => {
    let live = true;
    void syncCosmosMap().then((result) => {
      if (!live) return;
      setMapNote(result.ok ? `${result.destinations} live` : "offline");
      setState(CosmosNavigation.getInstance().getState());
    });
    return () => {
      live = false;
    };
  }, []);
  return { state, mapNote };
}

function useFocus(): FocusTarget | null {
  const [focus, setFocus] = useState(() => CosmosFocus.getInstance().get());
  useEffect(() => CosmosFocus.getInstance().subscribe(setFocus), []);
  return focus;
}

function useObjects(): CosmosObject[] {
  const [objects, setObjects] = useState<CosmosObject[]>(() => CosmosObjectStore.getInstance().list());
  useEffect(() => CosmosObjectStore.getInstance().subscribe(() => setObjects(CosmosObjectStore.getInstance().list())), []);
  return objects;
}

function useScale(): SpatialScale {
  const [scale, setScale] = useState(() => cosmosScaleStore.get());
  useEffect(() => cosmosScaleStore.subscribe(setScale), []);
  return scale;
}

interface WorldReading {
  phase: string;
  progress: number;
  cycle: number;
  expansion: number;
  engines: number;
}

/** The lifecycle ticks every 100 ms; this re-renders only when the phase or a whole percent changes. */
function useWorld(): WorldReading {
  const read = (): WorldReading => {
    const w = WorldLifecycle.getInstance();
    return { phase: String(w.getPhase()), progress: Math.floor(w.getPhaseProgress() * 100) / 100, cycle: w.getCycleCount(), expansion: Math.round(w.getExpansionScale() * 100) / 100, engines: w.getActiveEngines().length };
  };
  const [world, setWorld] = useState(read);
  useEffect(
    () =>
      WorldLifecycle.getInstance().subscribe(() => {
        const next = read();
        setWorld((prev) => (prev.phase === next.phase && prev.progress === next.progress && prev.cycle === next.cycle && prev.engines === next.engines ? prev : next));
      }),
    [],
  );
  return world;
}

interface StreamReading {
  camera: { x: number; y: number; z: number };
  sector: { x: number; y: number; z: number };
  loadedChunks: number;
  stars: number;
  galaxies: number;
  nebulae: number;
  blackHoles: number;
  generated: number;
}

const chunkXYZ = (c: ChunkCoord) => ({ x: c.cx, y: c.cy, z: c.cz });

/** Camera from the Infinite Cosmos tracker (polled twice a second — reading is free); stream stats on change. */
function useStream(): StreamReading {
  const read = (): StreamReading => {
    const cosmos = InfiniteCosmos.getInstance();
    const s = cosmos.getStats();
    return { camera: cosmos.getCameraPosition(), sector: chunkXYZ(s.cameraChunk), loadedChunks: s.loadedChunks, stars: s.totalStars, galaxies: s.totalGalaxies, nebulae: s.totalNebulae, blackHoles: s.totalBlackHoles, generated: s.totalGenerated };
  };
  const [stream, setStream] = useState(read);
  useEffect(() => {
    const cosmos = InfiniteCosmos.getInstance();
    const unsub = cosmos.subscribe(() => setStream(read()));
    const timer = window.setInterval(() => {
      const c = cosmos.getCameraPosition();
      setStream((prev) => (Math.abs(prev.camera.x - c.x) + Math.abs(prev.camera.y - c.y) + Math.abs(prev.camera.z - c.z) < 0.01 ? prev : { ...prev, camera: { ...c }, sector: chunkXYZ(cosmos.getCameraChunk()) }));
    }, 500);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, []);
  return stream;
}

function useClock(): string {
  const fmt = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const t = window.setInterval(() => setNow(fmt()), 15000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

const n2 = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2));

/* ---------------------------------------------------------------
 * The terminal
 * ------------------------------------------------------------- */

type PhoneTab = "panes" | "directory" | "telemetry" | "log";

interface LogLine {
  id: number;
  text: string;
  tone: CommandResult["lines"][number]["tone"] | "cmd";
}

export interface RetroTerminalProps {
  presentation: HomePresentation;
  device: DeviceClass;
  editing: boolean;
  signals?: HomeSignals;
  editBar: ReactNode;
  neural: ReactNode;
  onOpenLibrary: () => void;
  onOpenWindows: () => void;
}

export default function RetroTerminal({ presentation, device, editing, signals, editBar, neural, onOpenLibrary, onOpenWindows }: RetroTerminalProps) {
  const genesis = useGenesis();
  const home = useHomeStore();
  const notes = useNotifications();
  const cloud = useCloud();
  const { state: nav, mapNote } = useNavigation();
  const focus = useFocus();
  const objects = useObjects();
  const scale = useScale();
  const world = useWorld();
  const stream = useStream();
  const clock = useClock();
  const [studio, setStudio] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).has("terminalStudio"));
  const [tab, setTab] = useState<PhoneTab>("panes");
  const [log, setLog] = useState<LogLine[]>(() => [
    { id: 1, text: "LÉLU RETRO TERMINAL — connected to the live Cosmos.", tone: "head" },
    { id: 2, text: "Type 'help' for commands. Anything else goes to LÉLU.", tone: "out" },
  ]);
  const [input, setInput] = useState("");
  const history = useRef<string[]>([]);
  const historyAt = useRef(-1);
  const logRef = useRef<HTMLDivElement | null>(null);
  const lineId = useRef(3);

  const theme = HomeStore.terminalTheme();
  const { vars } = useMemo(() => terminalVars(theme), [theme]);
  const skin = useMemo(() => homeSkinVars(theme), [theme]);
  const contrastNote = useMemo(() => contrastSummary(theme), [theme]);
  const unsaved = Boolean(home.terminal.draft);
  const cloudOn = cloud.status === "connected" && Boolean(cloud.session);

  const current = nav.nodes.find((n) => n.id === nav.currentId) ?? null;
  const path = useMemo(() => {
    const out: NavNode[] = [];
    let at: NavNode | undefined = current ?? undefined;
    while (at) {
      out.unshift(at);
      at = at.parentId ? nav.nodes.find((n) => n.id === at!.parentId) : undefined;
    }
    return out;
  }, [current, nav.nodes]);
  const focusLabel = focus ? (focus.kind === "node" ? nav.nodes.find((n) => n.id === focus.id)?.label : objects.find((o) => o.id === focus.id)?.name) ?? focus.id : null;
  const focusObject = focus?.kind === "object" ? objects.find((o) => o.id === focus.id) : undefined;

  const print = useCallback((lines: Array<{ text: string; tone: LogLine["tone"] }>, clear = false) => {
    setLog((prev) => {
      const next = [...(clear ? [] : prev), ...lines.map((l) => ({ ...l, id: lineId.current++ }))];
      return next.slice(-120);
    });
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const ctx: TerminalContext = useMemo(
    () => ({
      nodes: () => CosmosNavigation.getInstance().getState().nodes,
      currentNodeId: () => CosmosNavigation.getInstance().getState().currentId,
      navigateTo: (id) => goToNode(id),
      back: () => {
        const node = CosmosNavigation.getInstance().back();
        if (node) {
          CosmosFocus.getInstance().set({ kind: "node", id: node.id });
          flyToNode(node);
        }
        return Boolean(node);
      },
      objects: () => CosmosObjectStore.getInstance().list().map((o) => ({ id: o.id, name: o.name })),
      focus: (target) => CosmosFocus.getInstance().set(target),
      focused: () => CosmosFocus.getInstance().get(),
      flyScale: (s: ScaleName) => flyCosmosScale(s),
      scale: () => cosmosScaleStore.get(),
      camera: () => InfiniteCosmos.getInstance().getCameraPosition(),
      sector: () => chunkXYZ(InfiniteCosmos.getInstance().getCameraChunk()),
      world: () => ({ phase: String(WorldLifecycle.getInstance().getPhase()), progress: WorldLifecycle.getInstance().getPhaseProgress(), cycle: WorldLifecycle.getInstance().getCycleCount() }),
      panels: () => APPS.map((a) => ({ id: a.id, label: a.label })),
      openPanel: (id) => launch(genesis, id as GenesisPanel, null),
      immersive: () => HomeStore.setImmersive(true),
      openStudio: () => setStudio(true),
      arrange: () => HomeStore.setEditing(true),
      themes: () => [...TERMINAL_PRESETS.filter((p) => p.id !== "custom").map((p) => ({ id: presetThemeId(p.id), name: p.name })), ...HomeStore.get().terminal.themes.map((t) => ({ id: t.id, name: t.name }))],
      selectTheme: (id) => HomeStore.selectTerminalTheme(id),
      hasUnsavedTheme: () => Boolean(HomeStore.get().terminal.draft),
      ask: (text) => {
        window.dispatchEvent(new CustomEvent("lelu-open-universe", { detail: { draft: text } }));
      },
    }),
    [genesis],
  );

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    history.current = [...history.current.filter((h) => h !== text), text].slice(-50);
    historyAt.current = -1;
    setInput("");
    const result = runCommand(text, ctx);
    print([{ text: `> ${text}`, tone: "cmd" }, ...result.lines], result.clear);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const h = history.current;
    if (e.key === "ArrowUp" && h.length) {
      e.preventDefault();
      historyAt.current = historyAt.current < 0 ? h.length - 1 : Math.max(0, historyAt.current - 1);
      setInput(h[historyAt.current]);
    } else if (e.key === "ArrowDown" && historyAt.current >= 0) {
      e.preventDefault();
      historyAt.current += 1;
      if (historyAt.current >= h.length) {
        historyAt.current = -1;
        setInput("");
      } else setInput(h[historyAt.current]);
    } else if (e.key === "Tab" && input && !input.includes(" ")) {
      const options = completeCommand(input);
      if (options.length === 1) {
        e.preventDefault();
        setInput(`${options[0]} `);
      }
    }
  };

  const open = (id: GenesisPanel, from?: Element | null) => launch(genesis, id, from ?? null);
  const children = (parentId: string | null) => nav.nodes.filter((n) => n.parentId === parentId);
  const roots = nav.nodes.filter((n) => n.parentId === null);

  const renderNode = (node: NavNode, depth: number): ReactNode => {
    const kids = depth < 3 ? children(node.id) : [];
    const isCurrent = node.id === nav.currentId;
    const isFocused = focus?.kind === "node" && focus.id === node.id;
    return (
      <li key={node.id}>
        <button
          type="button"
          className="rt-row"
          data-current={isCurrent ? "true" : undefined}
          data-selected={isFocused ? "true" : undefined}
          aria-current={isCurrent ? "location" : undefined}
          aria-label={`${node.label}, ${node.level}${isCurrent ? ", current location" : ""}. Navigate here.`}
          style={{ paddingLeft: `calc(var(--rt-pad) + ${depth * 12}px)` }}
          onClick={() => {
            if (goToNode(node.id)) print([{ text: `> goto ${node.label}`, tone: "cmd" }, { text: `→ ${node.label} (${node.level})`, tone: "ok" }]);
          }}
        >
          <span className="rt-tag">{node.level.slice(0, 3).toUpperCase()}</span>
          <span className="rt-row-label">{node.label}</span>
          {node.visits ? <span className="rt-num">{node.visits}</span> : null}
        </button>
        {kids.length ? <ul>{kids.map((k) => renderNode(k, depth + 1))}</ul> : null}
      </li>
    );
  };

  const directory = (
    <section className="rt-panel rt-dir" aria-label="Celestial directory">
      <h2 className="rt-h">
        <span>CELESTIAL DIRECTORY</span>
        <span className="rt-num" title={`Map sync: ${mapNote}`}>
          {nav.nodes.length}
        </span>
      </h2>
      <ul className="rt-tree">{roots.map((r) => renderNode(r, 0))}</ul>
      <h2 className="rt-h">
        <span>SPATIAL OBJECTS</span>
        <span className="rt-num">{objects.length}</span>
      </h2>
      {objects.length ? (
        <ul className="rt-tree">
          {objects.slice(0, 24).map((o) => (
            <li key={o.id}>
              <button type="button" className="rt-row" data-selected={focus?.kind === "object" && focus.id === o.id ? "true" : undefined} aria-label={`Select object ${o.name}`} onClick={() => CosmosFocus.getInstance().set({ kind: "object", id: o.id })}>
                <span className="rt-tag">OBJ</span>
                <span className="rt-row-label">{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rt-dim rt-pad">No objects placed yet. Ask LÉLU to place one.</p>
      )}
      <h2 className="rt-h">
        <span>SCALE</span>
      </h2>
      <div className="rt-scales" role="group" aria-label="Fly to a scale">
        {SCALE_ORDER.map((s) => (
          <button key={s} type="button" className="rt-btn" aria-pressed={scale === s} title={SCALE_PRESETS[s].description} onClick={() => flyCosmosScale(s)}>
            {SCALE_PRESETS[s].label}
          </button>
        ))}
      </div>
    </section>
  );

  const telemetry = (
    <section className="rt-panel rt-tele" aria-label="Telemetry">
      <h2 className="rt-h">
        <span>COORDINATES</span>
        <span className="rt-status" data-on="true" aria-hidden />
      </h2>
      <dl className="rt-dl">
        <dt>X</dt>
        <dd className="rt-num">{n2(stream.camera.x)}</dd>
        <dt>Y</dt>
        <dd className="rt-num">{n2(stream.camera.y)}</dd>
        <dt>Z</dt>
        <dd className="rt-num">{n2(stream.camera.z)}</dd>
        <dt>SECTOR</dt>
        <dd className="rt-num">
          [{stream.sector.x}, {stream.sector.y}, {stream.sector.z}]
        </dd>
        <dt>SCALE</dt>
        <dd className="rt-hl">{scale.toUpperCase()}</dd>
      </dl>
      <h2 className="rt-h">
        <span>REGION</span>
      </h2>
      <p className="rt-path rt-pad">{path.length ? path.map((n) => n.label).join(" / ") : "—"}</p>
      <dl className="rt-dl">
        <dt>LEVEL</dt>
        <dd>{current?.level.toUpperCase() ?? "—"}</dd>
        <dt>TRAIL</dt>
        <dd className="rt-num">{nav.trail.length}</dd>
      </dl>
      <h2 className="rt-h">
        <span>WORLD LIFECYCLE</span>
      </h2>
      <dl className="rt-dl">
        <dt>PHASE</dt>
        <dd className="rt-hl">{world.phase}</dd>
        <dt>PROGRESS</dt>
        <dd>
          <span className="rt-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(world.progress * 100)} aria-label="Phase progress">
            <i style={{ width: `${Math.round(world.progress * 100)}%` }} />
          </span>
          <span className="rt-num"> {Math.round(world.progress * 100)}%</span>
        </dd>
        <dt>CYCLE</dt>
        <dd className="rt-num">{world.cycle}</dd>
        <dt>EXPANSION</dt>
        <dd className="rt-num">{world.expansion.toFixed(2)}</dd>
        <dt>ENGINES</dt>
        <dd className="rt-num">{world.engines}</dd>
      </dl>
      <h2 className="rt-h">
        <span>STREAM</span>
      </h2>
      <dl className="rt-dl">
        <dt>CHUNKS</dt>
        <dd className="rt-num">{stream.loadedChunks}</dd>
        <dt>STARS</dt>
        <dd className="rt-num">{stream.stars.toLocaleString()}</dd>
        <dt>GALAXIES</dt>
        <dd className="rt-num">{stream.galaxies}</dd>
        <dt>NEBULAE</dt>
        <dd className="rt-num">{stream.nebulae}</dd>
        <dt>BLACK HOLES</dt>
        <dd className="rt-num">{stream.blackHoles}</dd>
      </dl>
      <h2 className="rt-h">
        <span>SELECTION</span>
      </h2>
      {focus ? (
        <div className="rt-pad">
          <p className="rt-sel">
            <span className="rt-tag">{focus.kind === "node" ? "DEST" : "OBJ"}</span> {focusLabel}
          </p>
          {focusObject ? (
            <p className="rt-num rt-dim">
              pos {focusObject.frame.position.map((v) => v.toFixed(1)).join(", ")} · scale {focusObject.frame.scale.toFixed(2)}
            </p>
          ) : null}
          <button type="button" className="rt-btn" onClick={() => CosmosFocus.getInstance().clear()}>
            Deselect
          </button>
        </div>
      ) : (
        <p className="rt-dim rt-pad">Nothing selected.</p>
      )}
      <h2 className="rt-h">
        <span>SYSTEM</span>
      </h2>
      <dl className="rt-dl">
        <dt>MODE</dt>
        <dd>{home.cosmosMode.toUpperCase()}</dd>
        <dt>DEVICE</dt>
        <dd>{device.toUpperCase()}</dd>
        <dt>THEME</dt>
        <dd>
          {theme.name}
          {unsaved ? " *" : ""}
        </dd>
        <dt>CONTRAST</dt>
        <dd className={contrastNote.fails ? "rt-err" : contrastNote.warnings ? "rt-warn" : "rt-ok"}>{contrastNote.fails ? `${contrastNote.fails} FAIL` : contrastNote.warnings ? `${contrastNote.warnings} LOW` : "OK"}</dd>
      </dl>
    </section>
  );

  const viewport = (
    <section className="rt-view" aria-label="Live Cosmos viewport">
      <span className="rt-corner" data-c="tl" aria-hidden />
      <span className="rt-corner" data-c="tr" aria-hidden />
      <span className="rt-corner" data-c="bl" aria-hidden />
      <span className="rt-corner" data-c="br" aria-hidden />
      <span className="rt-cross" aria-hidden />
      <span className="rt-view-cap">LIVE COSMOS · {current?.label ?? "—"}</span>
      <span className="rt-view-read rt-num" aria-live="off">
        {n2(stream.camera.x)} · {n2(stream.camera.y)} · {n2(stream.camera.z)}
      </span>
      <button type="button" className="rt-btn rt-view-look" onClick={() => HomeStore.setImmersive(true)}>
        Full view
      </button>
    </section>
  );

  const panes = (
    <section className="rt-panes" aria-label="Modules">
      <HomeComposition
        presentation={presentation.style ? { ...presentation, style: undefined } : presentation}
        device={device}
        editing={editing}
        signals={signals}
        skinVars={skin}
        onOp={(op) => HomeStore.applyHomeOp(device, op)}
        onOpenLibrary={onOpenLibrary}
        onOpenWindows={onOpenWindows}
        label={`Modules — ${presentation.name}`}
      />
    </section>
  );

  const logView = (
    <div className="rt-log" ref={logRef} role="log" aria-live="polite" aria-label="Command output">
      {log.map((l) => (
        <p key={l.id} data-tone={l.tone}>
          {l.text}
        </p>
      ))}
    </div>
  );

  const phone = device === "phone";
  const tabs: Array<{ id: PhoneTab; label: string }> = [
    { id: "panes", label: "PANES" },
    { id: "directory", label: "DIR" },
    { id: "telemetry", label: "TELEMETRY" },
    { id: "log", label: "LOG" },
  ];

  return (
    <div
      className="lch lch-m15 rt"
      data-lelu-home
      data-retro-terminal
      data-device={device}
      data-editing={editing ? "true" : "false"}
      data-theme={theme.base}
      data-unsaved={unsaved ? "true" : "false"}
      data-grid={theme.effects.grid ? "on" : "off"}
      data-scan={theme.effects.scanlines > 0 ? "on" : "off"}
      data-anim={theme.effects.animation > 0 ? "on" : "off"}
      role="main"
      aria-label="LÉLU home — Retro Terminal"
      style={{ ...vars, ...skin }}
    >
      <div className="rt-fx" aria-hidden />
      <header className="rt-header">
        <button type="button" className="rt-icon" aria-label="Open the app library" onClick={() => onOpenLibrary()}>
          <HomeIcon name="Menu" size={18} />
        </button>
        <div className="rt-brand">
          <span className="rt-brand-name">LÉLU//TERMINAL</span>
          <span className="rt-brand-sub">{presentation.name}</span>
        </div>
        <div className="rt-header-mid" aria-label="Status">
          <span className="rt-chip">
            <span className="rt-status" data-on="true" aria-hidden /> {world.phase}
          </span>
          <span className="rt-chip rt-hide-phone">{scale.toUpperCase()}</span>
          <span className="rt-chip rt-num">{clock}</span>
        </div>
        <div className="rt-header-right">
          <button type="button" className="rt-icon" aria-label={editing ? "Finish arranging the home" : "Arrange the home or switch layout"} aria-pressed={editing} title={editing ? "Done" : "Arrange / layout"} data-home-customize onClick={() => HomeStore.setEditing(!editing)}>
            <HomeIcon name={editing ? "Check" : "LayoutGrid"} size={18} />
          </button>
          <button type="button" className="rt-icon" aria-label="Open the Terminal Appearance Studio" title="Appearance" data-terminal-studio-open aria-expanded={studio} onClick={() => setStudio(!studio)}>
            <HomeIcon name="Palette" size={18} />
            {unsaved ? <span className="rt-badge" aria-hidden>*</span> : null}
          </button>
          <button type="button" className="rt-icon rt-hide-phone" aria-label={cloudOn ? "Cloud sync on" : "Cloud sync off — open settings"} title={cloudOn ? "Cloud sync on" : "Cloud sync off"} onClick={(e) => open("settings", e.currentTarget)}>
            <HomeIcon name={cloudOn ? "Cloud" : "CloudOff"} size={18} />
          </button>
          <button type="button" className="rt-icon" aria-label={`Notifications${notes.unread ? `, ${notes.unread} unread` : ""}`} onClick={(e) => open("notifications", e.currentTarget)}>
            <HomeIcon name="Bell" size={18} />
            {notes.unread ? <span className="rt-badge">{notes.unread > 9 ? "9+" : notes.unread}</span> : null}
          </button>
          {neural}
          <button type="button" className="rt-icon" aria-label="Look at the Cosmos" title="Look at the Cosmos" onClick={() => HomeStore.setImmersive(true)}>
            <span className="rt-orb" aria-hidden />
          </button>
        </div>
      </header>

      {editBar}

      {phone ? (
        <>
          {viewport}
          <div className="rt-tabs" role="tablist" aria-label="Terminal sections">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" id={`rt-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`rt-tabpanel-${t.id}`} className="rt-tab" onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="rt-tabpanel" role="tabpanel" id={`rt-tabpanel-${tab}`} aria-labelledby={`rt-tab-${tab}`}>
            {tab === "panes" ? panes : tab === "directory" ? directory : tab === "telemetry" ? telemetry : logView}
          </div>
        </>
      ) : (
        <div className="rt-body">
          {directory}
          {viewport}
          {telemetry}
          {panes}
        </div>
      )}

      <footer className="rt-footer">
        {phone ? null : logView}
        <form
          className="rt-prompt"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="rt-cmd" className="rt-prompt-sign">
            LÉLU&gt;
          </label>
          <input
            id="rt-cmd"
            className="rt-cmd"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="type a command — 'help'"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-label="Terminal command"
          />
          <span className="rt-caret" aria-hidden />
          <button type="submit" className="rt-btn" aria-label="Run command">
            RUN
          </button>
        </form>
      </footer>

      {/* Portalled to <body>: inside the terminal (z-index 40) it could never rise above
          the app's navigation bar. It carries the theme's variables itself. */}
      {studio && typeof document !== "undefined"
        ? createPortal(
            <Suspense fallback={null}>
              <TerminalAppearanceStudio device={device} vars={vars} onClose={() => setStudio(false)} />
            </Suspense>,
            document.body,
          )
        : null}
    </div>
  );
}

