import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import "./index.css";
import Sentinel from "./core/sentinel/Sentinel";

// Real runtime error observation — Sentinel already existed as the
// system's error/event log (feeding CapabilityManifest and, from here
// on, CognitiveContext), but nothing fed it actual uncaught errors or
// rejected promises. Without this, "runtime errors" in the self-model
// meant only errors individual subsystems chose to report — a JS
// exception the app didn't specifically catch was invisible to
// cognition even though it was visible in the browser console.
window.addEventListener("error", (event) => {
  Sentinel.getInstance().error(
    "runtime_error",
    event.message || "Uncaught error",
    event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "window.onerror",
    { stack: event.error instanceof Error ? event.error.stack : undefined },
  );
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  Sentinel.getInstance().error(
    "runtime_error",
    reason instanceof Error ? reason.message : String(reason),
    "unhandledrejection",
    { stack: reason instanceof Error ? reason.stack : undefined },
  );
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// PWA: register the service worker (app shell + Web Push) in production builds.
// Base-aware so it also works when the app is served under a GitHub Pages
// project subpath, not only at the site root.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = typeof import.meta.env.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {
      /* offline shell unavailable — app still runs fully online */
    });
  });
}