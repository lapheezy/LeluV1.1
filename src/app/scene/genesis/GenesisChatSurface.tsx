/**
 * ==========================================================
 * LÉLU — CHAT VISUAL SURFACES
 *
 * Real execution → real visuals, inline inside the conversation.
 * When LÉLU runs a search/research tool or opens the browser,
 * the ACTUAL result (titles, urls, page excerpt) is attached to
 * the exchange as a ChatSurface and rendered here — never a
 * static "Searching…" card.
 *
 * Surfaces are fed by real AgentEventBus events:
 *   • tool_result (tool: research)  → search/research cards
 *   • browser_opened / tool_result (tool: browser) → browser card
 * ==========================================================
 */

import { useState, type CSSProperties } from "react";

export interface ChatSurfaceItem {
  title?: string;
  url?: string;
  type?: string;
  content?: string;
  source?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export type ChatSurface =
  | {
      kind: "search";
      label: string;
      summary?: string;
      items: ChatSurfaceItem[];
    }
  | {
      kind: "research";
      label: string;
      items: ChatSurfaceItem[];
    }
  | {
      kind: "browser";
      url: string;
      title?: string;
      excerpt?: string;
      status: "read" | "blocked" | "error" | "opened";
      error?: string;
    };

/** Tell the in-app browser panel to navigate to a real page. */
export function dispatchBrowserGoto(url: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("genesis-browser-goto", { detail: { url } }),
  );
  window.dispatchEvent(
    new CustomEvent("genesis-show-surface", { detail: { panel: "browser" } }),
  );
}

const cardStyle: CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(103, 232, 249, 0.18)",
  background: "rgba(2, 8, 23, 0.55)",
  padding: 10,
  fontSize: 11.5,
  fontFamily: "inherit",
};

const chipStyle: CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "#67e8f9",
  opacity: 0.9,
};

function SourceChip({ type }: { type?: string }) {
  return (
    <span
      style={{
        ...chipStyle,
        background: "rgba(103, 232, 249, 0.1)",
        border: "1px solid rgba(103, 232, 249, 0.25)",
        borderRadius: 999,
        padding: "1px 7px",
        flexShrink: 0,
      }}
    >
      {type ?? "web"}
    </span>
  );
}

function ResultList({ items }: { items: ChatSurfaceItem[] }) {
  if (items.length === 0) {
    return <div style={{ opacity: 0.6 }}>No usable results returned.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {items.slice(0, 6).map((item, index) => (
        <div
          key={`${item.url ?? item.title ?? ""}-${index}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "5px 8px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <SourceChip type={item.type} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#dbeafe" }}>
            {item.title ?? item.url ?? "(result)"}
          </span>
          {item.url ? (
            <button
              type="button"
              onClick={() => dispatchBrowserGoto(item.url!)}
              title={`Open ${item.url}`}
              style={{
                border: "1px solid rgba(103,232,249,0.35)",
                background: "rgba(103,232,249,0.1)",
                color: "#cffafe",
                borderRadius: 7,
                padding: "2px 8px",
                fontSize: 10,
                cursor: "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
            >
              Open
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function BrowserView({ surface }: { surface: Extract<ChatSurface, { kind: "browser" }> }) {
  const [open, setOpen] = useState(false);
  const statusColor =
    surface.status === "read"
      ? "#34d399"
      : surface.status === "blocked"
        ? "#fbbf24"
        : "#f87171";
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#e6f4ff" }}>
          🌐 {surface.title || surface.url}
        </span>
        <span style={{ fontSize: 9.5, color: statusColor, borderRadius: 999, border: `1px solid ${statusColor}55`, padding: "1px 8px" }}>
          {surface.status === "read" ? "PAGE READ" : surface.status === "blocked" ? "EMBED BLOCKED" : surface.status === "error" ? "ERROR" : "OPENED"}
        </span>
      </div>
      <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {surface.url}
      </div>

      <div style={{ display: "flex", gap: 6, margin: "8px 0" }}>
        <button
          type="button"
          onClick={() => dispatchBrowserGoto(surface.url)}
          style={{ ...actionBtn, borderColor: "rgba(103,232,249,0.4)" }}
        >
          Open in browser
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ ...actionBtn, borderColor: "rgba(255,255,255,0.15)" }}
        >
          {open ? "Hide preview" : "Preview page"}
        </button>
      </div>

      {open ? (
        <div
          style={{
            height: 260,
            borderRadius: 10,
            overflow: "hidden",
            background: "white",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          <iframe
            src={surface.url}
            title={`Preview of ${surface.url}`}
            referrerPolicy="no-referrer-when-downgrade"
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          />
        </div>
      ) : null}

      {surface.status === "blocked" || surface.status === "error" ? (
        <div style={{ fontSize: 10.5, color: "#fcd34d", marginTop: 6 }}>
          {surface.error ??
            "This site blocks embedding or direct reading — the in-app browser can still open it (Open in browser)."}
        </div>
      ) : null}
      {surface.excerpt ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: "rgba(226, 240, 255, 0.85)",
            maxHeight: 110,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: 7,
          }}
        >
          {surface.excerpt}
        </div>
      ) : null}
    </div>
  );
}

const actionBtn: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.05)",
  color: "#dbeafe",
  borderRadius: 8,
  padding: "4px 10px",
  fontSize: 10.5,
  cursor: "pointer",
  fontFamily: "inherit",
};

function SurfaceCard({ surface }: { surface: ChatSurface }) {
  const [open, setOpen] = useState(false);

  if (surface.kind === "browser") {
    return <BrowserView surface={surface} />;
  }

  const count = surface.items.length;
  const glyph = surface.kind === "search" ? "⌕" : "◫";
  const verb = surface.kind === "search" ? "searched" : "researched";

  return (
    <div style={cardStyle}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          color: "#dbeafe",
          cursor: "pointer",
          fontFamily: "inherit",
          padding: 0,
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 13, opacity: 0.9 }}>{glyph}</span>
        <span style={{ flex: 1, fontSize: 11.5 }}>
          LÉLU {verb} <strong>"{surface.label}"</strong>
          <span style={{ opacity: 0.55 }}> · {count} real result{count === 1 ? "" : "s"}</span>
        </span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? "collapse" : "expand"}</span>
      </button>
      {open ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {surface.kind === "search" && surface.summary ? <div style={{ fontSize: 10.5, opacity: 0.7 }}>{surface.summary}</div> : null}
          <ResultList items={surface.items} />
        </div>
      ) : null}
    </div>
  );
}

export default function GenesisChatSurface({ surfaces }: { surfaces: ChatSurface[] }) {
  if (!surfaces || surfaces.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 12,
        maxWidth: "min(430px, 100%)",
      }}
    >
      {surfaces.map((surface, index) => (
        <SurfaceCard key={index} surface={surface} />
      ))}
    </div>
  );
}
