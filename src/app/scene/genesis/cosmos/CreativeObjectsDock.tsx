/**
 * ==========================================================
 * LÉLU — CREATIVE OBJECT DOCK
 *
 * The controls for the creative objects that are actually in the
 * Cosmos: build one locally, pick it, move/rotate/scale it, take
 * a component off, put it back, take the object out without
 * deleting it, and bring it back.
 *
 * It is an HTML panel, so the same buttons work with a mouse and
 * with a thumb: every control is at least 40 px tall and nothing
 * depends on hover. It writes through the same stores and the
 * same bridge the tools use — the panel is a view, not a second
 * authority.
 * ==========================================================
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import CreativeObjects, { type CreativeObject } from "../../../../core/couture/objects";
import { requestCreativeFocus } from "./creativeGesture";
import { garmentAssembly } from "../../../../core/couture/components";
import { buildGarment } from "../../../../core/couture/garment";
import { buildProduct } from "../../../../core/couture/product";
import CreativeObjectBridge from "../../../../core/cosmos/CreativeObjectBridge";
import {
  creativePlacementInFront,
  getCreativeSelection,
  getCreativeTool,
  selectCreativeObject,
  setCreativeTool,
  subscribeCreativeSelection,
  subscribeCreativeTool,
  type CreativeSelection,
  type CreativeTool,
} from "./creativeGesture";

const TOOLS: Array<{ id: CreativeTool; label: string }> = [
  { id: "select", label: "Select" },
  { id: "move", label: "Move" },
  { id: "rotate", label: "Rotate" },
  { id: "scale", label: "Scale" },
];

function button(active = false): CSSProperties {
  return {
    minHeight: 40,
    minWidth: 44,
    padding: "0 10px",
    borderRadius: 9,
    border: `1px solid ${active ? "rgba(56,189,248,0.75)" : "rgba(148,163,184,0.28)"}`,
    background: active ? "rgba(56,189,248,0.18)" : "rgba(15,23,42,0.72)",
    color: active ? "#e0f2fe" : "#cbd5f5",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.03em",
    cursor: "pointer",
    touchAction: "manipulation",
  };
}

export default function CreativeObjectsDock() {
  const store = CreativeObjects.getInstance();
  const [objects, setObjects] = useState<CreativeObject[]>(() => store.list({ location: "cosmos" }));
  const [selection, setSelection] = useState<CreativeSelection | null>(() => getCreativeSelection());
  const [tool, setTool] = useState<CreativeTool>(() => getCreativeTool());
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const update = () => setObjects(store.list({ location: "cosmos" }));
    update();
    const unsubStore = store.subscribe(update);
    const unsubSelection = subscribeCreativeSelection(setSelection);
    const unsubTool = subscribeCreativeTool(setTool);
    return () => {
      unsubStore();
      unsubSelection();
      unsubTool();
    };
  }, [store]);

  /**
   * Ask the scene to frame the object.
   *
   * The dock used to fly the camera itself, to a point 0.5 m from the object's
   * ORIGIN. For a chair the origin is the floor between its legs, so the seat
   * ended up above the frustum and "Focus" aimed at the floor. The layer owns
   * the meshes and the camera, so it computes the framing from the real
   * bounding box and drives the same camera bus.
   */
  const frame = useCallback((object: CreativeObject) => {
    requestCreativeFocus(object.id);
  }, []);

  const selected = selection ? store.get(selection.objectId) ?? null : null;
  const selectedComponent = selected && selection?.componentId
    ? selected.components.find((c) => c.id === selection.componentId) ?? null
    : null;

  const build = useCallback((kind: "gown" | "pendant" | "chair") => {
    // Place it where the person is looking, not at a fixed corner of the
    // universe: two metres ahead of the live eye, with a step sideways per
    // object so a second creation does not land on the first.
    const step = objects.length % 3;
    const spot = creativePlacementInFront(2.2, (step - 1) * 0.9) ?? ([0, -2600, 0] as [number, number, number]);
    setBusy(kind);
    setNotice(kind === "gown" ? "Drafting and simulating the gown locally…" : "Building geometry locally…");
    // Let the notice paint before the (synchronous) local build runs.
    window.setTimeout(() => {
      try {
        if (kind === "gown") {
          const style = { category: "gown" as const, sleeves: "long" as const, length: "floor" as const, silhouette: "fit-and-flare" as const, darts: true, waistSeam: true };
          const built = buildGarment({ name: "Cosmos gown", style, material: "velvet-silk", rows: 26, cols: 80, steps: 40, iterations: 6 });
          if (!built.ok || !built.garment) throw new Error(built.reason ?? "garment build failed");
          const assembly = garmentAssembly(built.garment);
          const object = store.create({ kind: "garment", name: "Cosmos gown", parts: assembly.parts, components: assembly.components, sockets: assembly.sockets, data: assembly.data, source: { tool: "creative-dock" } });
          const placed = CreativeObjectBridge.place(object.id, { position: spot });
          setNotice(placed.message);
          selectCreativeObject({ objectId: object.id });
          frame(object);
        } else if (kind === "pendant") {
          const built = buildProduct("pendant", { discDiameter: 26, stoneDiameter: 11, bezelWall: 1.4 });
          if (!built.ok || !built.assembly) throw new Error(built.reason ?? "pendant build failed");
          const object = store.create({ kind: "jewelry", name: "Copper pendant", parts: built.assembly.parts, components: built.assembly.components, sockets: built.assembly.sockets, data: { ...built.assembly.data, template: "pendant" }, transform: { rotation: [90, 0, 0] }, source: { tool: "creative-dock" } });
          const placed = CreativeObjectBridge.place(object.id, { position: spot });
          setNotice(placed.message);
          selectCreativeObject({ objectId: object.id });
          frame(object);
        } else {
          const built = buildProduct("chair", { seatWidth: 470 });
          if (!built.ok || !built.assembly) throw new Error(built.reason ?? "chair build failed");
          const object = store.create({ kind: "product", name: "Oak side chair", parts: built.assembly.parts, components: built.assembly.components, sockets: built.assembly.sockets, data: { ...built.assembly.data, template: "chair" }, source: { tool: "creative-dock" } });
          const placed = CreativeObjectBridge.place(object.id, { position: spot });
          setNotice(placed.message);
          selectCreativeObject({ objectId: object.id });
          frame(object);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    }, 30);
  }, [store, frame, objects.length]);

  const detach = useCallback(() => {
    if (!selected) return;
    const component = selectedComponent ?? selected.components.find((c) => c.status === "attached");
    if (!component) { setNotice("nothing to detach on this object"); return; }
    const result = store.detachComponent(selected.id, component.id);
    setNotice(result.message);
    if (result.object) selectCreativeObject({ objectId: result.object.id });
  }, [selected, selectedComponent, store]);

  const reattach = useCallback(() => {
    if (!selected) return;
    if (!selected.attachment) { setNotice("this object is not an extracted component"); return; }
    const result = store.attachComponent(selected.id, selected.attachment.parentObjectId);
    setNotice(result.message);
    if (result.object) selectCreativeObject({ objectId: result.object.id });
  }, [selected, store]);

  const remove = useCallback(() => {
    if (!selected) return;
    setNotice(CreativeObjectBridge.remove(selected.id).message);
    selectCreativeObject(null);
  }, [selected]);

  const restore = useCallback(() => {
    const target = selected ?? objects[0];
    if (!target) { setNotice("nothing to restore"); return; }
    setNotice(CreativeObjectBridge.place(target.id).message);
  }, [objects, selected]);

  const float = useCallback(() => {
    if (!selected) return;
    const next = selected.motion.kind === "spin" && !selected.motion.paused;
    store.setMotion(selected.id, next ? { paused: true } : { kind: "spin", speed: 4, paused: false });
    setNotice(next ? `${selected.name}: motion paused` : `${selected.name} floats`);
  }, [selected, store]);

  const parked = store.list({ location: "workspace", includeArchived: false }).filter((o) => o.kind !== "pattern-piece");

  return (
    <div
      data-lelu-creative-dock="ready"
      style={{
        position: "fixed",
        right: 12,
        bottom: 96,
        width: "min(320px, calc(100vw - 24px))",
        maxHeight: open ? "min(52vh, 420px)" : 46,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: 14,
        background: "rgba(6,14,32,0.94)",
        border: "1px solid rgba(56,189,248,0.28)",
        boxShadow: "0 18px 60px rgba(2,6,23,0.6)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        color: "#dbeafe",
        fontFamily: "system-ui, sans-serif",
        zIndex: 2147483000,
        // The interface root sets pointer-events: none so the scene stays
        // draggable through it; a panel that wants the press must say so.
        pointerEvents: "auto",
        overflowY: "auto",
        touchAction: "manipulation",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 24 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7dd3fc" }}>✦ Creative objects</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#64748b" }}>{objects.length} in cosmos</span>
          <button
            type="button"
            aria-label={open ? "Collapse creative objects" : "Expand creative objects"}
            style={{ ...button(), minHeight: 28, minWidth: 32, padding: "0 8px" }}
            onClick={() => setOpen((value) => !value)}
          >{open ? "–" : "✦"}</button>
        </span>
      </div>

      {!open ? null : (<>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" data-lelu-action="build-gown" style={button()} onClick={() => build("gown")} disabled={busy !== null}>{busy === "gown" ? "building…" : "Gown"}</button>
        <button type="button" data-lelu-action="build-pendant" style={button()} onClick={() => build("pendant")} disabled={busy !== null}>{busy === "pendant" ? "building…" : "Pendant"}</button>
        <button type="button" data-lelu-action="build-chair" style={button()} onClick={() => build("chair")} disabled={busy !== null}>{busy === "chair" ? "building…" : "Chair"}</button>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {TOOLS.map((entry) => (
          <button key={entry.id} type="button" data-lelu-action={`tool-${entry.id}`} style={{ ...button(tool === entry.id), flex: 1 }} onClick={() => setCreativeTool(entry.id)}>{entry.label}</button>
        ))}
      </div>

      {selected ? (
        <div data-lelu-creative-selection={selected.id} style={{ border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{selected.name}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {selected.kind} · rev {selected.revision} · {selected.parts.length} parts · {selected.components.length} components
          </div>
          <div style={{ fontSize: 10, color: "#7dd3fc" }}>
            {selectedComponent ? `selected component: ${selectedComponent.name} (${selectedComponent.kind})` : "tap a part to select its component"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" data-lelu-action="focus" style={button()} onClick={() => frame(selected)}>Focus</button>
            <button type="button" data-lelu-action="detach" style={button()} onClick={detach}>Detach</button>
            <button type="button" style={button()} onClick={reattach}>Reattach</button>
            <button type="button" style={button()} onClick={float}>{selected.motion.kind === "spin" && !selected.motion.paused ? "Pause" : "Float"}</button>
            <button type="button" style={button()} onClick={remove}>Take out</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "#94a3b8" }}>Tap a creation in the Cosmos to select it, or build one above.</div>
      )}

      {parked.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.12em" }}>Parked (kept)</span>
          {parked.slice(-4).map((object) => (
            <div key={object.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 10, color: "#cbd5f5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{object.name}</span>
              <button type="button" style={{ ...button(), minHeight: 34, minWidth: 56 }} onClick={() => setNotice(CreativeObjectBridge.place(object.id).message)}>Restore</button>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" style={{ ...button(), flex: 1 }} onClick={restore}>Restore selected</button>
        <button type="button" style={{ ...button(), flex: 1 }} onClick={() => { store.undo(); setNotice("undone"); }}>Undo</button>
      </div>

      {notice ? <div data-lelu-creative-notice="ready" style={{ fontSize: 10, color: "#a7f3d0", lineHeight: 1.35 }}>{notice}</div> : null}
      </>)}
    </div>
  );
}
