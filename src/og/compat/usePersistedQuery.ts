/**
 * ==========================================================
 * LÉLU — POLLING THAT STOPS WHEN THERE IS NOTHING TO POLL
 *
 * The OG panels refresh themselves with react-query on 3-6
 * second intervals. That was reasonable in the OG deployment,
 * where Supabase was always present and a session always
 * existed.
 *
 * Under the hybrid it is not. Supabase is optional, so the
 * common case is a panel asking a database that cannot answer,
 * several times a minute, forever — on a phone. Unconfigured,
 * every tick rejects before the network and still costs a
 * render and a rejected promise. Configured but signed out or
 * rejecting, every tick is a real HTTP request that will fail
 * exactly the same way the last one did.
 *
 * So polling is made conditional on there being something to
 * poll, and failures back off rather than repeating at full
 * rate. The panels keep their live-updating behaviour whenever
 * the data is actually reachable, which is the behaviour worth
 * preserving.
 * ==========================================================
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { isSupabaseConfigured } from "@og/integrations/supabase/client";

export interface PersistedQueryOptions<T> {
  queryKey: unknown[];
  queryFn: () => Promise<T>;
  /** Poll period while the source is healthy. Omit for a one-shot query. */
  refetchInterval?: number;
  /**
   * The caller's own precondition, ANDed with Supabase availability. Some
   * panels already wait for a selection before querying; that stays theirs to
   * decide, this hook only adds "and the database can actually answer".
   */
  enabled?: boolean;
}

/**
 * A react-query poll that is disabled when Supabase cannot serve, and which
 * stops re-polling after a failure instead of hammering.
 *
 * Retry is off entirely: these are polls, so a failed tick is already retried
 * by the next interval. react-query's default of three retries turned one
 * failing panel into four requests per tick.
 */
export function usePersistedQuery<T>(options: PersistedQueryOptions<T>) {
  const configured = isSupabaseConfigured();

  return useQuery<T>({
    queryKey: options.queryKey,
    queryFn: options.queryFn,
    enabled: configured && (options.enabled ?? true),
    retry: false,
    // A query that has failed stops polling until something changes —
    // remounting the panel, or the window regaining focus. Repeating a call
    // that just failed, every few seconds, indefinitely, is the pattern this
    // hook exists to remove.
    refetchInterval: (query) =>
      options.refetchInterval && !query.state.error ? options.refetchInterval : false,
    refetchOnWindowFocus: true,
  } as UseQueryOptions<T>);
}

export default usePersistedQuery;
