/**
 * ==========================================================
 * LÉLU
 * GENESIS EXPLORER CARDS — Autonomous discovery overlay
 *
 * When LÉLU autonomously explores, she opens small floating
 * info cards instead of full-screen panels. These cards:
 *
 *   - Show what she's looking at (icon + label + reasoning)
 *   - Stack cleanly without overlapping
 *   - Auto-dismiss after ~25s
 *   - Tap to expand into the full panel
 *   - Max 4 visible simultaneously
 *
 * On mobile, these are the primary autonomous UI. The full
 * panels only open on explicit user tap.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ExplorerCard {
  /** Unique ID for this card instance */
  id: string;
  /** Genesis panel ID (chat, memory, reasoning, etc.) */
  panelId: string;
  /** Display label */
  label: string;
  /** Single-glyph icon */
  icon: string;
  /** Why LÉLU opened this — brief reasoning text */
  reasoning: string;
  /** Unix ms when created (for auto-dismiss) */
  createdAt: number;
  /** Whether this card was already tapped-to-expand */
  expanded: boolean;
}

const CARD_LIFETIME_MS = 25000;
const MAX_VISIBLE = 4;

export function createExplorerCard(
  panelId: string,
  label: string,
  icon: string,
  reasoning: string,
): ExplorerCard {
  return {
    id: `explore-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    panelId,
    label,
    icon,
    reasoning,
    createdAt: Date.now(),
    expanded: false,
  };
}

/** Reasoning templates keyed by panel. */
const REASONING_TEMPLATES: Record<string, string[]> = {
  memory: [
    "Checking recent memories",
    "Reviewing conversation history",
    "Consolidating knowledge",
    "Recalling context",
  ],
  reasoning: [
    "Evaluating active hypotheses",
    "Running inference chain",
    "Validating reasoning path",
  ],
  agents: [
    "Observing agent activity",
    "Checking agent status",
    "Coordinating with agents",
  ],
  cognition: [
    "Reviewing cognitive state",
    "Assessing attention targets",
    "Monitoring thought cycles",
  ],
  engineering: [
    "Inspecting engineering workspace",
    "Checking build status",
    "Reviewing code structure",
  ],
  diagnostics: [
    "Running system diagnostics",
    "Checking engine health",
    "Monitoring performance",
  ],
  projects: [
    "Reviewing active projects",
    "Checking project milestones",
    "Organizing workspace",
  ],
  providers: [
    "Checking API health",
    "Verifying provider status",
    "Monitoring fallback chain",
  ],
  cosmos: [
    "Navigating the universe",
    "Exploring celestial bodies",
    "Tracing star systems",
    "Surveying cosmic regions",
  ],
  sketch: [
    "Opening sketch workspace",
    "Reviewing visual drafts",
  ],
  render: [
    "Checking render pipeline",
    "Previewing visual output",
  ],
  avatar: [
    "Adjusting visual presence",
    "Checking avatar state",
  ],
  video: [
    "Opening video workspace",
    "Reviewing media content",
  ],
  knowledge: [
    "Searching knowledge graph",
    "Exploring information nodes",
  ],
  evolution: [
    "Tracking evolution cycle",
    "Reviewing capability growth",
  ],
  genesisv2: [
    "Entering Genesis v2 lab",
    "Opening transformation workspace",
  ],
  history: [
    "Reviewing interaction history",
    "Checking past conversations",
  ],
  logs: [
    "Checking system logs",
    "Reviewing runtime events",
  ],
  chat: [
    "Opening conversation",
    "Preparing chat workspace",
  ],
  settings: [
    "Checking configuration",
    "Reviewing system settings",
  ],
};

export function pickReasoning(panelId: string): string {
  const templates = REASONING_TEMPLATES[panelId];
  if (!templates || templates.length === 0) return "Exploring...";
  return templates[Math.floor(Math.random() * templates.length)]!;
}

const ICON_MAP: Record<string, string> = {
  chat: "◎", cosmos: "✦", history: "≡", workspaces: "▦",
  genesisv2: "⬡", sketch: "✎", render: "◍", video: "▶",
  avatar: "◉", reasoning: "✦", cognition: "◬", engineering: "⌘",
  evolution: "⬖", agents: "◈", memory: "◐", providers: "⌁",
  settings: "⚙", device: "◮", diagnostics: "●", logs: "▤",
  browser: "◫", knowledge: "◬",
};

export function iconForPanel(panelId: string): string {
  return ICON_MAP[panelId] ?? "◉";
}

interface GenesisExplorerCardsProps {
  cards: ExplorerCard[];
  onExpand: (card: ExplorerCard) => void;
  onDismiss: (id: string) => void;
}

export default function GenesisExplorerCards({ cards, onExpand, onDismiss }: GenesisExplorerCardsProps) {
  const visibleCards = useMemo(
    () => cards.filter((c) => !c.expanded).slice(0, MAX_VISIBLE),
    [cards],
  );

  if (visibleCards.length === 0) return null;

  return (
    <div
      data-lelu-explorer-cards
      style={{
        position: "fixed",
        bottom: 140, // above the dock bar
        left: 10,
        right: 10,
        zIndex: 26,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      {visibleCards.map((card) => (
        <ExplorerCardItem
          key={card.id}
          card={card}
          onExpand={() => onExpand(card)}
          onDismiss={() => onDismiss(card.id)}
        />
      ))}
    </div>
  );
}

function ExplorerCardItem({
  card,
  onExpand,
  onDismiss,
}: {
  card: ExplorerCard;
  onExpand: () => void;
  onDismiss: () => void;
}) {
  const [age, setAge] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setAge(Date.now() - card.createdAt);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [card.createdAt]);

  // Auto-dismiss after lifetime
  useEffect(() => {
    if (age >= CARD_LIFETIME_MS) {
      onDismiss();
    }
  }, [age, onDismiss]);

  const progress = Math.min(age / CARD_LIFETIME_MS, 1);
  const fadingOut = progress > 0.75;

  const handleTap = useCallback(() => {
    onExpand();
  }, [onExpand]);

  return (
    <button
      type="button"
      onClick={handleTap}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: 8,
        maxWidth: 260,
        padding: "8px 13px",
        borderRadius: 16,
        background: fadingOut
          ? "rgba(8, 16, 38, 0.55)"
          : "rgba(8, 16, 38, 0.82)",
        border: `1px solid ${fadingOut ? "rgba(148,163,184,0.15)" : "rgba(130,200,255,0.28)"}`,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        color: "rgba(220,230,245,0.92)",
        fontFamily: "inherit",
        fontSize: 12,
        lineHeight: 1.4,
        cursor: "pointer",
        textAlign: "left",
        opacity: fadingOut ? 0.55 : 0.92,
        boxShadow: fadingOut
          ? "none"
          : "0 8px 24px rgba(2,6,23,0.5), 0 0 12px rgba(130,200,255,0.12)",
        transition: "opacity 0.4s ease, background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
        animation: "lelu-card-enter 0.3s ease",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {/* Icon */}
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          borderRadius: 10,
          background: "rgba(130,200,255,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
        }}
      >
        {card.icon}
      </span>

      {/* Content */}
      <div style={{ overflow: "hidden", minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: "rgba(200,225,255,0.95)" }}>
          {card.label}
        </div>
        <div
          style={{
            fontSize: 10.5,
            opacity: 0.65,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.reasoning}
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 3,
          borderRadius: 3,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${(1 - progress) * 100}%`,
            height: "100%",
            borderRadius: 3,
            background: fadingOut
              ? "rgba(255,255,255,0.2)"
              : "rgba(130,200,255,0.55)",
            transition: "width 1s linear",
          }}
        />
      </div>

      {/* Dismiss X */}
      <span
        role="button"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        style={{
          flexShrink: 0,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: "rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          opacity: 0.45,
          cursor: "pointer",
        }}
      >
        ✕
      </span>
    </button>
  );
}