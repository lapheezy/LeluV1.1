/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS HISTORY PANEL
 *
 * Phase 7 — a searchable, full-height view over state.messages
 * (already populated by GenesisBridge). The chat bubble only
 * shows the live thread; this is where past exchanges can be
 * found again without scrolling a growing chat window.
 * ==========================================================
 */

import { useMemo, useState } from "react";
import { useGenesis } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import GenesisWindowFrame from "./GenesisWindowFrame";

interface GenesisHistoryPanelProps {
  onClose: () => void;
}

export default function GenesisHistoryPanel({ onClose }: GenesisHistoryPanelProps) {
  const { state, clearConversation } = useGenesis();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const messages = [...state.messages].reverse();
    if (!normalized) return messages;
    return messages.filter((message) => message.text.toLowerCase().includes(normalized));
  }, [state.messages, query]);

  return (
    <GenesisWindowFrame
      title={<>History · {state.messages.length} messages</>}
      onClose={onClose}
      width="min(92vw, 540px)"
      extraActions={
        <button
          type="button"
          onClick={() => clearConversation()}
          style={{ ...genesisTheme.closeButton, opacity: 0.75 }}
        >
          Clear
        </button>
      }
    >

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search conversation…"
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: genesisTheme.glass.borderSoft,
          borderRadius: genesisTheme.radius.md,
          background: "rgba(255,255,255,0.04)",
          color: "white",
          padding: "8px 10px",
          fontSize: 13,
          outline: "none",
          marginBottom: 12,
        }}
      />

      {filtered.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {state.messages.length === 0 ? "No conversation yet." : "No messages match this search."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((message) => (
            <div
              key={message.id}
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: "8px 10px",
                background: message.role === "user" ? "rgba(34, 211, 238, 0.06)" : "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.55, marginBottom: 4 }}>
                <span style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>{message.role}</span>
                <span>{new Date(message.timestamp).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>{message.text}</div>
            </div>
          ))}
        </div>
      )}
    </GenesisWindowFrame>
  );
}
