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

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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

  // Room: a live page squeezed into a small object (a raindrop, a workspace card) is unreadable, so in
  // anything narrower than 560 px, or in an object shorter than 460 px, it opens LARGE beside the chat; "Into the object" puts it back.
  const anchor = useRef<HTMLDivElement | null>(null);
  const [large, setLarge] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (large !== null || !anchor.current) return;
    // Too narrow, or inside an object too short to show a page (Ribbon rows are ~200 px: measured).
    const box = anchor.current.getBoundingClientRect();
    const holder = anchor.current.closest<HTMLElement>("[data-thread-object], .rd-drop");
    setLarge(box.width < 560 || (holder ? holder.getBoundingClientRect().height < 460 : false));
  }, [large]);

  const fallback = getEnvironment().nekoUrl.trim();
  const frame = (
    <iframe
      src={client ?? fallback}
      title={`Neko live: ${url}`}
      allow="clipboard-read; clipboard-write; fullscreen; autoplay; camera; microphone"
      style={{ flex: 1, width: "100%", border: "none", display: "block" }}
    />
  );
  const status = nav ? (nav.ok ? nav.url : `could not open ${url}`) : `opening ${url}…`;
  const btn: CSSProperties = { font: "inherit", fontSize: 11, color: "#ede9fe", background: "rgba(139,92,246,0.35)", border: "1px solid rgba(196,181,253,0.5)", borderRadius: 999, padding: "2px 10px", cursor: "pointer" };
  const attrs = { "data-neko-surface": surface, "data-neko-nav": nav ? (nav.ok ? "ok" : "failed") : "", "data-neko-live": nav?.ok ? nav.url : "", "data-neko-size": large ? "large" : "inline" };

  if (large && typeof document !== "undefined") {
    return (
      <div ref={anchor} style={{ fontSize: 11, color: "#c4b5fd", padding: "4px 0" }}>
        ◉ Live beside the chat{" "}
        <button type="button" style={btn} onClick={() => setLarge(false)}>Into the object</button>
        {createPortal(
          <div className="neko-live neko-live-large" {...attrs} style={{ position: "fixed", left: "2vw", top: 76, width: "min(980px, 66vw)", height: "calc(100vh - 190px)", zIndex: 2147483000, display: "flex", flexDirection: "column", borderRadius: 14, overflow: "hidden", background: "#000", boxShadow: "0 18px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(196,181,253,0.35)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 11.5, color: "#ede9fe", background: "linear-gradient(90deg, rgba(76,29,149,0.9), rgba(30,27,75,0.9))" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>◉ Neko live: {status}</span>
              <button type="button" style={btn} onClick={() => setLarge(false)}>Into the object</button>
            </div>
            {frame}
          </div>,
          document.body,
        )}
      </div>
    );
  }
  return (
    <div ref={anchor} className="neko-live" {...attrs} style={{ height, display: "flex", flexDirection: "column", borderRadius: 10, overflow: "hidden", background: "#000" }}>
      {frame}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, padding: "3px 8px", color: "#a5f3fc", background: "rgba(0,0,0,0.6)" }}>
        <span style={{ flex: 1 }}>◉ Neko live: {status} (one shared browser)</span>
        {large === false ? <button type="button" style={btn} onClick={() => setLarge(true)}>Bigger</button> : null}
      </div>
    </div>
  );
}
