/**
 * Neko live view for any surface (chat card, Thread web object, Thread YouTube object).
 *
 * The Browser window already used Neko (m1k1o/neko, a real Chromium streamed over WebRTC) for sites that
 * refuse embedding. The chat formats did not, so Google, ChatGPT and YouTube were blank or "unavailable"
 * there. This is the same mechanism, shared: check /api/neko/status, get the signed-in client URL from
 * /api/neko/client, and navigate Neko's Chromium to the page through /api/neko/navigate.
 *
 * Neko is ONE browser. Every NekoLive on screen shows that same browser; the most recent navigation wins.
 */

import { useEffect, useState } from "react";
import { getEnvironment } from "../../../../core/Environment";

export type NekoAvailability = "checking" | "reachable" | "unavailable" | "unconfigured";

let statusPromise: Promise<NekoAvailability> | null = null;
/** One status check per page, shared by every surface. */
export function nekoAvailability(): Promise<NekoAvailability> {
  if (!getEnvironment().nekoUrl.trim()) return Promise.resolve("unconfigured");
  statusPromise ??= fetch("/api/neko/status", { signal: AbortSignal.timeout(7000) })
    .then(async (r) => ((await r.json().catch(() => ({}))) as { reachable?: boolean }).reachable && r.ok ? "reachable" as const : "unavailable" as const)
    .catch(() => "unavailable" as const);
  return statusPromise;
}

export function useNekoAvailability(): NekoAvailability {
  const [state, setState] = useState<NekoAvailability>(getEnvironment().nekoUrl.trim() ? "checking" : "unconfigured");
  useEffect(() => {
    let live = true;
    void nekoAvailability().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export default function NekoLive({ url, height = 360, surface }: { url: string; height?: number | string; surface: string }) {
  const [client, setClient] = useState<string | null>(null);
  const [nav, setNav] = useState<{ ok: boolean; url: string } | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/neko/client")
      .then((r) => r.json())
      .then((p: { url?: string }) => live && p.url && setClient(p.url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!/^https?:/i.test(url)) return;
    let live = true;
    void fetch("/api/neko/navigate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })
      .then(async (r) => ({ ok: r.ok, body: (await r.json().catch(() => ({}))) as { url?: string } }))
      .then(({ ok, body }) => live && setNav({ ok, url: body.url ?? url }))
      .catch(() => live && setNav({ ok: false, url }));
    return () => {
      live = false;
    };
  }, [url]);

  const fallback = getEnvironment().nekoUrl.trim();
  return (
    <div className="neko-live" data-neko-surface={surface} data-neko-nav={nav ? (nav.ok ? "ok" : "failed") : ""} data-neko-live={nav?.ok ? nav.url : ""} style={{ height, display: "flex", flexDirection: "column", borderRadius: 10, overflow: "hidden", background: "#000" }}>
      <iframe
        src={client ?? fallback}
        title={`Neko live: ${url}`}
        allow="clipboard-read; clipboard-write; fullscreen; autoplay; camera; microphone"
        style={{ flex: 1, width: "100%", border: "none", display: "block" }}
      />
      <div style={{ fontSize: 10, padding: "3px 8px", color: "#a5f3fc", background: "rgba(0,0,0,0.6)" }}>
        ◉ Neko live: {nav ? (nav.ok ? nav.url : `could not open ${url}`) : `opening ${url}…`} (one shared browser)
      </div>
    </div>
  );
}
