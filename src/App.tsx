/**
 * ==========================================================
 * LÉLU — APPLICATION ROUTER
 *
 * One LÉLU, several interfaces (integration brief §4, §23).
 *
 *   /            the v1.1 Genesis scene
 *   /og/core     OG Core — window-manager desktop
 *   /og/chat     OG Inner Sky — the OG chat experience
 *
 * The interfaces differ; what is underneath does not. Every
 * surface talks to the same AIService, the same cognition, the
 * same provider chain — the OG chat reaches them through
 * src/og/compat/chat.ts rather than through a chat engine of
 * its own.
 *
 * Genesis is NOT lazy: it is the entry route, and deferring it
 * would put a loading state in front of the app's own front
 * door. The OG surfaces are, so their Tailwind/Radix payload is
 * only fetched when someone opens one.
 * ==========================================================
 */

import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import GenesisScene from "./app/scene/genesis/GenesisScene";

const OgRoutes = lazy(() => import("./og/OgRoutes"));

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<GenesisScene />} />
        <Route
          path="/og/*"
          element={
            <Suspense fallback={null}>
              <OgRoutes />
            </Suspense>
          }
        />
        {/* Anything unrecognised belongs to Genesis, which owns its own
            in-scene navigation and should not 404 on a deep link. */}
        <Route path="*" element={<GenesisScene />} />
      </Routes>
    </BrowserRouter>
  );
}
