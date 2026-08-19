/**
 * ==========================================================
 * LÉLU
 * NATIVE / DEVICE CAPABILITIES — registration index
 *
 * Registers every device capability into the singleton
 * NativeCapabilityRegistry. Called once from AIService.initialize
 * (failure-safe, never blocks the runtime).
 * ==========================================================
 */

import NativeCapabilityRegistry from "./NativeCapabilityRegistry";

import { deviceCapability } from "./capabilities/device";
import { lifecycleCapability } from "./capabilities/lifecycle";
import { permissionsCapability } from "./capabilities/permissions";
import { microphoneCapability } from "./capabilities/mic";
import { cameraCapability } from "./capabilities/camera";
import { speechCapability } from "./capabilities/speech";
import { ttsCapability } from "./capabilities/tts";
import { mediaCapability } from "./capabilities/media";
import { clipboardCapability } from "./capabilities/clipboard";
import { shareCapability } from "./capabilities/share";
import { notificationsCapability } from "./capabilities/notifications";
import { pushCapability } from "./capabilities/push";
import { storageCapability } from "./capabilities/storage";
import { backgroundCapability } from "./capabilities/background";
import { networkCapability } from "./capabilities/network";
import { hapticsCapability } from "./capabilities/haptics";
import {
  deepLinkIntakeCapability,
  deepLinkRegisterCapability,
} from "./capabilities/deeplinks";
import { appIntentsCapability } from "./capabilities/appintents";
import { nativeBridgeCapability } from "./capabilities/nativebridge";
import { installCapability } from "./capabilities/install";

export function registerAllNativeCapabilities(): NativeCapabilityRegistry {
  const registry = NativeCapabilityRegistry.getInstance();

  registry.registerMany([
    deviceCapability,
    lifecycleCapability,
    permissionsCapability,
    microphoneCapability,
    cameraCapability,
    speechCapability,
    ttsCapability,
    mediaCapability,
    clipboardCapability,
    shareCapability,
    notificationsCapability,
    pushCapability,
    storageCapability,
    backgroundCapability,
    networkCapability,
    hapticsCapability,
    deepLinkIntakeCapability,
    deepLinkRegisterCapability,
    appIntentsCapability,
    nativeBridgeCapability,
    installCapability,
  ]);

  return registry;
}

export { NativeCapabilityRegistry };
export * from "./NativeCapability";
