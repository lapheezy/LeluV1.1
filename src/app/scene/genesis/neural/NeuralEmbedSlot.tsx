/**
 * What a host interface imports (M17.2-WP02): a small toggle and the
 * card, fetched as its own chunk only when first opened. Hosts own where
 * the card sits; nothing is mounted — and nothing subscribes — until it
 * is open, and closing it unmounts it (its subscriptions go with it).
 */

import { lazy, Suspense, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { NeuralEmbedProps } from "./NeuralEmbed";

const NeuralEmbed = lazy(() => import("./NeuralEmbed"));

/**
 * `layer`: for an interface whose own windows stack ABOVE it (Chat
 * Universe's chat windows are z 520 over the Universe's 480), the card is
 * lifted to the interface's top layer so a window never hides it. It still
 * belongs to — and is opened, placed and closed by — that interface.
 */
export function NeuralEmbedSlot({ open, layer, ...props }: NeuralEmbedProps & { open: boolean; layer?: number }) {
  if (!open) return null;
  const node = (
    <Suspense fallback={null}>
      <NeuralEmbed {...props} style={layer ? { ...props.style, position: "fixed", zIndex: layer } : props.style} />
    </Suspense>
  );
  return layer && typeof document !== "undefined" ? createPortal(node, document.body) : node;
}

export function NeuralToggle({ open, onToggle, host, style, label = "Neural" }: { open: boolean; onToggle: () => void; host: string; style?: CSSProperties; label?: string }) {
  return (
    <button
      type="button"
      data-neural-toggle={host}
      aria-pressed={open}
      aria-label={open ? "Close the Neural Map card" : "Show this in the Neural Map"}
      title="LÉLU's Neural Map: what this is, what it connects to"
      onClick={onToggle}
      style={{
        border: "1px solid rgba(167, 139, 250, 0.45)",
        background: open ? "rgba(124, 58, 237, 0.45)" : "rgba(30, 27, 75, 0.55)",
        color: "#ede9fe",
        borderRadius: 999,
        padding: "4px 10px",
        font: "600 12px/1.2 Inter, system-ui, sans-serif",
        cursor: "pointer",
        ...style,
      }}
    >
      ◈ {label}
    </button>
  );
}
