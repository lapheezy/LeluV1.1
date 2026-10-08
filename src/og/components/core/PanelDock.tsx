import { useWindows } from "./WindowManager";
import { cn } from "@og/lib/utils";

export function PanelDock() {
  const panels = useWindows((s) => s.panels);
  const restore = useWindows((s) => s.restore);
  const focus = useWindows((s) => s.focus);
  const close = useWindows((s) => s.close);
  if (panels.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[10000] flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-white/10 bg-background/60 px-2 py-1.5 backdrop-blur-xl shadow-lg">
        {panels.map((p) => (
          <button
            key={p.key}
            onClick={() => (p.minimized ? restore(p.key) : focus(p.key))}
            onContextMenu={(e) => { e.preventDefault(); close(p.key); }}
            className={cn(
              "group flex items-center gap-2 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.28em] transition",
              p.minimized ? "bg-white/5 text-foreground/60 hover:text-foreground" : "bg-white/10 text-foreground hover:bg-white/15",
            )}
            title={p.minimized ? "Restore · right-click to close" : "Focus · right-click to close"}
          >
            <span className={cn("size-1.5 rounded-full", p.minimized ? "bg-foreground/30" : "bg-emerald-300/80")} />
            {p.title}
          </button>
        ))}
      </div>
    </div>
  );
}