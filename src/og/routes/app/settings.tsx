import { createFileRoute, useNavigate } from "@og/compat/router";
import { supabase } from "@og/integrations/supabase/client";
import { useSession } from "@og/hooks/use-session";

export const Route = createFileRoute("/app/settings")({ component: SettingsPage });

function SettingsPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="text-foreground/60 text-sm mt-1">Your account and preferences.</p>
      </header>
      <section className="rounded-xl border border-border/40 bg-card/30 p-5 space-y-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-foreground/50">Account</div>
        <div className="text-sm">{session?.user?.email ?? "—"}</div>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/" });
          }}
          className="px-4 py-2 rounded-md border border-border/60 text-sm hover:bg-foreground/5"
        >
          Sign out
        </button>
      </section>
      <section className="rounded-xl border border-border/40 bg-card/30 p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-foreground/50">Appearance</div>
        <p className="text-sm text-foreground/70 mt-2">
          Cosmic theme is on by default. Light mode arriving in a future phase.
        </p>
      </section>
    </div>
  );
}