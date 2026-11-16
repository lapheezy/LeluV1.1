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
import MissionLedgerStore, {
  type MissionSyncSummary,
} from "../projects/MissionLedger";
import MissionSyncGate from "../projects/MissionSyncGate";
import ContinuityEngine from "../sync/ContinuityEngine";

export type PersistenceMode =
  | "local"
  | "syncing"
  | "connected"
  | "degraded"
  | "offline";

export type RemotePersistenceState =
  | "local-only"
  | "signed-out"
  | "connected"
  | "queued"
  | "synchronizing"
  | "synchronized"
  | "conflict"
  | "failed"
  | "offline";

/** A per-domain answer. Cloud success never speaks for the mission ledger. */
export interface PersistenceDomainSnapshot {
  local: boolean;
  remote: RemotePersistenceState;
  synchronized: boolean;
  detail: string;
}

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
  /** Domain-specific truth; the global mode is only a summary. */
  domains: {
    cloud: PersistenceDomainSnapshot;
    missionLedger: PersistenceDomainSnapshot;
  };
  updatedAt: number;
}

export const EMPTY_MISSION_SYNC_SUMMARY: MissionSyncSummary = {
  total: 0,
  local: 0,
  queued: 0,
  synchronizing: 0,
  synchronized: 0,
  conflict: 0,
  failed: 0,
};

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
function cloudDomain(
  status: SupabasePersistenceStatus,
  hasNetwork: boolean,
): PersistenceDomainSnapshot {
  if (status === "disabled") {
    return {
      local: true,
      remote: "local-only",
      synchronized: false,
      detail: "Cloud persistence is not configured; this domain is local-only.",
    };
  }
  if (!hasNetwork) {
    return {
      local: true,
      remote: "offline",
      synchronized: false,
      detail: "Cloud-backed stores are waiting for the network; local copies remain usable.",
    };
  }
  if (status === "connecting") {
    return {
      local: true,
      remote: "synchronizing",
      synchronized: false,
      detail: "Cloud-backed stores are reconnecting and reconciling.",
    };
  }
  if (status === "signed_out") {
    return {
      local: true,
      remote: "signed-out",
      synchronized: false,
      detail: "Cloud-backed stores have no authenticated session.",
    };
  }
  if (status === "degraded") {
    return {
      local: true,
      remote: "failed",
      synchronized: false,
      detail: "Some cloud-backed writes are failing; local copies are authoritative.",
    };
  }
  return {
    local: true,
    // `connected` is the client's condition. Hydration and per-store write
    // success are not proven by it, so this domain does not claim sync.
    remote: "connected",
    synchronized: false,
    detail:
      "Authenticated and connected, but this status alone does not prove every cloud-backed store finished reconciling.",
  };
}

/**
 * MissionLedger's remote state is decided only by its own labels and its own
 * authorization gate. It is never inherited from Supabase's connectivity.
 */
function missionDomain(
  status: SupabasePersistenceStatus,
  hasNetwork: boolean,
  summary: MissionSyncSummary,
  syncAvailable: boolean,
): PersistenceDomainSnapshot {
  const reason = syncAvailable
    ? ""
    : " No mission sync adapter is registered and the remote-sync gate is closed, so cloud connectivity does not synchronize mission records.";

  let remote: RemotePersistenceState;
  if (summary.conflict > 0) remote = "conflict";
  else if (summary.failed > 0) remote = "failed";
  else if (summary.synchronizing > 0) remote = "synchronizing";
  else if (summary.queued > 0) remote = "queued";
  else if (status === "signed_out") remote = "signed-out";
  else if (!hasNetwork) remote = "offline";
  else if (!syncAvailable) remote = "local-only";
  else if (summary.total > 0 && summary.synchronized === summary.total) remote = "synchronized";
  else remote = "local-only";

  // Remote transport labels alone are not enough: without an open gate the
  // ledger is still local-only, even if imported data carries a stale label.
  const synchronized = syncAvailable && remote === "synchronized";
  if (!syncAvailable) remote = status === "signed_out" ? "signed-out" : !hasNetwork ? "offline" : "local-only";

  const counts =
    summary.total === 0
      ? "No mission records are stored yet."
      : `${summary.total} mission record${summary.total === 1 ? " is" : "s are"} held locally` +
        ` (${summary.local} local, ${summary.queued} queued, ${summary.synchronizing} synchronizing,` +
        ` ${summary.synchronized} synchronized, ${summary.conflict} conflict, ${summary.failed} failed).`;

  return {
    local: true,
    remote,
    synchronized,
    detail: synchronized
      ? `${counts} Every mission record is acknowledged by the authorized remote adapter.`
      : `${counts} Not remotely synchronized.${reason}`,
  };
}

/**
 * Translate the client's condition into the data's condition.
 *
 * `disabled` is the case worth being careful about: no Supabase
 * configuration is not a fault, it is local-only operation, and
 * reporting it as an error taught the user to ignore the indicator.
 *
 * The fourth argument is deliberately explicit: mission sync availability
 * cannot be inferred from `status` or from an unrelated successful write.
 */
export function describe(
  status: SupabasePersistenceStatus,
  hasNetwork = online(),
  missions: MissionSyncSummary = EMPTY_MISSION_SYNC_SUMMARY,
  missionSyncAvailable = false,
): PersistenceSnapshot {
  const now = Date.now();
  const cloud = cloudDomain(status, hasNetwork);
  const missionLedger = missionDomain(status, hasNetwork, missions, missionSyncAvailable);
  const base = { updatedAt: now, domains: { cloud, missionLedger } };

  if (status === "disabled") {
    return {
      ...base,
      mode: "local",
      label: "Local",
      detail: "Working on this device. No cloud persistence is configured. Mission records are local-only.",
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
      detail:
        "No network. Changes are kept on this device. Mission records remain local-only until an authorized mission sync adapter exists.",
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
      detail:
        "Connecting to cloud persistence and reconciling cloud-backed stores. Mission records remain local-only.",
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
      detail:
        "Cloud persistence is configured but nobody is signed in. Sign in to sync cloud-backed stores. Mission records remain local-only.",
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
      detail:
        "Signed in, but some cloud writes are failing. Local state is authoritative. Mission records remain local-only.",
      cloud: true,
      identified: true,
      actionable: false,
    };
  }

  return {
    ...base,
    mode: "connected",
    label: "Connected",
    // This is the statement that must never overreach: connected applies to
    // the cloud-backed domain that actually connected, not to MissionLedger.
    detail:
      "Cloud persistence is connected for its configured stores. Mission records remain local-only; no remote mission sync is active.",
    cloud: true,
    identified: true,
    actionable: false,
  };
}

export default class PersistenceStateStore {
  private static instance: PersistenceStateStore | null = null;

  private readonly listeners = new Set<Listener>();
  private snapshot: PersistenceSnapshot = this.describeCurrent("disabled");
  private attached = false;
  private detach: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): PersistenceStateStore {
    if (!PersistenceStateStore.instance) {
      PersistenceStateStore.instance = new PersistenceStateStore();
    }
    return PersistenceStateStore.instance;
  }

  /** Read mission counts without letting a ledger fault break status. */
  private describeCurrent(status: SupabasePersistenceStatus): PersistenceSnapshot {
    let missions = EMPTY_MISSION_SYNC_SUMMARY;
    try {
      missions = MissionLedgerStore.getInstance().syncSummary();
    } catch {
      // Keep the status surface alive; the ledger remains the owner of its
      // own recovery and write-failure reporting.
    }
    const snapshot = describe(status, online(), missions, MissionSyncGate.getInstance().available());
    try {
      const continuity = ContinuityEngine.getInstance().status();
      const detail = continuity.pending > 0 || continuity.conflicts > 0
        ? `${snapshot.detail} Continuity: ${continuity.pending} pending, ${continuity.conflicts} conflict(s).`
        : snapshot.detail;
      if (continuity.conflicts > 0) {
        return {
          ...snapshot,
          mode: "degraded",
          label: "Conflict",
          detail: `${detail} Resolve the conflict before this record is considered synchronized.`,
        };
      }
      return { ...snapshot, detail };
    } catch {
      return snapshot;
    }
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
      this.publish(this.describeCurrent(state.status));
    });

    const onNetwork = (): void => {
      this.publish(this.describeCurrent(SupabasePersistence.getInstance().getStatus()));
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
    if (
      next.mode === this.snapshot.mode &&
      next.detail === this.snapshot.detail &&
      next.domains.missionLedger.remote === this.snapshot.domains.missionLedger.remote
    ) {
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
