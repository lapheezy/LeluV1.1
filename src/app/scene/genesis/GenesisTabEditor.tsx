/**
 * ==========================================================
 * LÉLU
 * GENESIS TAB EDITOR — adjustable navigation tabs
 *
 * The customization sheet behind the ⚙ trigger in the dock:
 * reorder tabs (▲/▼), hide or restore tabs (eye toggle), and
 * resize the whole tab bar (compact / standard / large). The
 * same sheet is used on every breakpoint — on phones it slides
 * up above the mobile dock bar, on tablet/desktop it floats
 * beside the rail. All state is owned by GenesisDock's settings
 * hook (persisted via KvStore); this component only renders it.
 * ==========================================================
 */

import type { GenesisPanel } from "./GenesisCore";
import GenesisNavIcon from "./GenesisNavIcons";
import type { DockItem, DockSettings, DockSize } from "./GenesisDock";

interface GenesisTabEditorProps {
  visible: DockItem[];
  allItems: DockItem[];
  settings: DockSettings;
  onToggleHidden: (id: GenesisPanel) => void;
  onMove: (id: GenesisPanel, direction: -1 | 1) => void;
  onSetSize: (size: DockSize) => void;
  onReset: () => void;
  onClose: () => void;
  mobile: boolean;
}

const SIZES: { id: DockSize; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "standard", label: "Standard" },
  { id: "large", label: "Large" },
];

export default function GenesisTabEditor({
  visible,
  allItems,
  settings,
  onToggleHidden,
  onMove,
  onSetSize,
  onReset,
  onClose,
  mobile,
}: GenesisTabEditorProps) {
  const hiddenItems = allItems.filter((item) => settings.hidden.includes(item.id));

  return (
    <>
      {/* dim backdrop — closes the editor */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          background: "rgba(2, 6, 23, 0.45)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
        onClick={onClose}
        aria-hidden
      />

      <div
        className="lelu-tab-bar"
        role="dialog"
        aria-label="Customize tabs"
        style={{
          position: "fixed",
          zIndex: 61,
          ...(mobile
            ? {
                left: 8,
                right: 8,
                bottom: "calc(88px + env(safe-area-inset-bottom, 0px))",
              }
            : { left: 88, bottom: 24, width: 340 }),
          borderRadius: 18,
          padding: 14,
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxHeight: "min(72vh, 620px)",
          overflowY: "auto",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.9 }}>
            Customize tabs
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid rgba(255, 190, 225, 0.45)",
              borderRadius: 999,
              background: "rgba(255, 158, 203, 0.14)",
              color: "white",
              padding: "7px 14px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Done
          </button>
        </div>

        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 6 }}>
            Tab size
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {SIZES.map((size) => {
              const active = settings.size === size.id;
              return (
                <button
                  key={size.id}
                  type="button"
                  onClick={() => onSetSize(size.id)}
                  className={active ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    padding: "8px 6px",
                    fontSize: 11.5,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {size.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 6 }}>
            Order &amp; visibility · {visible.length} shown
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {visible.map((item, index) => (
              <div
                key={item.id}
                className="lelu-tab-cloud"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 12,
                  padding: "7px 9px",
                  fontSize: 12,
                }}
              >
                <span style={{ width: 20, textAlign: "center", fontSize: 10.5, opacity: 0.55, flexShrink: 0 }}>
                  {index + 1}
                </span>
                <GenesisNavIcon name={item.icon} size={15} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.label}
                </span>
                <button
                  type="button"
                  onClick={() => onMove(item.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${item.label} up`}
                  style={{
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.07)",
                    color: index === 0 ? "rgba(160,178,200,0.35)" : "white",
                    width: 26,
                    height: 26,
                    fontSize: 11,
                    cursor: index === 0 ? "default" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => onMove(item.id, 1)}
                  disabled={index === visible.length - 1}
                  aria-label={`Move ${item.label} down`}
                  style={{
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.07)",
                    color: index === visible.length - 1 ? "rgba(160,178,200,0.35)" : "white",
                    width: 26,
                    height: 26,
                    fontSize: 11,
                    cursor: index === visible.length - 1 ? "default" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  ▼
                </button>
                <button
                  type="button"
                  onClick={() => onToggleHidden(item.id)}
                  aria-label={`Hide ${item.label}`}
                  title="Hide"
                  style={{
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.07)",
                    color: "white",
                    width: 26,
                    height: 26,
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  ◉
                </button>
              </div>
            ))}
          </div>
        </div>

        {hiddenItems.length > 0 ? (
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 6 }}>
              Hidden · {hiddenItems.length}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {hiddenItems.map((item) => (
                <div
                  key={item.id}
                  className="lelu-tab-cloud"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 12,
                    padding: "7px 9px",
                    fontSize: 12,
                    opacity: 0.75,
                  }}
                >
                  <GenesisNavIcon name={item.icon} size={15} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleHidden(item.id)}
                    aria-label={`Show ${item.label}`}
                    title="Show"
                    style={{
                      border: "1px solid rgba(125, 211, 252, 0.45)",
                      borderRadius: 8,
                      background: "rgba(34, 211, 238, 0.14)",
                      color: "white",
                      padding: "4px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Show
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onReset}
          style={{
            border: "1px solid rgba(248, 113, 113, 0.4)",
            borderRadius: 12,
            background: "rgba(248, 113, 113, 0.08)",
            color: "#fca5a5",
            padding: "8px 12px",
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Reset tabs to default
        </button>
      </div>
    </>
  );
}
