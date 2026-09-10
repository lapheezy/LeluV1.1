import { useEffect, useState } from "react";
import { useProcessing } from "./ProcessingProvider";
import { supabase } from "@og/integrations/supabase/client";
import { cn } from "@og/lib/utils";

type Ind = "idle" | "working" | "complete" | "error";

function Dot({ label, state }: { label: string; state: Ind }) {
  return (
    <span title={`${label}: ${state}`} className="grid place-items-center">
      <span
        className={cn(
          "size-2 rounded-full transition",
          state === "idle" && "bg-foreground/25",
          state === "working" && "bg-amber-300 animate-pulse",
          state === "complete" && "bg-emerald-300",
          state === "error" && "bg-red-400",
        )}
      />
    </span>
  );
}

export function StatusBar() {
  const tasks = useProcessing((s) => s.tasks);
  const [online, setOnline] = useState(true);
  const [db, setDb] = useState<Ind>("idle");

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setDb("working");
      const { error } = await supabase.auth.getSession();
      if (cancel) return;
      setDb(error ? "error" : "complete");
    })();
    return () => { cancel = true; };
  }, []);

  const has = (k: string) => tasks.some((t) => t.kind === k);
  const memoryS: Ind = has("writing_memory") || has("reading_memory") ? "working" : "idle";
  const voiceS: Ind = has("listening") || has("speaking") ? "working" : "idle";
  const researchS: Ind = has("searching") ? "working" : "idle";
  const executiveS: Ind = has("organizing") ? "working" : "idle";
  const agentsS: Ind = has("agent") ? "working" : "idle";

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-background/50 px-3 py-1.5 backdrop-blur">
      <Dot label="Memory" state={memoryS} />
      <Dot label="Voice" state={voiceS} />
      <Dot label="Research" state={researchS} />
      <Dot label="Executive" state={executiveS} />
      <Dot label="Agents" state={agentsS} />
      <Dot label="Internet" state={online ? "complete" : "error"} />
      <Dot label="Database" state={db} />
    </div>
  );
}