/**
 * LÉLU — a drawing artifact, edited in Excalidraw (lazy-loaded: this
 * module and @excalidraw/excalidraw load only when a drawing is opened).
 *
 * Excalidraw's native editor is used as is — its tools, its menu (which
 * saves/loads .excalidraw files and exports PNG/SVG). LÉLU stores its
 * scene data unchanged in the Creation Studio artifact: elements, the
 * app-state fields that describe the drawing (not the UI), and files.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertToExcalidrawElements, Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { DrawingSpec } from "../../../../core/studio/StudioTypes";
import { useStudioStore } from "./useStudio";

/** App-state that belongs to the drawing; the rest is UI and is not stored. */
const KEPT_APP_STATE = ["viewBackgroundColor", "gridSize", "gridModeEnabled", "currentItemFontFamily", "currentItemStrokeColor", "currentItemBackgroundColor"] as const;

type SceneElement = { id: string; isDeleted?: boolean; version?: number };

export default function DrawingEditor({ artifactId, spec, readOnly }: { artifactId: string; spec: DrawingSpec; readOnly: boolean }) {
  const store = useStudioStore();
  const [status, setStatus] = useState("Saved");
  const pending = useRef<DrawingSpec | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>("");

  const initialData = useMemo(() => ({
    // A drawing LÉLU made holds element skeletons ({type, x, y, text…});
    // Excalidraw's own converter completes them. Saved drawings are full
    // elements (they carry a seed) and are passed through untouched.
    elements: ((spec.scene.elements as Array<Record<string, unknown>>).some((e) => typeof e.seed !== "number")
      ? convertToExcalidrawElements(spec.scene.elements as never)
      : spec.scene.elements) as never,
    appState: { ...(spec.scene.appState ?? {}), viewBackgroundColor: (spec.scene.appState?.viewBackgroundColor as string) ?? "#fdfcff" } as never,
    files: (spec.scene.files ?? {}) as never,
    scrollToContent: true,
  }), [spec]);

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

  return (
    <div className="lst-drawing" data-lelu-drawing-editor={artifactId}>
      <div className="lst-toolbar">
        <span className="lst-spacer" />
        <span className="lst-note" role="status" data-lelu-drawing-status>{readOnly ? "Viewing an earlier revision" : status}</span>
      </div>
      <div className="lst-drawing-canvas">
        <Excalidraw
          initialData={initialData}
          onChange={onChange as never}
          viewModeEnabled={readOnly}
          theme="dark"
          UIOptions={{ canvasActions: { toggleTheme: false } }}
        />
      </div>
    </div>
  );
}
