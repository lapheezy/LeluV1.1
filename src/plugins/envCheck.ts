/**
 * ==========================================================
 * LÉLU
 * ENV DIAGNOSTIC — lightweight server endpoint
 * ==========================================================
 *
 * Adds a GET /api/env-check route that verifies whether the
 * VITE_GROQ_API_KEY and VITE_OPENROUTER_API_KEY environment
 * variables are present and non-empty at server startup.
 *
 * This is a dev-only diagnostic tool.
 * ==========================================================
 */

import { loadEnv } from "vite";

export default function envCheckPlugin() {
  return {
    name: "env-check",
    configureServer(server: any) {
      server.middlewares.use("/api/env-check", (_req: any, res: any) => {
        const env = loadEnv("development", process.cwd(), "");
        const groqKey = env.VITE_GROQ_API_KEY || "";
        const openrouterKey = env.VITE_OPENROUTER_API_KEY || "";
        const groqModel = env.VITE_GROQ_MODEL || "";
        const defaultProvider = env.VITE_DEFAULT_PROVIDER || "";

        const response = {
          VITE_GROQ_API_KEY: groqKey ? `SET (${groqKey.length} chars, starts with ${groqKey.substring(0, 4)}...)` : "MISSING",
          VITE_OPENROUTER_API_KEY: openrouterKey ? `SET (${openrouterKey.length} chars)` : "MISSING",
          VITE_GROQ_MODEL: groqModel || "MISSING",
          VITE_DEFAULT_PROVIDER: defaultProvider || "MISSING",
          serverCwd: process.cwd(),
        };

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(response, null, 2));
      });
    },
  };
}
