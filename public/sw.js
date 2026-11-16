/* LÉLU service worker — app shell + push (iOS 16.4+ installed PWA).
 * Strategy: precache the shell, stale-while-revalidate for assets,
 * network-first for navigations so the app always has a fresh core.
 */
// v2 — a model file is no longer copied into Cache Storage (see isModelAsset).
// The name change also drops the v1 cache on activate, which is where a
// previous version would have kept a duplicate copy of a large model.
const VERSION = "lelu-v2";
// Relative paths on purpose: the app may be served at the site root
// (custom domain) or under a GitHub Pages project subpath — relative
// URLs resolve against the service worker's own scope either way.
const SHELL = [
  "./",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * A reconstructed model (`.glb`) is owned by the HTTP cache and by
 * IndexedDB — NOT by Cache Storage.
 *
 * Caching it here was a bug with three consequences: a model of tens of
 * megabytes was stored a second time on the phone; a replaced model at
 * the same URL kept being served from this cache, so a new version never
 * arrived; and `cache.put` failing on quota threw an unhandled rejection
 * that nothing reported. The asset is served by the network with its
 * ETag/304 (server.ts) and persisted deliberately in IndexedDB, so the
 * service worker steps aside and lets those two do their jobs.
 */
function isModelAsset(url) {
  return /\.(glb|gltf|fbx|bin)$/i.test(url.pathname) || url.pathname.includes("/models/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Models bypass this cache entirely — see isModelAsset.
  if (isModelAsset(url)) return;

  // Navigations: network first, fall back to cached shell (offline).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request.url, copy));
          return response;
        })
        .catch(() => caches.match(request.url) || caches.match("./")),
    );
    return;
  }

  // Same-origin assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});

/* ---- Web Push (iOS 16.4+ installed PWA, requires a push backend) ---- */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload */
  }
  const title = data.title || "LÉLU";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    data: data.data || {},
    tag: data.tag || "lelu-push",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.navigate(target).then(() => client.focus());
      }
      return self.clients.openWindow(target);
    }),
  );
});
