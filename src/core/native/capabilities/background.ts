/**
 * ==========================================================
 * LÉLU
 * BACKGROUND CAPABILITY — honest iOS web limits
 *
 * iOS permits service workers for INSTALLED web apps, but the
 * background execution model is strictly limited: no Background
 * Sync, no Periodic Background Sync, no Background Fetch, and
 * service workers are suspended shortly after the app leaves the
 * foreground. This capability reports exactly what the platform
 * reports — it never claims background execution exists.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { isStandalone } from "./helpers";

function swSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

async function backgroundReport(): Promise<Record<string, unknown>> {
  const syncSupported =
    typeof ServiceWorkerRegistration !== "undefined" &&
    "sync" in ServiceWorkerRegistration.prototype;
  const periodicSyncSupported =
    typeof ServiceWorkerRegistration !== "undefined" &&
    "periodicSync" in ServiceWorkerRegistration.prototype;
  const backgroundFetchSupported =
    typeof ServiceWorkerRegistration !== "undefined" &&
    "backgroundFetch" in ServiceWorkerRegistration.prototype;

  let registrationState: string | null = null;
  if (swSupported()) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      registrationState = registration ? registration.active ? "active" : "installing" : "none";
    } catch {
      registrationState = "unreachable";
    }
  }

  return {
    serviceWorkerSupported: swSupported(),
    standalone: isStandalone(),
    registrationState,
    backgroundSyncSupported: syncSupported,
    periodicSyncSupported,
    backgroundFetchSupported,
    note: "iOS permits service workers for installed web apps only, and suspends them shortly after backgrounding. There is no public iOS web API for arbitrary background execution.",
  };
}

export const backgroundCapability: NativeCapability = {
  id: "background.limited",
  title: "Background",
  category: "system",
  requiredPermission: null,
  unavailableReason:
    "iOS does not expose arbitrary background execution to web apps — service workers are limited and suspended when backgrounded.",
  standaloneOnly: true,
  isAvailable(): boolean {
    return swSupported();
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(): Promise<{ ok: true; result: Record<string, unknown> }> {
    return { ok: true, result: await backgroundReport() };
  },
};
