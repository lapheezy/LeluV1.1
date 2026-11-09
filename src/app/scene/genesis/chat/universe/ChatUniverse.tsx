/**
 * LÉLU — Multi-Chat Universe.
 *
 * One owner for the whole screen while open (z-index 480): nothing from the
 * home, the nav or the 3D scene's labels can show through in WORKSPACE mode.
 * Regions are a CSS grid, not stacked fixed layers:
 *
 *   desktop  [rail] [header + timeline / card grid / carousel]
 *            [universal composer + quick dock]
 *   phone    [header with LÉLU] [card grid] [composer + dock]
 *
 * Windows are NOT this file's. Opening a chat opens `chat:<id>` in the one
 * window host (GenesisModuleHost → GenesisWindowFrame), so a chat window is
 * the same window as every application's: draggable, resizable, stackable,
 * minimizable, and it survives closing the Universe. The open set is read
 * from the module state, so there is exactly one source of truth.
 *
 * Cosmos mode (homeStore.cosmosMode, single owner — also toggled from the
 * Worlds sheet):
 *
 *   workspace  the opaque Cosmos room; the scene's frameloop is paused
 *              through the existing budget while this covers it
 *   floating   the live scene shows through: only the cards and windows
 *              are solid, and the scene keeps rendering
 *
 * Sending reuses GenesisChat's send path (`lelu-universe-send`) after the
 * target is made the active conversation, so streaming, tools, queueing,
 * steering and persistence are the ones that already work.
 *
 * Organisation is the user's: no categories, nothing moved. Artwork is a
 * picture chosen from the chat's own words, never a folder.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Icons from "lucide-react";
import { chatWindowId, conversationIdOf, floatsAboveChat, useGenesis } from "../../GenesisCore";
import { setUniverseOpen, useUniverseOpen } from "./universeOpen";
import { processImageFile, processVideoFile, type ProcessedMedia } from "../../../../../core/media/mediaProcessor";
import ScreenShare from "../../../../../core/perception/ScreenShare";
import { explainScreenShareFailure, screenShareSupport } from "../../../../../core/perception/screenCapability";
import VoiceEngine from "../../../../../core/voice/VoiceEngine";
import { useSurface } from "../../surface/useSurface";
import MultiChatStore, { type ChatConversation } from "../../../../../core/multichat/MultiChatStore";
import { goHome } from "../../home/homeActions";
import HomeStore from "../../home/homeStore";
import { useHomeStore } from "../../home/useHomeLive";
import { getSceneRenderBudget } from "../../SceneRenderBudget";
import {
  artFor,
  gridOrder,
  previewOf,
  loadAppearance,
  recentOrder,
  relativeTime,
  saveAppearance,
  timelineMarkers,
  type ChatAppearance,
  type ChatPreview,
  type TimelineRange,
} from "./universeModel";
import "./chatUniverse.css";

export const OPEN_UNIVERSE_EVENT = "lelu-open-universe";
export const UNIVERSE_SEND_EVENT = "lelu-universe-send";

export function openChatUniverse(): void {
  window.dispatchEvent(new CustomEvent(OPEN_UNIVERSE_EVENT));
}

const ART_BASE = `${import.meta.env?.BASE_URL ?? "/"}universe/`.replace(/\/\/+/g, "/");

function useArchived() {
  const store = MultiChatStore.getInstance();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(() => store.listArchived().map((c) => `${c.id}:${c.updatedAt}`).join("|"), [store]);
  const key = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => store.listArchived(), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Ico({ name, size = 18 }: { name: string; size?: number }) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[name] ?? Icons.Circle;
  return <C size={size} />;
}

const ART_ICON: Record<string, string> = {
  lotus: "Moon", rings: "Code2", fabric: "Shirt", crystals: "Atom", build: "Layers",
  jellyfish: "Sparkles", forest: "Leaf", horizon: "Plane", galaxy: "Orbit",
};

function Art({ conversation, appearance, className = "lcu-art" }: { conversation: ChatConversation; appearance?: ChatAppearance; className?: string }) {
  if (appearance?.image === null) return <div className={className} data-off="true" />;
  const src = appearance?.image ?? previewOf(conversation as ChatConversation).attachment ?? `${ART_BASE}${artFor(conversation)}.webp`;
  return <div className={className} style={{ backgroundImage: `url("${src}")` }} />;
}

/** LÉLU's state, from real application state only. */
function presenceOf(processing: boolean, activityStatus: string | null): { label: string; state: string } {
  if (activityStatus === "running") return { label: "Working", state: "working" };
  if (processing) return { label: "Thinking", state: "thinking" };
  return { label: "Here with you", state: "idle" };
}

const RAIL: Array<{ id: string; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "Home" },
  { id: "chat", label: "Chat ∞", icon: "MessagesSquare" },
  { id: "browser", label: "Browser", icon: "Globe" },
  { id: "workspaces", label: "Apps", icon: "LayoutGrid" },
  { id: "visualstudio", label: "Studio", icon: "Box" },
  { id: "render", label: "Render", icon: "Play" },
  { id: "projects", label: "Files", icon: "Folder" },
  { id: "agents", label: "Agents", icon: "Network" },
  { id: "memory", label: "Memory", icon: "Layers" },
  { id: "history", label: "Diary", icon: "BookOpen" },
  { id: "settings", label: "Settings", icon: "Settings" },
];

export default function ChatUniverse() {
  const genesis = useGenesis();
  const { conversations, activeConversationId, modules } = genesis.state;
  const home = useHomeStore();
  const mode = home.cosmosMode;
  const archived = useArchived();
  // Shared, so the surface resolver knows when the Universe owns a phone screen.
  const open = useUniverseOpen();
  const setOpen = setUniverseOpen;
  const [range, setRange] = useState<TimelineRange>("24h");
  const [filter, setFilter] = useState<"all" | "active" | "archived">("all");
  const [view, setView] = useState<"grid" | "carousel">("grid");
  const [railOpen, setRailOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [appearance, setAppearance] = useState<Record<string, ChatAppearance>>(() => loadAppearance());
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_UNIVERSE_EVENT, show);
    return () => window.removeEventListener(OPEN_UNIVERSE_EVENT, show);
  }, []);

  // While open, the Universe owns the screen: home, nav and scene labels step aside.
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.dataset.leluUniverse = "open";
    else delete root.dataset.leluUniverse;
    return () => { delete root.dataset.leluUniverse; };
  }, [open]);

  const byId = useMemo(() => new Map([...conversations, ...archived].map((c) => [c.id, c])), [conversations, archived]);

  /* The open set IS the module set: a chat window is the `chat:<id>` module
     the host renders, ordered by when it was last touched. */
  const openIds = useMemo(
    () =>
      Object.entries(modules)
        .filter(([id, m]) => m.presentation !== "closed" && conversationIdOf(id) !== null)
        .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
        .map(([id]) => conversationIdOf(id))
        .filter((id): id is string => id !== null && byId.has(id)),
    [modules, byId],
  );
  const focusedId = openIds.length ? openIds[openIds.length - 1] : null;
  const focused = focusedId ? byId.get(focusedId) ?? null : null;

  const openKey = openIds.join("|");

  // On a phone an open conversation window fills the screen and has its own
  // composer; the Universe's composer leaves the tree so there is exactly one.
  const surface = useSurface();
  const sheetOpen = surface.workspaceOwnsScreen && Object.entries(modules).some(
    ([id, m]) => floatsAboveChat(id) && (m.presentation === "inline" || m.presentation === "expanded"),
  );
  const geometryKey = useMemo(
    () =>
      Object.entries(modules)
        .filter(([id]) => conversationIdOf(id) !== null)
        .map(([id, m]) => `${id}:${m.position?.x ?? ""},${m.position?.y ?? ""},${m.size?.width ?? ""},${m.size?.height ?? ""}`)
        .join("|"),
    [modules],
  );

  /* Reopen the chats the last session left here. Waits for the store to
     hydrate — an empty conversation list would otherwise read as "the user
     closed everything" and forget them. */
  useEffect(() => {
    if (hydrated) return;
    if (conversations.length === 0) return;
    const saved = HomeStore.get().universe;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    for (const conversationId of saved.open) {
      if (!conversations.some((c) => c.id === conversationId)) continue;
      const moduleId = chatWindowId(conversationId);
      genesis.openModule(moduleId);
      genesis.setModulePresentation(moduleId, "inline");
      const rect = saved.geometry[conversationId];
      if (!rect) continue;
      genesis.moveModule(moduleId, { x: Math.round(rect.x * width), y: Math.round(rect.y * height) });
      genesis.resizeModule(moduleId, { width: Math.round(rect.width * width), height: Math.round(rect.height * height) });
    }
    setHydrated(true);
    // Runs once, after hydration; `genesis` changes identity with every state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, hydrated]);

  /* Persist the open set (homeStore owns it, so windows survive a reload). */
  useEffect(() => {
    if (!hydrated) return;
    HomeStore.rememberUniverseOpen(openKey ? openKey.split("|") : []);
  }, [hydrated, openKey]);

  /* Persist geometry NORMALISED to the viewport, so the arrangement survives
     a reload on a different screen. */
  useEffect(() => {
    if (!hydrated) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    for (const [id, mod] of Object.entries(modules)) {
      const conversationId = conversationIdOf(id);
      if (!conversationId || !mod.position || !mod.size) continue;
      HomeStore.rememberUniverseGeometry(conversationId, {
        x: mod.position.x / width,
        y: mod.position.y / height,
        width: mod.size.width / width,
        height: mod.size.height / height,
      });
    }
    // `modules` is read here; `geometryKey` is what actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, geometryKey]);

  /* Workspace mode covers the scene with an opaque room: tell the existing
     render budget, so the canvas stops drawing (frameloop "never") instead
     of painting a cosmos nobody can see. Floating mode leaves it live. */
  useEffect(() => {
    const budget = getSceneRenderBudget();
    budget.setOccluded("chat-universe", open && mode === "workspace");
    return () => budget.setOccluded("chat-universe", false);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openKey) genesis.closeModule(chatWindowId(openKey.split("|").pop()!));
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openKey, genesis]);

  const list = filter === "archived" ? archived : filter === "active" ? conversations.filter((c) => c.processing || c.unread > 0) : conversations;
  const grid = useMemo(() => gridOrder(list), [list]);
  const recent = useMemo(() => recentOrder(conversations), [conversations]);
  const markers = useMemo(() => timelineMarkers(conversations, range), [conversations, range]);
  const activeCount = conversations.filter((c) => c.processing).length;
  const presence = presenceOf(activeCount > 0 || Boolean(focused?.processing), null);

  // Attachments and screen sharing live HERE now — the old panel is gone.
  const [attached, setAttached] = useState<ProcessedMedia[]>([]);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const mediaRef = useRef<HTMLInputElement | null>(null);
  const canShareScreen = useMemo(() => screenShareSupport().supported, []);
  const [sharing, setSharing] = useState(() => ScreenShare.getInstance().isActive());
  useEffect(() => ScreenShare.getInstance().subscribe((stats) => {
    setSharing(stats.active);
    if (stats.active) setAttachNotice(null);
  }), []);
  if (!open) return null;

  const openChat = (id: string) => {
    if (archived.some((c) => c.id === id)) genesis.unarchiveConversation(id);
    if (id !== activeConversationId) genesis.switchConversation(id);
    MultiChatStore.getInstance().markRead(id);
    // Present it as a WINDOW, not a full-screen takeover: on a phone that is
    // the docked sheet above the composer, so the grid and dock stay usable
    // and a second chat can be opened without going back first.
    const moduleId = chatWindowId(id);
    genesis.openModule(moduleId);
    genesis.setModulePresentation(moduleId, "inline");
    genesis.raiseModule(moduleId);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };
  const minimizeWindows = () => {
    for (const id of openIds) genesis.minimizeModule(chatWindowId(id));
  };
  const newChat = () => {
    const id = genesis.createConversation();
    if (id) openChat(id);
  };
  const onAttach = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: ProcessedMedia[] = [];
    for (const file of [...files].slice(0, 4)) {
      try {
        next.push(file.type.startsWith("video/") ? await processVideoFile(file) : await processImageFile(file));
      } catch (error) {
        setAttachNotice(`Could not attach ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (next.length) setAttached((current) => [...current, ...next].slice(0, 4));
  };
  const send = () => {
    const text = draft.trim();
    const target = focused ?? byId.get(activeConversationId) ?? null;
    if ((!text && attached.length === 0) || !target) return;
    if (target.id !== MultiChatStore.getInstance().getActiveId()) genesis.switchConversation(target.id);
    window.dispatchEvent(new CustomEvent(UNIVERSE_SEND_EVENT, { detail: { text, conversationId: target.id, media: attached } }));
    setAttached([]);
    setDraft("");
    if (!focused) openChat(target.id);
  };
  const setImage = (id: string, image: string | null | undefined) => {
    const next = { ...appearance, [id]: { image } };
    if (image === undefined) delete next[id];
    setAppearance(next);
    saveAppearance(next);
  };
  const onFile = (file: File | undefined) => {
    if (!file || !focused) return;
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" && setImage(focused.id, reader.result);
    reader.readAsDataURL(file);
  };
  const railGo = (id: string) => {
    setRailOpen(false);
    if (id === "chat") return;
    setOpen(false);
    if (id === "home") goHome(genesis);
    else genesis.openPanel(id as never);
  };
  const spin = (dir: 1 | -1) => {
    if (recent.length === 0) return;
    const i = Math.max(0, recent.findIndex((p) => p.id === (focusedId ?? activeConversationId)));
    const next = recent[(i + dir + recent.length) % recent.length];
    openChat(next.id);
    carouselRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };
  const toggleMode = () => HomeStore.setCosmosMode(mode === "floating" ? "workspace" : "floating");

  const target = focused ?? byId.get(activeConversationId) ?? null;
  const card = (p: ChatPreview) => {
    const c = byId.get(p.id);
    if (!c) return null;
    return (
      <button key={p.id} type="button" className="lcu-card" data-open={openIds.includes(p.id)} data-focused={p.id === focusedId} onClick={() => openChat(p.id)} aria-label={`Open ${p.title}`}>
        <span className="lcu-card-head">
          <span className="lcu-card-ico"><Ico name={ART_ICON[artFor(c)]} size={15} /></span>
          <span className="lcu-card-title">{p.title}</span>
          <span className="lcu-dot" data-state={p.processing ? "working" : p.unread ? "unread" : "idle"} />
        </span>
        <Art conversation={c} appearance={appearance[p.id]} />
        <span className="lcu-card-text">{p.lastText || "No messages yet"}</span>
        <span className="lcu-card-foot">
          {p.unread > 0 ? <span className="lcu-unread">{p.unread}</span> : null}
          <time dateTime={new Date(p.lastUsed).toISOString()}>{relativeTime(p.lastUsed)}</time>
        </span>
      </button>
    );
  };

  return (
    <div className="lcu" data-cosmos={mode} data-rail={railOpen} role="dialog" aria-label="Chat Universe">
      <div className="lcu-cosmos" aria-hidden="true" style={{ backgroundImage: `url("${ART_BASE}galaxy.webp")` }} />

      {/* ---------- navigation rail (permanent on desktop, drawer on phone) ---------- */}
      <aside className="lcu-rail" aria-label="LÉLU navigation">
        <div className="lcu-rail-id">
          <span className="lcu-orb" data-state={presence.state} />
          <span><strong>LÉLU</strong><small>Cosmos Workspace</small></span>
        </div>
        <nav>
          {RAIL.map((r) => (
            <button key={r.id} type="button" data-on={r.id === "chat"} onClick={() => railGo(r.id)}>
              <Ico name={r.icon} size={18} /> <span>{r.label}</span>
            </button>
          ))}
        </nav>
        <div className="lcu-rail-ws">
          <small>Open windows</small>
          {openIds.length === 0 ? <span className="lcu-rail-none">None open</span> : null}
          {openIds.map((id) => {
            const c = byId.get(id);
            return c ? (
              <button key={id} type="button" data-on={id === focusedId} onClick={() => openChat(id)}>
                <Art conversation={c} appearance={appearance[id]} className="lcu-art-mini" /> <span>{c.title}</span>
              </button>
            ) : null;
          })}
        </div>
      </aside>
      <div className="lcu-rail-scrim" onClick={() => setRailOpen(false)} aria-hidden="true" />

      {/* ---------- main region ---------- */}
      <section className="lcu-main">
        <header className="lcu-head">
          <button type="button" className="lcu-icon lcu-menu" onClick={() => setRailOpen(true)} aria-label="Open navigation"><Icons.Menu size={20} /></button>
          <div className="lcu-hero" style={{ backgroundImage: `url("${ART_BASE}lelu-portrait.webp")` }} data-state={presence.state} aria-label={`LÉLU — ${presence.label}`} role="img" />
          <div className="lcu-title">
            <h1>Chat Universe <span>∞</span></h1>
            <p>
              {conversations.length} Chats · {activeCount} Active · <span className="lcu-sync">● {presence.label}</span>
            </p>
          </div>
          <div className="lcu-head-tools">
            <button
              type="button"
              className="lcu-icon lcu-mode"
              data-mode={mode}
              onClick={toggleMode}
              aria-pressed={mode === "floating"}
              aria-label={mode === "floating" ? "Float the windows over the Cosmos" : "Workspace mode: the Cosmos behind the windows"}
              title={mode === "floating" ? "Floating over the live Cosmos — switch to the workspace" : "Workspace — float the windows over the live Cosmos"}
            >
              {mode === "floating" ? <Icons.Orbit size={18} /> : <Icons.Layers size={18} />}
            </button>
            <div className="lcu-seg" role="group" aria-label="Layout">
              <button type="button" data-on={view === "grid"} onClick={() => setView("grid")} aria-label="Grid view"><Icons.LayoutGrid size={17} /></button>
              <button type="button" data-on={view === "carousel"} onClick={() => setView("carousel")} aria-label="Carousel view"><Icons.GalleryHorizontal size={17} /></button>
            </div>
            <button type="button" className="lcu-icon" onClick={newChat} aria-label="New chat"><Icons.Plus size={19} /></button>
            <button type="button" className="lcu-icon" onClick={() => setOpen(false)} aria-label="Close Chat Universe"><Icons.X size={19} /></button>
          </div>
        </header>

        <div className="lcu-timeline" aria-label="Chat activity timeline">
          <span className="lcu-tl-label"><Icons.Clock size={15} /> Chat Activity</span>
          <div className="lcu-ranges">
            {(["24h", "7d", "30d", "all"] as TimelineRange[]).map((r) => (
              <button key={r} type="button" data-on={range === r} onClick={() => setRange(r)}>{r === "all" ? "All" : r.toUpperCase()}</button>
            ))}
          </div>
          <div className="lcu-track">
            {markers.map((m, i) => (
              <button
                key={`${m.conversationId}-${m.at}-${i}`}
                type="button"
                className="lcu-mark"
                data-kind={m.kind}
                data-on={m.conversationId === focusedId}
                style={{ left: `${m.position * 100}%` }}
                onClick={() => openChat(m.conversationId)}
                aria-label={`${byId.get(m.conversationId)?.title ?? "Chat"} at ${new Date(m.at).toLocaleString()}`}
              />
            ))}
            <span className="lcu-now">Now</span>
          </div>
        </div>

        <div className="lcu-filters">
          {(["all", "active", "archived"] as const).map((f) => (
            <button key={f} type="button" data-on={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? `All (${conversations.length})` : f === "active" ? "Active" : `Archived (${archived.length})`}
            </button>
          ))}
        </div>

        {view === "grid" ? (
          <div className="lcu-grid">
            {grid.map(card)}
            {filter !== "archived" ? (
              <button type="button" className="lcu-card lcu-card-new" onClick={newChat}><Icons.Plus size={26} /><span>New Chat</span></button>
            ) : null}
          </div>
        ) : null}

        <div className="lcu-carousel-wrap" data-view={view}>
          <button type="button" className="lcu-icon lcu-spin" onClick={() => spin(-1)} aria-label="Previous chat"><Icons.ChevronLeft size={20} /></button>
          <div className="lcu-carousel" ref={carouselRef}>
            {recent.map((p) => {
              const c = byId.get(p.id);
              return c ? (
                <button key={p.id} type="button" data-id={p.id} className="lcu-orbit" data-on={p.id === (focusedId ?? activeConversationId)} onClick={() => openChat(p.id)}>
                  <span className="lcu-card-head"><Ico name={ART_ICON[artFor(c)]} size={14} /><span className="lcu-card-title">{p.title}</span><span className="lcu-dot" data-state={p.processing ? "working" : p.unread ? "unread" : "idle"} /></span>
                  <Art conversation={c} appearance={appearance[p.id]} />
                  <span className="lcu-card-text">{p.lastText || "No messages yet"}</span>
                  <time>{relativeTime(p.lastUsed)}</time>
                </button>
              ) : null;
            })}
          </div>
          <button type="button" className="lcu-icon lcu-spin" onClick={() => spin(1)} aria-label="Next chat"><Icons.ChevronRight size={20} /></button>
          <div className="lcu-ring" aria-hidden="true" />
        </div>
        {grid.length === 0 ? <p className="lcu-empty">{filter === "archived" ? "No archived chats." : "No chats here yet."}</p> : null}
      </section>

      {/* ---------- universal composer + quick dock ---------- */}
      {sheetOpen ? null : (
      <footer className="lcu-bottom">
        {attachNotice ? (
          <div role="status" data-lelu-screen-share-notice className="lcu-notice" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 6, borderRadius: 10, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)", color: "#fde68a", font: "500 12px system-ui, sans-serif" }}>
            <span style={{ flex: 1 }}>{attachNotice}</span>
            <button type="button" className="lcu-icon sm" aria-label="Dismiss notice" onClick={() => setAttachNotice(null)}><Icons.X size={13} /></button>
          </div>
        ) : null}
        {attached.length ? (
          <div className="lcu-attached" aria-label="Attachments" style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {attached.map((m, i) => (
              <span key={i} style={{ position: "relative", display: "inline-block" }}>
                <img src={m.dataUrl} alt={m.kind === "video" ? "Video frame" : "Attached image"} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)" }} />
                <button type="button" className="lcu-icon sm" aria-label="Remove attachment" style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20 }} onClick={() => setAttached((cur) => cur.filter((_, j) => j !== i))}><Icons.X size={11} /></button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="lcu-composer">
          <button type="button" className="lcu-icon" aria-label="Attach an image or video" onClick={() => mediaRef.current?.click()} disabled={!target}><Icons.Plus size={19} /></button>
          <input ref={mediaRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void onAttach(e.target.files); e.target.value = ""; }} />
          <div className="lcu-input">
            <span className="lcu-target" title="This message goes to">{target ? target.title : "Pick a chat"}</span>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder={target ? "Message LÉLU…" : "Tap a chat first"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={!target}
              enterKeyHint="send"
            />
            {canShareScreen ? (
              <button
                type="button"
                className="lcu-icon sm"
                data-lelu-share-screen
                aria-pressed={sharing}
                aria-label={sharing ? "Stop sharing your screen" : "Share your screen with Lélu"}
                onClick={() => {
                  const share = ScreenShare.getInstance();
                  if (share.isActive()) share.stop();
                  else void share.start().catch((error: unknown) => setAttachNotice(explainScreenShareFailure(error)));
                }}
              >
                {sharing ? <Icons.ScreenShareOff size={17} /> : <Icons.ScreenShare size={17} />}
              </button>
            ) : null}
            <button type="button" className="lcu-icon sm" aria-label="Talk to LÉLU" onClick={() => { void VoiceEngine.getInstance().toggle(); }}><Icons.Mic size={17} /></button>
            <button type="button" className="lcu-send" onClick={send} disabled={!target || (!draft.trim() && attached.length === 0)} aria-label={`Send to ${target?.title ?? "chat"}`}><Icons.ArrowRight size={19} /></button>
          </div>
        </div>
        <nav className="lcu-dock" aria-label="Quick chat dock">
          <span className="lcu-dock-label"><Icons.Infinity size={18} /><span>Quick Chat Dock</span></span>
          {recent.map((p) => {
            const c = byId.get(p.id);
            return c ? (
              <button key={p.id} type="button" className="lcu-dock-item" data-on={p.id === focusedId} onClick={() => openChat(p.id)}>
                <Art conversation={c} appearance={appearance[p.id]} className="lcu-art-mini" />
                <span className="lcu-dock-txt"><span>{p.title}</span><time>{relativeTime(p.lastUsed)}</time></span>
                {p.unread > 0 ? <span className="lcu-unread">{p.unread}</span> : <span className="lcu-dot" data-state={p.processing ? "working" : "idle"} />}
              </button>
            ) : null;
          })}
        </nav>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {openIds.length ? (
          <button type="button" className="lcu-minimize" onClick={minimizeWindows} aria-label="Minimize the open chat windows">
            <Icons.Minus size={15} /> {openIds.length} window{openIds.length === 1 ? "" : "s"} — minimize
          </button>
        ) : null}
      </footer>
      )}
    </div>
  );
}
