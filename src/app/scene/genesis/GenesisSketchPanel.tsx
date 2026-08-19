/**
 * ==========================================================
 * LÉLU
 * GENESIS SKETCH PANEL — the Sketch workspace
 *
 * A full offline canvas editor driven by the SketchDocument
 * model: pencil/pen/brush/eraser/shapes/line/fill, layers,
 * opacity, undo/redo, color picker, text, image import, zoom,
 * pan (scroll), canvas resize, autosave, and PNG/JPG/SVG
 * export. Works with zero network.
 *
 * The LÉLU draw bar at the bottom routes natural-language
 * commands through CreativeToolInterface — cognition drives
 * the canvas through the tool layer, never the DOM.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import SketchStore, {
  preloadSketchImages,
  renderDocumentToCanvas,
  exportDocument,
  type SketchDocument,
  type SketchLayer,
  type SketchStroke,
  type SketchElement,
  type SketchStrokeTool,
} from "../../../core/creative/SketchDocument";
import { executeToolCommand, toolCommandExamples } from "../../../core/creative/CreativeToolInterface";

const fieldStyle: CSSProperties = {
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "white",
  fontSize: 12,
  outline: "none",
  fontFamily: "inherit",
};

const chipButton: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "6px 10px",
  fontSize: 11.5,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const TOOLS: { id: SketchStrokeTool | "rect" | "ellipse" | "fill" | "text"; label: string; glyph: string }[] = [
  { id: "pencil", label: "Pencil", glyph: "✏" },
  { id: "pen", label: "Pen", glyph: "🖊" },
  { id: "brush", label: "Brush", glyph: "🖌" },
  { id: "eraser", label: "Eraser", glyph: "◻" },
  { id: "line", label: "Line", glyph: "╱" },
  { id: "rect", label: "Rect", glyph: "▭" },
  { id: "ellipse", label: "Ellipse", glyph: "◯" },
  { id: "fill", label: "Fill", glyph: "▦" },
  { id: "text", label: "Text", glyph: "T" },
];

const SWATCHES = ["#f4f4f5", "#d4a94e", "#b87333", "#8a6d3b", "#34d399", "#22d3ee", "#a78bfa", "#e879c9", "#f87171", "#0a0a0a"];

interface GenesisSketchPanelProps {
  onClose: () => void;
}

type ToolId = (typeof TOOLS)[number]["id"];

export default function GenesisSketchPanel({ onClose }: GenesisSketchPanelProps) {
  const store = useMemo(() => SketchStore.getInstance(), []);
  const [docs, setDocs] = useState<SketchDocument[]>(() => store.list());
  const [docId, setDocId] = useState<string | null>(() => store.list()[0]?.id ?? null);
  const [doc, setDoc] = useState<SketchDocument | null>(() => store.list()[0] ?? null);

  const [tool, setTool] = useState<ToolId>("pencil");
  const [color, setColor] = useState("#d4a94e");
  const [brushSize, setBrushSize] = useState(2.5);
  const [opacity, setOpacity] = useState(0.9);
  const [zoom, setZoom] = useState(0.6);
  const [command, setCommand] = useState("");
  const [commandResult, setCommandResult] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 900 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveStrokeRef = useRef<SketchStroke | null>(null);
  const drawingRef = useRef(false);
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);

  useEffect(() => {
    const unsub = store.subscribe((next) => setDocs(next));
    return unsub;
  }, [store]);

  // Resolve the active document whenever the id changes.
  useEffect(() => {
    const next = docId ? store.get(docId) ?? null : null;
    setDoc(next);
    if (next) {
      setCanvasSize({ width: next.width, height: next.height });
      void preloadSketchImages(next).then(() => redraw());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, store]);

  // Redraw on every document mutation.
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, tool, color, brushSize, opacity]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) {
      return;
    }
    const live = liveStrokeRef.current;
    const view = live
      ? {
          ...doc,
          layers: doc.layers.map((layer) =>
            layer.id === doc.activeLayerId ? { ...layer, elements: [...layer.elements, live] } : layer,
          ),
        }
      : doc;
    const rendered = renderDocumentToCanvas(view);
    if (!rendered) {
      return;
    }
    canvas.width = doc.width;
    canvas.height = doc.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(rendered, 0, 0);
    }
  }, [doc]);

  const commit = useCallback(() => {
    // Push an undo snapshot for the committed state (before the new op).
    if (doc) {
      undoRef.current.push(JSON.stringify({ layers: doc.layers, activeLayerId: doc.activeLayerId }));
      if (undoRef.current.length > 50) {
        undoRef.current.shift();
      }
      redoRef.current = [];
    }
  }, [doc]);

  function mutate(next: SketchDocument, autosave = true) {
    setDoc(next);
    if (autosave) {
      store.save(next);
      setSavedAt(new Date().toLocaleTimeString());
    }
  }

  function snapshotState(): string {
    return doc ? JSON.stringify({ layers: doc.layers, activeLayerId: doc.activeLayerId }) : "";
  }

  function undo() {
    if (!doc || undoRef.current.length === 0) {
      return;
    }
    redoRef.current.push(snapshotState());
    const previous = undoRef.current.pop();
    if (!previous) {
      return;
    }
    const parsed = JSON.parse(previous) as Pick<SketchDocument, "layers" | "activeLayerId">;
    mutate({ ...doc, layers: parsed.layers, activeLayerId: parsed.activeLayerId }, false);
    store.save({ ...doc, layers: parsed.layers, activeLayerId: parsed.activeLayerId });
    setSavedAt(new Date().toLocaleTimeString());
  }

  function redo() {
    if (!doc || redoRef.current.length === 0) {
      return;
    }
    undoRef.current.push(snapshotState());
    const next = redoRef.current.pop();
    if (!next) {
      return;
    }
    const parsed = JSON.parse(next) as Pick<SketchDocument, "layers" | "activeLayerId">;
    mutate({ ...doc, layers: parsed.layers, activeLayerId: parsed.activeLayerId }, false);
    store.save({ ...doc, layers: parsed.layers, activeLayerId: parsed.activeLayerId });
    setSavedAt(new Date().toLocaleTimeString());
  }

  /* ------------------------------ pointer drawing ------------------------------ */

  function activeLayerOf(d: SketchDocument): SketchLayer | undefined {
    return d.layers.find((layer) => layer.id === d.activeLayerId);
  }

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!doc) {
      return;
    }
    const layer = activeLayerOf(doc);
    if (!layer || layer.locked) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = canvasPoint(event);

    if (tool === "text") {
      const text = window.prompt("Text to place on the canvas:");
      if (text && text.trim()) {
        commit();
        const element: SketchElement = {
          id: `tx-${crypto.randomUUID().slice(0, 8)}`,
          kind: "text",
          text: text.trim(),
          x: point.x,
          y: point.y,
          color,
          fontSize: Math.max(14, brushSize * 6),
        };
        const next: SketchDocument = {
          ...doc,
          layers: doc.layers.map((item) => (item.id === layer.id ? { ...item, elements: [...item.elements, element] } : item)),
        };
        mutate(next);
      }
      return;
    }

    if (tool === "fill") {
      commit();
      const stroke: SketchStroke = {
        id: `st-${crypto.randomUUID().slice(0, 8)}`,
        kind: "stroke",
        tool: "line",
        color,
        size: brushSize,
        opacity,
        points: [point, { x: point.x + 160, y: point.y + 120 }],
        shape: "rect",
        erase: false,
        fill: true,
      };
      const next: SketchDocument = {
        ...doc,
        layers: doc.layers.map((item) => (item.id === layer.id ? { ...item, elements: [...item.elements, stroke] } : item)),
      };
      mutate(next);
      return;
    }

    drawingRef.current = true;
    const erase = tool === "eraser";
    const shape = tool === "rect" || tool === "ellipse" ? tool : undefined;
    const stroke: SketchStroke = {
      id: `st-${crypto.randomUUID().slice(0, 8)}`,
      kind: "stroke",
      tool: (tool === "rect" || tool === "ellipse" ? "line" : tool) as SketchStrokeTool,
      color,
      size: erase ? brushSize * 4 : brushSize,
      opacity: erase ? 1 : opacity,
      points: [point],
      shape,
      erase,
    };
    liveStrokeRef.current = stroke;
    redraw();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !liveStrokeRef.current || !doc) {
      return;
    }
    const point = canvasPoint(event);
    const live = liveStrokeRef.current;
    if (live.shape) {
      // Shape tools: [start, current] live preview.
      live.points = [live.points[0], point];
    } else {
      live.points.push(point);
    }
    redraw();
  }

  function handlePointerUp() {
    if (!drawingRef.current || !liveStrokeRef.current || !doc) {
      drawingRef.current = false;
      liveStrokeRef.current = null;
      return;
    }
    const stroke = liveStrokeRef.current;
    liveStrokeRef.current = null;
    drawingRef.current = false;
    if (stroke.points.length === 0) {
      return;
    }
    commit();
    const layer = activeLayerOf(doc);
    if (!layer) {
      return;
    }
    const next: SketchDocument = {
      ...doc,
      layers: doc.layers.map((item) => (item.id === layer.id ? { ...item, elements: [...item.elements, stroke] } : item)),
    };
    mutate(next);
  }

  /* ------------------------------ layers ------------------------------ */

  function addLayer() {
    if (!doc) {
      return;
    }
    commit();
    const layer: SketchLayer = {
      id: `layer-${crypto.randomUUID().slice(0, 8)}`,
      name: `Layer ${doc.layers.length + 1}`,
      visible: true,
      opacity: 1,
      locked: false,
      elements: [],
    };
    mutate({ ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id });
  }

  function updateLayer(layerId: string, patch: Partial<SketchLayer>, recordUndo = true) {
    if (!doc) {
      return;
    }
    if (recordUndo) {
      commit();
    }
    mutate({
      ...doc,
      layers: doc.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
    });
  }

  function removeLayer(layerId: string) {
    if (!doc || doc.layers.length <= 1) {
      return;
    }
    commit();
    const layers = doc.layers.filter((layer) => layer.id !== layerId);
    mutate({ ...doc, layers, activeLayerId: layers[layers.length - 1]?.id ?? layerId });
  }

  function moveLayer(layerId: string, direction: -1 | 1) {
    if (!doc) {
      return;
    }
    commit();
    const index = doc.layers.findIndex((layer) => layer.id === layerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= doc.layers.length) {
      return;
    }
    const layers = [...doc.layers];
    const [layer] = layers.splice(index, 1);
    layers.splice(target, 0, layer);
    mutate({ ...doc, layers });
  }

  /* ------------------------------ canvas ------------------------------ */

  function applyCanvasSize() {
    if (!doc) {
      return;
    }
    commit();
    const width = Math.max(320, Math.min(4096, canvasSize.width || 1200));
    const height = Math.max(240, Math.min(4096, canvasSize.height || 900));
    mutate({ ...doc, width, height });
    setCanvasSize({ width, height });
  }

  function exportAs(format: "png" | "jpg" | "svg") {
    if (!doc) {
      return;
    }
    const dataUrl = exportDocument(doc, format);
    if (!dataUrl) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `${doc.name.replace(/[^\w\d-]+/g, "-").toLowerCase()}.${format === "jpg" ? "jpg" : format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function handleImportImage(file: File) {
    if (!doc) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const image = new Image();
      image.onload = () => {
        commit();
        const scale = Math.min(1, (doc.width * 0.5) / image.naturalWidth, (doc.height * 0.5) / image.naturalHeight);
        const element: SketchElement = {
          id: `img-${crypto.randomUUID().slice(0, 8)}`,
          kind: "image",
          x: (doc.width - image.naturalWidth * scale) / 2,
          y: (doc.height - image.naturalHeight * scale) / 2,
          width: Math.round(image.naturalWidth * scale),
          height: Math.round(image.naturalHeight * scale),
          dataUrl,
        };
        const layer = activeLayerOf(doc);
        if (!layer) {
          return;
        }
        const next: SketchDocument = {
          ...doc,
          layers: doc.layers.map((item) => (item.id === layer.id ? { ...item, elements: [...item.elements, element] } : item)),
        };
        mutate(next);
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleDrawCommand() {
    if (!doc || !command.trim()) {
      return;
    }
    const result = executeToolCommand({ command, document: doc, autosave: true });
    setCommandResult(result.ok ? `✓ ${result.message}` : result.message);
    setDoc(result.document);
    setSavedAt(new Date().toLocaleTimeString());
    setCommand("");
  }

  function selectTool(nextTool: ToolId) {
    setTool(nextTool);
    if (nextTool === "brush") {
      setBrushSize(8);
      setOpacity(0.55);
    } else if (nextTool === "pen") {
      setBrushSize(1.8);
      setOpacity(1);
    } else if (nextTool === "pencil") {
      setBrushSize(2.5);
      setOpacity(0.9);
    } else if (nextTool === "eraser") {
      setBrushSize(14);
      setOpacity(1);
    }
  }

  function createDocument() {
    const name = window.prompt("Sketch name:", `Sketch ${docs.length + 1}`)?.trim() || `Sketch ${docs.length + 1}`;
    const created = store.create(name);
    setDocId(created.id);
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Creation Studio"
      title={doc ? <>Sketch · {doc.name}</> : "Sketch"}
      onClose={onClose}
      width="min(97vw, 1240px)"
      maxHeight="min(92vh, 980px)"
      elevation="focus"
      overflow="hidden"
      extraActions={
        <button type="button" onClick={createDocument} style={chipButton}>
          ＋ New
        </button>
      }
    >
      {!doc ? (
        <div style={{ padding: "30px 0", textAlign: "center", opacity: 0.7, fontSize: 13 }}>
          No sketch open. Create one, or pick one from the library.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, height: "min(78vh, 860px)" }}>
          {/* toolbar */}
          <div
            style={{
              width: 64,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: 10,
              background: "rgba(255,255,255,0.03)",
              overflowY: "auto",
            }}
          >
            {TOOLS.map((item) => {
              const active = tool === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  onClick={() => selectTool(item.id)}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 10,
                    border: active ? "1px solid rgba(125, 211, 252, 0.5)" : "1px solid transparent",
                    background: active ? "rgba(34, 211, 238, 0.16)" : "transparent",
                    color: active ? "#9be8ff" : "rgba(214,228,244,0.75)",
                    fontSize: 15,
                    cursor: "pointer",
                  }}
                >
                  {item.glyph}
                </button>
              );
            })}
            <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    background: swatch,
                    border: color === swatch ? "2px solid white" : "1px solid rgba(255,255,255,0.25)",
                    cursor: "pointer",
                  }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                title="Custom color"
                style={{ width: 28, height: 28, border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
              />
            </div>
            <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
            <label style={{ fontSize: 9.5, opacity: 0.6, textAlign: "center" }}>
              Size
              <input
                type="range"
                min={1}
                max={48}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                style={{ width: 44 }}
              />
            </label>
            <label style={{ fontSize: 9.5, opacity: 0.6, textAlign: "center" }}>
              Opacity
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
                style={{ width: 44 }}
              />
            </label>
            <label style={{ fontSize: 9.5, opacity: 0.6, textAlign: "center" }}>
              Zoom
              <input
                type="range"
                min={0.2}
                max={2}
                step={0.1}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                style={{ width: 44 }}
              />
            </label>
            <button type="button" onClick={undo} style={chipButton} title="Undo">
              ↩ Undo
            </button>
            <button type="button" onClick={redo} style={chipButton} title="Redo">
              ↪ Redo
            </button>
          </div>

          {/* canvas */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              overflow: "auto",
              background: "rgba(2,6,23,0.55)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              padding: 16,
              position: "relative",
            }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              style={{
                width: doc.width * zoom,
                height: doc.height * zoom,
                borderRadius: 8,
                boxShadow: "0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
                cursor: tool === "text" ? "text" : "crosshair",
                touchAction: "none",
                flexShrink: 0,
              }}
            />
          </div>

          {/* layers + export */}
          <div
            style={{
              width: 200,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: 10,
              background: "rgba(255,255,255,0.03)",
              overflowY: "auto",
            }}
          >
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
              Layers
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={addLayer} style={chipButton}>
                ＋ Layer
              </button>
              <button
                type="button"
                onClick={() => {
                  const layer = activeLayerOf(doc);
                  if (layer) {
                    const name = window.prompt("Layer name:", layer.name);
                    if (name?.trim()) {
                      updateLayer(layer.id, { name: name.trim() });
                    }
                  }
                }}
                style={chipButton}
              >
                Rename
              </button>
            </div>
            {[...doc.layers].reverse().map((layer) => {
              const active = layer.id === doc.activeLayerId;
              return (
                <div
                  key={layer.id}
                  style={{
                    border: active ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    background: active ? "rgba(34, 211, 238, 0.08)" : "rgba(255,255,255,0.02)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => updateLayer(layer.id, { visible: !layer.visible }, false)}
                      title={layer.visible ? "Hide" : "Show"}
                      style={{ border: "none", background: "none", color: layer.visible ? "#9be8ff" : "rgba(160,178,200,0.5)", cursor: "pointer", fontSize: 12 }}
                    >
                      {layer.visible ? "◉" : "○"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDoc({ ...doc, activeLayerId: layer.id })}
                      style={{
                        border: "none",
                        background: "none",
                        color: "white",
                        fontSize: 12,
                        cursor: "pointer",
                        textAlign: "left",
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        opacity: layer.locked ? 0.5 : 1,
                      }}
                    >
                      {layer.locked ? "🔒 " : ""}
                      {layer.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateLayer(layer.id, { locked: !layer.locked }, false)}
                      title="Lock"
                      style={{ border: "none", background: "none", color: "rgba(160,178,200,0.6)", cursor: "pointer", fontSize: 11 }}
                    >
                      {layer.locked ? "🔓" : "🔒"}
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={layer.opacity}
                      onChange={(event) => updateLayer(layer.id, { opacity: Number(event.target.value) }, false)}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 9.5, opacity: 0.6, width: 28 }}>{Math.round(layer.opacity * 100)}%</span>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                    <button type="button" onClick={() => moveLayer(layer.id, -1)} style={{ ...chipButton, fontSize: 10, padding: "3px 7px" }}>
                      ▲
                    </button>
                    <button type="button" onClick={() => moveLayer(layer.id, 1)} style={{ ...chipButton, fontSize: 10, padding: "3px 7px" }}>
                      ▼
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const source = layer;
                        const copy: SketchLayer = { ...structuredClone(source), id: `layer-${crypto.randomUUID().slice(0, 8)}`, name: `${source.name} copy` };
                        setDoc({ ...doc, layers: [...doc.layers, copy], activeLayerId: copy.id });
                      }}
                      style={{ ...chipButton, fontSize: 10, padding: "3px 7px" }}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLayer(layer.id)}
                      style={{ ...chipButton, fontSize: 10, padding: "3px 7px", color: "#fca5a5" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}

            <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
              Canvas
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="number"
                value={canvasSize.width}
                min={320}
                max={4096}
                onChange={(event) => setCanvasSize({ ...canvasSize, width: Number(event.target.value) })}
                style={{ ...fieldStyle, width: "50%" }}
              />
              <input
                type="number"
                value={canvasSize.height}
                min={240}
                max={4096}
                onChange={(event) => setCanvasSize({ ...canvasSize, height: Number(event.target.value) })}
                style={{ ...fieldStyle, width: "50%" }}
              />
            </div>
            <button type="button" onClick={applyCanvasSize} style={chipButton}>
              Apply size
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10.5, opacity: 0.6 }}>BG</span>
              <input
                type="color"
                value={doc.background}
                onChange={(event) => {
                  commit();
                  mutate({ ...doc, background: event.target.value });
                }}
                style={{ border: "none", background: "none", cursor: "pointer", width: 30, height: 26, padding: 0 }}
              />
            </div>

            <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
              Import / Export
            </div>
            <label style={{ ...chipButton, textAlign: "center", cursor: "pointer" }}>
              🖼 Import image
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleImportImage(file);
                  }
                  event.target.value = "";
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => exportAs("png")} style={chipButton}>
                PNG
              </button>
              <button type="button" onClick={() => exportAs("jpg")} style={chipButton}>
                JPG
              </button>
              <button type="button" onClick={() => exportAs("svg")} style={chipButton}>
                SVG
              </button>
            </div>
            {savedAt ? (
              <div style={{ fontSize: 10, opacity: 0.5 }}>Autosaved {savedAt}</div>
            ) : null}
          </div>

          {/* LÉLU draw bar */}
          <div
            style={{
              position: "absolute",
              left: 92,
              right: 228,
              bottom: 14,
              display: "flex",
              gap: 8,
              alignItems: "center",
              zIndex: 5,
            }}
          >
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleDrawCommand();
                }
              }}
              placeholder="Lélu, draw a concept for a copper hoodie… (add layer, annotate, shapes, resize…)"
              style={{
                ...fieldStyle,
                flex: 1,
                background: "rgba(2,6,23,0.82)",
                border: "1px solid rgba(125, 211, 252, 0.35)",
                backdropFilter: "blur(12px)",
                padding: "10px 12px",
              }}
            />
            <button
              type="button"
              onClick={handleDrawCommand}
              style={{
                ...chipButton,
                background: "rgba(34, 211, 238, 0.22)",
                border: "1px solid rgba(125, 211, 252, 0.5)",
                padding: "10px 14px",
              }}
            >
              ⚡ Draw
            </button>
          </div>
          {commandResult ? (
            <div
              style={{
                position: "absolute",
                left: 92,
                right: 228,
                bottom: 58,
                fontSize: 11.5,
                background: "rgba(2,6,23,0.85)",
                border: "1px solid rgba(125, 211, 252, 0.3)",
                borderRadius: 10,
                padding: "8px 12px",
                zIndex: 5,
              }}
            >
              {commandResult}
              <button
                type="button"
                onClick={() => setCommandResult(null)}
                style={{ border: "none", background: "none", color: "rgba(160,178,200,0.7)", cursor: "pointer", marginLeft: 8, fontSize: 11 }}
              >
                ✕
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* document library */}
      {docs.length > 1 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {docs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDocId(item.id)}
              style={{
                ...chipButton,
                background: item.id === doc?.id ? "rgba(34, 211, 238, 0.16)" : "rgba(255,255,255,0.04)",
                border: item.id === doc?.id ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {item.name}
            </button>
          ))}
          <span style={{ fontSize: 10.5, opacity: 0.45, alignSelf: "center" }}>
            Try: {toolCommandExamples().slice(0, 3).join(" · ")}
          </span>
        </div>
      ) : null}
    </GenesisWindowFrame>
  );
}
