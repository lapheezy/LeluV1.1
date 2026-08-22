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
 * Features: new / switch / rename (double-click or ✎) / close /
 * pin / link-to-active / unified search (click a result to open
 * that conversation). Unread and processing indicators come from
 * the persistent MultiChatStore.
 * ==========================================================
 */

import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { useGenesis } from "./GenesisCore";

const barStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  top: "56px",
  transform: "translateX(-50%)",
  zIndex: 26,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 6px",
  borderRadius: 999,
  pointerEvents: "auto",
  maxWidth: "min(96vw, 760px)",
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

const iconButtonStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: 0,
  width: 18,
  height: 18,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  borderRadius: 999,
  color: "rgba(214, 228, 244, 0.72)",
  fontFamily: "inherit",
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
      <div data-lelu-multichat className="lelu-tab-bar" style={barStyle}>
        {conversations.map((conversation) => {
          const active = conversation.id === activeId;
          const linked = conversation.linkedIds.includes(activeId);
          const canClose = conversations.length > 1;

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
                  onClick={(event) => handleTabClick(event, conversation.id)}
                  title={`${conversation.title}${conversation.unread > 0 ? ` (${conversation.unread} unread)` : ""}`}
                  style={{
                    ...tabStyle,
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
                title={linked ? "Unlink from active chat" : "Link to active chat"}
                aria-label={linked ? "Unlink conversation" : "Link conversation"}
                onClick={() => (linked ? unlinkConversations(conversation.id, activeId) : linkConversations(conversation.id, activeId))}
                style={{
                  ...iconButtonStyle,
                  color: linked ? "rgba(103, 232, 249, 0.95)" : "rgba(214, 228, 244, 0.55)",
                }}
              >
                🔗
              </button>

              <button
                type="button"
                title={conversation.pinned ? "Unpin" : "Pin"}
                aria-label={conversation.pinned ? "Unpin conversation" : "Pin conversation"}
                onClick={() => pinConversation(conversation.id)}
                style={{
                  ...iconButtonStyle,
                  color: conversation.pinned ? "rgba(251, 191, 36, 0.95)" : "rgba(214, 228, 244, 0.55)",
                }}
              >
                📌
              </button>

              <button
                type="button"
                title="Rename"
                aria-label="Rename conversation"
                onClick={() => beginRename(conversation.id, conversation.title)}
                style={iconButtonStyle}
              >
                ✎
              </button>

              {canClose ? (
                <button
                  type="button"
                  title="Close chat"
                  aria-label={`Close ${conversation.title}`}
                  onClick={() => closeConversation(conversation.id)}
                  style={{ ...iconButtonStyle, color: "rgba(248, 113, 113, 0.85)" }}
                >
                  ✕
                </button>
              ) : null}
            </div>
          );
        })}

        <button
          type="button"
          title="New chat"
          aria-label="New chat"
          className="lelu-tab-cloud"
          onClick={() => {
            createConversation();
            openPanel("chat");
          }}
          style={{ ...tabStyle, background: "transparent", color: "rgba(226, 238, 252, 0.85)" }}
        >
          ＋
        </button>

        <button
          type="button"
          title="Search all chats"
          aria-label="Search all chats"
          aria-expanded={searchOpen}
          className={searchOpen ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
          onClick={() => setSearchOpen((current) => !current)}
          style={{ ...tabStyle, background: "transparent", color: "rgba(226, 238, 252, 0.85)" }}
        >
          🔍
        </button>
      </div>

      {searchOpen ? (
        <div
          className="lelu-tab-bar"
          style={{
            position: "fixed",
            left: "50%",
            top: "96px",
            transform: "translateX(-50%)",
            zIndex: 27,
            width: "min(92vw, 560px)",
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
