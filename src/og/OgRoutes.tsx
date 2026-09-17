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

import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import "./og.css";

const OgCore = lazy(() => import("./routes/core"));
const OgInnerSky = lazy(() => import("./routes/app/route"));
const OgChatThread = lazy(() => import("./routes/chat.$threadId"));

// Inner Sky's pages. AppShell renders an <Outlet/>, so without these mounted
// the shell came up with an empty body and every nav tab led nowhere — OG UI
// #2 was half an interface.
const AppHome = lazy(() => import("./routes/app/index"));
const AppChats = lazy(() => import("./routes/app/chats"));
const AppArchive = lazy(() => import("./routes/app/chats.archive"));
const AppAgents = lazy(() => import("./routes/app/agents"));
const AppMemories = lazy(() => import("./routes/app/memories"));
const AppFiles = lazy(() => import("./routes/app/files"));
const AppUniverses = lazy(() => import("./routes/app/universes"));
const AppUniverse = lazy(() => import("./routes/app/universes.$id"));
const AppQueue = lazy(() => import("./routes/app/queue"));
const AppSettings = lazy(() => import("./routes/app/settings"));

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

/**
 * The OG interfaces read their data through react-query, which needs a client
 * in context. In OG that client lived in the TanStack root route — the one
 * file the hybrid does not mount — so after the port EVERY query in both OG
 * interfaces threw "No QueryClient set" and the error boundary swallowed it.
 * The surfaces looked like they rendered; what they rendered was the
 * boundary's own message.
 *
 * One client for the whole OG tree: a second would give the two interfaces
 * separate caches of the same rows, which is the duplicate-state problem this
 * integration exists to avoid.
 *
 * The defaults matter as much as the client. OG relied on react-query's
 * out-of-the-box behaviour, which refetches on every mount and window focus
 * and retries three times — on a phone, switching panels re-requested
 * everything, and one unreachable database became four requests per attempt.
 */
function makeOgQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A poll is its own retry; a one-shot failure is better surfaced than
        // hammered at.
        retry: false,
        // Panels are opened and closed constantly. Re-fetching rows that are
        // seconds old on every remount is pure cost.
        staleTime: 30_000,
        refetchOnMount: false,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
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
  // Created once per mount of the OG tree rather than at module scope, so the
  // cache does not outlive the interfaces and leak between sessions.
  const [queryClient] = useState(makeOgQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
    <Routes>
      <Route path="core" element={<OgFrame><OgCore /></OgFrame>} />

      {/* Inner Sky: the shell is the layout, its pages are nested children,
          which is the shape AppShell's <Outlet/> was written for. Kept under
          the OG sources' own /app naming so those files stay unmodified — the
          compat router maps /app/* onto /og/app/*. */}
      <Route path="app" element={<OgFrame><OgInnerSky /></OgFrame>}>
        <Route index element={<AppHome />} />
        <Route path="chats" element={<AppChats />} />
        <Route path="chats/archive" element={<AppArchive />} />
        <Route path="agents" element={<AppAgents />} />
        <Route path="memories" element={<AppMemories />} />
        <Route path="files" element={<AppFiles />} />
        <Route path="universes" element={<AppUniverses />} />
        <Route path="universes/:id" element={<AppUniverse />} />
        <Route path="queue" element={<AppQueue />} />
        <Route path="settings" element={<AppSettings />} />
      </Route>

      {/* /og/chat is the dock's entry to Inner Sky and predates the nested
          mount above; kept so existing links and the dock tab do not break. */}
      <Route path="chat" element={<OgFrame><OgInnerSky /></OgFrame>}>
        <Route index element={<AppHome />} />
      </Route>
      <Route path="chat/:threadId" element={<OgFrame><OgChatThread /></OgFrame>} />

      <Route path="*" element={<OgFrame><OgCore /></OgFrame>} />
    </Routes>
    </QueryClientProvider>
  );
}
