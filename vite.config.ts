import { vlyPlugin } from "@vly-ai/integrations";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";

import glslIncludes from "./plugins/glslIncludes.js";
import { createAisBridge } from "./plugins/aisBridgePlugin.ts";
import { engineerApiPlugin } from "./plugins/engineerApi.ts";
import { createNodeEngineerAdapter } from "./plugins/nodeAdapters.ts";
import { createEnvApi } from "./plugins/envApi.ts";
import { createInstagramApi } from "./plugins/instagramApi.ts";
import { createRssApi } from "./plugins/rssApi.ts";
import { createBrowseApi } from "./plugins/browseApi.ts";
import { createQuad9Api } from "./plugins/quad9Plugin.ts";
import { createNekoApi } from "./plugins/nekoApi.ts";
import { githubApiPlugin } from "./plugins/githubApi.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // AISStream key: server-only (non-VITE) — read once here, passed into
  // the bridge instance, never exposed to the browser bundle.
  const aisKey = process.env.AISSTREAM_API_KEY || env.AISSTREAM_API_KEY || "";
  const aisBridge = createAisBridge({ apiKey: aisKey });

  const envReader = (key: string) => env[key] ?? process.env[key] ?? "";
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
  const quad9Api = createQuad9Api(envReader);
  const nekoApi = createNekoApi(envReader);
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

  return {
    // Support Supabase's documented NEXT_PUBLIC_* names alongside the
    // existing Vite convention without exposing any server-only secrets.
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    base: "/",

    plugins: [
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
        },
        configurePreviewServer(server: any) {
          browseApi.attach(server.middlewares);
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

      githubApiPlugin(),

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

    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      hmr: false,
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

    resolve: {
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
