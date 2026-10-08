/**
 * ==========================================================
 * LÉLU — PERSISTENCE STATE
 *
 * One answer to "where is my data right now?"
 *
 * Supabase was reachable only through the settings panel, which made
 * cloud persistence read as a feature the user had opted into rather
 * than as the infrastructure the runtime sits on. Everything that cared
 * about it had to import SupabasePersistence and interpret its internal
 * status enum — `disabled`, `signed_out`, `connecting` — which describes
 * the CLIENT's condition, not the data's.
 *
 * This is the data's condition, in five states anything may read:
 *
 *   LOCAL      working, on this device only. Not an error.
 *   SYNCING    establishing or catching up.
 *   CONNECTED  local and cloud agree.
 *   DEGRADED   cloud configured and reachable but failing writes.
 *   OFFLINE    the network is gone; local still works.
 *
 * It is a FACADE. It owns no client, opens no connection, and
 * duplicates no persistence logic — SupabasePersistence remains the only
 * Supabase client in the app. This translates and republishes what that
 * already knows, so the UI can show it without reaching into the
 * persistence layer, and so LOCAL is presented as a normal mode of
 * operation rather than a failure.
 * ==========================================================
 */

import SupabasePersistence, {
  type SupabasePersistenceStatus,
} from "./SupabasePersistence";

export type PersistenceMode =
  | "local"
  | "syncing"
  | "connected"
  | "degraded"
  | "offline";

export interface PersistenceSnapshot {
  mode: PersistenceMode;
  /** One short line suitable for a status chip. */
  label: string;
  /** Why it is in this mode, for a tooltip or a diagnostics panel. */
  detail: string;
  /** Is anything being written beyond this device? */
  cloud: boolean;
  /** Signed in, where the cloud needs an identity. */
  identified: boolean;
  /** Does the user need to do something for cloud sync to work? */
  actionable: boolean;
  updatedAt: number;
}

type Listener = (snapshot: PersistenceSnapshot) => void;

/** Is the browser reporting a network at all? Unknown outside one. */
function online(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine !== false;
}

/**
 * Translate the client's condition into the data's condition.
 *
 * `disabled` is the case worth being careful about: no Supabase
 * configuration is not a fault, it is local-only operation, and
 * reporting it as an error taught the user to ignore the indicator.
 */
export function describe(
  status: SupabasePersistenceStatus,
  hasNetwork = online(),
): PersistenceSnapshot {
  const now = Date.now();
  const base = { updatedAt: now };

  if (status === "disabled") {
    return {
      ...base,
      mode: "local",
      label: "Local",
      detail: "Working on this device. No cloud persistence is configured.",
      cloud: false,
      identified: false,
      actionable: false,
    };
  }

  if (!hasNetwork) {
    return {
      ...base,
      mode: "offline",
      label: "Offline",
      detail: "No network. Changes are kept on this device and sync when the connection returns.",
      cloud: true,
      identified: status === "connected" || status === "degraded",
      actionable: false,
    };
  }

  if (status === "connecting") {
    return {
      ...base,
      mode: "syncing",
      label: "Syncing",
      detail: "Connecting to cloud persistence and reconciling local state.",
      cloud: true,
      identified: false,
      actionable: false,
    };
  }

  if (status === "signed_out") {
    return {
      ...base,
      mode: "local",
      label: "Local",
      detail: "Cloud persistence is configured but nobody is signed in. Sign in to sync this device.",
      cloud: false,
      identified: false,
      // The one case the user can actually fix.
      actionable: true,
    };
  }

  if (status === "degraded") {
    return {
      ...base,
      mode: "degraded",
      label: "Degraded",
      detail: "Signed in, but some cloud writes are failing. Local state is authoritative until they succeed.",
      cloud: true,
      identified: true,
      actionable: false,
    };
  }

  return {
    ...base,
    mode: "connected",
    label: "Connected",
    detail: "Local and cloud state are in sync.",
    cloud: true,
    identified: true,
    actionable: false,
  };
}

export default class PersistenceStateStore {
  private static instance: PersistenceStateStore | null = null;

  private readonly listeners = new Set<Listener>();
  private snapshot: PersistenceSnapshot = describe("disabled");
  private attached = false;
  private detach: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): PersistenceStateStore {
    if (!PersistenceStateStore.instance) {
      PersistenceStateStore.instance = new PersistenceStateStore();
    }
    return PersistenceStateStore.instance;
  }

  /**
   * Begin following the persistence layer and the network.
   *
   * Idempotent: Genesis mounts under StrictMode, so this runs twice on
   * every boot in development and must not end up with two
   * subscriptions publishing the same transition.
   */
  public attach(): void {
    if (this.attached) return;
    this.attached = true;

    const persistence = SupabasePersistence.getInstance();
    const unsubscribe = persistence.subscribeAuth((state) => {
      this.publish(describe(state.status));
    });

    const onNetwork = (): void => {
      this.publish(describe(SupabasePersistence.getInstance().getStatus()));
    };
    const target = globalThis as {
      addEventListener?: (type: string, fn: () => void) => void;
      removeEventListener?: (type: string, fn: () => void) => void;
    };
    target.addEventListener?.("online", onNetwork);
    target.addEventListener?.("offline", onNetwork);

    this.detach = () => {
      unsubscribe();
      target.removeEventListener?.("online", onNetwork);
      target.removeEventListener?.("offline", onNetwork);
    };
  }

  public stop(): void {
    this.detach?.();
    this.detach = null;
    this.attached = false;
  }

  public get(): PersistenceSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  /** Publish only real transitions — a status echo must not re-render. */
  private publish(next: PersistenceSnapshot): void {
    if (next.mode === this.snapshot.mode && next.detail === this.snapshot.detail) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // A UI listener must never break persistence reporting.
      }
    }
  }
}
