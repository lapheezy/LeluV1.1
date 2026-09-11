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
  const { session } = useSession();
  const navigate = useNavigate();
  const [horizons, setHorizons] = useState<HorizonItem[]>([]);

  // No redirect. The OG surfaces render whatever they can and show their own
  // signed-out affordances, because §21 requires each of them to work without
  // Supabase — and "work" cannot mean "bounce the user to a different screen".
  //
  // The case that exposed this: Supabase CONFIGURED but rejecting. Not
  // unconfigured, no session, and getSession() reports no error because it
  // reads local storage rather than validating — so every flag said fine and
  // the surface quietly navigated away. Signing in is still offered inside
  // the interface; it is simply no longer a toll gate on reaching it.

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
        {/* The conversation is never gated.
            Earlier this was `session ? … : null`, then `session ||
            unconfigured`, and both were wrong for the same reason: they tie
            whether LÉLU will talk to you to the state of a database. She
            answers through AIService, which needs no account; Supabase only
            ever stored the transcript, and ChatPanel already falls back to
            local snapshots when it cannot be read.

            The case that exposed this was Supabase configured but rejecting —
            not "unconfigured", no session, and getSession() reports no error
            because it reads local storage rather than validating. So every
            flag said "fine" and the chat silently disappeared. §21 requires
            that a Supabase failure stay isolated; the way to guarantee that
            is for the conversation not to consult it. */}
        <ChatPanel key={threadId} threadId={threadId} />
      </div>
    </UniverseScene>
  );
}
/** Default export so v1.1's router can lazy-load this OG surface. */
export default ChatRoute;
