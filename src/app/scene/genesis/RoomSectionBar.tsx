/**
 * LÉLUVERSE — the controls of her rotating room.
 *
 * A row of chips, one per section plus the bare stage and the floor plan.
 * Tapping one turns the room (RoomStore.goTo); the chip of the section at
 * the back is lit, and while the room turns the bar says where it is going.
 * LÉLU turns the same room with her world.room tool. On a phone the row
 * folds into one chip that opens it.
 */
import { useEffect, useState } from "react";
import RoomStore, { ROOM_SECTIONS, type RoomMode, type RoomState } from "../../../core/world/RotatingRoom";

const EXTRA: Array<{ id: RoomMode; label: string; glyph: string }> = [
  { id: "stage", label: "Stage", glyph: "◯" },
  { id: "plan", label: "Floor plan", glyph: "⌖" },
];

export default function RoomSectionBar({ mobile }: { mobile: boolean }) {
  const [state, setState] = useState<RoomState>(() => RoomStore.get());
  const [open, setOpen] = useState(!mobile);
  useEffect(() => RoomStore.subscribe((s) => setState({ ...s })), []);
  const items = [...ROOM_SECTIONS.map((s) => ({ id: s.id as RoomMode, label: s.label, glyph: s.glyph })), ...EXTRA];
  const current = items.find((i) => i.id === state.mode) ?? items[0];
  const chip = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 34,
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${active ? "rgba(255,138,216,0.9)" : "rgba(255,200,150,0.28)"}`,
    background: active ? "linear-gradient(120deg, rgba(120,40,90,0.85), rgba(90,50,30,0.8))" : "rgba(18,10,20,0.62)",
    color: active ? "#ffe6f6" : "#f3dcc8",
    font: "12px system-ui, sans-serif",
    whiteSpace: "nowrap",
    cursor: "pointer",
    touchAction: "manipulation",
  });
  return (
    <div
      data-lelu-room-bar
      role="toolbar"
      aria-label="Her room"
      style={{
        position: "absolute",
        // left of the top-right controls (command palette, fullscreen), clear of the left rail
        left: mobile ? 12 : 96,
        // the top centre: the dock and the camera controls own the bottom
        top: mobile ? "calc(env(safe-area-inset-top, 0px) + 62px)" : 16,
        zIndex: 7,
        display: "flex",
        gap: 6,
        padding: 6,
        maxWidth: mobile ? "calc(100vw - 24px)" : "calc(100vw - 96px - 400px)",
        overflowX: "auto",
        borderRadius: 999,
        background: "rgba(10,6,14,0.45)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        pointerEvents: "auto",
      }}
    >
      {mobile && !open ? (
        <button type="button" style={chip(true)} onClick={() => setOpen(true)} aria-label="Turn her room">
          <span aria-hidden>{current.glyph}</span> {current.label}
        </button>
      ) : (
        items.map((i) => (
          <button
            key={i.id}
            type="button"
            style={chip(state.mode === i.id)}
            aria-pressed={state.mode === i.id}
            title={i.id === "plan" ? "See the whole room from above" : i.id === "stage" ? "Retract the furniture" : `Turn the room to the ${i.label.toLowerCase()}`}
            onClick={() => {
              RoomStore.goTo(i.id);
              if (mobile) setOpen(false);
            }}
          >
            <span aria-hidden>{i.glyph}</span> {i.label}
          </button>
        ))
      )}
    </div>
  );
}
