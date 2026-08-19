/**
 * ==========================================================
 * LÉLU — ANDROID PROJECT PREPARATION (runs in CI only)
 *
 * Capacitor generates the Android project with just the INTERNET
 * permission. LÉLU's existing voice and camera systems use the same
 * browser APIs the web build already uses, so we declare the two
 * permissions those features need at runtime. We deliberately do NOT
 * add storage, location, or any permission the app does not use.
 *
 * This script is run after `cap add android` + `capacitor-assets`
 * and before `./gradlew assembleDebug`. It never touches the web app.
 * ==========================================================
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, "android/app/src/main/AndroidManifest.xml");

let manifest = readFileSync(manifestPath, "utf8");

const permissions = [
  '    <uses-permission android:name="android.permission.CAMERA" />',
  '    <uses-permission android:name="android.permission.RECORD_AUDIO" />',
];

let added = 0;
for (const permission of permissions) {
  // Idempotent: match on the permission name, not the whitespace.
  const name = permission.match(/android\.permission\.[A-Z_]+/)?.[0];
  if (name && !manifest.includes(name)) {
    manifest = manifest.replace("</manifest>", `${permission}\n</manifest>`);
    added += 1;
  }
}

writeFileSync(manifestPath, manifest, "utf8");
console.log(`prepare-android: injected ${added} runtime permission(s)`);

// Gradle finds the SDK through ANDROID_HOME/ANDROID_SDK_ROOT on the
// runner, but writing local.properties makes the build explicit and
// avoids any AGP lookup ambiguity.
const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (sdkDir) {
  const localProperties = resolve(root, "android/local.properties");
  writeFileSync(localProperties, `sdk.dir=${sdkDir}\n`, "utf8");
  console.log(`prepare-android: wrote local.properties (sdk.dir=${sdkDir})`);
} else {
  console.log("prepare-android: ANDROID_HOME not set, relying on Gradle defaults");
}
