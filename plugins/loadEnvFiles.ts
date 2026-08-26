/**
 * ==========================================================
 * LÉLU — ENV-FILE LOADER (shared, framework-free)
 *
 * The standalone runtime server (server.ts) and the Deno entry
 * (main.ts) must read the project's existing environment files
 * the same way Vite's `loadEnv` does — otherwise a runtime that
 * serves the app reports providers as NOT_CONFIGURED even though
 * the keys exist in .env / .env.local.
 *
 * Precedence (deterministic, matches Vite):
 *
 *   1. process env (platform-injected / shell)   — always wins
 *   2. .env.local                                — overrides .env
 *   3. .env                                      — base config
 *
 * A key already present in process.env is NEVER overwritten, so
 * deployment platforms that inject secrets directly keep working.
 * Files are parsed as `KEY=VALUE` lines; `export ` prefixes and
 * surrounding quotes are tolerated; comments/blank lines skipped.
 *
 * Vite itself is NOT wired through this loader: it has its own
 * canonical `loadEnv(mode, cwd, "")` which already implements
 * the same precedence. This loader exists so the non-Vite
 * runtimes behave identically.
 * ==========================================================
 */

export interface EnvFileSummary {
  filesLoaded: string[];
  /** key name → whether it was loaded (true = set with non-empty value) */
  keys: Record<string, boolean>;
}

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  // strip matching surrounding quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key: match[1], value };
}

import { readFileSync } from "node:fs";

function readFileLines(filePath: string): string[] {
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

/**
 * Load .env.local then .env into the given lookup, filling only
 * keys that are not already set. Returns which files were found
 * and which tracked keys ended up defined (names only — never
 * values, so it is safe to log).
 */
export function loadEnvFiles(
  lookup: { get: (key: string) => string | undefined; set: (key: string, value: string) => void },
  watchedKeys: string[] = [],
): EnvFileSummary {
  const filesLoaded: string[] = [];
  const keys: Record<string, boolean> = {};
  for (const key of watchedKeys) keys[key] = false;

  // lowest precedence first — later files may override, and process
  // env always wins because we only fill unset keys.
  const order = [".env", ".env.local"];

  for (const file of order) {
    const lines = readFileLines(file);
    if (lines.length === 0) continue;
    filesLoaded.push(file);
    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      const current = lookup.get(parsed.key);
      if (current === undefined || current === "") {
        lookup.set(parsed.key, parsed.value);
      }
    }
  }

  for (const key of watchedKeys) {
    const value = lookup.get(key);
    keys[key] = Boolean(value && value.length > 0);
  }
  return { filesLoaded, keys };
}

/** Convenience: load into process.env (Node/Bun). */
export function loadEnvFilesIntoProcess(watchedKeys: string[] = []): EnvFileSummary {
  return loadEnvFiles(
    {
      get: (key) => process.env[key],
      set: (key, value) => {
        process.env[key] = value;
      },
    },
    watchedKeys,
  );
}
