import { vlyPlugin } from "@vly-ai/integrations";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import glslIncludes from "./plugins/glslIncludes.js";

function envCheckPlugin() {
  return {
    name: "env-check",
    configureServer(server: any) {
      server.middlewares.use("/api/env-check", (_req: any, res: any) => {
        const env = loadEnv("development", process.cwd(), "");
        const groqKey = env.VITE_GROQ_API_KEY || "";
        const openrouterKey = env.VITE_OPENROUTER_API_KEY || "";
        const response = {
          VITE_GROQ_API_KEY: groqKey ? `SET (${groqKey.length} chars)` : "MISSING",
          VITE_OPENROUTER_API_KEY: openrouterKey ? `SET (${openrouterKey.length} chars)` : "MISSING",
          VITE_GROQ_MODEL: env.VITE_GROQ_MODEL || "MISSING",
          VITE_DEFAULT_PROVIDER: env.VITE_DEFAULT_PROVIDER || "MISSING",
        };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(response, null, 2));
      });

      // Live provider health check — tests Groq API connectivity from the server
      server.middlewares.use("/api/provider-health", async (_req: any, res: any) => {
        const env = loadEnv("development", process.cwd(), "");
        const groqKey = env.VITE_GROQ_API_KEY || "";
        const openrouterKey = env.VITE_OPENROUTER_API_KEY || "";
        const results: Record<string, any> = {};

        // Test Groq
        if (groqKey) {
          try {
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${groqKey}`,
              },
              body: JSON.stringify({
                model: env.VITE_GROQ_MODEL || "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: "Say OK" }],
                max_tokens: 5,
              }),
              signal: AbortSignal.timeout(15000),
            });
            const body = await groqRes.text();
            results.groq = {
              status: groqRes.status,
              ok: groqRes.ok,
              response: groqRes.ok ? "OK" : body.slice(0, 200),
            };
          } catch (e: any) {
            results.groq = { status: "error", error: e.message };
          }
        } else {
          results.groq = { status: "missing-key" };
        }

        // Test OpenRouter
        if (openrouterKey) {
          try {
            const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openrouterKey}`,
                "HTTP-Referer": "https://freebuff.com",
                "X-Title": "Lélu",
              },
              body: JSON.stringify({
                model: "openrouter/free",
                messages: [{ role: "user", content: "Say OK" }],
                max_tokens: 5,
              }),
              signal: AbortSignal.timeout(15000),
            });
            const body = await orRes.text();
            results.openrouter = {
              status: orRes.status,
              ok: orRes.ok,
              response: orRes.ok ? "OK" : body.slice(0, 200),
            };
          } catch (e: any) {
            results.openrouter = { status: "error", error: e.message };
          }
        } else {
          results.openrouter = { status: "missing-key" };
        }

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(results, null, 2));
      });
    },
  };
}

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

    envCheckPlugin(),

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