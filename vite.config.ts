import { vlyPlugin } from "@vly-ai/integrations";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import glslIncludes from "./plugins/glslIncludes.js";

function sandboxApiPlugin() {
  const workspaceRoot = process.cwd();

  function resolveWithinWorkspace(targetPath: string) {
    const absoluteTarget = path.resolve(workspaceRoot, targetPath);
    if (!absoluteTarget.startsWith(workspaceRoot)) {
      throw new Error("Sandbox path escapes workspace root.");
    }
    return absoluteTarget;
  }

  function sendJson(res: any, payload: unknown, status = 200) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  }

  function readJsonBody(req: any) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let body = "";
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      });
      req.on("error", reject);
    });
  }

  return {
    name: "sandbox-api",
    configureServer(server: any) {
      server.middlewares.use("/api/engineer", async (req: any, res: any, next: () => void) => {
        if (!req.url) {
          next();
          return;
        }

        const [route] = req.url.split("?");
        if (req.method !== "POST") {
          next();
          return;
        }

        try {
          const payload = await readJsonBody(req);

          if (route === "/api/engineer/command") {
            const command = String(payload.command ?? "");
            const result = spawnSync(command, {
              cwd: workspaceRoot,
              shell: true,
              encoding: "utf8",
              env: { ...process.env, FORCE_COLOR: "0" },
            });
            sendJson(res, {
              ok: result.status === 0,
              status: result.status ?? 1,
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
            });
            return;
          }

          if (route === "/api/engineer/read") {
            const filePath = String(payload.path ?? "");
            const absolutePath = resolveWithinWorkspace(filePath);
            const content = readFileSync(absolutePath, "utf8");
            sendJson(res, { ok: true, path: filePath, content });
            return;
          }

          if (route === "/api/engineer/write") {
            const filePath = String(payload.path ?? "");
            const content = String(payload.content ?? "");
            const absolutePath = resolveWithinWorkspace(filePath);
            mkdirSync(path.dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, content, "utf8");
            sendJson(res, { ok: true, path: filePath });
            return;
          }
        } catch (error) {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
          return;
        }

        next();
      });
    },
    configurePreviewServer(server: any) {
      server.middlewares.use("/api/engineer", async (req: any, res: any, next: () => void) => {
        if (!req.url) {
          next();
          return;
        }

        const [route] = req.url.split("?");
        if (req.method !== "POST") {
          next();
          return;
        }

        try {
          const payload = await readJsonBody(req);
          if (route === "/api/engineer/command") {
            const command = String(payload.command ?? "");
            const result = spawnSync(command, {
              cwd: workspaceRoot,
              shell: true,
              encoding: "utf8",
              env: { ...process.env, FORCE_COLOR: "0" },
            });
            sendJson(res, {
              ok: result.status === 0,
              status: result.status ?? 1,
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
            });
            return;
          }

          if (route === "/api/engineer/read") {
            const filePath = String(payload.path ?? "");
            const absolutePath = resolveWithinWorkspace(filePath);
            const content = readFileSync(absolutePath, "utf8");
            sendJson(res, { ok: true, path: filePath, content });
            return;
          }

          if (route === "/api/engineer/write") {
            const filePath = String(payload.path ?? "");
            const content = String(payload.content ?? "");
            const absolutePath = resolveWithinWorkspace(filePath);
            mkdirSync(path.dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, content, "utf8");
            sendJson(res, { ok: true, path: filePath });
            return;
          }
        } catch (error) {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {

  base: "/",

  plugins: [vlyPlugin(), 

    react(),

    sandboxApiPlugin(),

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

    hmr: {

      host: "localhost",

      clientPort: 5173,

      protocol: "ws",

    },

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