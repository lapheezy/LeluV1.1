/**
 * LÉLU — Multi-Chat Universe.
 *
 * Every conversation as a translucent glass window floating in the Cosmos.
 *   overview — all windows visible (grid, or the rotating carousel)
 *   window   — the tapped chat comes forward mid-size; the rest stay behind
 *   full     — that chat fills the screen; one tap returns to the overview
 *
 * ONE universal composer targets whichever chat is selected. It does not
 * send by itself: it switches the active conversation (GenesisCore →
 * MultiChatStore) and hands the text to the existing GenesisChat send path
 * (`lelu-universe-send`), so streaming, tools, queueing per conversation,
 * steering and persistence are the ones that already work.
 *
 * Organisation is the user's: no categories are created, nothing is moved.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Archive, ArrowLeft, Expand, Grid2x2, GalleryHorizontal, Image as ImageIcon, Mic, Paperclip, Plus, Send, Shrink, X } from "lucide-react";
import { useGenesis } from "../../GenesisCore";
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import {
  autoVisual,
  gridOrder,
  loadAppearance,
  recentOrder,
  relativeTime,
  saveAppearance,
  timelineMarkers,
  type ChatAppearance,
  type ChatPreview,
  type TimelineRange,
  type UniverseFocus,
  type UniverseView,
} from "./universeModel";
import "./chatUniverse.css";

export const OPEN_UNIVERSE_EVENT = "lelu-open-universe";
export const UNIVERSE_SEND_EVENT = "lelu-universe-send";

export function openChatUniverse(): void {
  window.dispatchEvent(new CustomEvent(OPEN_UNIVERSE_EVENT));
}

function useArchived() {
  const store = MultiChatStore.getInstance();
  const subscribe = (cb: () => void) => store.subscribe(cb);
  // listArchived() builds a new array each call; key the snapshot on content.
  const snapshot = () => store.listArchived().map((c) => `${c.id}:${c.updatedAt}`).join("|");
  const key = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => store.listArchived(), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Visual({ preview, appearance }: { preview: ChatPreview; appearance?: ChatAppearance }) {
  if (appearance?.image === null) return <div className="lcu-visual" data-off="true" />;
  const src = appearance?.image ?? preview.attachment;
  if (src) return <div className="lcu-visual" style={{ backgroundImage: `url("${src}")` }} />;
  const v = autoVisual(preview.id);
  return (
    <div
      className="lcu-visual"
      data-auto="true"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 60%, hsla(${v.hueB},95%,75%,.85) 0 6%, transparent 26%), radial-gradient(ellipse at 50% 62%, hsla(${v.hueA},90%,62%,.55), transparent 62%), linear-gradient(${v.angle}deg, hsla(${v.hueA},70%,22%,.9), hsla(${v.hueB},75%,30%,.75))`,
      }}
    />
  );
}

export default function ChatUniverse() {
  const genesis = useGenesis();
  const { conversations, activeConversationId } = genesis.state;
  const archived = useArchived();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<UniverseView>("grid");
  const [focus, setFocus] = useState<UniverseFocus>("overview");
  const [range, setRange] = useState<TimelineRange>("24h");
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState("");
  const [appearance, setAppearance] = useState<Record<string, ChatAppearance>>(() => loadAppearance());
  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = () => { setOpen(true); setFocus("overview"); };
    window.addEventListener(OPEN_UNIVERSE_EVENT, show);
    return () => window.removeEventListener(OPEN_UNIVERSE_EVENT, show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (focus === "overview") setOpen(false);
      else setFocus("overview");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, focus]);

  const visible = showArchived ? archived : conversations;
  const grid = useMemo(() => gridOrder(visible), [visible]);
  const recent = useMemo(() => recentOrder(conversations), [conversations]);
  const markers = useMemo(() => timelineMarkers(conversations, range), [conversations, range]);
  const active = conversations.find((c) => c.id === activeConversationId) ?? null;
  const activeCount = conversations.filter((c) => c.processing).length;

  // While open, the home and its nav step aside so only the Cosmos (and
  // LÉLU) sit behind the glass windows.
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.dataset.leluUniverse = "open";
    else delete root.dataset.leluUniverse;
    return () => { delete root.dataset.leluUniverse; };
  }, [open]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [active?.messages.length, focus]);

  if (!open) return null;

  const select = (id: string) => {
    if (archived.some((c) => c.id === id)) genesis.unarchiveConversation(id);
    if (id !== activeConversationId) genesis.switchConversation(id);
    setFocus("window");
  };
  const send = () => {
    const text = draft.trim();
    if (!text || !active) return;
    // The store already names `active` as the target (select() switched it).
    window.dispatchEvent(new CustomEvent(UNIVERSE_SEND_EVENT, { detail: { text, conversationId: active.id } }));
    setDraft("");
  };
  const setImage = (id: string, image: string | null | undefined) => {
    const next = { ...appearance, [id]: { image } };
    if (image === undefined) delete next[id];
    setAppearance(next);
    saveAppearance(next);
  };
  const onFile = (file: File | undefined) => {
    if (!file || !active) return;
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" && setImage(active.id, reader.result);
    reader.readAsDataURL(file);
  };

  const windowCard = (p: ChatPreview, extra = "") => (
    <button
      key={p.id}
      type="button"
      className={`lcu-win ${extra}`}
      data-selected={p.id === activeConversationId && focus !== "overview"}
      data-target={p.id === activeConversationId}
      onClick={() => select(p.id)}
      aria-label={`Open ${p.title}`}
    >
      <span className="lcu-win-head">
        <span className="lcu-win-title">{p.title}</span>
        <span className="lcu-dot" data-state={p.processing ? "working" : p.unread ? "unread" : "idle"} />
      </span>
      <Visual preview={p} appearance={appearance[p.id]} />
      <span className="lcu-win-text">{p.lastText || "No messages yet"}</span>
      <span className="lcu-win-foot">
        {p.unread > 0 ? <span className="lcu-unread">{p.unread}</span> : null}
        <time dateTime={new Date(p.lastUsed).toISOString()}>{relativeTime(p.lastUsed)}</time>
      </span>
    </button>
  );

  return (
    <div className="lcu" data-focus={focus} data-view={view} role="dialog" aria-label="Chat Universe">
      <div className="lcu-haze" aria-hidden="true" />
      <header className="lcu-head">
        <button type="button" className="lcu-icon" onClick={() => (focus === "overview" ? setOpen(false) : setFocus("overview"))} aria-label={focus === "overview" ? "Close Chat Universe" : "Back to all chats"}>
          <ArrowLeft size={18} />
        </button>
        <div className="lcu-brand">
          <strong>Chat Universe ∞</strong>
          <small>
            {conversations.length} chats · {activeCount} active · {archived.length} archived
          </small>
        </div>
        <div className="lcu-seg" role="group" aria-label="Layout">
          <button type="button" data-on={view === "grid"} onClick={() => setView("grid")} aria-label="Grid"><Grid2x2 size={16} /></button>
          <button type="button" data-on={view === "carousel"} onClick={() => setView("carousel")} aria-label="Carousel"><GalleryHorizontal size={16} /></button>
          <button type="button" data-on={showArchived} onClick={() => setShowArchived((v) => !v)} aria-label="Archived chats"><Archive size={16} /></button>
        </div>
        <button type="button" className="lcu-icon" onClick={() => { genesis.createConversation(); setFocus("window"); }} aria-label="New chat">
          <Plus size={18} />
        </button>
      </header>

      <section className="lcu-timeline" aria-label="Chat activity timeline">
        <div className="lcu-ranges">
          {(["24h", "7d", "30d"] as TimelineRange[]).map((r) => (
            <button key={r} type="button" data-on={range === r} onClick={() => setRange(r)}>{r.toUpperCase()}</button>
          ))}
        </div>
        <div className="lcu-track">
          {markers.map((m, i) => (
            <span
              key={`${m.conversationId}-${m.at}-${i}`}
              className="lcu-mark"
              data-kind={m.kind}
              data-on={m.conversationId === activeConversationId}
              style={{ left: `${m.position * 100}%` }}
              title={`${conversations.find((c) => c.id === m.conversationId)?.title ?? ""} · ${new Date(m.at).toLocaleString()}`}
            />
          ))}
          <span className="lcu-now">Now</span>
        </div>
      </section>

      <main className="lcu-field" onClick={(e) => { if (e.target === e.currentTarget && focus === "window") setFocus("overview"); }}>
        {grid.length === 0 ? <p className="lcu-empty">{showArchived ? "No archived chats." : "No chats yet — start one with +."}</p> : null}
        <div className={view === "grid" ? "lcu-grid" : "lcu-carousel"}>{grid.map((p) => windowCard(p))}</div>
      </main>

      {focus !== "overview" && active ? (
        <>
          <div className="lcu-scrim" onClick={() => setFocus("overview")} aria-hidden="true" />
          <article className="lcu-active" data-full={focus === "full"} aria-label={`${active.title} conversation`}>
            <header className="lcu-active-head">
              <span className="lcu-dot" data-state={active.processing ? "working" : "idle"} />
              <strong>{active.title}</strong>
              {active.processing ? <span className="lcu-live">Active</span> : null}
              <span className="lcu-active-tools">
                <button type="button" onClick={() => fileRef.current?.click()} aria-label="Change thumbnail"><ImageIcon size={16} /></button>
                <button type="button" onClick={() => setFocus(focus === "full" ? "window" : "full")} aria-label={focus === "full" ? "Restore window" : "Expand to full screen"}>
                  {focus === "full" ? <Shrink size={16} /> : <Expand size={16} />}
                </button>
                <button type="button" onClick={() => setFocus("overview")} aria-label="Back to all chats"><X size={16} /></button>
              </span>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </header>
            <div className="lcu-thread" ref={threadRef}>
              {active.messages.length === 0 ? <p className="lcu-empty">Say something to start this chat.</p> : null}
              {active.messages.slice(-40).map((m) => (
                <div key={m.id} className="lcu-msg" data-role={m.role}>
                  <p>{m.text}</p>
                  <time>{relativeTime(m.timestamp)}</time>
                </div>
              ))}
            </div>
            {appearance[active.id] !== undefined ? (
              <button type="button" className="lcu-reset-visual" onClick={() => setImage(active.id, undefined)}>Automatic thumbnail</button>
            ) : (
              <button type="button" className="lcu-reset-visual" onClick={() => setImage(active.id, null)}>Hide thumbnail</button>
            )}
          </article>
        </>
      ) : null}

      <footer className="lcu-bottom">
        <div className="lcu-composer" data-disabled={!active}>
          <span className="lcu-target" aria-live="polite">{active ? `To: ${active.title}` : "Select a chat"}</span>
          <div className="lcu-input">
            <button type="button" className="lcu-icon sm" aria-label="Attach (opens the full chat composer)" onClick={() => { setOpen(false); genesis.openPanel("chat"); }}>
              <Paperclip size={16} />
            </button>
            <textarea
              rows={1}
              value={draft}
              placeholder={active ? `Message ${active.title}…` : "Tap a chat first"}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => focus === "overview" && active && setFocus("window")}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={!active}
              enterKeyHint="send"
            />
            <button type="button" className="lcu-icon sm" aria-label="Voice (opens the full chat)" onClick={() => { setOpen(false); genesis.openPanel("chat"); }}>
              <Mic size={16} />
            </button>
            <button type="button" className="lcu-send" onClick={send} disabled={!active || !draft.trim()} aria-label="Send">
              <Send size={16} />
            </button>
          </div>
        </div>
        <nav className="lcu-dock" aria-label="Recent chats">
          {recent.map((p) => (
            <button key={p.id} type="button" className="lcu-dock-item" data-on={p.id === activeConversationId} onClick={() => select(p.id)}>
              <Visual preview={p} appearance={appearance[p.id]} />
              <span>{p.title}</span>
              <time>{relativeTime(p.lastUsed)}</time>
              <span className="lcu-dot" data-state={p.processing ? "working" : p.unread ? "unread" : "idle"} />
            </button>
          ))}
          <button type="button" className="lcu-dock-item lcu-dock-more" onClick={() => { setView("carousel"); setFocus("overview"); }} aria-label="Open the full carousel">
            <GalleryHorizontal size={18} />
          </button>
        </nav>
      </footer>
    </div>
  );
}
