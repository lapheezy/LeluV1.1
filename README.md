# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Android (Capacitor) build

The web app is wrapped in a Capacitor Android shell (see
`capacitor.config.ts`). The build happens entirely in the cloud via
GitHub Actions — no local computer or Android Studio required.

1. Push to `main`, or run **Actions → "Build Android APK" → Run workflow**.
2. When the run completes, download **`LELU-Android-debug.apk`** from the
   run's **Artifacts** section.
3. On your phone, allow "Install unknown apps" for your browser/files app
   and open the APK to install it.

Pipeline (`.github/workflows/android-apk.yml`):
`bun install` → `bun run build` → `cap add android` → `capacitor-assets`
(launcher icon + splash) → `scripts/prepare-android.mjs` (runtime
permissions + SDK path) → `cap sync` → `./gradlew assembleDebug` →
upload the APK artifact.

Local equivalents (after `bun install`): `bun run android:add`,
`bun run android:assets`, `bun run android:sync`, `bun run android:apk`.
