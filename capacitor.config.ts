/**
 * ==========================================================
 * LÉLU — CAPACITOR WRAPPER CONFIGURATION
 *
 * This wraps the existing Vite/React web app in a native
 * Android shell. It does not replace or duplicate the web
 * application: the same `dist/` build is served inside the
 * WebView, and the same backend/provider architecture runs.
 *
 * Build order (also encoded in .github/workflows/android-apk.yml):
 *   1. `bun run build`  → emits `dist/`
 *   2. `cap add android` + `cap sync android` → copies `dist/`
 *      into the Android project's assets
 *   3. `./gradlew assembleDebug` → installable debug APK
 * ==========================================================
 */

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.lelu.app",
  appName: "LÉLU",
  webDir: "dist",

  server: {
    // Serve the bundled assets over the https scheme so secure
    // browser APIs (clipboard, camera, microphone, media) keep
    // working inside the WebView the same way they do on the web.
    androidScheme: "https",
  },

  android: {
    // Match the web app's dark canvas so there is no white flash
    // while the WebView attaches.
    backgroundColor: "#020617",
  },
};

export default config;
