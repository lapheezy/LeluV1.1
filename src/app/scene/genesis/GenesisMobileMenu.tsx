/**
 * ==========================================================
 * LÉLU — MOBILE MENU (the chat-controlled, categorized sheet)
 *
 * The LÉLU menu lives INSIDE the chat and is the only
 * navigation on phones. It presents the SAME registered
 * research modules and tools catalog) are grouped the
 * way LÉLU's environment is organised: LÉLU · Cosmos ·
 * Create · Research · Tools & Labs · System.
 *
 * This is not a second navigation system — it is the mobile
 * presentation of the one unified dock/module catalog, and it
 * launches canonical panels (openPanel) and environment
 * modules (openModule) through the shared runtime. It is
 * touch-first (≥44px targets), safe-area aware, scrollable and
 * never renders over the composer.
 * ==========================================================
 */

/** A thematic group maps real dock/module ids to a LÉLU label. */
interface MobileMenuEntry {
  id: string;
  label: string;
  glyph: string;
}

export interface MobileMenuGroup {
  id: string;
  label: string;
  glyph: string;
  tint: string;
  items: MobileMenuEntry[];
}

interface GenesisMobileMenuProps {
  statusTitle: string;
  statusColor: string;
  statusPulsing: boolean;
  online: boolean;
  onClose: () => void;
  onActivate: (id: string) => void;
}

/* The authoritative list of every registered capability, grouped the
   way LÉLU's environment is organised. Each id is a real GenesisPanel
   resolved by the caller through the shared dock/module catalog. */
const GROUPS: MobileMenuGroup[] = [
  {
    id: "lelu",
    label: "LÉLU",
    glyph: "◎",
    tint: "#ffb3d9",
    items: [
      { id: "chat", label: "Chat", glyph: "◎" },
      { id: "history", label: "Conversation", glyph: "≡" },
      { id: "notifications", label: "Notifications", glyph: "◷" },
      { id: "memory", label: "Memory", glyph: "◐" },
      { id: "cognition", label: "Cognition", glyph: "◬" },
      { id: "settings", label: "Settings", glyph: "⚙" },
    ],
  },
  {
    id: "cosmos",
    label: "COSMOS",
    glyph: "✦",
    tint: "#67e8f9",
    items: [
      { id: "cosmos", label: "Cosmos", glyph: "✦" },
      { id: "earth", label: "Earth / Eagle Eye", glyph: "🌍" },
      { id: "genesisv2", label: "Navigation", glyph: "⬡" },
    ],
  },
  {
    id: "create",
    label: "CREATE",
    glyph: "◍",
    tint: "#a78bfa",
    items: [
      { id: "visualstudio", label: "Visual Studio", glyph: "◍" },
      { id: "render", label: "Render", glyph: "◍" },
      { id: "sketch", label: "Sketch", glyph: "✎" },
      { id: "avatar", label: "Avatar", glyph: "◉" },
      { id: "evolution", label: "Self Development", glyph: "⬖" },
    ],
  },
  {
    id: "research",
    label: "RESEARCH",
    glyph: "◫",
    tint: "#34d399",
    items: [
      { id: "browser", label: "Web / Browser", glyph: "◫" },
      { id: "video", label: "YouTube / Media", glyph: "▶" },
      { id: "reasoning", label: "Reasoning", glyph: "✦" },
      { id: "knowledge", label: "Knowledge", glyph: "◬" },
    ],
  },
  {
    id: "tools",
    label: "TOOLS & LABS",
    glyph: "⌘",
    tint: "#fbbf24",
    items: [
      { id: "engineering", label: "Sandbox / Code", glyph: "⌘" },
      { id: "agents", label: "Agents", glyph: "◈" },
      { id: "executive", label: "Executive", glyph: "◉" },
    ],
  },
  {
    id: "system",
    label: "SYSTEM",
    glyph: "◉",
    tint: "#94a3b8",
    items: [
      { id: "device", label: "Device", glyph: "◮" },
      { id: "diagnostics", label: "Engines", glyph: "●" },
      { id: "logs", label: "Logs", glyph: "▤" },
      { id: "visual", label: "System UI", glyph: "◉" },
    ],
  },
];

/** The soft, pillow-like button base shared by every menu chip. */
const softBubble: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 999,
  background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 60%)",
  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.25), 0 2px 6px rgba(2,6,23,0.35)",
  flexShrink: 0,
};

/** The soft section chip — rounded, cloud-like label tile. */
const sectionChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  borderRadius: 999,
  padding: "5px 12px",
  margin: "8px 2px 4px",
  background: "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 2px 8px rgba(2,6,23,0.25)",
};

export default function GenesisMobileMenu({
  statusTitle,
  statusColor,
  statusPulsing,
  online,
  onClose,
  onActivate,
}: GenesisMobileMenuProps) {
  return (
    <div
      data-lelu-mobile-menu
      className="lelu-menu-sheet"
      role="dialog"
      aria-label="LÉLU menu"
      style={{
        position: "fixed",
        left: 8,
        right: 8,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)",
        zIndex: 27,
        pointerEvents: "auto",
        borderRadius: 24,
        background: "linear-gradient(150deg, rgba(15,23,46,0.98) 0%, rgba(30,41,59,0.94) 55%, rgba(2,8,23,0.98) 100%)",
        border: "1px solid rgba(167,139,250,0.28)",
        backdropFilter: "blur(26px)",
        WebkitBackdropFilter: "blur(26px)",
        boxShadow:
          "0 24px 70px rgba(2,6,23,0.7), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 40px rgba(167,139,250,0.08)",
        padding: "10px 12px 16px",
        maxHeight: "min(74dvh, 600px)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "inherit",
        overflowY: "auto",
        scrollbarWidth: "none",
      }}
    >
      {/* grab handle */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
        <span style={{ width: 44, height: 4, borderRadius: 99, background: "rgba(148,163,184,0.4)" }} />
      </div>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, padding: "0 4px" }}>
        <span aria-hidden style={{ ...softBubble, width: 30, height: 30, fontSize: 13, color: "#ffb3d9" }}>
          ◎
        </span>
        <strong style={{ fontSize: 13, letterSpacing: "0.08em", color: "#ffe9f6", flex: 1 }}>
          LÉLU · TOOLS
        </strong>
        <span
          title={statusTitle}
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: statusColor,
            boxShadow: statusPulsing ? `0 0 8px ${statusColor}` : "none",
          }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close LÉLU menu"
          title="Close"
          style={{
            width: 30,
            height: 30,
            borderRadius: 999,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(226,232,240,0.85)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ fontSize: 10.5, color: "rgba(148,163,184,0.9)", padding: "0 6px 4px", letterSpacing: "0.04em" }}>
        {online ? "live · one runtime" : "booting · one runtime"} — every item is a tool of the chat
      </div>

      {/* grouped sections */}
      {GROUPS.map((group) => (
        <div key={group.id}>
          <span style={{ ...sectionChip, color: group.tint }}>
            <span aria-hidden>{group.glyph}</span>
            <span style={{ letterSpacing: "0.16em", fontSize: 10, fontWeight: 700 }}>{group.label}</span>
          </span>
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onActivate(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                minHeight: 46,
                padding: "8px 12px",
                borderRadius: 16,
                border: "1px solid transparent",
                background: "transparent",
                color: "#dbeafe",
                fontSize: 13,
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "inherit",
                WebkitTapHighlightColor: "transparent",
                transition: "background 0.15s ease",
              }}
            >
              <span aria-hidden style={{ ...softBubble, width: 30, height: 30, fontSize: 14, color: group.tint }}>
                {item.glyph}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
              <span aria-hidden style={{ fontSize: 12, color: "rgba(125,211,252,0.55)" }}>›</span>
            </button>
          ))}
        </div>
      ))}

      <div style={{ height: 2 }} />
    </div>
  );
}