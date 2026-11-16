/**
 * ==========================================================
 * LÉLU — CHAT GALLERY
 *
 * A visual browser for the conversations that exist: tiles you
 * scroll like a photo library, grouped by recency, with the
 * state the store already tracks (unread, working, pinned).
 *
 * It is a VIEW over MultiChatStore. Every card carries the
 * conversation's metadata and its latest line — never a
 * transcript — and every action calls the store operation that
 * already does the work. Nothing is stored here, so closing and
 * reopening the gallery cannot disagree with the chats.
 *
 * Two things make it feel alive rather than like a panel:
 *   - a staggered entrance, a press that compresses the tile and
 *     lets its neighbours recede, and a chosen card that grows
 *     as the conversation opens (all CSS, all reduced-motion
 *     aware);
 *   - a live preview of the conversation's ACTION QUEUE, read
 *     from the same store the chat reads, so a working chat
 *     shows where LÉLU actually is.
 *
 * The scroll position and the last opened card are remembered
 * across open → chat → back, so returning to the library lands
 * where the user left it.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSyncExternalStore } from "react";
import { Archive, ArrowLeft, Check, Pencil, Pin, PinOff, Search, Trash2, X } from "lucide-react";
import { layer } from "../../../../core/ui/Layers";
import type { ChatConversation } from "../../../../core/multichat/MultiChatStore";
import ActionQueueStore from "../../../../core/multichat/ActionQueueStore";
import { ACTION_GLYPH, queueView } from "../../../../core/multichat/ActionQueue";
import {
  GALLERY_FILTERS,
  galleryCounts,
  gallerySections,
  galleryTimeAgo,
  type GalleryFilter,
} from "./chatGallery";
import "./chatGallery.css";

export interface ChatGalleryProps {
  conversations: ChatConversation[];
  activeId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  onPin: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}

type CardMenu = { id: string } | null;

const actionQueues = ActionQueueStore.getInstance();

/**
 * Where the library was left. Module-scoped on purpose: the gallery is
 * unmounted whenever a conversation opens, and the position belongs to the
 * library, not to one mount of it.
 */
const galleryMemory: { scrollTop: number; lastOpenedId: string | null } = {
  scrollTop: 0,
  lastOpenedId: null,
};

/** The longest stagger a card can have, so a big library never lags in. */
const MAX_STAGGER = 14;
/** Long enough for the chosen tile to grow, short enough to feel immediate. */
const OPEN_TRANSITION_MS = 170;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function ChatGallery({
  conversations,
  activeId,
  onOpen,
  onClose,
  onPin,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: ChatGalleryProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [menu, setMenu] = useState<CardMenu>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** A delete always takes a second, deliberate tap. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** The card growing into the conversation, while the transition runs. */
  const [leaving, setLeaving] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);

  // The queue of whichever chats are working, from the same store the chat uses.
  useSyncExternalStore(actionQueues.subscribe, actionQueues.getVersion, actionQueues.getVersion);

  // Times shown on the cards stay true while the gallery is open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * Return to where the library was scrolled to, and remember it from now on.
   * The list can be a hundred chats long; reopening it at the top would lose
   * the user's place.
   */
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = galleryMemory.scrollTop;
    const remember = () => {
      galleryMemory.scrollTop = element.scrollTop;
    };
    element.addEventListener("scroll", remember, { passive: true });
    return () => {
      galleryMemory.scrollTop = element.scrollTop;
      element.removeEventListener("scroll", remember);
    };
  }, []);

  useEffect(
    () => () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    },
    [],
  );

  /**
   * Say, in the document, that a modal is over the chat.
   *
   * The chat listens for Escape in an earlier-registered capture handler and
   * closes the conversation; a later listener cannot stop it. This flag is
   * what lets that handler stand down, so Escape here closes the gallery and
   * leaves the conversation — and the gallery's place in it — intact.
   */
  useEffect(() => {
    document.documentElement.dataset.leluGallery = "open";
    return () => {
      delete document.documentElement.dataset.leluGallery;
    };
  }, []);

  /**
   * Escape belongs to the gallery while it is open: first an open menu, then
   * the gallery itself. Stopped in the capture phase so no other surface
   * acts on the same key.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (menu) {
        setMenu(null);
        setConfirmDelete(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu, onClose]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-lelu-gallery-menu]") || target?.closest("[data-lelu-gallery-options]")) return;
      setMenu(null);
      setConfirmDelete(null);
    };
    if (!menu) return;
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [menu]);

  const counts = useMemo(() => galleryCounts(conversations), [conversations]);
  const sections = useMemo(
    () => gallerySections(conversations, { query, filter, now }),
    [conversations, query, filter, now],
  );
  const shown = sections.reduce((total, section) => total + section.cards.length, 0);

  function beginRename(id: string, title: string) {
    setRenaming(id);
    setRenameValue(title === "New chat" ? "" : title);
    setMenu(null);
  }

  function commitRename() {
    if (renaming) {
      const title = renameValue.trim();
      if (title) onRename(renaming, title);
    }
    setRenaming(null);
    setRenameValue("");
  }

  /**
   * Open a conversation through the card that was tapped: the tile grows, its
   * neighbours recede, and then the conversation opens. With reduced motion
   * the open is immediate — the state change is the feedback.
   */
  function openCard(id: string) {
    galleryMemory.lastOpenedId = id;
    if (prefersReducedMotion()) {
      onOpen(id);
      return;
    }
    setLeaving(id);
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => onOpen(id), OPEN_TRANSITION_MS);
  }

  /** Cards are numbered across sections, so the stagger runs down the page. */
  let cardIndex = 0;

  return (
    <div
      className={leaving ? "lelu-ccg is-leaving" : "lelu-ccg"}
      data-lelu-chat-gallery
      data-lelu-gallery-leaving={leaving ?? undefined}
      role="dialog"
      aria-label="Chat gallery"
      aria-modal="true"
      style={{ zIndex: layer("modal"), pointerEvents: "auto" }}
    >
      <header className="lelu-ccg-head">
        <button type="button" className="lelu-ccg-back" onClick={onClose} aria-label="Back to the conversation">
          <ArrowLeft size={18} aria-hidden />
        </button>
        <div className="lelu-ccg-heading">
          <strong>Chats</strong>
          <span>
            {counts.all} conversation{counts.all === 1 ? "" : "s"}
            {counts.working > 0 ? ` · ${counts.working} working` : ""}
            {counts.unread > 0 ? ` · ${counts.unread} unread` : ""}
          </span>
        </div>
        <button type="button" className="lelu-ccg-close" onClick={onClose} aria-label="Close chat gallery">
          <X size={18} aria-hidden />
        </button>
      </header>

      <div className="lelu-ccg-search">
        <Search size={15} aria-hidden />
        <input
          ref={searchRef}
          data-lelu-gallery-search
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats and messages…"
          aria-label="Search chats"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="lelu-ccg-filters" role="tablist" aria-label="Filter chats">
        {GALLERY_FILTERS.map((item) => {
          const count = counts[item.id];
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              data-lelu-gallery-filter={item.id}
              className={filter === item.id ? "lelu-ccg-chip is-on" : "lelu-ccg-chip"}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {count > 0 ? <span>{count}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Keyed on the view: changing search or filter animates the results in
          rather than swapping them abruptly. */}
      <div className="lelu-ccg-body" ref={bodyRef} key={`${filter}:${query}`}>
        {shown === 0 ? (
          <div className="lelu-ccg-empty">
            {query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : filter === "archived"
                ? "No archived chats."
                : filter === "unread"
                  ? "Nothing unread."
                  : filter === "working"
                    ? "Nothing is running right now."
                    : "No conversations yet."}
          </div>
        ) : (
          sections.map((section) => (
            <section key={section.title} data-lelu-gallery-section={section.title} className="lelu-ccg-section">
              <h3>
                {section.title}
                <span>{section.cards.length}</span>
              </h3>
              <div className="lelu-ccg-grid">
                {section.cards.map((card) => {
                  const current = card.id === activeId;
                  const chosen = leaving === card.id || (!leaving && galleryMemory.lastOpenedId === card.id);
                  const index = Math.min(cardIndex, MAX_STAGGER);
                  cardIndex += 1;
                  const queue = actionQueues.queueFor(card.id);
                  const queueInfo = queue ? queueView(queue) : null;
                  return (
                    <article
                      key={card.id}
                      data-lelu-gallery-card={card.id}
                      data-lelu-gallery-active={current ? "true" : "false"}
                      data-lelu-gallery-chosen={chosen ? "true" : undefined}
                      style={{ "--ccg-i": index } as CSSProperties}
                      className={[
                        "lelu-ccg-card",
                        current ? "is-current" : "",
                        card.archived ? "is-archived" : "",
                        card.pinned ? "is-pinned" : "",
                        card.processing ? "is-working" : "",
                        card.unread > 0 ? "is-unread" : "",
                        chosen ? "is-chosen" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <button
                        type="button"
                        className="lelu-ccg-open"
                        onClick={() => openCard(card.id)}
                        aria-label={`Open ${card.title}`}
                        aria-current={current ? "true" : undefined}
                      >
                        <span className="lelu-ccg-card-head">
                          <strong>{card.title}</strong>
                        </span>
                        <span className="lelu-ccg-preview">
                          {card.previewRole === "user" ? <em>You: </em> : null}
                          {card.preview}
                        </span>
                        {queueInfo ? (
                          <span
                            className={`lelu-ccg-queue is-${queueInfo.status}`}
                            data-lelu-gallery-queue={queueInfo.status}
                            aria-label={`Actions: ${queueInfo.headline}`}
                          >
                            <span className="lelu-ccg-queue-trail" aria-hidden>
                              {queueInfo.trail.slice(-4).map((action) => (
                                <span key={action.id} className={`is-${action.status}`}>
                                  {action.status === "running" || action.status === "retrying"
                                    ? <i className="lelu-ccg-queue-orb" />
                                    : ACTION_GLYPH[action.status]}
                                </span>
                              ))}
                            </span>
                            <span className="lelu-ccg-queue-label">{queueInfo.activeLabel}</span>
                          </span>
                        ) : null}
                        <span className="lelu-ccg-badges">
                          <time className="lelu-ccg-time" dateTime={new Date(card.timestamp).toISOString()}>
                            {galleryTimeAgo(card.timestamp, now)}
                          </time>
                          {card.processing ? (
                            <span className="lelu-ccg-badge is-working" data-lelu-gallery-badge="working">
                              working
                            </span>
                          ) : null}
                          {card.unread > 0 ? (
                            <span className="lelu-ccg-badge is-unread" data-lelu-gallery-badge="unread">
                              {card.unread > 9 ? "9+" : card.unread} new
                            </span>
                          ) : null}
                          {card.pinned ? (
                            <span className="lelu-ccg-badge is-pinned" data-lelu-gallery-badge="pinned">
                              pinned
                            </span>
                          ) : null}
                          {card.archived ? (
                            <span className="lelu-ccg-badge" data-lelu-gallery-badge="archived">
                              archived
                            </span>
                          ) : null}
                          {card.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="lelu-ccg-badge is-tag">
                              {tag}
                            </span>
                          ))}
                        </span>
                      </button>

                      {renaming === card.id ? (
                        <form
                          className="lelu-ccg-rename"
                          onSubmit={(event) => {
                            event.preventDefault();
                            commitRename();
                          }}
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            aria-label="New title"
                            placeholder="Title"
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.stopPropagation();
                                setRenaming(null);
                              }
                            }}
                          />
                          <button type="submit" aria-label="Save title">
                            <Check size={14} aria-hidden />
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="lelu-ccg-options"
                          data-lelu-gallery-options={card.id}
                          aria-label={`Options for ${card.title}`}
                          aria-haspopup="menu"
                          aria-expanded={menu?.id === card.id}
                          onClick={() => {
                            setConfirmDelete(null);
                            setMenu((current) => (current?.id === card.id ? null : { id: card.id }));
                          }}
                        >
                          ⋯
                        </button>
                      )}

                      {menu?.id === card.id ? (
                        <div className="lelu-ccg-menu" data-lelu-gallery-menu role="menu" aria-label={`Options for ${card.title}`}>
                          <button type="button" role="menuitem" onClick={() => openCard(card.id)}>
                            Open
                          </button>
                          <button type="button" role="menuitem" onClick={() => onPin(card.id)}>
                            {card.pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
                            {card.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button type="button" role="menuitem" onClick={() => beginRename(card.id, card.title)}>
                            <Pencil size={14} aria-hidden /> Rename
                          </button>
                          {card.archived ? (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                onRestore(card.id);
                                setMenu(null);
                              }}
                            >
                              <Archive size={14} aria-hidden /> Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                onArchive(card.id);
                                setMenu(null);
                              }}
                            >
                              <Archive size={14} aria-hidden /> Archive
                            </button>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            className={confirmDelete === card.id ? "is-danger is-confirming" : "is-danger"}
                            onClick={() => {
                              if (confirmDelete !== card.id) {
                                setConfirmDelete(card.id);
                                return;
                              }
                              onDelete(card.id);
                              setConfirmDelete(null);
                              setMenu(null);
                            }}
                          >
                            <Trash2 size={14} aria-hidden />
                            {confirmDelete === card.id ? "Delete for good?" : "Delete"}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
