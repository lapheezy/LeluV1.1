import { createFileRoute, useNavigate } from "@og/compat/router";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@og/hooks/use-session";
import { Core } from "@og/components/core/Core";
import { PanelRouter } from "@og/components/core/PanelRouter";
import { PanelDock } from "@og/components/core/PanelDock";
import { ProcessingDock } from "@og/components/core/ProcessingDock";
import { StatusBar } from "@og/components/core/StatusBar";
import { CoreMenu } from "@og/components/core/CoreMenu";
import { useWindows } from "@og/components/core/WindowManager";

export const Route = createFileRoute("/core")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Lélu — Core" },
      { name: "description", content: "The living Core of Lélu." },
    ],
  }),
  component: CoreRoute,
});

function CoreRoute() {
  const { session, loading, error, unconfigured } = useSession();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const coreWrapRef = useRef<HTMLDivElement | null>(null);
  const openWin = useWindows((s) => s.open);
  const panels = useWindows((s) => s.panels);

  useEffect(() => {
    // Redirect only when there is a Supabase to sign in to. With none
    // configured the OG surface renders disconnected instead of bouncing the
    // user out of it — LÉLU has to work without Supabase (brief §5, §21).
    if (!loading && !session && !unconfigured) navigate({ to: "/" });
  }, [loading, session, unconfigured, navigate]);

  useEffect(() => {
    const measure = () => {
      const el = coreWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    measure();
    const id = window.setTimeout(measure, 750); // after slide animation
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); window.clearTimeout(id); };
  }, [panels.length]);

  if (loading || (!session && !unconfigured)) {
    return (
      <div className="grid min-h-screen place-items-center gap-4 px-6 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-[0.4em] text-foreground/50">
            {loading ? "awakening the core…" : "the horizon is dark"}
          </p>
          {error && <p className="mt-3 text-xs text-foreground/60">{error}</p>}
          {!loading && (
            <button
              onClick={() => navigate({ to: "/" })}
              className="mt-5 text-[10px] uppercase tracking-[0.3em] text-foreground/70 underline hover:text-foreground"
            >
              back to the horizon
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#050810] via-[#08101f] to-[#020409] text-foreground">
      {/* ambient starfield */}
      <div className="pointer-events-none absolute inset-0 opacity-70"
        style={{ backgroundImage:
          "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.6) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,0.5) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,0.35) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 85% 20%, rgba(255,255,255,0.45) 50%, transparent 51%)",
        }} />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[7000] flex items-center justify-between px-4 py-3">
        <div className="pointer-events-auto font-display text-sm tracking-[0.5em] uppercase text-foreground/70">Lélu</div>
        <div className="pointer-events-auto"><StatusBar /></div>
      </div>

      {/* Core in center when no panels; drifts to a corner otherwise */}
      <div
        ref={coreWrapRef}
        className="pointer-events-auto fixed z-[6000] transition-all duration-700 ease-out"
        style={
          panels.length === 0
            ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
            : { right: 24, bottom: 24 }
        }
      >
        <Core
          size={panels.length === 0 ? 320 : 140}
          onTap={() => setMenuOpen((v) => !v)}
          onLongPress={() => openWin({ id: "chat", key: "chat", title: "Chat" })}
        />
        {panels.length === 0 && (
          <div className="mt-4 text-center text-[10px] uppercase tracking-[0.4em] text-foreground/50">
            tap the core · long-press to speak
          </div>
        )}
      </div>

      <CoreMenu open={menuOpen} onClose={() => setMenuOpen(false)} center={center} />

      <PanelRouter />
      <ProcessingDock />
      <PanelDock />
    </div>
  );
}
/** Default export so v1.1's router can lazy-load this OG surface. */
export default CoreRoute;
