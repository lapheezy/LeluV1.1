import { createFileRoute, useNavigate, useParams } from "@og/compat/router";
import { useEffect, useState } from "react";
import { UniverseScene } from "@og/components/universe/UniverseScene";
import { ChatPanel } from "@og/components/universe/ChatPanel";
import { useSession } from "@og/hooks/use-session";
import { getSupabase } from "@og/integrations/supabase/client";
import { listHorizons, type HorizonItem } from "@og/lib/horizons.functions";

export const Route = createFileRoute("/chat/$threadId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "A conversation with Lélu" },
      {
        name: "description",
        content: "Speak to the small sun on the horizon.",
      },
    ],
  }),
  component: ChatRoute,
});

function ChatRoute() {
  const { threadId } = useParams({ from: "/chat/$threadId" });
  const { session, loading, unconfigured } = useSession();
  const navigate = useNavigate();
  const [horizons, setHorizons] = useState<HorizonItem[]>([]);

  useEffect(() => {
    // Redirect only when there is a Supabase to sign in to. With none
    // configured the OG surface renders disconnected instead of bouncing the
    // user out of it — LÉLU has to work without Supabase (brief §5, §21).
    if (!loading && !session && !unconfigured) navigate({ to: "/" });
  }, [loading, session, unconfigured, navigate]);

  useEffect(() => {
    if (!session) return;
    listHorizons().then(setHorizons).catch(() => {});
  }, [session, threadId]);

  return (
    <UniverseScene horizons={horizons}>
      <button
        onClick={async () => {
          await getSupabase()?.auth.signOut();
          navigate({ to: "/" });
        }}
        className="absolute right-5 top-5 z-10 text-[10px] uppercase tracking-[0.3em] text-foreground/40 hover:text-foreground/80"
      >
        drift away
      </button>
      <button
        onClick={() => navigate({ to: "/" })}
        className="absolute left-1/2 top-6 -translate-x-1/2 font-display text-2xl tracking-[0.4em] uppercase text-foreground/70 hover:text-foreground"
      >
        Lélu
      </button>

      {/* Small sun anchored above the panel */}
      <div
        className="sun-orb pointer-events-none absolute left-1/2 top-[14%] -translate-x-1/2 rounded-full"
        style={{ width: 80, height: 80 }}
      />

      <div className="absolute inset-0 flex items-end justify-center pt-32">
        {/* The chat itself needs no Supabase — only its persistence does.
            Gating on `session` alone meant no Supabase, no conversation at
            all, which contradicts §5: LÉLU must still chat without it.
            ChatPanel already degrades to local snapshots when the stored
            history cannot be read. */}
        {session || unconfigured ? (
          <ChatPanel key={threadId} threadId={threadId} />
        ) : null}
      </div>
    </UniverseScene>
  );
}
/** Default export so v1.1's router can lazy-load this OG surface. */
export default ChatRoute;
