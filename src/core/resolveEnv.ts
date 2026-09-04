/**
 * ==========================================================
 * LÉLU — CANONICAL ENVIRONMENT VALUE RESOLVER
 *
 * The single implementation of the four-rung lookup every
 * other config module performs:
 *
 *   1. import.meta.env.VITE_<NAME>   (browser bundle)
 *   2. globalThis.__LELU_<NAME>__    (runtime key bridge)
 *   3. window.__LELU_<NAME>__        (same object in a browser)
 *   4. process.env.<NAME>            (server runtimes, unprefixed)
 *
 * Environment.ts, Endpoints.ts and the providers each grew
 * their own copy of this walk, and every copy is a chance for
 * one of them to disagree with the others about whether a
 * setting is present — which is exactly the class of bug the
 * runtime key bridge exists to remove. New code resolves here.
 * ==========================================================
 */

/**
 * Resolve a configuration name across every rung, trying the
 * VITE_-prefixed form first at each rung that can carry it.
 * Returns undefined when nothing is set, never an empty string.
 */
export function resolveEnvValue(name: string): string | undefined {
  const viteName = name.startsWith("VITE_") ? name : `VITE_${name}`;

  try {
    const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const fromVite = viteEnv?.[viteName] ?? viteEnv?.[name];
    if (typeof fromVite === "string" && fromVite.trim()) return fromVite.trim();
  } catch {
    /* import.meta.env does not exist outside Vite — fall through */
  }

  const runtime = globalThis as unknown as Record<string, string | undefined>;
  const bare = name.startsWith("VITE_") ? name.slice("VITE_".length) : name;
  const fromGlobal = runtime[`__LELU_${bare}__`] ?? runtime[`__LELU_${name}__`];
  if (typeof fromGlobal === "string" && fromGlobal.trim()) return fromGlobal.trim();

  const processEnv =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined> | undefined)
      : undefined;
  const fromProcess = processEnv?.[viteName] ?? processEnv?.[name] ?? processEnv?.[bare];
  if (typeof fromProcess === "string" && fromProcess.trim()) return fromProcess.trim();

  return undefined;
}

/** First name that carries a value, in the order given. */
export function resolveFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const found = resolveEnvValue(name);
    if (found) return found;
  }
  return undefined;
}

/**
 * NASA's open APIs accept the shared `DEMO_KEY` without registration —
 * heavily rate-limited (a handful of requests an hour per IP) but real,
 * so a NASA-backed feature degrades to "slow" rather than "unavailable"
 * when no key is configured. That is the honest default here: the
 * request genuinely works, it is simply throttled.
 */
export function nasaApiKey(): string {
  return resolveFirst("NASA_API_KEY", "VITE_NASA_API_KEY") ?? "DEMO_KEY";
}

/**
 * Resolve ONLY the documented VITE_ form of a name, never the bare one.
 *
 * GitHubModelsProvider needs this: dev containers, Codespaces and CI
 * runners set an ambient GITHUB_TOKEN for git tooling that is not a
 * GitHub Models inference key, and adopting it would make the provider
 * report itself available and then spend a repo-scoped token against an
 * unrelated API. The token must be supplied explicitly.
 */
export function resolveViteOnly(bareName: string): string | undefined {
  const viteName = `VITE_${bareName}`;

  try {
    const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const fromVite = viteEnv?.[viteName];
    if (typeof fromVite === "string" && fromVite.trim()) return fromVite.trim();
  } catch {
    /* import.meta.env does not exist outside Vite */
  }

  const runtime = globalThis as unknown as Record<string, string | undefined>;
  const fromGlobal = runtime[`__LELU_${bareName}__`];
  if (typeof fromGlobal === "string" && fromGlobal.trim()) return fromGlobal.trim();

  const processEnv =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined> | undefined)
      : undefined;
  const fromProcess = processEnv?.[viteName];
  if (typeof fromProcess === "string" && fromProcess.trim()) return fromProcess.trim();

  return undefined;
}
