import { useCallback, useRef, type ReactNode } from "react";
import { X, Minus, Maximize2, Minimize2, Pin, PinOff } from "lucide-react";
import { useWindows, type PanelInstance } from "./WindowManager";
import { cn } from "@og/lib/utils";

export function CorePanel({
  panel,
  children,
}: {
  panel: PanelInstance;
  children: ReactNode;
}) {
  const { focus, update, close, minimize, toggleMaximize, togglePin } = useWindows();
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ dir: string; sx: number; sy: number; w: number; h: number; x: number; y: number } | null>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (panel.maximized) return;
      focus(panel.key);
      dragRef.current = { dx: e.clientX - panel.x, dy: e.clientY - panel.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [panel, focus],
  );
  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - dragRef.current.dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragRef.current.dy));
      update(panel.key, { x: nx, y: ny });
    },
    [panel.key, update],
  );
  const onDragEnd = useCallback(() => { dragRef.current = null; }, []);

  const startResize = (dir: string) => (e: React.PointerEvent) => {
    if (panel.maximized) return;
    e.stopPropagation();
    focus(panel.key);
    resizeRef.current = {
      dir, sx: e.clientX, sy: e.clientY,
      w: panel.w, h: panel.h, x: panel.x, y: panel.y,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    let { x, y, w, h } = { x: r.x, y: r.y, w: r.w, h: r.h };
    const dx = e.clientX - r.sx;
    const dy = e.clientY - r.sy;
    if (r.dir.includes("e")) w = Math.max(320, r.w + dx);
    if (r.dir.includes("s")) h = Math.max(220, r.h + dy);
    if (r.dir.includes("w")) { w = Math.max(320, r.w - dx); x = r.x + (r.w - w); }
    if (r.dir.includes("n")) { h = Math.max(220, r.h - dy); y = r.y + (r.h - h); }
    update(panel.key, { x, y, w, h });
  };
  const onResizeEnd = () => { resizeRef.current = null; };

  if (panel.minimized) return null;

  const style: React.CSSProperties = panel.maximized
    ? { left: 8, top: 56, width: "calc(100vw - 16px)", height: "calc(100vh - 96px)", zIndex: panel.pinned ? 9000 + panel.z : panel.z, position: "absolute" }
    : { left: panel.x, top: panel.y, width: panel.w, height: panel.h, zIndex: panel.pinned ? 9000 + panel.z : panel.z, position: "absolute" };

  return (
    <div
      className={cn(
        "core-panel flex flex-col rounded-2xl border border-white/10 bg-background/60 backdrop-blur-xl shadow-[0_30px_120px_-30px_rgba(0,0,0,0.75)] overflow-hidden text-foreground",
      )}
      style={style}
      onPointerDown={() => focus(panel.key)}
    >
      <div
        className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent px-3 select-none cursor-move"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onDoubleClick={() => toggleMaximize(panel.key)}
      >
        <span className="text-[10px] uppercase tracking-[0.32em] text-foreground/70 truncate">
          {panel.title}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button title={panel.pinned ? "Unpin" : "Pin"} onClick={(e) => { e.stopPropagation(); togglePin(panel.key); }}
            className="grid h-6 w-6 place-items-center rounded-md text-foreground/60 hover:text-foreground hover:bg-white/10">
            {panel.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          <button title="Minimize" onClick={(e) => { e.stopPropagation(); minimize(panel.key); }}
            className="grid h-6 w-6 place-items-center rounded-md text-foreground/60 hover:text-foreground hover:bg-white/10">
            <Minus className="size-3.5" />
          </button>
          <button title={panel.maximized ? "Restore" : "Maximize"} onClick={(e) => { e.stopPropagation(); toggleMaximize(panel.key); }}
            className="grid h-6 w-6 place-items-center rounded-md text-foreground/60 hover:text-foreground hover:bg-white/10">
            {panel.maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button title="Close" onClick={(e) => { e.stopPropagation(); close(panel.key); }}
            className="grid h-6 w-6 place-items-center rounded-md text-foreground/60 hover:text-foreground hover:bg-destructive/40">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {!panel.maximized && (
        <>
          <div className="absolute inset-x-0 top-0 h-1 cursor-n-resize"  onPointerDown={startResize("n")}  onPointerMove={onResizeMove} onPointerUp={onResizeEnd} />
          <div className="absolute inset-x-0 bottom-0 h-1 cursor-s-resize" onPointerDown={startResize("s")}  onPointerMove={onResizeMove} onPointerUp={onResizeEnd} />
          <div className="absolute inset-y-0 left-0 w-1 cursor-w-resize"   onPointerDown={startResize("w")}  onPointerMove={onResizeMove} onPointerUp={onResizeEnd} />
          <div className="absolute inset-y-0 right-0 w-1 cursor-e-resize"  onPointerDown={startResize("e")}  onPointerMove={onResizeMove} onPointerUp={onResizeEnd} />
          <div className="absolute right-0 bottom-0 h-3 w-3 cursor-se-resize" onPointerDown={startResize("se")} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} />
          <div className="absolute left-0 bottom-0 h-3 w-3 cursor-sw-resize"  onPointerDown={startResize("sw")} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} />
          <div className="absolute right-0 top-0 h-3 w-3 cursor-ne-resize"   onPointerDown={startResize("ne")} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} />
          <div className="absolute left-0 top-0 h-3 w-3 cursor-nw-resize"    onPointerDown={startResize("nw")} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} />
        </>
      )}
    </div>
  );
}