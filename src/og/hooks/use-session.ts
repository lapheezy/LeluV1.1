import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "@og/integrations/supabase/client";

/**
 * Single shared auth store. One getSession() call + one onAuthStateChange
 * listener for the whole app, with a hard timeout so the UI can never hang
 * on an unresolved auth promise.
 */
type AuthSnapshot = {
  session: Session | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  /**
   * True when there is no Supabase to authenticate against at all — as
   * opposed to a configured Supabase with nobody signed in. The OG surfaces
   * branch on this: signed-out means "go sign in", unconfigured means
   * "render disconnected", because LÉLU must run without Supabase (§5).
   */
  unconfigured: boolean;
};

const INIT_TIMEOUT_MS = 8000;

let snapshot: AuthSnapshot = {
  session: null,
  loading: true,
  error: null,
  ready: false,
  unconfigured: false,
};
const listeners = new Set<(s: AuthSnapshot) => void>();
let started = false;

function log(...args: unknown[]) {
  if (typeof console !== "undefined") console.info("[auth]", ...args);
}

function set(partial: Partial<AuthSnapshot>) {
  snapshot = { ...snapshot, ...partial };
  listeners.forEach((l) => l(snapshot));
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  log("initializing");

  // No Supabase configured: settle immediately as signed-out-and-unconfigured.
  // The OG original reached straight for the client here and threw, which blanked
  // whichever OG surface was mounting. Auth is optional now, so this is a state,
  // not a failure.
  const client = getSupabase();
  if (!client || !isSupabaseConfigured()) {
    log("supabase not configured — continuing without auth");
    set({ session: null, loading: false, ready: true, error: null, unconfigured: true });
    return;
  }

  let settled = false;
  const finish = (session: Session | null, error: string | null) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    set({ session, loading: false, ready: true, error });
    log(session ? `session detected · user ${session.user.id}` : "no session", error ? `error: ${error}` : "");
    log("app ready");
  };

  const timer = window.setTimeout(() => {
    console.warn("[auth] getSession() timed out — continuing signed out");
    finish(null, "Auth took too long to respond. You may need to sign in again.");
  }, INIT_TIMEOUT_MS);

  client.auth
    .getSession()
    .then(({ data, error }) => finish(data.session ?? null, error?.message ?? null))
    .catch((err: unknown) => {
      console.error("[auth] getSession failed", err);
      finish(null, err instanceof Error ? err.message : "Could not read your session.");
    });

  client.auth.onAuthStateChange((event, s) => {
    log("state change:", event, s ? `user ${s.user.id}` : "signed out");
    if (!settled) {
      settled = true;
      window.clearTimeout(timer);
    }
    set({ session: s ?? null, loading: false, ready: true, error: null });
  });
}

export function useSession() {
  const [state, setState] = useState<AuthSnapshot>(snapshot);

  useEffect(() => {
    start();
    listeners.add(setState);
    setState(snapshot);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}
