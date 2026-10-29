/**
 * The companion-mode switch — one control, used in the Avatar panel and
 * the menu. It writes CompanionStore; the companion itself reads it.
 */

import { useEffect, useState } from "react";
import CompanionStore, { type CompanionState } from "../../../../core/avatar/CompanionStore";

export default function CompanionToggle({ detailed = false }: { detailed?: boolean }) {
  const store = CompanionStore.getInstance();
  const [state, setState] = useState<CompanionState>(() => store.get());
  useEffect(() => store.subscribe(setState), [store]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        role="switch"
        aria-checked={state.enabled}
        data-testid="companion-toggle"
        onClick={() => store.toggle()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          width: "100%",
          minHeight: 44,
          padding: "8px 12px",
          borderRadius: 14,
          border: `1px solid ${state.enabled ? "rgba(240,171,252,0.55)" : "rgba(255,255,255,0.12)"}`,
          background: state.enabled ? "rgba(240,171,252,0.12)" : "rgba(255,255,255,0.04)",
          color: "#f5edff",
          font: "600 13px system-ui, sans-serif",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>
          Companion mode
          <span style={{ display: "block", fontWeight: 400, fontSize: 11, opacity: 0.7 }}>
            {state.enabled ? "She's with you on every screen" : "Show her over the app while you work"}
          </span>
        </span>
        <span
          aria-hidden
          style={{
            width: 38,
            height: 22,
            borderRadius: 11,
            background: state.enabled ? "#f0abfc" : "rgba(255,255,255,0.18)",
            position: "relative",
            flexShrink: 0,
            transition: "background 160ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: state.enabled ? 19 : 3,
              width: 16,
              height: 16,
              borderRadius: 8,
              background: "#140c1e",
              transition: "left 160ms ease",
            }}
          />
        </span>
      </button>
      {detailed && state.enabled ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
          {(["small", "medium", "large"] as const).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => store.setSize(size)}
              style={{
                padding: "5px 9px",
                borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.14)",
                background: state.size === size ? "rgba(240,171,252,0.22)" : "transparent",
                color: "#f5edff",
                cursor: "pointer",
              }}
            >
              {size}
            </button>
          ))}
          <button
            type="button"
            onClick={() => store.unpin()}
            disabled={!state.pinned}
            style={{
              padding: "5px 9px",
              borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "transparent",
              color: "#f5edff",
              opacity: state.pinned ? 1 : 0.5,
              cursor: state.pinned ? "pointer" : "default",
            }}
          >
            {state.pinned ? "Let her choose where to stand" : "She chooses where to stand"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
