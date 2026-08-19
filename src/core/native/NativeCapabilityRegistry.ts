/**
 * ==========================================================
 * LÉLU
 * NATIVE / DEVICE CAPABILITY REGISTRY
 *
 * Singleton — same pattern as AIProviderRegistry, AIService and
 * VoiceEngine. Holds every device capability LÉLU can reach and
 * is the single source of truth for "what can LÉLU actually do
 * on this device".
 *
 *   - register()   — one capability
 *   - snapshot()   — resolved statuses for UI + cognition (never throws)
 *   - invoke()     — execute a capability through its REAL path,
 *                    with availability + permission gating
 *   - subscribe()  — the Device panel listens for state changes
 *
 * Nothing here fakes a capability: if the platform does not
 * expose the mechanism, isAvailable() is false and invoke()
 * returns a clear error.
 * ==========================================================
 */

import type {
  CapabilityResult,
  CapabilityStatus,
  NativeCapability,
  PermissionState,
} from "./NativeCapability";

type RegistryListener = () => void;

export default class NativeCapabilityRegistry {
  private static instance: NativeCapabilityRegistry | null = null;

  private readonly capabilities = new Map<string, NativeCapability>();
  private readonly listeners = new Set<RegistryListener>();

  private constructor() {}

  public static getInstance(): NativeCapabilityRegistry {
    if (!NativeCapabilityRegistry.instance) {
      NativeCapabilityRegistry.instance = new NativeCapabilityRegistry();
    }
    return NativeCapabilityRegistry.instance;
  }

  public register(capability: NativeCapability): void {
    this.capabilities.set(capability.id, capability);
    this.notify();
  }

  public registerMany(capabilities: NativeCapability[]): void {
    for (const capability of capabilities) {
      this.capabilities.set(capability.id, capability);
    }
    this.notify();
  }

  public get(id: string): NativeCapability | undefined {
    return this.capabilities.get(id);
  }

  public all(): NativeCapability[] {
    return Array.from(this.capabilities.values());
  }

  public has(id: string): boolean {
    return this.capabilities.has(id);
  }

  public subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("[Lélu Native] registry listener threw (contained)", error);
      }
    }
  }

  /** Resolve one capability's live status. Never throws. */
  public async statusOf(capability: NativeCapability): Promise<CapabilityStatus> {
    let available = false;
    let permissionState: PermissionState = "unknown";
    try {
      available = Boolean(await capability.isAvailable());
    } catch (error) {
      available = false;
      console.error(`[Lélu Native] ${capability.id} isAvailable() threw (contained)`, error);
    }
    try {
      permissionState = await capability.permissionState();
    } catch (error) {
      permissionState = "unknown";
      console.error(`[Lélu Native] ${capability.id} permissionState() threw (contained)`, error);
    }

    return {
      id: capability.id,
      title: capability.title,
      category: capability.category,
      available,
      permissionState,
      requiredPermission: capability.requiredPermission,
      reason: !available ? capability.unavailableReason : undefined,
      standaloneOnly: capability.standaloneOnly,
      requiresRemote: capability.requiresRemote,
    };
  }

  /** Resolved status for every registered capability. Never throws. */
  public async snapshot(): Promise<CapabilityStatus[]> {
    const statuses: CapabilityStatus[] = [];
    for (const capability of this.capabilities.values()) {
      statuses.push(await this.statusOf(capability));
    }
    return statuses;
  }

  /**
   * Execute a capability through its REAL path with gating:
   * unavailable → clear error; permission not granted → error
   * naming the permission; otherwise the adapter runs and must
   * report its own honest success/failure.
   */
  public async invoke(
    id: string,
    payload: Record<string, unknown> = {},
  ): Promise<CapabilityResult> {
    const capability = this.capabilities.get(id);

    if (!capability) {
      return { ok: false, error: `Capability "${id}" is not registered.` };
    }

    let available = false;
    try {
      available = Boolean(await capability.isAvailable());
    } catch {
      available = false;
    }

    if (!available) {
      return {
        ok: false,
        state: "unknown",
        error: capability.unavailableReason ?? `${capability.title} is not available on this device.`,
      };
    }

    let permissionState: PermissionState = "authorized";
    try {
      permissionState = await capability.permissionState();
    } catch {
      permissionState = "unknown";
    }

    if (capability.requiredPermission && permissionState === "denied") {
      return {
        ok: false,
        state: permissionState,
        error: `${capability.title} permission is denied. Enable it in Settings → Privacy & Security → ${capability.requiredPermission}.`,
      };
    }

    if (capability.requiredPermission && permissionState === "restricted") {
      return {
        ok: false,
        state: permissionState,
        error: `${capability.title} is restricted on this device (parental controls / MDM).`,
      };
    }

    try {
      const result = await capability.execute(payload);
      this.notify();
      return { ...result, state: result.state ?? permissionState };
    } catch (error) {
      return {
        ok: false,
        state: permissionState,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Clear (used by tests). */
  public clear(): void {
    this.capabilities.clear();
    this.notify();
  }
}
