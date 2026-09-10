import { useState } from "react";
import { supabase } from "@og/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@og/compat/router";
import { useSession } from "@og/hooks/use-session";
import { cn } from "@og/lib/utils";

type Cat = "profile" | "appearance" | "voice" | "memory" | "notifications" | "data" | "advanced";

const CATS: { id: Cat; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "voice", label: "Voice" },
  { id: "memory", label: "Memory" },
  { id: "notifications", label: "Notifications" },
  { id: "data", label: "Data" },
  { id: "advanced", label: "Advanced" },
];

export function SettingsPanel() {
  const [cat, setCat] = useState<Cat>("profile");
  const { session } = useSession();
  const navigate = useNavigate();

  return (
    <div className="flex h-full">
      <aside className="w-40 shrink-0 border-r border-white/10 bg-black/10 p-3">
        <div className="mb-2 text-[9px] uppercase tracking-[0.3em] text-foreground/50">Settings</div>
        {CATS.map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)}
            className={cn(
              "block w-full rounded-md px-2 py-1.5 text-left text-xs transition",
              cat === c.id ? "bg-white/10 text-foreground" : "text-foreground/60 hover:bg-white/5 hover:text-foreground",
            )}>
            {c.label}
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-5 text-sm">
        {cat === "profile" && (
          <div className="space-y-3">
            <h3 className="text-base font-medium">Profile</h3>
            <Row k="Signed in as" v={session?.user.email ?? "—"} />
            <Row k="User ID" v={session?.user.id ?? "—"} />
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                toast.success("Signed out");
                navigate({ to: "/" });
              }}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        )}
        {cat === "appearance" && (
          <Empty title="Appearance" text="The Core evolves seasonally on its own. Manual palette overrides land in v1.1." />
        )}
        {cat === "voice" && <Empty title="Voice" text="Configure microphone, wake word, and voice output in the Voice workspace." />}
        {cat === "memory" && <Empty title="Memory" text="Retention rules, importance thresholds, and auto-archive policies land next." />}
        {cat === "notifications" && <Empty title="Notifications" text="Notification channels & schedules will be added with the notification service." />}
        {cat === "data" && <Empty title="Data" text="Export, backup, and delete-all-data controls come with the data manager." />}
        {cat === "advanced" && <Empty title="Advanced" text="Model routing and executive-control overrides live here soon." />}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-[10px] uppercase tracking-[0.28em] text-foreground/50">{k}</span>
      <span className="truncate text-xs text-foreground/85">{v}</span>
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mt-2 text-xs text-foreground/55">{text}</p>
    </div>
  );
}