import { vlyPlugin } from "@vly-ai/integrations";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import glsl from "vite-plugin-glsl";

import glslIncludes from "./plugins/glslIncludes.js";
import { createAisBridge } from "./plugins/aisBridgePlugin.ts";
import { engineerApiPlugin } from "./plugins/engineerApi.ts";
import { createIntegrationApi } from "./plugins/integrationApi.ts";
import { createNodeEngineerAdapter } from "./plugins/nodeAdapters.ts";
import { createEnvApi } from "./plugins/envApi.ts";
import { createModelApi } from "./plugins/modelApi.ts";
import { createAcquisitionApi } from "./plugins/acquisitionApi.ts";
import { createMeshyForgeApi } from "./plugins/meshyForgeApi.ts";
import { createInstagramApi } from "./plugins/instagramApi.ts";
import { createRssApi } from "./plugins/rssApi.ts";
import { createBrowseApi } from "./plugins/browseApi.ts";
import { createSourceCatalogApi } from "./plugins/sourceCatalogApi.ts";
import { createSelfViewApi } from "./plugins/selfViewApi.ts";
import { createStudioApi, stopAllStudioBackends } from "./plugins/studioApi.ts";
import { createAiProxyApi } from "./plugins/aiProxyApi.ts";
import { createQuad9Api } from "./plugins/quad9Plugin.ts";
import { createNekoApi } from "./plugins/nekoApi.ts";
import { githubApiPlugin } from "./plugins/githubApi.ts";
import { voiceApiPlugin } from "./plugins/voiceApi.ts";
import { runtimeKeyBridgePlugin, bridgeReport } from "./plugins/runtimeKeyBridge.ts";
import { fillBareSecretAliases } from "./plugins/bareSecretAliases.ts";
import { readBuildInfo } from "./plugins/buildInfo.ts";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // The platform writes .env.local from the project's secret store, under
  // the SECRET names (`Anthropic`, `Groq`, `Supabase`) — names no code
  // reads. Fill the documented names from them, only where the documented
  // name is absent, so a regenerated file cannot put the providers back to
  // "unconfigured" and the Supabase key cannot be orphaned again.
  const filledFromBareNames = fillBareSecretAliases({
    get: (key) => env[key],
    set: (key, value) => {
      env[key] = value;
    },
  });
  if (filledFromBareNames.length > 0) {
    console.info(`[env] bare secret names supplied ${filledFromBareNames.join(", ")}`);
  }
  // AISStream key: server-only (non-VITE) — read once here, passed into
  // the bridge instance, never exposed to the browser bundle.
  const aisKey = process.env.AISSTREAM_API_KEY || env.AISSTREAM_API_KEY || "";
  const aisBridge = createAisBridge({ apiKey: aisKey });

  const envReader = (key: string) => env[key] ?? process.env[key] ?? "";

  /*
   * Exact extra hosts the Cloud Browser serves this dev server under. Vite's
   * `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` hook only applies when
   * `allowedHosts` is already an array, so it is read here instead. Names come
   * from the environment only: unset means no extra host is allowed, and there
   * is no blanket allowlist.
   */
  const extraAllowedHosts = (process.env.LELU_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  // Report — by NAME only, never by value — which provider keys were
  // supplied under an unprefixed platform name and are therefore being
  // bridged onto the __LELU_*__ channel the providers already read.
  // Without this the key is present in the process yet invisible to the
  // browser bundle, and the provider reports itself unconfigured.
  const bridged = bridgeReport(envReader);
  if (bridged.length > 0) {
    console.info(
      "[runtime-key-bridge] publishing provider keys from unprefixed names:",
      bridged.map((b) => `${b.sourceName} → ${b.globalName}`).join(", "),
    );
  }

  const envApi = createEnvApi(
    envReader,
    "vite-dev",
    { aisStatus: () => aisBridge.getStatus() },
  );
  const instagramApi = createInstagramApi(envReader);
  const rssApi = createRssApi(envReader);
  // Server-side page reader: gives BrowserTool a CORS-free path so a
  // browsed page's TEXT can actually reach cognition (see browseApi.ts).
  const browseApi = createBrowseApi();
  // Evaluated source inventory + gated public-apis discovery (sourceCatalogApi.ts).
  const sourceCatalogApi = createSourceCatalogApi();
  // Server-side AI credential relay: the provider keys stay in the
  // server process and never reach the client bundle (aiProxyApi.ts).
  const aiProxyApi = createAiProxyApi(envReader);
  const quad9Api = createQuad9Api(envReader);
  const nekoApi = createNekoApi(envReader);
  // The same-origin model broker. Without it the page has to call a
  // provider directly, which needs the provider's CORS and the page's
  // own egress — and puts the API key in the bundle.
  const modelApi = createModelApi(envReader);
  // LÉLU 3D Forge: Meshy jobs, the credit ledger and the asset store. The
  // Meshy key is read here, server-side, and nowhere else.
  const forgeApi = createMeshyForgeApi(envReader, { poll: command === "serve" });
  function modelApiPlugin() {
    return {
      name: "model-api",
      configureServer(server: any) {
        modelApi.attach(server.middlewares);
        forgeApi.attach(server.middlewares);
      },
      configurePreviewServer(server: any) {
        modelApi.attach(server.middlewares);
        forgeApi.attach(server.middlewares);
      },
    };
  }
  function envApiPlugin() {
    return {
      name: "env-api",
      configureServer(server: any) {
        envApi.attach(server.middlewares);
      },
      configurePreviewServer(server: any) {
        envApi.attach(server.middlewares);
      },
    };
  }

  // What code this is — from git at start/build time, never typed by hand.
  const buildInfo = readBuildInfo(mode);
  console.info(`[build] LÉLU ${buildInfo.shortSha}${buildInfo.dirty ? "+dirty" : ""} on ${buildInfo.branch} (${mode}) at ${buildInfo.builtAt}`);

  return {
    define: {
      __LELU_BUILD__: JSON.stringify(buildInfo),
    },
    // Support Supabase's documented NEXT_PUBLIC_* names alongside the
    // existing Vite convention without exposing any server-only secrets.
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    base: "/",

    plugins: [
      // FIRST: publish bridged provider keys into <head> before any
      // module evaluates, so every provider's initialize() sees them.
      runtimeKeyBridgePlugin(envReader),
      modelApiPlugin(),

      // Repository acquisition: real git clones, isolated command execution,
      // versioning and approvals. The same runtime the standalone server mounts,
      // so a tool call in the browser reaches a real workspace operation.
      {
        name: "acquisition-api",
        configureServer(server: any) {
          createAcquisitionApi({
            runtime: "vite-dev",
            workspaceRoot: process.cwd(),
            acquisitionsRoot: `${process.cwd()}/.lelu-acquisitions`,
            githubToken: () =>
              envReader("GITHUB_TOKEN") ||
              envReader("GITHUB_READ_TOKEN") ||
              envReader("VITE_GITHUB_TOKEN") ||
              envReader("LELU_ACQUISITION_GITHUB_TOKEN"),
          }).attach(server.middlewares);
        },
        configurePreviewServer(server: any) {
          createAcquisitionApi({
            runtime: "vite-preview",
            workspaceRoot: process.cwd(),
            acquisitionsRoot: `${process.cwd()}/.lelu-acquisitions`,
            githubToken: () =>
              envReader("GITHUB_TOKEN") ||
              envReader("GITHUB_READ_TOKEN") ||
              envReader("VITE_GITHUB_TOKEN") ||
              envReader("LELU_ACQUISITION_GITHUB_TOKEN"),
          }).attach(server.middlewares);
        },
      },

      // Tailwind v4 — utilities for the OG interfaces only; see src/og/og.css
      // for why preflight is deliberately not part of that build.
      tailwindcss(),

      vlyPlugin(),

      {
        name: "ais-bridge",
        configureServer(server: any) {
          aisBridge.attach(server.middlewares);
        },
        configurePreviewServer(server: any) {
          aisBridge.attach(server.middlewares);
        },
      },

      react(),

      // The shared engineering runtime: POST /api/engineer/command|read|write
      // + GET /api/engineer/status, whitelisted + workspace-bounded. Same
      // middleware the standalone server (server.ts) mounts — the capability
      // is identical in dev and in the deployed runtime.
      engineerApiPlugin(createNodeEngineerAdapter("vite-dev")),

      // The intelligence integrations: real service probes, real OPA
      // decisions and real security scans (plugins/integrationApi.ts).
      // Same middleware the standalone server mounts, so a deployed runtime
      // reports the same real state instead of a dev-only view.
      {
        name: "lelu-integration-api",
        configureServer(server: any) {
          server.middlewares.use(createIntegrationApi({
            workspaceRoot: process.cwd(),
            runtime: "vite-dev",
            // Vite's use(fn) does not strip a prefix, so the handler must
            // claim its own paths explicitly or it answers every request.
            mountPath: "/api/integration",
            token: process.env.LELU_ENGINEER_TOKEN,
            allowedOrigins: (process.env.LELU_ENGINEER_ALLOWED_ORIGINS ?? "")
              .split(",")
              .map((origin) => origin.trim())
              .filter(Boolean),
          }));
        },
        configurePreviewServer(server: any) {
          server.middlewares.use(createIntegrationApi({
            workspaceRoot: process.cwd(),
            runtime: "vite-dev",
            mountPath: "/api/integration",
            token: process.env.LELU_ENGINEER_TOKEN,
            allowedOrigins: (process.env.LELU_ENGINEER_ALLOWED_ORIGINS ?? "")
              .split(",")
              .map((origin) => origin.trim())
              .filter(Boolean),
          }));
        },
      },

      // Her eyes: headless capture of pages and her own UI, workspace
      // previews, and code search (plugins/selfViewApi.ts).
      {
        name: "lelu-self-view",
        configureServer(server: any) {
          createSelfViewApi().attach(server.middlewares);
        },
      },

      // Session 3C — the software studio runtime: real scaffolds, builds,
      // tests, same-origin previews, approvals and deployment preparation.
      {
        name: "lelu-studio",
        configureServer(server: any) {
          createStudioApi().attach(server.middlewares);
          server.httpServer?.once("close", stopAllStudioBackends);
        },
        configurePreviewServer(server: any) {
          createStudioApi().attach(server.middlewares);
          server.httpServer?.once("close", stopAllStudioBackends);
        },
      },

      envApiPlugin(),

      {
        name: "instagram-api",
        configureServer(server: any) {
          instagramApi.attach(server.middlewares);
        },
        configurePreviewServer(server: any) {
          instagramApi.attach(server.middlewares);
        },
      },

      {
        name: "rss-api",
        configureServer(server: any) {
          rssApi.attach(server.middlewares);
        },
        configurePreviewServer(server: any) {
          rssApi.attach(server.middlewares);
        },
      },

      {
        name: "browse-api",
        configureServer(server: any) {
          browseApi.attach(server.middlewares);
          sourceCatalogApi.attach(server.middlewares);
        },
        configurePreviewServer(server: any) {
          browseApi.attach(server.middlewares);
          sourceCatalogApi.attach(server.middlewares);
        },
      },

      {
        name: "ai-proxy-api",
        configureServer(server: any) {
          aiProxyApi.attach(server.middlewares);
        },
        configurePreviewServer(server: any) {
          aiProxyApi.attach(server.middlewares);
        },
      },

      {
        name: "quad9-api",
        configureServer(server: any) {
          quad9Api.attach(server.middlewares);
        },
        configurePreviewServer(server: any) {
          quad9Api.attach(server.middlewares);
        },
      },

      {
        name: "neko-api",
        configureServer(server: any) {
          nekoApi.attach(server.middlewares);
        },
        configurePreviewServer(server: any) {
          nekoApi.attach(server.middlewares);
        },
      },

      githubApiPlugin(envReader),
      voiceApiPlugin(envReader),

      glslIncludes(),

      glsl({
        include: [
          "**/*.glsl",
          "**/*.vert",
          "**/*.frag",
        ],
        exclude: [
          "node_modules/**",
        ],
        warnDuplicatedImports: false,
        watch: true,
        compress: false,
      }),
    ],

    build: {
      /*
       * NO modulepreload LIST.
       *
       * This build emits ~1,700 chunks, and Vite was injecting a
       * <link rel="modulepreload"> for 674 of them into index.html. The
       * browser therefore started 674 script fetches the moment it read the
       * document — including every lazily-code-split panel, which is exactly
       * what code splitting exists to avoid. Measured through the preview
       * proxy: a burst of 120 requests returns 96x200 + 24x503, so the tail
       * of that storm fails, one chunk of the entry graph never arrives, and
       * the app never mounts; on any connection-limited network it is simply
       * the multi-second stall before the first frame.
       *
       * Chunks still load — every import and dynamic import fetches what it
       * needs. What is gone is the speculative prefetch of the entire
       * application at boot. Panels now load when they are opened, which is
       * what their lazy() already promised.
       */
      modulePreload: false,
    },

    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: extraAllowedHosts.length ? extraAllowedHosts : undefined,
      hmr: false,
      // LÉLU's workspace copies live in .lelu-sandbox. Watching them made
      // every copy and every edit she made there force a full reload of the
      // live app — ending the very chat turn doing the work.
      watch: { ignored: ["**/.lelu-sandbox/**"] },
      proxy: {
        "/api/ai": {
          target: "https://models.inference.ai.azure.com",
          changeOrigin: true,
          secure: true,
          headers: {
            Authorization: `Bearer ${env.VITE_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GITHUB_CODESPACE_TOKEN || ""}`,
          },
        },
      },
    },

    preview: {
      host: "0.0.0.0",
      port: 4173,
      strictPort: true,
      allowedHosts: extraAllowedHosts.length ? extraAllowedHosts : undefined,
      proxy: {
        "/api/ai": {
          target: "https://models.inference.ai.azure.com",
          changeOrigin: true,
          secure: true,
          headers: {
            Authorization: `Bearer ${env.VITE_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GITHUB_CODESPACE_TOKEN || ""}`,
          },
        },
      },
    },

    // The graph (React Flow) and drawing (Excalidraw) editors are lazy
    // chunks, so Vite would discover these only when one is first opened,
    // re-bundle mid-session and reload — leaving two React copies on that
    // page ("Cannot read properties of null (reading 'useState')").
    // Pre-bundled at server start instead. Dev only; the build is unchanged.
    optimizeDeps: {
      include: ["@xyflow/react", "@excalidraw/excalidraw"],
    },

    resolve: {
      alias: {
        // The OG interfaces keep their own import root so their sources stay
        // close to the originals; "@og/x" resolves to src/og/x.
        "@og": fileURLToPath(new URL("./src/og", import.meta.url)),
      },
      extensions: [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".json",
        ".glsl",
      ],
    },
  };
});
