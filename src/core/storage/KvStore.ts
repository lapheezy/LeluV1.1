/**
 * ==========================================================
 * LÉLU
 * KV STORE — persistent key/value storage
 *
 * The single persistence layer for the V1 creative expansion
 * (agents, projects, sketches, renders, videos, avatar). Each
 * backend is independently try/caught so a blocked storage
 * (private mode, sandboxed iframe) can never take the app
 * down — exactly like the workspace persistence in GenesisCore.
 *
 * Backends, in order of durability:
 *   1. localStorage   — survives reload and tab close/reopen
 *   2. sessionStorage — survives reload in the same tab
 *   3. window.name    — survives reload even when both storages
 *      are blocked (WebContainer preview iframes)
 *
 * Values are JSON-serialized; reads are always fresh (never
 * captured at module load). Offline by design — no network.
 * ==========================================================
 */

const PREFIX = "lelu.";

interface KvBackend {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const backends: KvBackend[] = [
  {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => window.localStorage.setItem(key, value),
    remove: (key) => window.localStorage.removeItem(key),
  },
  {
    get: (key) => window.sessionStorage.getItem(key),
    set: (key, value) => window.sessionStorage.setItem(key, value),
    remove: (key) => window.sessionStorage.removeItem(key),
  },
  {
    get: (key) => {
      const raw = window.name;
      return raw.startsWith(`${PREFIX}${key}=`) ? raw.slice(PREFIX.length + key.length + 1) : null;
    },
    set: (key, value) => {
      window.name = `${PREFIX}${key}=${value}`;
    },
    remove: () => {
      window.name = "";
    },
  },
];

function fullKey(key: string): string {
  return `${PREFIX}${key}`;
}

export default class KvStore {
  private static instance: KvStore | null = null;

  private constructor() {}

  public static getInstance(): KvStore {
    if (!KvStore.instance) {
      KvStore.instance = new KvStore();
    }
    return KvStore.instance;
  }

  /** Read a JSON value from the first backend that has it. */
  public get<T>(key: string): T | null {
    if (typeof window === "undefined") {
      return null;
    }
    const prefixed = fullKey(key);
    for (const backend of backends) {
      try {
        const raw = backend.get(prefixed);
        if (raw !== null && raw !== "") {
          return JSON.parse(raw) as T;
        }
      } catch {
        // backend blocked or corrupt — try the next one
      }
    }
    return null;
  }

  /** Write a JSON value to every backend (best-effort). */
  public set<T>(key: string, value: T): void {
    if (typeof window === "undefined") {
      return;
    }
    const prefixed = fullKey(key);
    const raw = JSON.stringify(value);
    for (const backend of backends) {
      try {
        backend.set(prefixed, raw);
      } catch {
        // backend blocked — the others still persist
      }
    }
  }

  /** Remove a key from every backend. */
  public remove(key: string): void {
    if (typeof window === "undefined") {
      return;
    }
    const prefixed = fullKey(key);
    for (const backend of backends) {
      try {
        backend.remove(prefixed);
      } catch {
        // backend blocked
      }
    }
  }

  /** List every stored key under this prefix (best-effort union). */
  public keys(prefix = ""): string[] {
    if (typeof window === "undefined") {
      return [];
    }
    const found = new Set<string>();
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key && key.startsWith(PREFIX) && key.includes(prefix)) {
          found.add(key.slice(PREFIX.length));
        }
      }
    } catch {
      // backend blocked
    }
    try {
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key && key.startsWith(PREFIX) && key.includes(prefix)) {
          found.add(key.slice(PREFIX.length));
        }
      }
    } catch {
      // backend blocked
    }
    return [...found];
  }
}
