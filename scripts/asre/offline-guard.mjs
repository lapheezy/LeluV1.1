// Mission 5 WP07 — offline guard.
//
// Preloaded into the harness child with `node --import` so that any attempt to
// reach a non-loopback host fails loudly and is counted. The whole creation
// pipeline (analysis, reconstruction, meshing, character builds, Blender render,
// Forge export) must then be provably local: if it needs a remote service the
// run fails instead of silently succeeding on the network.
//
//   node --import ./scripts/asre/offline-guard.mjs <harness> ...
//   WP7_GUARD_OUT=/path/summary.json  (optional summary destination)
import net from "node:net";
import dns from "node:dns";
import { writeFileSync } from "node:fs";

const attempts = [];
const allowed = (host) => {
  if (!host) return true; // unix socket / local pipe
  const h = String(host).toLowerCase();
  return h === "localhost" || h === "::1" || h === "0.0.0.0" || h === "::" || h === "[::1]" || h.startsWith("127.") || h.startsWith("/");
};

function record(kind, host, port) {
  attempts.push({ kind, host, port, at: new Date().toISOString() });
}

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let host;
  let port;
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    if (first.path) return origConnect.apply(this, args);
    host = first.host;
    port = first.port;
  } else if (typeof first === "string" && Number.isNaN(Number(first))) {
    return origConnect.apply(this, args); // unix socket path
  } else {
    port = first;
    host = typeof args[1] === "string" ? args[1] : undefined;
  }
  if (!allowed(host)) {
    record("tcp", host, port);
    const err = new Error(`offline guard: refused outbound connection to ${host}:${port}`);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return origConnect.apply(this, args);
};

const origLookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (!allowed(hostname)) {
    record("dns", hostname, null);
    const cb = rest[rest.length - 1];
    if (typeof cb === "function") {
      process.nextTick(() => cb(Object.assign(new Error(`offline guard: refused DNS lookup for ${hostname}`), { code: "ENOTFOUND" })));
      return undefined;
    }
    throw new Error(`offline guard: refused DNS lookup for ${hostname}`);
  }
  return origLookup.call(this, hostname, ...rest);
};

// fetch() goes through undici, which uses net.Socket.connect (patched above).
// Keep a direct guard on fetch too, so a redirected request is refused by URL.
const origFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  try {
    const url = typeof input === "string" ? input : input?.url;
    if (url && /^https?:/i.test(url)) {
      const host = new URL(url).hostname;
      if (!allowed(host)) {
        record("fetch", host, new URL(url).port || null);
        return Promise.reject(new Error(`offline guard: refused fetch to ${url}`));
      }
    }
  } catch {
    /* malformed input: let fetch decide */
  }
  return origFetch.call(this, input, init);
};

function summary() {
  return {
    guard: "offline-guard.mjs",
    policy: "only loopback/unix sockets allowed; every other TCP connect, DNS lookup and fetch is refused and counted",
    blockedAttempts: attempts,
    passed: attempts.length === 0,
  };
}

process.on("exit", () => {
  const out = process.env.WP7_GUARD_OUT;
  if (out) {
    try {
      writeFileSync(out, JSON.stringify(summary(), null, 1));
    } catch {
      /* nothing else to do at exit */
    }
  } else if (attempts.length) {
    console.error(`offline guard: ${attempts.length} blocked outbound attempt(s)`);
  }
});
