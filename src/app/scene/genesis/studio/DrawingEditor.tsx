/**
 * LÉLU — a drawing artifact, edited in Excalidraw (lazy-loaded: this
 * module and @excalidraw/excalidraw load only when a drawing is opened).
 *
 * Excalidraw's native editor is used as is — its tools, its menu (which
 * saves/loads .excalidraw files and exports PNG/SVG). LÉLU stores its
 * scene data unchanged in the Creation Studio artifact: elements, the
 * app-state fields that describe the drawing (not the UI), and files.
 *
 * The load is genuinely deferred, which is what this header always claimed:
 * the imports are dynamic, so a build (or a test) that never opens a drawing
 * never loads Excalidraw at all. A static import made every consumer pay for
 * it, and made the module impossible to load outside a bundler — its package
 * resolves `./index.css` only under a `development`/`production` condition and
 * its ESM build names an export its CJS dependency does not provide at the
 * top level. Opening a drawing is the moment those rules matter, so that is
 * the moment they are applied.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawingSpec } from "../../../../core/studio/StudioTypes";
import { useStudioStore } from "./useStudio";

/** App-state that belongs to the drawing; the rest is UI and is not stored. */
const KEPT_APP_STATE = ["viewBackgroundColor", "gridSize", "gridModeEnabled", "currentItemFontFamily", "currentItemStrokeColor", "currentItemBackgroundColor"] as const;

type SceneElement = { id: string; isDeleted?: boolean; version?: number };
type ExcalidrawModule = typeof import("@excalidraw/excalidraw");

export default function DrawingEditor({ artifactId, spec, readOnly }: { artifactId: string; spec: DrawingSpec; readOnly: boolean }) {
  const store = useStudioStore();
  const [status, setStatus] = useState("Saved");
  const [excalidraw, setExcalidraw] = useState<ExcalidrawModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pending = useRef<DrawingSpec | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const module = await import("@excalidraw/excalidraw");
        // Its stylesheet, not its behaviour: a runtime that cannot resolve a
        // CSS export still gets a working editor, so a failure here is not fatal.
        await import("@excalidraw/excalidraw/index.css").catch(() => undefined);
        if (!cancelled) setExcalidraw(module);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message.split("\n")[0] : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const initialData = useMemo(() => {
    if (!excalidraw) return null;
    // A drawing LÉLU made holds element skeletons ({type, x, y, text…});
    // Excalidraw's own converter completes them. Saved drawings are full
    // elements (they carry a seed) and are passed through untouched.
    const elements = (spec.scene.elements as Array<Record<string, unknown>>).some((e) => typeof e.seed !== "number")
      ? excalidraw.convertToExcalidrawElements(spec.scene.elements as never)
      : spec.scene.elements;
    return {
      elements: elements as never,
      appState: { ...(spec.scene.appState ?? {}), viewBackgroundColor: (spec.scene.appState?.viewBackgroundColor as string) ?? "#fdfcff" } as never,
      files: (spec.scene.files ?? {}) as never,
      scrollToContent: true,
    };
  }, [excalidraw, spec]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return null;
    return store.saveEdit(artifactId, next);
  }, [artifactId, store]);

  const onChange = useCallback((elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
    if (readOnly) return;
    const live = (elements as SceneElement[]).filter((e) => !e.isDeleted);
    // Excalidraw calls onChange on every pointer move; save only real changes.
    const signature = live.map((e) => `${e.id}:${e.version ?? 0}`).join(",");
    if (signature === lastSaved.current) return;
    lastSaved.current = signature;
    const kept = Object.fromEntries(KEPT_APP_STATE.filter((k) => appState[k] !== undefined).map((k) => [k, appState[k]]));
    const usedFiles = new Set(live.map((e) => (e as { fileId?: string }).fileId).filter(Boolean));
    pending.current = {
      ...spec,
      scene: { elements: live, appState: kept, files: Object.fromEntries(Object.entries(files).filter(([id]) => usedFiles.has(id))) },
    };
    setStatus("Saving…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = flush();
      if (r) setStatus(!r.ok ? `Not saved: ${r.reason}` : r.persisted ? `Saved · r${r.revision.rev}` : "Not saved to this device (storage full) — kept for this session");
    }, 800);
  }, [flush, readOnly, spec]);

  useEffect(() => {
    lastSaved.current = (spec.scene.elements as SceneElement[]).map((e) => `${e.id}:${e.version ?? 0}`).join(",");
  }, [spec]);

  useEffect(() => {
    const onHide = () => { flush(); };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  const Editor = excalidraw?.Excalidraw ?? null;

  return (
    <div className="lst-drawing" data-lelu-drawing-editor={artifactId}>
      <div className="lst-toolbar">
        <span className="lst-spacer" />
        <span className="lst-note" role="status" data-lelu-drawing-status>{readOnly ? "Viewing an earlier revision" : status}</span>
      </div>
      <div className="lst-drawing-canvas">
        {Editor && initialData ? (
          <Editor
            initialData={initialData}
            onChange={onChange as never}
            viewModeEnabled={readOnly}
            theme="dark"
            UIOptions={{ canvasActions: { toggleTheme: false } }}
          />
        ) : loadError ? (
          <div className="lst-note" role="alert" data-lelu-drawing-error>
            The drawing surface could not load here: {loadError}
          </div>
        ) : (
          <div className="lst-note" data-lelu-drawing-loading>Loading the drawing surface…</div>
        )}
      </div>
    </div>
  );
}
