/**
 * ==========================================================
 * LÉLUVERSE
 * MULTI-CHAT TABS
 *
 * The Multi-Chat Workspace tab bar, integrated into the existing
 * LÉLU visual language (lelu-tab-bar / lelu-tab-cloud + glass).
 * Each conversation is an isolated slice of the ONE LÉLU
 * cognition; switching tabs only changes which conversation is
 * active — it never creates a second brain.
 *
 * Features: new / switch / rename (double-click or the tab's ⋯
 * menu) / close / pin / link-to-active / unified search (click a
 * result to open that conversation). Unread and processing
 * indicators come from the persistent MultiChatStore.
 *
 * Layout: the tabs scroll sideways inside the bar while New and
 * Search stay fixed at its end, so no control is ever pushed past
 * the edge of the screen. Each tab carries ONE options button (a
 * full-size target) instead of four 18px icons.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Ellipsis, Link, Pencil, Pin, Plus, Search, X } from "lucide-react";
import { useGenesis } from "./GenesisCore";
import { layer } from "../../../core/ui/Layers";
import { useWorkspace } from "./useWorkspace";
import { chatFillsScreen, useDockInset } from "./chat/chatLayout";

/** Where the bar sits: under the chat's header on phones, over the scene otherwise. */
function barStyleFor(compact: boolean, leftInset: number): CSSProperties {
  return compact
    ? {
        position: "fixed",
        left: leftInset + 10,
        right: 10,
        top: "calc(env(safe-area-inset-top, 0px) + 64px)",
        zIndex: layer("tabs"),
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 4,
        borderRadius: 999,
        pointerEvents: "auto",
      }
    : {
        position: "fixed",
        left: "50%",
        top: "56px",
        transform: "translateX(-50%)",
        zIndex: layer("tabs"),
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 4,
        borderRadius: 999,
        pointerEvents: "auto",
        maxWidth: "min(96vw, 760px)",
      };
}

const barIconStyle: CSSProperties = {
  width: 36,
  height: 36,
  minWidth: 36,
  borderRadius: 999,
  border: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  background: "transparent",
  color: "rgba(244, 232, 255, 0.85)",
  flexShrink: 0,
};

const menuItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  minHeight: 40,
  padding: "0 12px",
  border: "none",
  borderRadius: 12,
  background: "transparent",
  color: "rgba(247, 241, 255, 0.95)",
  font: "inherit",
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
};

const tabStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
  letterSpacing: "0.02em",
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
  border: "none",
  flexShrink: 0,
};


export default function MultiChatTabs() {
  const {
    state,
    createConversation,
    switchConversation,
    renameConversation,
    closeConversation,
    pinConversation,
    linkConversations,
    unlinkConversations,
    searchConversations,
    openPanel,
  } = useGenesis();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Which tab's options are open, and where to draw them. */
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const workspace = useWorkspace();
  const fills = chatFillsScreen(workspace);
  const dockInset = useDockInset(fills);

  // The chat's own options menu can open search.
  useEffect(() => {
    const open = () => setSearchOpen(true);
    window.addEventListener("lelu-multichat-search", open);
    return () => window.removeEventListener("lelu-multichat-search", open);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const conversations = state.conversations;
  const activeId = state.activeConversationId;

  const results = useMemo(
    () => (query.trim().length > 0 ? searchConversations(query, "all") : []),
    [query, searchConversations],
  );

  function beginRename(id: string, title: string) {
    setRenamingId(id);
    setRenameValue(title === "New chat" ? "" : title);
  }

  function commitRename() {
    if (renamingId) {
      renameConversation(renamingId, renameValue);
    }
    setRenamingId(null);
    setRenameValue("");
  }

  function handleTabClick(event: MouseEvent<HTMLButtonElement>, id: string) {
    // Double-click on the active tab enters rename mode.
    if (event.detail >= 2) {
      const conversation = conversations.find((item) => item.id === id);
      beginRename(id, conversation?.title ?? "");
      return;
    }
    if (id !== activeId) {
      switchConversation(id);
    }
  }

  function handleResult(hit: { conversationId: string }) {
    if (hit.conversationId !== activeId) {
      switchConversation(hit.conversationId);
    }
    setSearchOpen(false);
    setQuery("");
    openPanel("chat");
  }

  return (
    <>
      <div data-lelu-multichat className="lelu-tab-bar" style={barStyleFor(fills, dockInset)} role="tablist" aria-label="Conversations">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
            // A soft fade at the end says "more tabs this way".
            maskImage: "linear-gradient(90deg, #000 0, #000 calc(100% - 18px), transparent)",
            WebkitMaskImage: "linear-gradient(90deg, #000 0, #000 calc(100% - 18px), transparent)",
          }}
        >
        {conversations.map((conversation) => {
          const active = conversation.id === activeId;
          return (
            <div
              key={conversation.id}
              className={active ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
              style={{ display: "inline-flex", alignItems: "center", gap: 2, borderRadius: 999, flexShrink: 0 }}
            >
              {conversation.pinned ? (
                <span aria-hidden style={{ fontSize: 10, lineHeight: 1, marginLeft: 2 }}>📌</span>
              ) : null}

              {renamingId === conversation.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitRename();
                    }
                    if (event.key === "Escape") {
                      setRenamingId(null);
                      setRenameValue("");
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    width: 120,
                    border: "none",
                    background: "rgba(2, 6, 23, 0.4)",
                    color: "rgba(245, 240, 255, 0.97)",
                    fontSize: 12,
                    outline: "none",
                    borderRadius: 6,
                    padding: "2px 6px",
                    fontFamily: "inherit",
                  }}
                />
              ) : (
                <button
                  type="button"
                  // Which conversation this tab selects. Tabs are reordered
                  // by pinning and recency, so position is not a stable way
                  // to identify one — for assistive tech or for a test.
                  data-conversation-id={conversation.id}
                  role="tab"
                  aria-selected={active}
                  onClick={(event) => handleTabClick(event, conversation.id)}
                  title={`${conversation.title}${conversation.unread > 0 ? ` (${conversation.unread} unread)` : ""}`}
                  style={{
                    ...tabStyle,
                    minHeight: 32,
                    background: "transparent",
                    color: active ? "rgba(255,255,255,0.98)" : "rgba(226, 238, 252, 0.78)",
                    maxWidth: 180,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {conversation.processing ? (
                    <span
                      aria-hidden
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        border: "1.5px solid rgba(103, 232, 249, 0.9)",
                        borderTopColor: "transparent",
                        animation: "lelu-spin 0.8s linear infinite",
                      }}
                    />
                  ) : null}
                  {conversation.title}
                  {conversation.unread > 0 ? (
                    <span
                      aria-hidden
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        background: "#fbbf24",
                        boxShadow: "0 0 8px rgba(251, 191, 36, 0.9)",
                      }}
                    />
                  ) : null}
                </button>
              )}

              <button
                type="button"
                title="Conversation options"
                aria-label={`Options for ${conversation.title}`}
                aria-haspopup="menu"
                aria-expanded={menu?.id === conversation.id}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu((current) =>
                    current?.id === conversation.id
                      ? null
                      : { id: conversation.id, left: Math.min(rect.left, window.innerWidth - 220), top: rect.bottom + 6 },
                  );
                }}
                style={{ ...barIconStyle, width: 32, height: 32, minWidth: 32, color: "rgba(244, 232, 255, 0.7)" }}
              >
                <Ellipsis size={16} aria-hidden />
              </button>
            </div>
          );
        })}
        </div>

        <button
          type="button"
          title="New chat"
          aria-label="New chat"
          className="lelu-tab-cloud"
          onClick={() => {
            createConversation();
            openPanel("chat");
          }}
          style={barIconStyle}
        >
          <Plus size={18} aria-hidden />
        </button>

        <button
          type="button"
          title="Search all chats"
          aria-label="Search all chats"
          aria-expanded={searchOpen}
          className={searchOpen ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
          onClick={() => setSearchOpen((current) => !current)}
          style={barIconStyle}
        >
          <Search size={17} aria-hidden />
        </button>
      </div>

      {menu ? (() => {
        const conversation = conversations.find((item) => item.id === menu.id);
        if (!conversation) return null;
        const linked = conversation.linkedIds.includes(activeId);
        const canClose = conversations.length > 1;
        const act = (fn: () => void) => () => {
          setMenu(null);
          fn();
        };
        return (
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Options for ${conversation.title}`}
            className="lelu-tab-bar"
            style={{
              position: "fixed",
              left: Math.max(8, menu.left),
              top: menu.top,
              zIndex: layer("tabs") + 1,
              width: 210,
              padding: 6,
              borderRadius: 18,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              pointerEvents: "auto",
            }}
          >
            {conversation.id !== activeId ? (
              <button
                type="button"
                role="menuitem"
                title={linked ? "Unlink from active chat" : "Link to active chat"}
                aria-label={linked ? "Unlink conversation" : "Link conversation"}
                onClick={act(() => (linked ? unlinkConversations(conversation.id, activeId) : linkConversations(conversation.id, activeId)))}
                style={menuItemStyle}
              >
                <Link size={15} aria-hidden /> {linked ? "Unlink from this chat" : "Link to this chat"}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              aria-label={conversation.pinned ? "Unpin conversation" : "Pin conversation"}
              onClick={act(() => pinConversation(conversation.id))}
              style={menuItemStyle}
            >
              <Pin size={15} aria-hidden /> {conversation.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label="Rename conversation"
              onClick={act(() => beginRename(conversation.id, conversation.title))}
              style={menuItemStyle}
            >
              <Pencil size={15} aria-hidden /> Rename
            </button>
            {canClose ? (
              <button
                type="button"
                role="menuitem"
                aria-label={`Close ${conversation.title}`}
                onClick={act(() => closeConversation(conversation.id))}
                style={{ ...menuItemStyle, color: "rgba(255, 190, 205, 0.95)" }}
              >
                <X size={15} aria-hidden /> Close
              </button>
            ) : null}
          </div>
        );
      })() : null}

      {searchOpen ? (
        <div
          className="lelu-tab-bar"
          style={{
            position: "fixed",
            left: "50%",
            top: fills ? "calc(env(safe-area-inset-top, 0px) + 112px)" : "100px",
            transform: "translateX(-50%)",
            zIndex: layer("tabs") + 1,
            width: "min(calc(100vw - 20px), 560px)",
            padding: 8,
            borderRadius: 16,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            pointerEvents: "auto",
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            style={{
              border: "none",
              background: "rgba(2, 6, 23, 0.4)",
              color: "rgba(245, 240, 255, 0.97)",
              fontSize: 13,
              outline: "none",
              borderRadius: 10,
              padding: "9px 12px",
              fontFamily: "inherit",
            }}
          />
          {query.trim() && results.length === 0 ? (
            <div style={{ padding: "8px 12px", color: "rgba(214, 228, 244, 0.6)", fontSize: 12 }}>
              No matches.
            </div>
          ) : (
            results.slice(0, 12).map((hit) => (
              <button
                key={hit.messageId}
                type="button"
                className="lelu-tab-cloud"
                onClick={() => handleResult(hit)}
                style={{
                  ...tabStyle,
                  background: "transparent",
                  textAlign: "left",
                  whiteSpace: "normal",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  width: "100%",
                }}
              >
                <span style={{ fontSize: 12, color: "rgba(226, 238, 252, 0.92)", fontWeight: 600 }}>
                  {hit.title}
                </span>
                <span style={{ fontSize: 11, color: "rgba(214, 228, 244, 0.7)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                  {hit.text}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}
