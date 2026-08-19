/**
 * ==========================================================
 * LÉLU
 * GENESIS RENDER PANEL — the Render workspace
 *
 * Finished visual creation + transformation, built around the
 * pluggable RenderEngineRegistry:
 *   - Local Canvas Engine  — real offline processing (filters,
 *     variations, product canvas, sketch renders)
 *   - Cloud engines        — PROVIDER-DEPENDENT slots that report
 *     honestly until an API key exists
 *
 * Inputs can come from the Sketch library, an uploaded image,
 * or a generated scene. Every successful render is saved to
 * the persistent RenderStore and can be attached to a project.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import RenderEngineRegistry, { type RenderEngine, type RenderKind } from "../../../core/creative/RenderEngine";
import RenderStore, { type RenderOutput } from "../../../core/creative/RenderStore";
import SketchStore, { type SketchDocument } from "../../../core/creative/SketchDocument";
import ProjectStore from "../../../core/projects/ProjectStore";

const fieldStyle: CSSProperties = {
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  padding: "7px 9px",
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
  padding: "7px 12px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
};

const FILTERS = ["grayscale", "sepia", "invert", "blur", "contrast", "brightness", "saturate", "hue", "pixelate"];
const VARIATIONS = ["mirror", "rotate", "crop-square"];

interface GenesisRenderPanelProps {
  onClose: () => void;
}

export default function GenesisRenderPanel({ onClose }: GenesisRenderPanelProps) {
  const registry = useMemo(() => RenderEngineRegistry.getInstance(), []);
  const store = useMemo(() => RenderStore.getInstance(), []);
  const sketches = useMemo(() => SketchStore.getInstance(), []);
  const projects = useMemo(() => ProjectStore.getInstance(), []);

  const [outputs, setOutputs] = useState<RenderOutput[]>(() => store.list());
  const [sketchList, setSketchList] = useState<SketchDocument[]>(() => sketches.list());

  const [sourceKind, setSourceKind] = useState<"sketch" | "image" | "scene">("scene");
  const [sketchId, setSketchId] = useState<string | null>(() => sketches.list()[0]?.id ?? null);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [engineId, setEngineId] = useState<string>("local-canvas");
  const [kind, setKind] = useState<RenderKind>("post");
  const [prompt, setPrompt] = useState("");
  const [filter, setFilter] = useState("grayscale");
  const [filterValue, setFilterValue] = useState(1.4);
  const [variationMode, setVariationMode] = useState("mirror");
  const [variationAngle, setVariationAngle] = useState(12);
  const [backdrop, setBackdrop] = useState("#111827");
  const [fromColor, setFromColor] = useState("#1e1b4b");
  const [toColor, setToColor] = useState("#0f172a");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output?: string; message: string } | null>(null);
  const [attachProject, setAttachProject] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return store.subscribe((next) => setOutputs(next));
  }, [store]);

  useEffect(() => {
    return sketches.subscribe((next) => setSketchList(next));
  }, [sketches]);

  const engines = registry.all();
  const engine = engines.find((item) => item.id === engineId) ?? engines[0];

  function pickEngine(next: RenderEngine) {
    setEngineId(next.id);
    const supported = next.supports;
    if (!supported.includes(kind)) {
      setKind(supported[0] ?? "post");
    }
  }

  function handleSourceFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setSourceImage(String(reader.result));
      setSourceKind("image");
    };
    reader.readAsDataURL(file);
  }

  async function handleRun() {
    if (!engine) {
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const sketch = sourceKind === "sketch" && sketchId ? sketches.get(sketchId) : undefined;
      const source = sourceKind === "image" ? sourceImage : undefined;
      const response = await registry.run({
        engine: engine.id,
        kind,
        prompt: prompt || undefined,
        sketch,
        source: source ?? undefined,
        params: {
          filter,
          value: filterValue,
          mode: variationMode,
          angle: variationAngle,
          backdrop,
          from: fromColor,
          to: toColor,
        },
      });
      setResult({ ok: response.ok, output: response.output, message: response.message });
      if (response.ok && response.output) {
        const saved = store.save({
          name: `${engine.name} · ${kind}${prompt ? ` — ${prompt.slice(0, 40)}` : ""}`,
          engine: engine.id,
          kind,
          prompt: prompt || "",
          output: response.output,
          projectId: attachProject || undefined,
        });
        if (attachProject) {
          projects.addItem(attachProject, {
            kind: "render",
            title: saved.name,
            ref: saved.output,
            assetIds: [saved.id],
          });
        }
      }
    } finally {
      setRunning(false);
    }
  }

  function download(dataUrl: string, name: string) {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Render Lab"
      title="Render · finished visuals"
      onClose={onClose}
      width="min(97vw, 1180px)"
      maxHeight="min(92vh, 940px)"
      elevation="focus"
    >
      <div style={{ display: "flex", gap: 14, minHeight: "min(72vh, 700px)" }}>
        {/* ---------------------------------------------- inputs */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            padding: 12,
            background: "rgba(255,255,255,0.03)",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>Source</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(
              [
                ["scene", "Scene"],
                ["sketch", "Sketch"],
                ["image", "Image"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSourceKind(id)}
                style={{
                  ...chipButton,
                  background: sourceKind === id ? "rgba(34, 211, 238, 0.16)" : "rgba(255,255,255,0.04)",
                  border: sourceKind === id ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {sourceKind === "sketch" ? (
            <select value={sketchId ?? ""} onChange={(event) => setSketchId(event.target.value)} style={fieldStyle}>
              {sketchList.length === 0 ? <option value="">No sketches yet</option> : null}
              {sketchList.map((sketch) => (
                <option key={sketch.id} value={sketch.id}>
                  {sketch.name}
                </option>
              ))}
            </select>
          ) : null}

          {sourceKind === "image" ? (
            <>
              <button type="button" onClick={() => fileRef.current?.click()} style={chipButton}>
                {sourceImage ? "Replace image" : "Upload image"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleSourceFile(file);
                  }
                  event.target.value = "";
                }}
              />
              {sourceImage ? (
                <img
                  src={sourceImage}
                  alt="Source"
                  style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", maxHeight: 140, objectFit: "cover" }}
                />
              ) : null}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 10.5, opacity: 0.6 }}>From</span>
                <input type="color" value={fromColor} onChange={(event) => setFromColor(event.target.value)} style={{ width: 34, height: 26, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
                <span style={{ fontSize: 10.5, opacity: 0.6 }}>To</span>
                <input type="color" value={toColor} onChange={(event) => setToColor(event.target.value)} style={{ width: 34, height: 26, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
              </div>
            </div>
          )}

          <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>Engine</div>
          {engines.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pickEngine(item)}
              style={{
                textAlign: "left",
                borderRadius: 10,
                padding: "9px 11px",
                border: engineId === item.id ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.1)",
                background: engineId === item.id ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.03)",
                color: "white",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</span>
                <span
                  style={{
                    fontSize: 9,
                    borderRadius: 999,
                    padding: "2px 7px",
                    background: item.offline ? "rgba(74,222,128,0.16)" : "rgba(250,204,21,0.16)",
                  }}
                >
                  {item.offline ? "offline" : "provider-dependent"}
                </span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 3, lineHeight: 1.4 }}>{item.description}</div>
            </button>
          ))}

          <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>Operation</div>
          <select value={kind} onChange={(event) => setKind(event.target.value as RenderKind)} style={fieldStyle}>
            {engine?.supports.map((supported) => (
              <option key={supported} value={supported}>
                {supported}
              </option>
            ))}
          </select>

          {kind === "post" ? (
            <>
              <select value={filter} onChange={(event) => setFilter(event.target.value)} style={fieldStyle}>
                {FILTERS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <label style={{ fontSize: 11, opacity: 0.7 }}>
                Strength: {filterValue}
                <input
                  type="range"
                  min={0.2}
                  max={3}
                  step={0.1}
                  value={filterValue}
                  onChange={(event) => setFilterValue(Number(event.target.value))}
                  style={{ width: "100%", display: "block" }}
                />
              </label>
            </>
          ) : null}

          {kind === "variation" ? (
            <>
              <select value={variationMode} onChange={(event) => setVariationMode(event.target.value)} style={fieldStyle}>
                {VARIATIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              {variationMode === "rotate" ? (
                <label style={{ fontSize: 11, opacity: 0.7 }}>
                  Angle: {variationAngle}°
                  <input
                    type="range"
                    min={-45}
                    max={45}
                    value={variationAngle}
                    onChange={(event) => setVariationAngle(Number(event.target.value))}
                    style={{ width: "100%", display: "block" }}
                  />
                </label>
              ) : null}
            </>
          ) : null}

          {kind === "visualize" ? (
            <label style={{ fontSize: 11, opacity: 0.7, display: "flex", alignItems: "center", gap: 8 }}>
              Backdrop
              <input type="color" value={backdrop} onChange={(event) => setBackdrop(event.target.value)} style={{ width: 40, height: 28, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
            </label>
          ) : null}

          {kind === "generate" || kind === "edit" ? (
            <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the output…" style={fieldStyle} />
          ) : null}

          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running || (sourceKind === "image" && !sourceImage)}
            style={{
              ...chipButton,
              background: "rgba(34, 211, 238, 0.22)",
              border: "1px solid rgba(125, 211, 252, 0.5)",
              padding: "10px 14px",
              opacity: running ? 0.6 : 1,
            }}
          >
            {running ? "Rendering…" : `Run ${engine?.name ?? "engine"}`}
          </button>

          <label style={{ fontSize: 11, opacity: 0.7, display: "flex", flexDirection: "column", gap: 4 }}>
            Attach result to project
            <select value={attachProject} onChange={(event) => setAttachProject(event.target.value)} style={fieldStyle}>
              <option value="">None</option>
              {projects.list().map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ---------------------------------------------- output */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {result ? (
            <div
              style={{
                border: result.ok ? "1px solid rgba(74,222,128,0.35)" : "1px solid rgba(248,113,113,0.4)",
                borderRadius: 14,
                padding: 12,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ fontSize: 12, marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: result.ok ? "#86efac" : "#fca5a5" }}>{result.ok ? "✓" : "✕"}</span>
                <span style={{ opacity: 0.85 }}>{result.message}</span>
              </div>
              {result.output ? (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <img
                    src={result.output}
                    alt="Render result"
                    style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", objectFit: "contain" }}
                  />
                  <button type="button" onClick={() => download(result.output!, "lelu-render.png")} style={chipButton}>
                    ⬇ Download
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div
              style={{
                border: "1px dashed rgba(255,255,255,0.14)",
                borderRadius: 14,
                padding: "40px 20px",
                textAlign: "center",
                opacity: 0.55,
                fontSize: 12.5,
              }}
            >
              Choose a source and an operation, then run the engine. The local engine works fully offline; cloud engines need API keys.
            </div>
          )}

          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
            Gallery · {outputs.length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, overflowY: "auto", maxHeight: "min(46vh, 420px)", paddingBottom: 4 }}>
            {outputs.map((output) => (
              <div
                key={output.id}
                style={{
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <img src={output.output} alt={output.name} style={{ width: "100%", height: 110, objectFit: "cover", display: "block", cursor: "zoom-in" }} onClick={() => setResult({ ok: true, output: output.output, message: output.name })} />
                <div style={{ padding: "7px 9px" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{output.name}</div>
                  <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 2 }}>
                    {new Date(output.createdAt).toLocaleString()} {output.projectId ? "· in project" : ""}
                  </div>
                </div>
              </div>
            ))}
            {outputs.length === 0 ? <div style={{ fontSize: 12, opacity: 0.5 }}>No renders yet.</div> : null}
          </div>
        </div>
      </div>
    </GenesisWindowFrame>
  );
}
