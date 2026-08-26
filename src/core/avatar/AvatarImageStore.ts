/**
 * ==========================================================
 * LÉLU
 * AVATAR IMAGE STORE — IndexedDB-backed image persistence
 *
 * referenceImage data URLs can be 500KB-2MB, easily exceeding
 * localStorage's ~5MB per-origin quota. IndexedDB supports
 * files up to the device's available storage — no silent
 * QuotaExceededError failures.
 *
 * The rest of the AvatarProfile stays in KvStore (small text).
 * Only the image is stored here.
 * ==========================================================
 */

const DB = "lelu-avatar-images";
const STORE = "images";
const KEY = "referenceImage";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function getReferenceImage(): Promise<string | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function setReferenceImage(dataUrl: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(dataUrl, KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB write failed"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB write aborted"));
    };
  });
}

export async function removeReferenceImage(): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // best-effort cleanup
  }
}