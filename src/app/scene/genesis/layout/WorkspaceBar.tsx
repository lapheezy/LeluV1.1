/**
 * LÉLU — the workspace bar.
 *
 * Every open window, one row. On a phone it IS the sheet's title bar (one
 * window is the screen, the others are tabs a tap away); on a desktop it is
 * a floating pill under the work area with the layout modes and the
 * steward's last decision — what it did, why, and that it cost no model call.
 * Motion animates the active tab and the layout switch.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useGenesisActions, useGenesisState } from "../GenesisCore";
import WorkspaceStewardStore from "../../../../core/interface/WorkspaceStewardStore";
import type { StewardLayout, StewardMode } from "../../../../core/interface/WorkspaceSteward";
import { arrangeWorkspace, type StewardHost } from "./stewardActions";
import { setUniverseOpen } from "../chat/universe/universeOpen";
import "./workspaceBar.css";

const MODES: Array<{ id: StewardMode; label: string; glyph: string }> = [
  { id: "auto", label: "Auto", glyph: "✦" },
  { id: "tile", label: "Tile", glyph: "▦" },
  { id: "split", label: "Split", glyph: "◫" },
  { id: "focus", label: "Focus", glyph: "◧" },
  { id: "stack", label: "Stack", glyph: "❐" },
  { id: "fullscreen", label: "Full", glyph: "⛶" },
];

export function useStewardViewport(): { width: number; height: number } {
  const read = () => ({
    width: Math.round(typeof window === "undefined" ? 1440 : window.visualViewport?.width ?? window.innerWidth),
    height: Math.round(typeof window === "undefined" ? 900 : window.visualViewport?.height ?? window.innerHeight),
  });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVp((prev) => {
        const next = read();
        return prev.width === next.width && prev.height === next.height ? prev : next;
      }));
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return vp;
}

/**
 * Recognise content that does not fit its window: a descendant reaching past
 * the window's right edge. Reported to the steward, which gives the window
 * room (desktop) — or, where no room exists, the panel's own container
 * queries reflow it. Debounced; reads layout only, never writes it.
 */
export function useContentOverflowWatch(key: string): void {
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scan = () => {
      for (const content of document.querySelectorAll<HTMLElement>("[data-lelu-module-content]")) {
        const id = content.getAttribute("data-lelu-module-content");
        if (!id || content.offsetParent === null) continue;
        const box = content.getBoundingClientRect();
        let right = box.right;
        const nodes = content.querySelectorAll<HTMLElement>("*");
        const limit = Math.min(nodes.length, 600);
        for (let i = 0; i < limit; i += 1) {
          const r = nodes[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.right > right) right = r.right;
        }
        const overflow = right - box.right;
        if (overflow > 6) WorkspaceStewardStore.reportNeed(id, box.width + overflow + 24);
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(scan, 450);
    };
    const observer = new ResizeObserver(schedule);
    for (const el of document.querySelectorAll("[data-lelu-module-content]")) observer.observe(el);
    schedule();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [key]);
}

export default function WorkspaceBar({
  compact,
  ids,
  shown,
  labelOf,
  glyphOf,
  mode,
  layout,
  reasons,
}: {
  compact: boolean;
  ids: string[];
  shown: string[];
  labelOf: (id: string) => string;
  glyphOf: (id: string) => string;
  mode: StewardMode;
  layout: StewardLayout;
  reasons: string[];
}) {
  const actions = useGenesisActions();
  const { state } = useGenesisState();
  const [why, setWhy] = useState(false);
  const [menu, setMenu] = useState(false);
  const log = useSyncExternalStore(WorkspaceStewardStore.subscribe, () => WorkspaceStewardStore.get().log, () => WorkspaceStewardStore.get().log);
  const minimized = Object.entries(state.modules).filter(([, m]) => m.presentation === "minimized").map(([id]) => id);
  const all = [...ids, ...minimized.filter((id) => !ids.includes(id))];
  const active = shown[0] ? [...shown].sort((a, b) => (state.modules[b]?.zIndex ?? 0) - (state.modules[a]?.zIndex ?? 0))[0] : null;

  const host: StewardHost = {
    modules: () => state.modules,
    openModule: actions.openModule,
    setModulePresentation: actions.setModulePresentation,
    raiseModule: actions.raiseModule,
    activeConversationId: () => state.activeConversationId ?? null,
  };
  const go = (id: string) => {
    const m = state.modules[id];
    if (!m || m.presentation === "minimized" || m.presentation === "closed") actions.setModulePresentation(id, "inline");
    actions.raiseModule(id);
    WorkspaceStewardStore.setFocus(id);
  };
  const pick = (next: StewardMode) => {
    setMenu(false);
    arrangeWorkspace(host, next, [], "user");
  };
  const hideAll = () => {
    for (const id of ids) actions.minimizeModule(id);
  };

  const tabs = (
    <LayoutGroup id={compact ? "ws-tabs-compact" : "ws-tabs"}>
      <div className="lws-tabs" role="tablist" aria-label="Open windows">
        {all.map((id) => {
          const on = id === active || (!compact && shown.includes(id));
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              data-on={on}
              data-state={shown.includes(id) ? "shown" : minimized.includes(id) ? "minimized" : "tab"}
              className="lws-tab"
              onClick={() => go(id)}
              title={shown.includes(id) ? labelOf(id) : `${labelOf(id)} — still running; tap to bring it in`}
            >
              {id === active ? <motion.span layoutId="lws-active" className="lws-tab-glow" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
              <span className="lws-tab-glyph" aria-hidden>{glyphOf(id)}</span>
              <span className="lws-tab-label">{labelOf(id)}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );

  const modes = (
    <div className="lws-modes" role="group" aria-label="Layout">
      {MODES.map((m) => (
        <button key={m.id} type="button" data-on={mode === m.id} aria-pressed={mode === m.id} onClick={() => pick(m.id)} title={`${m.label} layout`} data-lelu-layout={m.id}>
          {mode === m.id ? <motion.span layoutId={compact ? "lws-mode-c" : "lws-mode"} className="lws-mode-glow" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
          <span aria-hidden>{m.glyph}</span>
          <span className="lws-mode-label">{m.label}</span>
        </button>
      ))}
    </div>
  );

  const lastLelu = [...log].reverse().find((d) => d.by === "lelu");
  const explain = (
    <AnimatePresence>
      {why ? (
        <motion.div
          className="lws-why"
          data-lelu-steward-why
          initial={{ opacity: 0, y: compact ? -8 : 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: compact ? -8 : 8 }}
          transition={{ duration: 0.2 }}
        >
          <strong>LÉLU organised this: {layout}</strong>
          <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {lastLelu ? <p>Last change by LÉLU: {lastLelu.what}</p> : null}
          <p className="lws-zero">Model calls for organising: 0 · runs on this device</p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (compact) {
    return (
      <div className="lws lws-compact" data-lelu-workspace-bar="compact">
        <button type="button" className="lws-icon" aria-label="Back to the Universe — windows keep running" onClick={() => { hideAll(); setUniverseOpen(true); }}>‹</button>
        {tabs}
        <button type="button" className="lws-icon" aria-label="Layout" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>▦</button>
        <button type="button" className="lws-icon" aria-label="Why this layout" aria-expanded={why} onClick={() => setWhy((v) => !v)}>ⓘ</button>
        {active ? <button type="button" className="lws-icon" aria-label={`Close ${labelOf(active)}`} onClick={() => actions.closeModule(active)}>✕</button> : null}
        <AnimatePresence>
          {menu ? (
            <motion.div className="lws-menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              {modes}
            </motion.div>
          ) : null}
        </AnimatePresence>
        {explain}
      </div>
    );
  }

  return (
    <motion.div layout className="lws lws-desktop" data-lelu-workspace-bar="desktop" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      {tabs}
      <span className="lws-sep" />
      {modes}
      <button type="button" className="lws-icon" aria-label="Why this layout" aria-expanded={why} onClick={() => setWhy((v) => !v)}>ⓘ</button>
      {explain}
    </motion.div>
  );
}
