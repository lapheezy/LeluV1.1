import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import "./index.css";

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