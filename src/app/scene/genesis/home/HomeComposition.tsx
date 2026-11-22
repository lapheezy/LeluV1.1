/**
 * ==========================================================
 * LÉLU HOME — COMPOSITION VIEW
 *
 * Draws a solved Home (homeComposition.solveHome) with the eight
 * live modules, and — in edit mode — the controls that change it:
 *
 *   drag (Pointer Events, handle only: page scrolling on iPhone
 *   is never captured) · resize · reorder · pin · lock · hide ·
 *   collapse · float (drag + resize + snap/align) · dock ·
 *   group/ungroup into tabs · expand (Expanded Home)
 *
 * and the hand-offs to the systems that already own them:
 *
 *   Window   GenesisCore.openPanel via homeActions.launch
 *   Chat     the Chat Universe's own "lelu-open-universe" event
 *   Cosmos   placeInWorld (SpatialIntentBus) + immersive view
 *
 * Every edit is an op handed to HomeStore (undoable); this view
 * keeps only transient drag state. No dependency was added: CSS
 * Grid, absolute positioning and Pointer Events do the work.
 * ==========================================================
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useGenesis, type GenesisPanel } from "../GenesisCore";
import { launch } from "./homeActions";
import HomeStore from "./homeStore";
import { placeInWorld } from "../../../../core/spatial/placeInWorld";
import { HomeIcon, HomeModuleView, type HomeModuleProps } from "./HomeModules";
import {
  ABSOLUTE_KINDS,
  MODULE_LABEL,
  MODULE_PANEL,
  SIZES,
  adaptiveModeOf,
  adaptiveOrder,
  layoutOf,
  solveHome,
  timeKind,
  timeOrder,
  usageOrder,
  type DeviceClass,
  type HomeModuleId,
  type HomeOp,
  type HomePresentation,
  type HomeSignals,
  type NRect,
  type SolvedModule,
} from "./homeComposition";
import { resolveStyle } from "./homeStyle";
import { useHomeStore } from "./useHomeLive";
import "./homeComposition.css";
import "./homeEffects.css";

export interface HomeCompositionProps extends HomeModuleProps {
  presentation: HomePresentation;
  device: DeviceClass;
  editing?: boolean;
  signals?: HomeSignals;
  onOp?: (op: HomeOp) => void;
  /** Accessible name for the region. */
  label?: string;
  /** Hour of the day for time-of-day layouts (default: now). */
  hour?: number;
  /** CSS variables laid over the presentation's look (the Retro Terminal skins the modules with its own theme). */
  skinVars?: Record<string, string>;
}

interface Drag {
  id: HomeModuleId;
  kind: "move" | "float" | "resize";
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  rect?: NRect;
}

export default function HomeComposition({ presentation, device, editing = false, preview = false, signals, onOp, label, onOpenLibrary, onOpenWindows, hour, skinVars }: HomeCompositionProps) {
  const genesis = useGenesis();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [expanded, setExpanded] = useState<HomeModuleId | null>(null);
  const [menu, setMenu] = useState<HomeModuleId | null>(null);
  const [said, setSaid] = useState("");

  // Adaptive layouts reorder at render time — from live signals, the time
  // of day or her usage — and never rewrite the saved order. While she
  // arranges, she sees (and edits) her own order.
  const usage = useHomeStore().presentations.usage;
  const layout = layoutOf(presentation);
  const mode = editing ? "none" : adaptiveModeOf(layout, device);
  const now = hour ?? new Date().getHours();
  const saved = presentation.profiles[device].order;
  const adapted =
    mode === "signals" && signals ? adaptiveOrder(saved, signals) : mode === "time" ? timeOrder(saved, now) : mode === "usage" ? usageOrder(saved, usage) : saved;
  const effective = adapted === saved ? presentation : { ...presentation, profiles: { ...presentation.profiles, [device]: { ...presentation.profiles[device], order: adapted } } };
  const solved = solveHome(effective, device, mode === "time" ? { kind: timeKind(layout.kind[device], now) } : {});
  const order = effective.profiles[device].order;
  const look = resolveStyle(presentation.style);

  const op = useCallback(
    (next: HomeOp, sentence?: string) => {
      onOp?.(next);
      if (sentence) setSaid(sentence);
    },
    [onOp],
  );

  /* ---------------- pointer drag (handle-only) ---------------- */
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0 } : d));
    const up = (e: PointerEvent) => {
      const d = drag;
      setDrag(null);
      const box = rootRef.current?.getBoundingClientRect();
      if (!box) return;
      const dx = (e.clientX - d.x0) / box.width;
      const dy = (e.clientY - d.y0) / box.height;
      if (d.kind === "move") {
        const target = document
          .elementsFromPoint(e.clientX, e.clientY)
          .map((el) => (el as HTMLElement).closest?.("[data-home-module]") as HTMLElement | null)
          .find((el) => el && el.dataset.homeModule !== d.id && rootRef.current?.contains(el));
        if (!target) return;
        const overId = target.dataset.homeModule as HomeModuleId;
        const r = target.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2 || e.clientY > r.top + r.height * 0.75;
        const idx = order.indexOf(overId);
        const before = after ? (order[idx + 1] ?? null) : overId;
        op({ op: "move", id: d.id, before: before === d.id ? (order[idx + 2] ?? null) : before }, `${MODULE_LABEL[d.id]} moved ${after ? "after" : "before"} ${MODULE_LABEL[overId]}`);
      } else if (d.rect && (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002)) {
        const rect = d.kind === "float" ? { ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy } : { ...d.rect, w: d.rect.w + dx, h: d.rect.h + dy };
        op({ op: "place", id: d.id, rect }, `${MODULE_LABEL[d.id]} ${d.kind === "float" ? "moved" : "resized"}`);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", () => setDrag(null), { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, drag?.kind]);

  const startDrag = (e: ReactPointerEvent, id: HomeModuleId, kind: Drag["kind"], rect?: NRect) => {
    if (!editing || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDrag({ id, kind, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, rect });
  };

  /* ---------------- hand-offs to the owning systems ---------------- */
  const toWindow = (id: HomeModuleId, from: Element | null) => {
    const panel = MODULE_PANEL[id];
    if (panel && !preview) {
      HomeStore.noteUse(id);
      launch(genesis, panel as GenesisPanel, from);
    }
    setMenu(null);
  };
  const expand = (id: HomeModuleId) => {
    if (!preview) HomeStore.noteUse(id);
    setExpanded(id);
  };
  const toChatUniverse = () => {
    if (!preview) window.dispatchEvent(new CustomEvent("lelu-open-universe"));
    setMenu(null);
  };
  const toCosmos = async (id: HomeModuleId) => {
    setMenu(null);
    if (preview) return;
    const outcome = await placeInWorld({ name: `Home · ${MODULE_LABEL[id]}`, kind: id === "lelu" ? "sphere" : "box", color: "#c084fc", scale: 0.7 }).catch((error: Error) => ({ ok: false, message: error.message }));
    setSaid(outcome.ok ? `${MODULE_LABEL[id]} placed in the Cosmos` : `Could not place ${MODULE_LABEL[id]}: ${outcome.message}`);
    if (outcome.ok) HomeStore.setImmersive(true);
  };

  /* ---------------- keyboard (edit mode) ---------------- */
  const onKey = (e: KeyboardEvent, m: SolvedModule) => {
    if (!editing || e.target !== e.currentTarget) return;
    const id = m.id;
    const floating = m.settings.mode === "float" || solved.kind === "freeform";
    const rect = m.rect ?? m.settings.float;
    const nudge = (dx: number, dy: number) =>
      rect && op({ op: "place", id, rect: e.shiftKey ? { ...rect, w: rect.w + dx, h: rect.h + dy } : { ...rect, x: rect.x + dx, y: rect.y + dy } }, `${MODULE_LABEL[id]} ${e.shiftKey ? "resized" : "moved"}`);
    const keys: Record<string, () => void> = {
      ArrowLeft: () => (floating ? nudge(-0.02, 0) : op({ op: "shift", id, delta: -1 }, `${MODULE_LABEL[id]} moved earlier`)),
      ArrowUp: () => (floating ? nudge(0, -0.02) : op({ op: "shift", id, delta: -1 }, `${MODULE_LABEL[id]} moved earlier`)),
      ArrowRight: () => (floating ? nudge(0.02, 0) : op({ op: "shift", id, delta: 1 }, `${MODULE_LABEL[id]} moved later`)),
      ArrowDown: () => (floating ? nudge(0, 0.02) : op({ op: "shift", id, delta: 1 }, `${MODULE_LABEL[id]} moved later`)),
      "+": () => op({ op: "grow", id, delta: 1 }, `${MODULE_LABEL[id]} larger`),
      "=": () => op({ op: "grow", id, delta: 1 }, `${MODULE_LABEL[id]} larger`),
      "-": () => op({ op: "grow", id, delta: -1 }, `${MODULE_LABEL[id]} smaller`),
      h: () => op({ op: "toggle", id, flag: "hidden" }, `${MODULE_LABEL[id]} hidden`),
      p: () => op({ op: "toggle", id, flag: "pinned" }, `${MODULE_LABEL[id]} ${m.settings.pinned ? "unpinned" : "pinned"}`),
      l: () => op({ op: "toggle", id, flag: "locked" }, `${MODULE_LABEL[id]} ${m.settings.locked ? "unlocked" : "locked"}`),
      c: () => op({ op: "toggle", id, flag: "collapsed" }, `${MODULE_LABEL[id]} ${m.settings.collapsed ? "expanded" : "collapsed"}`),
      f: () => op(m.settings.mode === "float" ? { op: "restore", id } : { op: "float", id }, `${MODULE_LABEL[id]} ${m.settings.mode === "float" ? "back in the layout" : "floating"}`),
      d: () => op({ op: "dock", id }, `${MODULE_LABEL[id]} docked`),
      Enter: () => expand(id),
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
      // Keep focus on the module that moved (the DOM order may have changed).
      requestAnimationFrame(() => (rootRef.current?.querySelector(`[data-home-module="${id}"]`) as HTMLElement | null)?.focus());
    }
  };

  /* ---------------- one module frame ---------------- */
  const frame = (m: SolvedModule, style: CSSProperties, extra?: string) => {
    const rotate = m.tilt ? `rotate(${m.tilt}deg)` : undefined;
    const s = m.settings;
    const dragging = drag?.id === m.id;
    const floatRect = m.rect;
    const translate = dragging && drag ? (drag.kind === "resize" ? undefined : `translate(${drag.dx}px, ${drag.dy}px)`) : undefined;
    const resizing = dragging && drag?.kind === "resize" && rootRef.current;
    const box = rootRef.current?.getBoundingClientRect();
    const sized: CSSProperties = resizing && floatRect && box ? { width: `${(floatRect.w + drag!.dx / box.width) * 100}%`, height: `${(floatRect.h + drag!.dy / box.height) * 100}%` } : {};
    return (
      <div
        key={m.id}
        className={`hc-module${extra ? ` ${extra}` : ""}`}
        data-home-module={m.id}
        data-size={s.size}
        data-collapsed={s.collapsed ? "true" : "false"}
        data-pinned={s.pinned ? "true" : "false"}
        data-locked={s.locked ? "true" : "false"}
        data-dragging={dragging ? "true" : "false"}
        data-menu-open={menu === m.id ? "true" : "false"}
        data-depth={m.depth ?? 0}
        style={{ ...style, ...sized, ...(rotate ? { transform: rotate } : null), ...(translate ? { transform: translate, zIndex: 50 } : null) }}
        tabIndex={editing ? 0 : undefined}
        role={editing ? "group" : undefined}
        aria-label={editing ? `${MODULE_LABEL[m.id]} — ${s.size} ${s.locked ? "locked " : ""}${s.pinned ? "pinned " : ""}module. Arrows move, plus and minus resize, H hide, P pin, L lock, C collapse, F float, D dock, Enter expand.` : undefined}
        onKeyDown={(e) => onKey(e, m)}
      >
        {editing ? (
          <div className="hc-chrome" onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="hc-handle"
              aria-label={`Drag ${MODULE_LABEL[m.id]}`}
              disabled={s.locked}
              onPointerDown={(e) => startDrag(e, m.id, m.rect ? "float" : "move", m.rect)}
            >
              <HomeIcon name="GripVertical" size={14} />
              <span>{m.members.length > 1 ? m.members.map((x) => MODULE_LABEL[x]).join(" + ") : MODULE_LABEL[m.id]}</span>
            </button>
            <span className="hc-tools">
              <button type="button" aria-label="Smaller" title="Smaller" disabled={s.locked || s.size === SIZES[0]} onClick={() => op({ op: "grow", id: m.id, delta: -1 })}>
                <HomeIcon name="Minus" size={13} />
              </button>
              <button type="button" aria-label="Larger" title="Larger" disabled={s.locked || s.size === SIZES[SIZES.length - 1]} onClick={() => op({ op: "grow", id: m.id, delta: 1 })}>
                <HomeIcon name="Plus" size={13} />
              </button>
              <button type="button" aria-label={s.pinned ? "Unpin" : "Pin first"} aria-pressed={s.pinned} title="Pin" onClick={() => op({ op: "toggle", id: m.id, flag: "pinned" })}>
                <HomeIcon name="Pin" size={13} />
              </button>
              <button type="button" aria-label={s.locked ? "Unlock" : "Lock"} aria-pressed={s.locked} title="Lock" onClick={() => op({ op: "toggle", id: m.id, flag: "locked" })}>
                <HomeIcon name={s.locked ? "Lock" : "LockOpen"} size={13} />
              </button>
              <button type="button" aria-label={s.collapsed ? "Expand" : "Collapse"} title="Collapse" disabled={s.locked} onClick={() => op({ op: "toggle", id: m.id, flag: "collapsed" })}>
                <HomeIcon name={s.collapsed ? "ChevronDown" : "ChevronUp"} size={13} />
              </button>
              <button type="button" aria-label="More" aria-expanded={menu === m.id} title="More" onClick={() => setMenu(menu === m.id ? null : m.id)}>
                <HomeIcon name="Menu" size={13} />
              </button>
            </span>
            {menu === m.id ? (
              <div className="hc-menu" role="menu">
                {/* On narrow modules the tool pill folds away; its controls live here too. */}
                <span className="hc-menu-tools">
                  <button type="button" role="menuitem" disabled={s.locked || s.size === SIZES[SIZES.length - 1]} onClick={() => op({ op: "grow", id: m.id, delta: 1 })}>
                    <HomeIcon name="Plus" size={14} /> Larger
                  </button>
                  <button type="button" role="menuitem" disabled={s.locked || s.size === SIZES[0]} onClick={() => op({ op: "grow", id: m.id, delta: -1 })}>
                    <HomeIcon name="Minus" size={14} /> Smaller
                  </button>
                  <button type="button" role="menuitem" onClick={() => op({ op: "toggle", id: m.id, flag: "pinned" })}>
                    <HomeIcon name="Pin" size={14} /> {s.pinned ? "Unpin" : "Pin first"}
                  </button>
                  <button type="button" role="menuitem" onClick={() => op({ op: "toggle", id: m.id, flag: "locked" })}>
                    <HomeIcon name={s.locked ? "LockOpen" : "Lock"} size={14} /> {s.locked ? "Unlock" : "Lock"}
                  </button>
                  <button type="button" role="menuitem" disabled={s.locked} onClick={() => op({ op: "toggle", id: m.id, flag: "collapsed" })}>
                    <HomeIcon name={s.collapsed ? "ChevronDown" : "ChevronUp"} size={14} /> {s.collapsed ? "Expand" : "Collapse"}
                  </button>
                  <hr />
                </span>
                <button type="button" role="menuitem" onClick={() => (expand(m.id), setMenu(null))}>
                  <HomeIcon name="Maximize2" size={14} /> Expand
                </button>
                <button type="button" role="menuitem" disabled={s.locked} onClick={() => (op(s.mode === "float" ? { op: "restore", id: m.id } : { op: "float", id: m.id }), setMenu(null))}>
                  <HomeIcon name="AppWindow" size={14} /> {s.mode === "float" ? "Back into the layout" : "Float"}
                </button>
                <button type="button" role="menuitem" disabled={s.locked} onClick={() => (op({ op: "dock", id: m.id }), setMenu(null))}>
                  <HomeIcon name="PanelBottom" size={14} /> Dock (minimise)
                </button>
                {m.members.length > 1 || s.group ? (
                  <button type="button" role="menuitem" onClick={() => (op({ op: "ungroup", id: m.id }), setMenu(null))}>
                    <HomeIcon name="Layers" size={14} /> Ungroup
                  </button>
                ) : (
                  (() => {
                    const next = order[order.indexOf(m.id) + 1];
                    return next ? (
                      <button type="button" role="menuitem" disabled={s.locked} onClick={() => (op({ op: "group", id: m.id, with: next }), setMenu(null))}>
                        <HomeIcon name="Layers3" size={14} /> Group with {MODULE_LABEL[next]}
                      </button>
                    ) : null;
                  })()
                )}
                <button type="button" role="menuitem" onClick={() => (op({ op: "toggle", id: m.id, flag: "hidden" }), setMenu(null))}>
                  <HomeIcon name="EyeOff" size={14} /> Hide
                </button>
                <hr />
                {MODULE_PANEL[m.id] ? (
                  <button type="button" role="menuitem" onClick={(e) => toWindow(m.id, e.currentTarget)}>
                    <HomeIcon name="AppWindow" size={14} /> Open as a window
                  </button>
                ) : null}
                <button type="button" role="menuitem" onClick={toChatUniverse}>
                  <HomeIcon name="MessageCircle" size={14} /> Chat Universe
                </button>
                <button type="button" role="menuitem" onClick={() => void toCosmos(m.id)}>
                  <HomeIcon name="Orbit" size={14} /> Place in the Cosmos
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {look.border !== "none" ? <span className="hc-fx" data-fx={look.border} aria-hidden /> : null}
        {look.border2 !== "none" ? <span className="hc-fx" data-fx={look.border2} data-layer="inner" aria-hidden /> : null}
        <ModuleBody m={m} preview={preview} stacked={solved.params.groupView === "stack"} onOpenLibrary={onOpenLibrary} onOpenWindows={onOpenWindows} />
        {editing && m.rect ? <span className="hc-resize" aria-hidden onPointerDown={(e) => startDrag(e, m.id, "resize", m.rect)} /> : null}
      </div>
    );
  };

  const kind = solved.kind;
  const absolute = ABSOLUTE_KINDS.has(kind);
  const params = solved.params;
  const windowShare = params.window ?? 0;
  const rootStyle: CSSProperties = {
    ...look.vars,
    ...(skinVars ?? null),
    ["--cols" as string]: solved.columns,
    ["--rows" as string]: solved.rows,
    ["--hc-density" as string]: params.density ?? 0.5,
    ["--hc-depth" as string]: params.depth ?? 1,
    ...(params.maxWidth ? { ["--hc-maxw" as string]: `${params.maxWidth}px` } : null),
    ...(windowShare ? { ["--hc-window" as string]: `${Math.round(windowShare * 100)}%` } : null),
  };
  const placedAt = (m: SolvedModule) =>
    absolute && m.rect
      ? frame(m, { left: `${m.rect.x * 100}%`, top: `${m.rect.y * 100}%`, width: `${m.rect.w * 100}%`, height: `${m.rect.h * 100}%` }, "hc-abs")
      : m.cell
        ? frame(m, kind === "deck" || kind === "rows" ? {} : { gridColumn: `${m.cell.col} / span ${m.cell.w}`, gridRow: `${m.cell.row} / span ${m.cell.h}` })
        : null;
  const rowsOf = kind === "rows" ? [...new Set(solved.placed.map((m) => m.cell?.row ?? 1))].sort((a, b) => a - b) : [];
  const centre = (id: HomeModuleId) => {
    const r = solved.placed.find((m) => m.id === id)?.rect;
    return r ? { x: (r.x + r.w / 2) * 100, y: (r.y + r.h / 2) * 100 } : null;
  };
  return (
    <div
      ref={rootRef}
      className="hc"
      data-kind={kind}
      data-device={device}
      data-editing={editing ? "true" : "false"}
      data-template={presentation.template}
      data-adaptive={mode}
      data-styled={presentation.style ? "true" : "false"}
      data-motion={presentation.style?.motion === false ? "off" : "on"}
      data-stacked={params.stacked ? "true" : undefined}
      data-rail={params.rail ? "true" : undefined}
      data-rings={params.rings ? "true" : undefined}
      data-window={windowShare ? "true" : undefined}
      data-density={params.density !== undefined ? params.density : undefined}
      aria-label={label ?? `Home — ${presentation.name}`}
      style={rootStyle}
    >
      <FxDefs />
      <div className="hc-body">
        {kind === "rows" ? (
          <div className="hc-stage hc-rows">
            {rowsOf.map((row, i) => (
              <section key={row} className="hc-row" aria-label={params.laneNames?.[i] ?? `Row ${i + 1}`}>
                {params.laneNames?.[i] ? <h3 className="hc-lane-head">{params.laneNames[i]}</h3> : null}
                <div className="hc-row-track">{solved.placed.filter((m) => (m.cell?.row ?? 1) === row).map(placedAt)}</div>
              </section>
            ))}
          </div>
        ) : (
          <div className="hc-stage">
            {kind === "lanes" && params.laneNames?.length
              ? params.laneNames.slice(0, solved.columns).map((name, i) => (
                  <h3 key={name + i} className="hc-lane-head" style={{ gridColumn: `${i + 1} / span 1`, gridRow: "1 / span 1" }}>
                    {name}
                  </h3>
                ))
              : null}
            {solved.links?.length ? (
              <svg className="hc-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                {solved.links.map(([a, b]) => {
                  const p = centre(a);
                  const q = centre(b);
                  return p && q ? <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> : null;
                })}
              </svg>
            ) : null}
            {solved.placed.map(placedAt)}
          </div>
        )}
        {windowShare ? (
          <div className="hc-window" role="img" aria-label="A window onto the live Cosmos">
            <span>The Cosmos</span>
          </div>
        ) : null}
      </div>
      {solved.floating.map((m) => frame(m, { left: `${m.rect!.x * 100}%`, top: `${m.rect!.y * 100}%`, width: `${m.rect!.w * 100}%`, height: `${m.rect!.h * 100}%` }, "hc-abs hc-float"))}
      {solved.docked.length || (editing && solved.hidden.length) ? (
        <div className="hc-dock" role="toolbar" aria-label="Docked modules">
          {solved.docked.map((id) => (
            <button key={id} type="button" className="hc-dock-chip" onClick={() => (editing ? op({ op: "restore", id }, `${MODULE_LABEL[id]} restored`) : expand(id))} aria-label={editing ? `Restore ${MODULE_LABEL[id]}` : `Open ${MODULE_LABEL[id]}`}>
              {MODULE_LABEL[id]}
            </button>
          ))}
          {editing
            ? solved.hidden.map((id) => (
                <button key={id} type="button" className="hc-dock-chip" data-hidden="true" onClick={() => op({ op: "toggle", id, flag: "hidden" }, `${MODULE_LABEL[id]} shown`)} aria-label={`Show ${MODULE_LABEL[id]}`}>
                  <HomeIcon name="Eye" size={12} /> {MODULE_LABEL[id]}
                </button>
              ))
            : null}
        </div>
      ) : null}
      {expanded ? (
        <div className="hc-expanded" role="dialog" aria-label={`${MODULE_LABEL[expanded]} — expanded`}>
          <div className="hc-expanded-bar">
            <strong>{MODULE_LABEL[expanded]}</strong>
            {MODULE_PANEL[expanded] ? (
              <button type="button" onClick={(e) => (toWindow(expanded, e.currentTarget), setExpanded(null))}>
                <HomeIcon name="AppWindow" size={14} /> Open as a window
              </button>
            ) : null}
            <button type="button" aria-label="Close" onClick={() => setExpanded(null)}>
              <HomeIcon name="X" size={16} />
            </button>
          </div>
          <div className="hc-expanded-body">
            <HomeModuleView id={expanded} preview={preview} onOpenLibrary={onOpenLibrary} onOpenWindows={onOpenWindows} />
          </div>
        </div>
      ) : null}
      <p className="hc-sr" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/** A module, or a group of modules sharing one surface (as tabs, or stacked). */
function ModuleBody({ m, stacked, ...props }: HomeModuleProps & { m: SolvedModule; stacked?: boolean }) {
  const [tab, setTab] = useState(0);
  if (m.settings.collapsed) {
    return <div className="lch-glass hc-collapsed">{MODULE_LABEL[m.id]}</div>;
  }
  if (m.members.length < 2) return <HomeModuleView id={m.id} {...props} />;
  if (stacked) {
    return (
      <div className="hc-group hc-group-stack" role="group" aria-label={m.members.map((id) => MODULE_LABEL[id]).join(" and ")}>
        {m.members.map((id) => (
          <div key={id} className="hc-stack-cell">
            <HomeModuleView id={id} {...props} />
          </div>
        ))}
      </div>
    );
  }
  const active = m.members[Math.min(tab, m.members.length - 1)];
  return (
    <div className="hc-group">
      <div className="hc-tabs" role="tablist" aria-label="Grouped modules">
        {m.members.map((id, i) => (
          <button key={id} type="button" role="tab" aria-selected={id === active} onClick={() => setTab(i)}>
            {MODULE_LABEL[id]}
          </button>
        ))}
      </div>
      <div className="hc-tabpanel" role="tabpanel">
        <HomeModuleView id={active} {...props} />
      </div>
    </div>
  );
}

/**
 * The SVG filters the elemental borders use (feTurbulence displacement:
 * water ripples, fire and lava churn, lightning crackles, moss grows).
 * Static noise; the motion comes from the CSS gradients moving under it.
 * Several Homes on one page (the studio) render identical copies — harmless.
 */
function FxDefs() {
  return (
    <svg className="hc-fx-defs" width="0" height="0" aria-hidden focusable="false">
      <filter id="hc-fx-water" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="2" seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="7" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="hc-fx-fire" x="-20%" y="-30%" width="140%" height="160%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035 0.09" numOctaves="3" seed="8" />
        <feDisplacementMap in="SourceGraphic" scale="11" xChannelSelector="R" yChannelSelector="B" />
      </filter>
      <filter id="hc-fx-lava" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="2" seed="11" />
        <feDisplacementMap in="SourceGraphic" scale="9" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="hc-fx-lightning" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="turbulence" baseFrequency="0.09" numOctaves="1" seed="2" />
        <feDisplacementMap in="SourceGraphic" scale="6" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="hc-fx-nature" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="5" />
        <feDisplacementMap in="SourceGraphic" scale="5" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
