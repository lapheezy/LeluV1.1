/**
 * ==========================================================
 * LÉLU — OG INTERFACE ROUTE TABLE
 *
 * OG declared its routes as files (TanStack createFileRoute).
 * v1.1 routes with react-router, so the same routes are
 * declared here and the OG route modules are consumed for
 * their components — their `Route` export still exists via
 * the compat layer, it simply is not what builds the table.
 *
 * Every OG surface is lazy. Loading them eagerly would pull
 * Tailwind, Radix and the whole OG tree into v1.1's initial
 * bundle for users who never open an OG screen, which brief
 * §17 rules out. As a side effect og.css ships with the OG
 * chunk rather than the entry chunk.
 *
 * `.og-root` on the wrapper is load-bearing: it is the scope
 * for every OG design token and the stand-in preflight (see
 * og.css), so OG styling reaches OG components and stops
 * there.
 * ==========================================================
 */

import { Component, Suspense, lazy, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import "./og.css";

const OgCore = lazy(() => import("./routes/core"));
const OgInnerSky = lazy(() => import("./routes/app/route"));
const OgChatThread = lazy(() => import("./routes/chat.$threadId"));

/**
 * A throw inside an OG surface must not take the whole app down. Before this
 * existed, an unconfigured Supabase threw out of useSession() during mount and
 * both OG routes rendered as a blank page — precisely the white-screen class of
 * failure brief §20 rules out. The root cause is fixed in use-session.ts; this
 * is the backstop, and it reports the real error rather than swallowing it.
 */
class OgErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[og] interface crashed", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div className="max-w-md">
          <p className="text-[10px] uppercase tracking-[0.4em] text-foreground/50">
            this interface did not open
          </p>
          <p className="mt-4 text-xs text-foreground/70">{this.state.error.message}</p>
          <a href="/" className="mt-6 inline-block text-[10px] uppercase tracking-[0.3em] underline">
            back to LÉLU
          </a>
        </div>
      </div>
    );
  }
}

function OgFrame({ children }: { children: ReactNode }) {
  return (
    <div className="og-root dark min-h-screen bg-background text-foreground">
      <OgErrorBoundary>
      <Suspense
        fallback={
          <div className="grid min-h-screen place-items-center">
            <p className="text-[10px] uppercase tracking-[0.4em] text-foreground/50">
              opening the horizon…
            </p>
          </div>
        }
      >
        {children}
      </Suspense>
      </OgErrorBoundary>
    </div>
  );
}

/** Mounted by the app router under /og/*. */
export default function OgRoutes() {
  return (
    <Routes>
      <Route path="core" element={<OgFrame><OgCore /></OgFrame>} />
      <Route path="chat" element={<OgFrame><OgInnerSky /></OgFrame>} />
      <Route path="chat/:threadId" element={<OgFrame><OgChatThread /></OgFrame>} />
      <Route path="*" element={<OgFrame><OgCore /></OgFrame>} />
    </Routes>
  );
}
