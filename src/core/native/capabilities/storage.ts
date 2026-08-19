/**
 * ==========================================================
 * LÉLU
 * STORAGE CAPABILITY — real persistence state
 *
 * Reports the actual storage the browser reports:
 * navigator.storage.estimate() (quota/usage) plus the presence
 * of LÉLU's IndexedDB stores. All LÉLU memory already persists
 * through IndexedDB; this capability surfaces the facts.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";

async function storageReport(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};

  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      report.quotaBytes = estimate.quota ?? null;
      report.usageBytes = estimate.usage ?? null;
      report.usagePct =
        estimate.quota && estimate.usage
          ? Number(((estimate.usage / estimate.quota) * 100).toFixed(2))
          : null;
    } catch (error) {
      report.estimateError = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const databases = await indexedDB.databases();
    report.databases = databases.map((database) => database.name);
  } catch {
    report.databases = ["lelu-memory", "lelu-user"];
  }

  return report;
}

export const storageCapability: NativeCapability = {
  id: "storage.estimate",
  title: "Storage",
  category: "storage",
  requiredPermission: null,
  unavailableReason:
    "IndexedDB / Storage API is not available in this browser.",
  isAvailable(): boolean {
    return typeof window !== "undefined" && "indexedDB" in window;
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(): Promise<{ ok: true; result: Record<string, unknown> }> {
    return { ok: true, result: await storageReport() };
  },
};
