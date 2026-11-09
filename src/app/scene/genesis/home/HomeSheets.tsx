/**
 * ==========================================================
 * LÉLU — HOME SHEETS
 *
 *   LibrarySheet  every application LÉLU has (homeCatalog), by group,
 *                 searchable, each showing whether it is open, minimized,
 *                 working or waiting on you (GenesisCore module state)
 *   WindowsSheet  the windows that are open now — bring forward,
 *                 minimize, close — and the layout you left at home
 *   WorldsSheet   which world the Cosmos shows
 *
 * A bottom sheet on a phone, a floating panel on a desktop; the Cosmos
 * stays visible around it.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { conversationIdOf, useGenesis, type GenesisPanel, type ModuleState } from "../GenesisCore";
import { HomeIcon } from "./CosmosHome";
import { APPS, GROUPS, appFor, type AppGroup } from "./homeCatalog";
import { goHome, launch, restoreLayout } from "./homeActions";
import HomeStore from "./homeStore";
import { useHomeStore } from "./useHomeLive";

function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lsh-backdrop" onClick={onClose} data-testid={testId}>
      <div ref={ref} className="lsh" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="lsh-grip" aria-hidden />
        <div className="lsh-head">
          <strong>{title}</strong>
          <button type="button" className="lsh-close" aria-label={`Close ${title}`} onClick={onClose}>
            <HomeIcon name="X" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function stateLabel(mod: ModuleState | undefined): string | null {
  if (!mod || mod.presentation === "closed") return null;
  if (mod.status === "attention") return "Needs you";
  if (mod.status === "failed") return "Failed";
  if (mod.status === "active" || mod.status === "loading") return "Working";
  return mod.presentation === "minimized" ? "Minimized" : "Open";
}

export function LibrarySheet({ group, onClose }: { group?: AppGroup; onClose: () => void }) {
  const genesis = useGenesis();
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<AppGroup | undefined>(group);
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => APPS.filter((app) => (!only || app.group === only) && (!q || app.label.toLowerCase().includes(q) || app.hint.toLowerCase().includes(q))),
    [only, q],
  );
  return (
    <Sheet title="App Library" onClose={onClose} testId="lelu-library">
      <label className="lsh-search">
        <HomeIcon name="Search" size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an app" aria-label="Find an app" />
      </label>
      <div className="lsh-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!only} data-on={!only ? "true" : "false"} onClick={() => setOnly(undefined)}>
          All
        </button>
        {GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={only === g.id} data-on={only === g.id ? "true" : "false"} onClick={() => setOnly(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      <div className="lsh-grid">
        {matches.map((app) => {
          const label = stateLabel(genesis.state.modules[app.id]) ?? (genesis.state.activePanel === app.id ? "Open" : null);
          return (
            <button
              key={app.id}
              type="button"
              className="lsh-app"
              data-group={app.group}
              onClick={(e) => {
                launch(genesis, app.id, e.currentTarget);
                onClose();
              }}
            >
              <span className="lsh-app-icon">
                <HomeIcon name={app.icon} size={24} />
              </span>
              <span className="lsh-app-name">{app.label}</span>
              <small>{label ?? app.hint}</small>
              {label ? <i className="lsh-app-dot" data-state={label} aria-hidden /> : null}
            </button>
          );
        })}
        {matches.length === 0 ? <p className="lsh-empty">No app matches “{query}”.</p> : null}
      </div>
    </Sheet>
  );
}

export function WindowsSheet({ onClose }: { onClose: () => void }) {
  const genesis = useGenesis();
  const home = useHomeStore();
  const open = Object.entries(genesis.state.modules).filter(([id, m]) => id !== "chat" && m.presentation !== "closed");
  const chatOpen = genesis.state.activePanel === "chat";
  const left = home.layout ? Object.keys(home.layout.modules) : [];
  return (
    <Sheet title="Windows" onClose={onClose} testId="lelu-windows">
      {open.length || chatOpen ? (
        <ul className="lsh-list">
          {chatOpen ? (
            <li>
              <span className="lsh-app-icon">
                <HomeIcon name="MessageCircle" size={20} />
              </span>
              <span className="lsh-list-name">Chat</span>
              <small>Open</small>
            </li>
          ) : null}
          {open.map(([id, mod]) => {
            const app = appFor(id);
            const conversationId = conversationIdOf(id);
            const title = conversationId
              ? genesis.state.conversations.find((c) => c.id === conversationId)?.title ?? "Chat"
              : app?.label ?? id;
            const icon = conversationId ? "MessageCircle" : app?.icon ?? "AppWindow";
            return (
              <li key={id}>
                <span className="lsh-app-icon">
                  <HomeIcon name={icon} size={20} />
                </span>
                <span className="lsh-list-name">{title}</span>
                <small>{stateLabel(mod)}</small>
                <span className="lsh-list-actions">
                  <button type="button" aria-label={`Bring ${title} forward`} title="Bring forward" onClick={() => { genesis.setModulePresentation(id, "inline"); genesis.raiseModule(id); onClose(); }}>
                    <HomeIcon name="Maximize2" size={15} />
                  </button>
                  <button type="button" aria-label={`Minimize ${title}`} title="Minimize" onClick={() => genesis.minimizeModule(id)}>
                    <HomeIcon name="Minimize2" size={15} />
                  </button>
                  <button type="button" aria-label={`Close ${title}`} title="Close" onClick={() => genesis.closeModule(id)}>
                    <HomeIcon name="X" size={15} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="lsh-empty">No windows are open.</p>
      )}
      <div className="lsh-actions">
        {left.length ? (
          <button type="button" className="lsh-primary" onClick={() => { restoreLayout(genesis); onClose(); }}>
            <HomeIcon name="RotateCcw" size={16} /> Restore the {left.length} window{left.length === 1 ? "" : "s"} you left
          </button>
        ) : null}
        {open.length || chatOpen ? (
          <button type="button" onClick={() => { goHome(genesis); onClose(); }}>
            <HomeIcon name="Home" size={16} /> Home (keeps this layout)
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

export function WorldsSheet({
  onClose,
  onSystem,
  selfExploration,
  onToggleSelfExploration,
}: {
  onClose: () => void;
  onSystem: () => void;
  selfExploration: boolean;
  onToggleSelfExploration: () => void;
}) {
  const genesis = useGenesis();
  const home = useHomeStore();
  const scene = genesis.state.activeScene;
  const worlds: Array<{ id: string; label: string; hint: string; icon: string; on: boolean; go: () => void }> = [
    { id: "cosmos", label: "Cosmos", hint: "Her living universe — home", icon: "Orbit", on: scene !== "genesisv2" && genesis.state.activePanel === "none", go: () => { goHome(genesis); HomeStore.setImmersive(false); } },
    { id: "genesisv2", label: "Her world", hint: "LÉLU in 3D, her rooms", icon: "Layers", on: scene === "genesisv2", go: () => genesis.openPanel("genesisv2" as GenesisPanel) },
    { id: "earth", label: "Earth", hint: "Live planet data", icon: "Globe2", on: genesis.state.activePanel === "earth", go: () => { if (scene === "genesisv2") genesis.openPanel("none"); genesis.openPanel("earth" as GenesisPanel); } },
    { id: "system", label: "System", hint: "Her systems, visualised", icon: "Activity", on: false, go: onSystem },
  ];
  return (
    <Sheet title="Worlds" onClose={onClose} testId="lelu-worlds">
      <ul className="lsh-list">
        {worlds.map((w) => (
          <li key={w.id}>
            <button type="button" className="lsh-world" data-world={w.id} data-on={w.on ? "true" : "false"} aria-current={w.on ? "true" : undefined} onClick={() => { w.go(); onClose(); }}>
              <span className="lsh-app-icon">
                <HomeIcon name={w.icon} size={20} />
              </span>
              <span className="lsh-list-name">{w.label}</span>
              <small>{w.on ? "Showing" : w.hint}</small>
            </button>
          </li>
        ))}
      </ul>
      <div className="lsh-actions">
        <button
          type="button"
          role="switch"
          aria-checked={home.cosmosMode === "floating"}
          onClick={() => HomeStore.setCosmosMode(home.cosmosMode === "floating" ? "workspace" : "floating")}
        >
          <HomeIcon name="Orbit" size={16} /> Float the windows over the live Cosmos: {home.cosmosMode === "floating" ? "on" : "off"}
        </button>
        <button type="button" role="switch" aria-checked={selfExploration} onClick={onToggleSelfExploration}>
          <HomeIcon name="Sparkles" size={16} /> Let her explore the Cosmos on her own: {selfExploration ? "on" : "off"}
        </button>
      </div>
    </Sheet>
  );
}
