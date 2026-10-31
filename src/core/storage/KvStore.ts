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
];

/**
 * `window.name` is READ ONLY now, for migration, and is never written.
 *
 * It was a third write target beside localStorage and sessionStorage,
 * and it was the worst of the three on every count. Measured on a 422KB
 * conversation payload: stringify 1.9ms, localStorage 4.6ms,
 * sessionStorage 3.4ms, window.name 7.9ms — the slowest write, for the
 * least durable store. It is a single string on the window object: it
 * does not survive a new tab, it is readable by and travels to the next
 * document on a cross-origin navigation, and it holds exactly one key
 * at a time, so every write silently evicted whatever other key was
 * there. It was never a durable backend; it was a fourth copy of one
 * key.
 *
 * Anything that is still only there is read back once, below, and
 * written to the real backends. Nothing is discarded.
 */
const legacyWindowNameBackend: KvBackend = {
  get: (key) => {
    const raw = window.name;
    return raw.startsWith(`${PREFIX}${key}=`) ? raw.slice(PREFIX.length + key.length + 1) : null;
  },
  set: () => {
    /* deliberately never written — see above */
  },
  remove: () => {
    /* nothing is removed from it; it is read-only legacy */
  },
};

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

    // MIGRATION, not a fallback. A value that exists only in
    // window.name was written by a previous version; it is returned AND
    // copied into the real backends so this is the last time it is read
    // from there. Never written back.
    try {
      const legacy = legacyWindowNameBackend.get(prefixed);
      if (legacy !== null && legacy !== "") {
        const parsed = JSON.parse(legacy) as T;
        for (const backend of backends) {
          try {
            backend.set(prefixed, legacy);
          } catch {
            // the migration is best-effort; the value is still returned
          }
        }
        return parsed;
      }
    } catch {
      // unparsable legacy data is not data
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
