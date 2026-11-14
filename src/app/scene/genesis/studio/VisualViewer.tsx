/**
 * LÉLU — a "visual" artifact (or an Excalidraw drawing's file exports)
 * inside its Creation Studio window.
 *
 *   generative  the SVG itself
 *   chart       the interactive page (scripts allowed, no same-origin)
 *   diagram     Mermaid-rendered SVG (strict security level)
 *   scene3d     a live three.js view: WebGL2 by default, WebGPU on request
 *   video       render on this device, then play it here
 *
 * Every export button writes the file, re-reads it, and only then saves it.
 * This module (and three / mermaid / mediabunny) loads only when a visual opens.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Film, Loader2, TriangleAlert } from "lucide-react";
import type { StudioArtifact } from "../../../../core/studio/StudioStore";
import type { DrawingSpec, VisualSpec } from "../../../../core/studio/StudioTypes";
import { VISUAL_FORMATS, saveFile, visualPreviewHtml, type VisualFormat } from "../../../../core/creative/kit/VisualArtifacts";
import { exportArtifactFile, visualFile } from "../../../../core/creative/kit/CreativeKitTools";
import { renderDiagramSvg, type DiagramProgram } from "../../../../core/creative/kit/Diagram";
import { vizHtml, type VizProgram } from "../../../../core/creative/kit/InteractiveViz";
import type { Scene3DProgram } from "../../../../core/creative/kit/Scene3D";
import { renderFilm, type VideoProgram } from "../../../../core/creative/kit/VideoComposer";
import { capabilities } from "../../../../core/creative/kit/BrowserCapabilities";

export default function VisualViewer({ artifact, rev, spec }: { artifact: StudioArtifact; rev: number; spec: VisualSpec | DrawingSpec }) {
  const formats = (spec.kind === "drawing" ? VISUAL_FORMATS.drawing : VISUAL_FORMATS[spec.medium]) as VisualFormat[];
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const doExport = async (format: VisualFormat) => {
    setBusy(format);
    setReport(null);
    const r = await exportArtifactFile(artifact, format, rev);
    setBusy(null);
    setReport(r.line);
    const file = visualFile(artifact.id, rev, format);
    if (r.ok && file) await saveFile(file.bytes, file.filename, file.mime);
  };

  return (
    <div className="lst-visual" data-lelu-visual={spec.kind === "drawing" ? "drawing" : spec.medium}>
      {spec.kind === "visual" ? <VisualBody spec={spec} /> : null}
      <div className="lst-toolbar" aria-label="Export">
        {formats.map((f) => (
          <button key={f} type="button" className="lst-btn" disabled={busy !== null} onClick={() => void doExport(f)} data-lelu-visual-export={f}>
            {busy === f ? <Loader2 size={13} className="spin" aria-hidden /> : <Download size={13} aria-hidden />} {f.toUpperCase()}
          </button>
        ))}
      </div>
      {report ? <pre className={`lst-visual-report ${report.startsWith("✓") ? "ok" : "bad"}`} data-lelu-visual-report>{report}</pre> : null}
    </div>
  );
}

function VisualBody({ spec }: { spec: VisualSpec }) {
  if (spec.medium === "chart") return <iframe className="lst-preview" title={`Interactive ${spec.title}`} sandbox="allow-scripts" srcDoc={vizHtml(spec.program as unknown as VizProgram)} />;
  if (spec.medium === "diagram") return <DiagramView program={spec.program as unknown as DiagramProgram} />;
  if (spec.medium === "scene3d") return <SceneView program={spec.program as unknown as Scene3DProgram} />;
  if (spec.medium === "video") return <FilmView program={spec.program as unknown as VideoProgram} title={spec.title} />;
  return <iframe className="lst-preview" title={spec.title} sandbox="" srcDoc={visualPreviewHtml(spec)} />;
}

function DiagramView({ program }: { program: DiagramProgram }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void renderDiagramSvg(program).then((r) => { if (!live) return; if (r.ok) setSvg(r.svg); else setError(r.reason); });
    return () => { live = false; };
  }, [program]);
  if (error) return <div className="lst-error" role="alert"><TriangleAlert size={14} aria-hidden /> Mermaid could not draw it: {error}<pre>{program.source}</pre></div>;
  if (!svg) return <p className="lst-note" role="status">Drawing the diagram…</p>;
  // Mermaid's strict security level sanitises labels; the SVG is its own output.
  return <div className="lst-diagram" data-lelu-diagram-rendered dangerouslySetInnerHTML={{ __html: svg }} />;
}

function SceneView({ program }: { program: Scene3DProgram }) {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"webgl2" | "webgpu">("webgl2");
  const [gpuOk, setGpuOk] = useState(false);
  const [info, setInfo] = useState("Building the scene…");
  useEffect(() => { void capabilities().then((c) => setGpuOk(c.gpu.webgpu.available)); }, []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const { buildScene, disposeScene } = await import("../../../../core/creative/kit/Scene3D");
      const T = (mode === "webgpu" ? await import("three/webgpu") : await import("three")) as unknown as typeof import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;
      const built = buildScene(program, T);
      let renderer: { setSize: (w: number, h: number) => void; setPixelRatio: (r: number) => void; render: (s: unknown, c: unknown) => void; dispose: () => void; domElement: HTMLCanvasElement; setAnimationLoop: (f: ((t: number) => void) | null) => void; init?: () => Promise<void> };
      if (mode === "webgpu") {
        const W = T as unknown as { WebGPURenderer: new (o: unknown) => typeof renderer };
        renderer = new W.WebGPURenderer({ antialias: true });
        await renderer.init?.();
      } else {
        renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }) as unknown as typeof renderer;
      }
      if (disposed) { renderer.dispose(); return; }
      const w = el.clientWidth || 640, h = Math.round(w * 9 / 16);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(w, h);
      el.appendChild(renderer.domElement);
      built.camera.aspect = w / h;
      built.camera.updateProjectionMatrix();
      const controls = new OrbitControls(built.camera as never, renderer.domElement);
      controls.target.set(...program.camera.target);
      controls.update();
      const mixer = built.clips.length ? new T.AnimationMixer(built.scene) : null;
      if (mixer) for (const clip of built.clips) mixer.clipAction(clip).play();
      const clock = new T.Clock();
      renderer.setAnimationLoop(() => { mixer?.update(clock.getDelta()); controls.update(); renderer.render(built.scene, built.camera); });
      setInfo(`${mode === "webgpu" ? "WebGPU" : "WebGL2"} · ${built.stats.meshes} meshes · ${built.stats.triangles.toLocaleString()} triangles · ${built.stats.lights} lights${built.clips.length ? " · animated" : ""} — drag to orbit`);
      cleanup = () => { renderer.setAnimationLoop(null); controls.dispose(); disposeScene(built.scene); renderer.dispose(); renderer.domElement.remove(); };
    })().catch((error) => setInfo(`The live view could not start (${error instanceof Error ? error.message : String(error)}); GLB export still works.`));
    return () => { disposed = true; cleanup(); };
  }, [program, mode]);
  return (
    <div className="lst-scene">
      <div ref={host} className="lst-scene-canvas" data-lelu-scene-renderer={mode} />
      <p className="lst-note" data-lelu-scene-info>{info}{gpuOk ? <> · <button type="button" className="lst-btn ghost" onClick={() => setMode(mode === "webgpu" ? "webgl2" : "webgpu")}>Use {mode === "webgpu" ? "WebGL2" : "WebGPU"}</button></> : null}</p>
    </div>
  );
}

function FilmView({ program, title }: { program: VideoProgram; title: string }) {
  const [state, setState] = useState<{ url?: string; progress?: number; info?: string; error?: string }>({});
  useEffect(() => () => { if (state.url) URL.revokeObjectURL(state.url); }, [state.url]);
  const seconds = useMemo(() => program.scenes.reduce((a, s) => a + s.duration, 0), [program]);
  const render = async () => {
    setState({ progress: 0 });
    try {
      const film = await renderFilm(program, (p) => setState((s) => ({ ...s, progress: p })));
      const url = URL.createObjectURL(new Blob([film.bytes as BlobPart], { type: film.mime }));
      setState({ url, info: `${film.path === "webcodecs" ? "WebCodecs" : "MediaRecorder"} · ${film.codec} · ${film.seconds.toFixed(1)} s · ${film.frames} frames · ${(film.bytes.byteLength / 1024).toFixed(0)} KB · encoded in ${(film.encodeMs / 1000).toFixed(1)} s${film.audio ? " · soundtrack" : ""}` });
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <div className="lst-film">
      {state.url ? <video src={state.url} controls playsInline className="lst-film-video" data-lelu-film-ready aria-label={title} /> : (
        <button type="button" className="lst-btn" onClick={() => void render()} disabled={state.progress !== undefined && !state.error} data-lelu-film-render>
          <Film size={14} aria-hidden /> {state.progress !== undefined && !state.error ? `Rendering… ${Math.round((state.progress ?? 0) * 100)}%` : `Render the ${seconds.toFixed(0)} s film on this device`}
        </button>
      )}
      {state.info ? <p className="lst-note" data-lelu-film-info>{state.info}</p> : null}
      {state.error ? <p className="lst-error" role="alert"><TriangleAlert size={14} aria-hidden /> {state.error}</p> : null}
    </div>
  );
}
