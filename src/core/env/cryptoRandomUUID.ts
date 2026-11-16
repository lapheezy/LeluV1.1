/**
 * `crypto.randomUUID` only exists in secure contexts. Served over plain HTTP —
 * a phone hitting a dev machine's LAN address, an embedded webview, a kiosk —
 * the property is simply absent, so the first id generator to run threw
 * `crypto.randomUUID is not a function` and the whole root render was replaced
 * by a blank white page.
 *
 * The ids in this codebase are local identifiers, not secrets, so a v4-shaped
 * value built from `getRandomValues` (which is available in insecure contexts
 * too) is a faithful stand-in. Patching it here, once, at boot, keeps the ~90
 * existing call sites honest instead of scattering fallbacks through the
 * engines.
 */

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

function makeUuidV4(target: CryptoLike): () => string {
  return () => {
    const bytes = new Uint8Array(16);
    if (typeof target.getRandomValues === "function") {
      target.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    // Version 4, variant 1 (RFC 4122) — the shape callers already rely on.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/**
 * Installs the fallback when it is missing and returns whether `randomUUID` is
 * usable afterwards. Returns false only when there is no crypto object at all.
 */
export function ensureCryptoRandomUUID(target?: CryptoLike): boolean {
  const crypto = target ?? (globalThis.crypto as CryptoLike | undefined);
  if (!crypto) return false;
  if (typeof crypto.randomUUID === "function") return true;
  const fallback = makeUuidV4(crypto);
  try {
    Object.defineProperty(crypto, "randomUUID", {
      value: fallback,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  } catch {
    crypto.randomUUID = fallback;
  }
  return typeof crypto.randomUUID === "function";
}

ensureCryptoRandomUUID();
