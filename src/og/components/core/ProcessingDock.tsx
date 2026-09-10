import { useProcessing } from "./ProcessingProvider";
import { useWindows } from "./WindowManager";
import { Loader2 } from "lucide-react";

const LABELS: Record<string, string> = {
  thinking: "Thinking",
  searching: "Searching",
  writing_memory: "Writing memory",
  reading_memory: "Reading memory",
  organizing: "Organizing",
  agent: "Agent",
  speaking: "Speaking",
  listening: "Listening",
};

export function ProcessingDock() {
  const tasks = useProcessing((s) => s.tasks);
  const open = useWindows((s) => s.open);
  if (!tasks.length) return null;
  return (
    <div className="pointer-events-auto fixed bottom-16 left-3 z-[9999] flex max-w-[280px] flex-col gap-1">
      {tasks.slice(0, 5).map((t) => (
        <button
          key={t.id}
          onClick={() => open({ id: "logs", key: "logs", title: "Logs" })}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-background/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.24em] text-foreground/80 backdrop-blur hover:bg-background/90"
        >
          <Loader2 className="size-3 animate-spin" />
          <span className="truncate">{LABELS[t.kind] ?? t.kind}</span>
          {t.label && (
            <span className="truncate normal-case tracking-normal text-foreground/50">· {t.label}</span>
          )}
        </button>
      ))}
    </div>
  );
}