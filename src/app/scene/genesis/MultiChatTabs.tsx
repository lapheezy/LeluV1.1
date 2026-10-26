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
 * Chats panel (the speech-bubble button): every conversation, New
 * chat, and NOTIFICATIONS — side questions, replies that finished
 * in another chat, approvals another chat is waiting on (see
 * core/notifications/NotificationRouting). Opening one goes to its
 * conversation and marks it read.
 *
 * Layout: the tabs scroll sideways inside the bar while New and
 * Search stay fixed at its end, so no control is ever pushed past
 * the edge of the screen. Each tab carries ONE options button (a
 * full-size target) instead of four 18px icons.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Bell, Ellipsis, GitMerge, Link, MessagesSquare, Pencil, Pin, Plus, Search, X } from "lucide-react";
import { useGenesis } from "./GenesisCore";
import { layer } from "../../../core/ui/Layers";
import { useWorkspace } from "./useWorkspace";
import { chatFillsScreen, useDockInset } from "./chat/chatLayout";
import NotificationProvider, { isUnread, type NotificationRecord } from "../../../core/notifications/NotificationProvider";

const NOTIFICATION_ICON: Record<NonNullable<NotificationRecord["type"]>, string> = {
  question: "❓",
  reply: "💬",
  failure: "⚠️",
  approval: "✋",
  proactive: "✨",
  info: "•",
};

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

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

const sectionLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "rgba(244, 214, 238, 0.75)",
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
    mergeConversations,
    searchConversations,
    openPanel,
  } = useGenesis();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  /** Choosing chats to merge (two or more) in the Chats panel. */
  const [mergeSelection, setMergeSelection] = useState<string[] | null>(null);
  const [inbox, setInbox] = useState<NotificationRecord[]>([]);
  const unread = inbox.filter(isUnread).length;
  const [query, setQuery] = useState("");
  /** Which tab's options are open, and where to draw them. */
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const workspace = useWorkspace();
  const fills = chatFillsScreen(workspace);
  const dockInset = useDockInset(fills);

  useEffect(() => NotificationProvider.getInstance().subscribeHistory((history) => setInbox([...history].reverse())), []);

  useEffect(() => {
    if (!chatsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChatsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatsOpen]);

  useEffect(() => {
    if (!chatsOpen) setMergeSelection(null);
  }, [chatsOpen]);

  function toggleMergePick(id: string) {
    setMergeSelection((current) => (current ? (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) : [id]));
  }

  function createMerged() {
    if (!mergeSelection || mergeSelection.length < 2) return;
    if (mergeConversations(mergeSelection)) {
      openPanel("chat");
      setChatsOpen(false);
    }
  }

  function openNotification(record: NotificationRecord) {
    // The provider's deep link switches to the conversation and opens chat.
    NotificationProvider.getInstance().open(record.id);
    if (record.questionId) {
      window.dispatchEvent(new CustomEvent("lelu-open-question", { detail: { questionId: record.questionId } }));
    }
    if (!record.conversationId) openPanel("chat");
    setChatsOpen(false);
  }

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
          onClick={() => {
            setChatsOpen(false);
            setSearchOpen((current) => !current);
          }}
          style={barIconStyle}
        >
          <Search size={17} aria-hidden />
        </button>

        <button
          type="button"
          title={unread > 0 ? `Chats and notifications (${unread} unread)` : "Chats and notifications"}
          aria-label={unread > 0 ? `Chats and notifications, ${unread} unread` : "Chats and notifications"}
          aria-expanded={chatsOpen}
          data-lelu-chats-button
          className={chatsOpen ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
          onClick={() => {
            setSearchOpen(false);
            setChatsOpen((current) => !current);
          }}
          style={{ ...barIconStyle, position: "relative" }}
        >
          <MessagesSquare size={17} aria-hidden />
          {unread > 0 ? (
            <span
              aria-hidden
              data-lelu-unread-count={unread}
              style={{
                position: "absolute",
                top: 2,
                right: 1,
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                borderRadius: 999,
                background: "#f472b6",
                color: "#1b1033",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: "16px",
                textAlign: "center",
              }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </div>

      {chatsOpen ? (
        <div
          className="lelu-tab-bar"
          role="dialog"
          aria-label="Chats and notifications"
          data-lelu-chats-panel
          style={{
            position: "fixed",
            left: "50%",
            top: fills ? "calc(env(safe-area-inset-top, 0px) + 112px)" : "100px",
            transform: "translateX(-50%)",
            zIndex: layer("tabs") + 1,
            width: "min(calc(100vw - 20px), 420px)",
            maxHeight: "min(70vh, 560px)",
            overflowY: "auto",
            padding: 10,
            borderRadius: 18,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            pointerEvents: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 6px" }}>
            <span style={sectionLabelStyle}>Chats</span>
            <span style={{ display: "inline-flex", gap: 4 }}>
              {conversations.length >= 2 ? (
                <button
                  type="button"
                  data-lelu-merge-mode
                  aria-pressed={mergeSelection !== null}
                  title="Choose two or more chats to merge into a new chat; the originals stay as they are"
                  onClick={() => setMergeSelection((current) => (current ? null : []))}
                  style={{ ...menuItemStyle, width: "auto", minHeight: 32, padding: "0 10px", fontSize: 12 }}
                >
                  <GitMerge size={14} aria-hidden /> {mergeSelection ? "Cancel merge" : "Merge chats…"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  createConversation();
                  openPanel("chat");
                  setChatsOpen(false);
                }}
                style={{ ...menuItemStyle, width: "auto", minHeight: 32, padding: "0 10px", fontSize: 12 }}
              >
                <Plus size={14} aria-hidden /> New chat
              </button>
            </span>
          </div>
          {mergeSelection ? (
            <div style={{ padding: "0 12px 4px", fontSize: 11.5, color: "rgba(226, 232, 248, 0.75)" }}>
              Pick two or more chats. A new chat gets all of their messages, each labelled with the chat it came from;
              the originals are not changed.
            </div>
          ) : null}
          {conversations.map((conversation) => {
            const picked = mergeSelection?.includes(conversation.id) ?? false;
            return (
            <button
              key={conversation.id}
              type="button"
              data-lelu-chats-item={conversation.id}
              {...(mergeSelection ? { role: "checkbox", "aria-checked": picked } : {})}
              aria-current={!mergeSelection && conversation.id === activeId ? "true" : undefined}
              onClick={() => {
                if (mergeSelection) {
                  toggleMergePick(conversation.id);
                  return;
                }
                if (conversation.id !== activeId) switchConversation(conversation.id);
                openPanel("chat");
                setChatsOpen(false);
              }}
              style={{
                ...menuItemStyle,
                background: picked
                  ? "rgba(244, 114, 182, 0.16)"
                  : !mergeSelection && conversation.id === activeId
                    ? "rgba(255, 236, 252, 0.1)"
                    : "transparent",
              }}
            >
              {mergeSelection ? (
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 5,
                    border: "1.5px solid rgba(255, 236, 252, 0.6)",
                    background: picked ? "#f472b6" : "transparent",
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color: "#1b1033",
                  }}
                >
                  {picked ? "✓" : ""}
                </span>
              ) : null}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {conversation.title}
              </span>
              {conversation.processing ? <span style={{ fontSize: 11, color: "rgba(103, 232, 249, 0.9)" }}>working…</span> : null}
              {conversation.unread > 0 ? (
                <span style={{ fontSize: 11, color: "#fbbf24" }}>{conversation.unread} new</span>
              ) : null}
            </button>
            );
          })}
          {mergeSelection ? (
            <button
              type="button"
              data-lelu-merge-create
              disabled={mergeSelection.length < 2}
              onClick={createMerged}
              style={{
                ...menuItemStyle,
                justifyContent: "center",
                fontWeight: 600,
                background: mergeSelection.length >= 2 ? "rgba(244, 114, 182, 0.28)" : "rgba(255, 236, 252, 0.05)",
                cursor: mergeSelection.length >= 2 ? "pointer" : "not-allowed",
                opacity: mergeSelection.length >= 2 ? 1 : 0.6,
              }}
            >
              <GitMerge size={15} aria-hidden />
              {mergeSelection.length >= 2 ? `Create merged chat from ${mergeSelection.length} chats` : "Pick at least two chats"}
            </button>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 6px 2px" }}>
            <span style={sectionLabelStyle}>
              <Bell size={12} aria-hidden /> Notifications{unread > 0 ? ` · ${unread} unread` : ""}
            </span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => NotificationProvider.getInstance().markAllRead()}
                style={{ ...menuItemStyle, width: "auto", minHeight: 32, padding: "0 10px", fontSize: 12 }}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {inbox.length === 0 ? (
            <div style={{ padding: "6px 12px 8px", color: "rgba(214, 228, 244, 0.6)", fontSize: 12 }}>Nothing yet.</div>
          ) : (
            inbox.slice(0, 30).map((record) => {
              const fresh = isUnread(record);
              return (
                <button
                  key={record.id}
                  type="button"
                  data-lelu-notification={record.type ?? "info"}
                  data-lelu-notification-read={fresh ? "false" : "true"}
                  onClick={() => openNotification(record)}
                  style={{
                    ...menuItemStyle,
                    alignItems: "flex-start",
                    padding: "8px 12px",
                    background: fresh ? "rgba(244, 114, 182, 0.1)" : "transparent",
                  }}
                >
                  <span aria-hidden style={{ lineHeight: "18px" }}>{NOTIFICATION_ICON[record.type ?? "info"]}</span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontWeight: fresh ? 700 : 500, fontSize: 12.5 }}>{record.title}</span>
                    {record.body ? (
                      <span style={{ fontSize: 11.5, color: "rgba(226, 232, 248, 0.75)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {record.body}
                      </span>
                    ) : null}
                    <span style={{ fontSize: 10.5, color: "rgba(214, 228, 244, 0.55)" }}>{timeAgo(record.timestamp)}</span>
                  </span>
                  {fresh ? <span aria-label="unread" style={{ width: 8, height: 8, marginTop: 5, borderRadius: 999, background: "#f472b6", flexShrink: 0 }} /> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}

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
                <Link size={15} aria-hidden /> {linked ? "Unlink — stop sharing research" : "Link — share research with this chat"}
              </button>
            ) : null}
            {conversation.id !== activeId ? (
              <button
                type="button"
                role="menuitem"
                data-lelu-merge-chat={conversation.id}
                title="Make a new chat with both histories; both original chats stay as they are"
                aria-label={`Merge ${conversation.title} with the current chat into a new chat`}
                onClick={act(() => {
                  if (mergeConversations([activeId, conversation.id])) openPanel("chat");
                })}
                style={menuItemStyle}
              >
                <GitMerge size={15} aria-hidden /> Merge into a new chat
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
