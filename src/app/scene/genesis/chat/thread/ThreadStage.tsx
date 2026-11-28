/**
 * ==========================================================
 * LÉLU — THE THREAD STAGE (Mission 44.9)
 *
 * One conversation, its words and its live objects together, arranged by the
 * variant the person (or LÉLU) chose: raindrop, liquid workspace, ribbon,
 * live workspace, chat + browser, or a variant LÉLU created.
 *
 *   - objects come from ThreadObjects (summoned maps, videos, pages, research)
 *     plus the images, 3D models and spatial surfaces already in the messages;
 *   - every object is a liquid shell the person can drag by its grip, resize
 *     from its corner, rotate from its knob, collapse, close and restyle
 *     ("Shape it"); every change is stored as that variant's transform;
 *   - LÉLU's companion stands in the variant's reserved spot
 *     (data-lelu-preview-host), never over content;
 *   - after each move the element's real rectangle is written on it
 *     (data-measured), so what a tool reports is what the page shows.
 * ==========================================================
 */

import ThreadWorld from "../../../worlds/ThreadWorld";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  adopt,
  DEFAULT_STYLE,

  remove,
  resetLayout,
  setThreadConversationResolver,
  summon,
  setTransform,
  setVariant,
  subscribeThread,
  threadContents,
  update,
  variantFor,
  type LiquidStyle,
  type ThreadObject,
} from "../../../../../core/thread/ThreadObjects";
import { layoutThread, placed, subscribeVariants, variantById, variants, type Rect } from "../../../../../core/thread/ThreadVariants";
import type { ChatActivity } from "../../../../../core/multichat/TurnActivity";
import RaindropFeed, { type FeedEntry } from "./RaindropFeed";
import ThreadMap, { FreeformMaps } from "./ThreadMap";
import YouTubeObject from "./YouTubeObject";
import DiagnosticsObject from "./DiagnosticsObject";
import NekoLive, { useNekoAvailability } from "../../neko/NekoLive";
import "./thread.css";

const Model3DView = lazy(() => import("../Model3DView"));

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  attachments?: string[];
  models?: Array<{ name: string; format: "glb" | "gltf" | "stl" | "obj"; src: string; size: number }>;
  activity?: ChatActivity;
}

function useSize<T extends Element>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** A web page in the thread. Live in Neko right here, in every thread format, not only in the Browser window. */
function WebObject({ o, compact }: { o: ThreadObject; compact: boolean }) {
  const neko = useNekoAvailability();
  const [live, setLive] = useState(false);
  return (
    <div className="to-web">
      <b>{o.web?.title}</b>
      <a href={o.web?.url} target="_blank" rel="noreferrer">
        {o.web?.url}
      </a>
      {o.web?.snippet && !live ? <p>{o.web.snippet}</p> : null}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {neko === "reachable" ? (
          <button type="button" data-neko-toggle onClick={() => setLive((v) => !v)}>
            {live ? "Close live" : "◉ Live here (Neko)"}
          </button>
        ) : null}
        <button type="button" onClick={() => openInBrowser(o.web!.url)}>
          Open in her browser
        </button>
      </div>
      {live ? <NekoLive url={o.web!.url} height={compact ? 240 : 420} surface="thread-web" /> : null}
    </div>
  );
}

export function ObjectBody({ o, compact }: { o: ThreadObject; compact: boolean }): ReactNode {
  switch (o.kind) {
    case "neural-map":
      return <ThreadMap object={o} compact={compact} />;
    case "youtube":
      return <YouTubeObject object={o} />;
    case "diagnostics":
      return <DiagnosticsObject object={o} />;
    case "image":
      return <img className="to-img" src={o.ref?.src} alt={o.title} />;
    case "model3d":
      return o.ref?.src ? (
        <Suspense fallback={<p className="tm-hint">Loading model…</p>}>
          <Model3DView model={{ name: o.ref.name ?? o.title, format: (o.ref.format ?? "glb") as "glb", src: o.ref.src, size: 0 }} />
        </Suspense>
      ) : null;
    case "web":
      return <WebObject o={o} compact={compact} />;
    case "research":
      return (
        <div className="to-research">
          <b>{o.research?.query}</b>
          <ol>
            {(o.research?.sources ?? []).slice(0, 8).map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>{" "}
                <small>{s.domain}</small>
              </li>
            ))}
          </ol>
        </div>
      );
    default:
      return <p className="tm-hint">{o.title}</p>;
  }
}

function openInBrowser(url: string) {
  try {
    window.sessionStorage.setItem("lelu.browser.pending-url", url);
  } catch {
    /* event path */
  }
  window.dispatchEvent(new CustomEvent("genesis-browser-goto", { detail: { url } }));
}

const KIND_LABEL: Record<ThreadObject["kind"], string> = { "neural-map": "Neural Map", youtube: "Video", web: "Web", research: "Research", image: "Image", model3d: "3D model", spatial: "Spatial", diagnostics: "Diagnostics" };

/* ---------------------------------------------------------- one liquid object */

function LiquidShell({ o, rect, variantId, compact, shape, hue, ribbon = false, focusPane = false }: { o: ThreadObject; rect: Rect; variantId: string; compact: boolean; shape: LiquidStyle["shape"]; hue: number; ribbon?: boolean; focusPane?: boolean }) {
  const el = useRef<HTMLDivElement | null>(null);
  const t = o.transforms[variantId];
  const box = placed(rect, t);
  const rot = t?.rot ?? 0;
  const [live, setLive] = useState<{ dx: number; dy: number; w: number; h: number; rot: number } | null>(null);
  const [panel, setPanel] = useState(false);
  const style = { ...DEFAULT_STYLE, ...o.style };
  const g = useRef<{ mode: "move" | "size" | "turn"; x: number; y: number; dx: number; dy: number; w: number; h: number; rot: number; cx: number; cy: number } | null>(null);
  const begin = (mode: "move" | "size" | "turn") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const r = el.current!.getBoundingClientRect();
    g.current = { mode, x: e.clientX, y: e.clientY, dx: t?.dx ?? 0, dy: t?.dy ?? 0, w: box.w, h: box.h, rot, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const moveG = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s) return;
    if (s.mode === "move") setLive({ dx: s.dx + e.clientX - s.x, dy: s.dy + e.clientY - s.y, w: s.w, h: s.h, rot: s.rot });
    else if (s.mode === "size") setLive({ dx: s.dx, dy: s.dy, w: Math.max(160, s.w + e.clientX - s.x), h: Math.max(120, s.h + e.clientY - s.y), rot: s.rot });
    else setLive({ dx: s.dx, dy: s.dy, w: s.w, h: s.h, rot: Math.round((Math.atan2(e.clientY - s.cy, e.clientX - s.cx) * 180) / Math.PI + 90) });
  };
  const end = () => {
    if (g.current && live) {
      adopt(o);
      setTransform(o.id, variantId, { dx: Math.round(live.dx), dy: Math.round(live.dy), w: Math.round(live.w), h: Math.round(live.h), rot: live.rot, manual: true });
    }
    g.current = null;
    setLive(null);
  };
  const b = live ? { x: rect.x + live.dx, y: rect.y + live.dy, w: live.w, h: live.h } : box;
  const r = live ? live.rot : rot;
  // What the page really shows, written on the element after each layout.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const parent = node.offsetParent as HTMLElement | null;
    node.dataset.measured = JSON.stringify({ x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight, rot: r, within: parent ? parent.clientWidth >= node.offsetLeft + node.offsetWidth - 1 : true });
  });
  const collapsed = style.collapsed;
  return (
    <div
      ref={el}
      className="to lq"
      data-thread-object={o.id}
      data-focus-pane={focusPane ? "true" : "false"}
      data-kind={o.kind}
      data-shape={shape}
      data-group={o.group ?? ""}
      data-manual={t?.manual ? "true" : "false"}
      style={{
        left: b.x,
        top: b.y,
        width: b.w,
        height: collapsed ? 46 : b.h,
        transform: r ? `rotate(${r}deg)` : undefined,
        // Above the conversation (4) once placed by hand or while held, so a moved object is never lost under it.
        zIndex: (t?.manual || live ? 6 : 2) + (t?.z ?? 0) + (live ? 50 : 0),
        ["--hue" as string]: style.hue ?? hue,
        ["--alpha" as string]: 1 - style.transparency,
        ["--grad" as string]: style.gradient,
      }}
      onPointerMove={moveG}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {ribbon ? <span className="to-ribbon-wrap" aria-hidden /> : null}
      {focusPane && o.kind === "web" ? (
        <div className="tx-addr">
          <span>🔒</span>
          <b>{o.web?.url}</b>
        </div>
      ) : null}
      <header className="to-head">
        <span
          className="to-grip"
          onPointerDown={begin("move")}
          title="Drag to move (or focus and use the arrow keys; Shift for bigger steps)"
          aria-label="Move"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            // Keyboard move (diagnostics b:keyboard found the handle pointer-only).
            const step = e.shiftKey ? 40 : 10;
            const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (!d) return;
            e.preventDefault();
            adopt(o);
            setTransform(o.id, variantId, { dx: (t?.dx ?? 0) + d[0], dy: (t?.dy ?? 0) + d[1], manual: true });
          }}
        >
          ⠿
        </span>
        <span className="to-kind">{KIND_LABEL[o.kind]}</span>
        <b className="to-title">{o.title}</b>
        <span className="to-actions">
          <button type="button" aria-label="Shape it" onClick={() => setPanel((p) => !p)}>
            ☰
          </button>
          <button type="button" aria-label={collapsed ? "Expand" : "Collapse"} onClick={() => (adopt(o), update(o.id, { style: { ...style, collapsed: !collapsed } }))}>
            {collapsed ? "▢" : "▁"}
          </button>
          <button type="button" aria-label="Close" onClick={() => remove(o.id)}>
            ✕
          </button>
        </span>
      </header>
      {collapsed ? null : <div className="to-body">{ObjectBody({ o, compact })}</div>}
      {collapsed || compact ? null : (
        <>
          <span className="to-resize" onPointerDown={begin("size")} aria-label="Resize" title="Drag to resize" />
          <span className="to-rotate" onPointerDown={begin("turn")} aria-label="Rotate" title="Drag to rotate" />
        </>
      )}
      {panel ? <ShapePanel o={o} variantId={variantId} onClose={() => setPanel(false)} /> : null}
    </div>
  );
}

function ShapePanel({ o, variantId, onClose }: { o: ThreadObject; variantId: string; onClose: () => void }) {
  const style = { ...DEFAULT_STYLE, ...o.style };
  const t = o.transforms[variantId];
  const set = (p: Partial<LiquidStyle>) => (adopt(o), update(o.id, { style: { ...style, ...p } }));
  return (
    <div className="to-panel lq" data-shape-panel onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <b>Shape it</b>
        <button type="button" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </header>
      <label>
        Transparency <input type="range" min={0} max={0.9} step={0.05} value={style.transparency} onChange={(e) => set({ transparency: Number(e.target.value) })} />
      </label>
      <label>
        Gradient <input type="range" min={0} max={1} step={0.05} value={style.gradient} onChange={(e) => set({ gradient: Number(e.target.value) })} />
      </label>
      <label>
        Glow <input type="range" min={0} max={359} step={1} value={style.hue} onChange={(e) => set({ hue: Number(e.target.value) })} />
      </label>
      <label>
        Rotation <input type="range" min={-45} max={45} step={1} value={t?.rot ?? 0} onChange={(e) => (adopt(o), setTransform(o.id, variantId, { rot: Number(e.target.value), manual: true }))} />
      </label>
      <div className="to-chips">
        {(["droplet", "ribbon", "pane", "capsule", "orb"] as const).map((s) => (
          <button key={s} type="button" data-on={style.shape === s ? "true" : "false"} onClick={() => set({ shape: s })}>
            {s}
          </button>
        ))}
      </div>
      <div className="to-chips">
        <button type="button" onClick={() => (adopt(o), setTransform(o.id, variantId, { dx: 0, dy: 0, manual: true }))}>
          Keep in view
        </button>
        <button type="button" onClick={() => (adopt(o), setTransform(o.id, variantId, { dx: 0, dy: 0, w: null, h: null, rot: 0, manual: false }))}>
          Reset this object
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- LÉLU live panel */

function LivePanel({ messages, processing }: { messages: ThreadMessage[]; processing: boolean }) {
  const last = [...messages].reverse().find((m) => m.role === "assistant" && m.activity);
  const steps = last?.activity?.steps.slice(-8) ?? [];
  return (
    <aside className="tl lq" data-live-panel>
      <header>
        <b>LÉLU Live</b> <span className={processing ? "tl-on" : "tl-off"}>{processing ? "● Running" : "○ Idle"}</span>
      </header>
      {steps.length === 0 ? <p className="tl-empty">Her steps appear here while she works: searches, pages, tools, agents. Nothing is running now.</p> : null}
      <ol>
        {steps.map((s) => (
          <li key={s.id} data-step-status={s.status}>
            <span>{s.status === "done" ? "✓" : s.status === "failed" ? "✕" : "◌"}</span> {s.label}
            {s.detail ? <small> {s.detail.slice(0, 60)}</small> : null}
          </li>
        ))}
      </ol>
      {last?.activity?.sources.length ? <small>{last.activity.sources.length} sources</small> : null}
    </aside>
  );
}

/* ---------------------------------------------------------- header */

/** Status chips from the conversation's real state only. */
function statusOf(messages: ThreadMessage[], processing: boolean, objects: ThreadObject[]) {
  const last = [...messages].reverse().find((m) => m.role === "assistant" && m.activity);
  const running = (k: string[]) => Boolean(processing && last?.activity?.steps.some((s) => s.status === "running" && k.includes(s.kind)));
  return [
    { id: "live", label: "Live", on: processing },
    { id: "research", label: "Researching", on: running(["search", "reference"]) },
    { id: "browse", label: "Browsing", on: running(["browse"]) || objects.some((o) => o.kind === "web") },
    { id: "create", label: "Creating", on: Boolean(processing && last?.activity?.artifacts?.length) },
    { id: "3d", label: "3D", on: objects.some((o) => o.kind === "model3d" || o.map?.dim === "3d") },
  ];
}

function ThreadHeader({ conversationId, variantId, chips, immersive, onImmersive, showTabs, onTabs, fx, fxMode, fxMs, onFx, worldOpen, onWorld }: { conversationId: string; variantId: string; chips: ReturnType<typeof statusOf>; immersive: boolean; onImmersive: () => void; showTabs: boolean; onTabs: () => void; fx: string; fxMode: string; fxMs: number | null; onFx: () => void; worldOpen: boolean; onWorld: () => void }) {
  return (
    <header className="tx-head" data-thread-header>
      <div className="tx-mark">
        <span className="tx-orbit" aria-hidden />
        <span className="tx-word">
          <b>LÉLU</b>
          <small>Chat Universe</small>
        </span>
      </div>
      <div className="tx-row">
        <div className="tx-chips" aria-label="What she is doing">
          {chips.map((c) => (
            <span key={c.id} className="tx-chip" data-on={c.on ? "true" : "false"} data-chip={c.id}>
              {c.on ? <i /> : null}
              {c.label}
            </span>
          ))}
        </div>
        <div className="tx-variants" role="tablist" aria-label="Thread variant">
          {variants().map((v) => (
            <button key={v.id} type="button" role="tab" data-on={v.id === variantId ? "true" : "false"} data-variant-tab={v.id} onClick={() => setVariant(conversationId, v.id)} title={v.description}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="tx-buttons">
        <select value={variantId} onChange={(e) => setVariant(conversationId, e.target.value)} aria-label="Thread variant" data-variant-picker className="tx-sr">
          {variants().map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <button type="button" data-reset onClick={() => resetLayout(conversationId, variantId)} title="Return every object to its automatic place">
          ⟲
        </button>
        <button type="button" onClick={onWorld} data-world-toggle data-on={worldOpen ? "true" : "false"} title="World: build the environment behind this thread">
          🌐
        </button>
        <button type="button" onClick={onFx} data-fx-toggle title={`Effects: ${fx}${fx === "auto" && fxMs !== null ? ` (measured ${fxMs} ms/frame → ${fxMode})` : ""}. Click to change.`}>
          {fx === "auto" ? "✦A" : fx === "full" ? "✦" : "✧"}
        </button>
        <button type="button" data-tabs onClick={onTabs} data-on={showTabs ? "true" : "false"} title="Show the environment tabs">
          ☰
        </button>
        <button type="button" onClick={onImmersive} title={immersive ? "Back to the window" : "Fill the screen"} data-immersive-toggle>
          {immersive ? "⤡" : "⤢"}
        </button>
        {/* The one dial's reserved slot: in the Thread view this header is on top, so the dial (and the way
            back to the primary Cosmos) lives here, one tap away, never over the composer. */}
        <span className="lelu-module-nav-slot" data-lelu-nav-slot style={{ width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} />
      </div>
    </header>
  );
}

/** Animated light trails between related objects (same group, or a map beside the media it explains). */
function Trails({ objects, rects }: { objects: ThreadObject[]; rects: Record<string, Rect> }) {
  const shown = objects.filter((o) => rects[o.id]);
  const pairs: Array<[ThreadObject, ThreadObject]> = [];
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i], b = shown[j];
      if ((a.group && a.group === b.group) || (a.kind === "neural-map" && b.kind !== "neural-map") || (b.kind === "neural-map" && a.kind !== "neural-map") || (a.kind === "neural-map" && b.kind === "neural-map" && j === i + 1)) pairs.push([a, b]);
    }
  const c = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  return (
    <svg className="ts-trails" aria-hidden>
      <defs>
        <linearGradient id="ts-trail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="hsl(274 95% 75%)" />
          <stop offset=".5" stopColor="hsl(38 98% 64%)" />
          <stop offset="1" stopColor="hsl(212 95% 70%)" />
        </linearGradient>
      </defs>
      {pairs.slice(0, 8).map(([a, b]) => {
        const p = c(rects[a.id]);
        const q = c(rects[b.id]);
        const mx = (p.x + q.x) / 2 + (q.y - p.y) * 0.18;
        const my = (p.y + q.y) / 2 - (q.x - p.x) * 0.18;
        return <path key={`${a.id}-${b.id}`} d={`M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`} stroke="url(#ts-trail)" />;
      })}
    </svg>
  );
}

/* ---------------------------------------------------------- the stage */

export default function ThreadStage({ conversationId, messages, processing, transcript }: { conversationId: string; messages: ThreadMessage[]; processing: boolean; transcript: ReactNode }) {
  useSyncExternalStore(subscribeThread, () => variantFor(conversationId) + JSON.stringify(threadContents(conversationId, messages).map((o) => [o.id, o.transforms, o.style, o.group, o.map, o.lastTime])));
  useSyncExternalStore(subscribeVariants, () => variants().length);
  useEffect(() => {
    setThreadConversationResolver(() => conversationId);
    return () => setThreadConversationResolver(null);
  }, [conversationId]);
  const [ref, size] = useSize<HTMLDivElement>();
  const variantId = variantFor(conversationId);
  const spec = variantById(variantId);
  const objects = threadContents(conversationId, messages).filter((o) => o.kind !== "spatial");
  const [focus, setFocus] = useState<string | null>(null);
  const compact = size.w < 700;
  const [immersive, setImmersive] = useState(() => (typeof localStorage === "undefined" ? true : localStorage.getItem("lelu.thread.immersive") !== "false"));
  const [showTabs, setShowTabs] = useState(false);
  // The window around the stage takes the whole screen in immersive mode (thread.css).
  useEffect(() => {
    const root = ref.current?.closest(".lst-root") as HTMLElement | null;
    if (!root) return;
    root.dataset.immersive = immersive ? "true" : "false";
    root.dataset.showTabs = showTabs ? "true" : "false";
    return () => {
      delete root.dataset.immersive;
      delete root.dataset.showTabs;
    };
  }, [immersive, showTabs, ref]);
  const toggleImmersive = () => {
    setImmersive((v) => {
      try {
        localStorage.setItem("lelu.thread.immersive", String(!v));
      } catch {
        /* fine */
      }
      return !v;
    });
  };
  // Visual quality: measured, not assumed. Two seconds after opening, the stage
  // times its own frames; above 40 ms per frame it switches to light effects.
  const [worldOpen, setWorldOpen] = useState(false);
  const [fx, setFx] = useState<"full" | "light" | "auto">(() => ((typeof localStorage !== "undefined" && (localStorage.getItem("lelu.thread.fx") as "full" | "light" | null)) || "auto"));
  const [measuredFx, setMeasuredFx] = useState<{ medianMs: number; mode: "full" | "light" } | null>(null);
  useEffect(() => {
    if (fx !== "auto") return;
    let raf = 0;
    const t: number[] = [];
    const start = performance.now() + 2000;
    const step = (now: number) => {
      if (now >= start) t.push(now);
      if (now - start < 2000) raf = requestAnimationFrame(step);
      else {
        const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
        const median = d.length ? d[d.length >> 1] : 0;
        setMeasuredFx({ medianMs: Math.round(median), mode: median > 40 ? "light" : "full" });
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fx]);
  const fxMode = fx === "auto" ? measuredFx?.mode ?? "full" : fx;
  const cycleFx = () => {
    const next = fx === "auto" ? "full" : fx === "full" ? "light" : "auto";
    setFx(next);
    try {
      localStorage.setItem("lelu.thread.fx", next);
    } catch {
      /* fine */
    }
  };
  const chips = statusOf(messages, processing, threadContents(conversationId, messages));
  const header = <ThreadHeader conversationId={conversationId} variantId={variantFor(conversationId)} chips={chips} immersive={immersive} onImmersive={toggleImmersive} showTabs={showTabs} onTabs={() => setShowTabs((v) => !v)} fx={fx} fxMode={fxMode} fxMs={measuredFx?.medianMs ?? null} onFx={cycleFx} worldOpen={worldOpen} onWorld={() => setWorldOpen((v) => !v)} />;
  const withWorld = (node: ReactNode) => (
    <ThreadWorld editorOpen={worldOpen} onCloseEditor={() => setWorldOpen(false)} paused={false} images={threadContents(conversationId, messages).filter((o) => o.kind === "image" && o.ref?.src).map((o) => ({ id: o.id, title: o.title, src: o.ref!.src!, by: o.by }))}>
      {node}
    </ThreadWorld>
  );
  const chatH = compact ? Math.min(300, size.h * 0.42) : 260;
  const lay = useMemo(() => layoutThread(spec.base, size.w, size.h, objects.map((o) => o.id), focus, chatH), [spec.base, size.w, size.h, objects.map((o) => o.id).join(","), focus, chatH]); // eslint-disable-line react-hooks/exhaustive-deps


  if (spec.base === "raindrop") {
    const entries: FeedEntry[] = [
      ...messages.map<FeedEntry>((m) => ({ id: m.id, at: m.timestamp, kind: "message", label: m.role === "user" ? "You" : "LÉLU", body: <p className="rd-text">{m.text}</p> })),
      ...objects.map<FeedEntry>((o) => ({ id: o.id, at: o.createdAt || messages.find((m) => o.ref?.messageId === m.id)?.timestamp || 0, kind: "object", label: `${KIND_LABEL[o.kind]} · ${o.title}`, body: ObjectBody({ o, compact: true }) })),
    ].sort((a, b) => a.at - b.at);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastLelu = [...messages].reverse().find((m) => m.role === "assistant");
    return withWorld(
      <div ref={ref} className="ts" data-fx={fxMode} data-fx-ms={measuredFx?.medianMs ?? ""} data-thread-stage={conversationId} data-variant={variantId} data-base="raindrop" data-compact={compact ? "true" : "false"} style={{ ["--hue" as string]: spec.style.hue, ["--accent" as string]: spec.style.accent }}>
        {header}
        <div className="ts-avatar ts-avatar-orb" data-lelu-preview-host data-avatar-spot style={{ left: lay.avatar!.x, top: lay.avatar!.y + 40, width: lay.avatar!.w, height: lay.avatar!.h }} />
        <div className="ts-head">
          {lastUser ? <p className="ts-you lq"><span>{lastUser.text}</span></p> : null}
          {lastLelu ? (
            <p className="ts-lelu lq">
              <b>✦ LÉLU</b> {processing ? <span className="tl-on">● working</span> : null} {lastLelu.text.slice(0, 280)}
            </p>
          ) : null}
        </div>
        <RaindropFeed conversationId={conversationId} entries={entries} compact={compact} />
      </div>,
    );
  }

  if (spec.base === "freestyle") {
    // Two separate scrolls: the work flows in its own scrolling space; the
    // conversation (and her presence) stay put, the conversation scrolling on
    // its own. Panels that hold more (a web page, research, a browser) scroll
    // inside themselves without moving either.
    return withWorld(
      <div ref={ref} className="ts" data-fx={fxMode} data-fx-ms={measuredFx?.medianMs ?? ""} data-thread-stage={conversationId} data-variant={variantId} data-base="freestyle" data-compact={compact ? "true" : "false"} style={{ ["--hue" as string]: spec.style.hue, ["--accent" as string]: spec.style.accent }}>
        {header}
        <FreeformMaps.Provider value>
          <div className="fs-stage">
            <div className="fs-scroll" data-freestyle-scroll>
              <div className="ts-canvas" style={{ height: compact ? lay.height : Math.max(lay.height - 40, 0) }}>
                {compact ? (
                  <section className="ts-chat lq" data-thread-chat style={{ left: lay.chat.x, top: lay.chat.y, width: lay.chat.w, height: lay.chat.h }}>
                    {transcript}
                  </section>
                ) : null}
                {objects
                  .filter((o) => lay.objects[o.id])
                  .map((o) => (
                    <LiquidShell key={o.id} o={o} rect={lay.objects[o.id]} variantId={variantId} compact={compact} shape={o.style.shape !== DEFAULT_STYLE.shape ? o.style.shape : spec.style.shape} hue={spec.style.hue} ribbon={false} focusPane={false} />
                  ))}
              </div>
            </div>
            {lay.avatar ? <div className="ts-avatar" data-lelu-preview-host data-avatar-spot style={{ left: lay.avatar.x, top: lay.avatar.y, width: lay.avatar.w, height: lay.avatar.h }} /> : null}
            {compact ? null : (
              <section className="ts-chat lq fs-chat" data-thread-chat style={{ left: lay.chat.x, top: 8, width: lay.chat.w }}>
                {transcript}
              </section>
            )}
          </div>
        </FreeformMaps.Provider>
      </div>,
    );
  }

  const tabs = lay.tabs.map((id) => objects.find((o) => o.id === id)!).filter(Boolean);
  return withWorld(
    <div
      ref={ref}
      className="ts"
      data-fx={fxMode}
      data-fx-ms={measuredFx?.medianMs ?? ""}
      data-thread-stage={conversationId}
      data-variant={variantId}
      data-base={spec.base}
      data-backdrop={spec.style.backdrop}
      data-compact={compact ? "true" : "false"}
      style={{ ["--hue" as string]: spec.style.hue, ["--accent" as string]: spec.style.accent, ["--glow" as string]: spec.style.glow }}
    >
      {header}
      <FreeformMaps.Provider value={false}>
      <div className="ts-canvas" style={{ height: lay.height }}>
        {spec.base === "workspace" || spec.base === "live" ? <Trails objects={objects} rects={Object.fromEntries(objects.filter((o) => lay.objects[o.id]).map((o) => [o.id, placed(lay.objects[o.id], o.transforms[variantId])]))} /> : null}
        {spec.base === "ribbon" ? (
          <div className="ts-spine" style={{ top: lay.chat.y, height: Math.max(80, lay.height - lay.chat.y - 60) }}>
            {objects.map((o, i) => (
              <i key={o.id} style={{ top: `${((i + 1) / (objects.length + 1)) * 100}%` }} />
            ))}
          </div>
        ) : null}
        {lay.avatar ? <div className={`ts-avatar${lay.avatar.w < 100 ? " ts-avatar-orb" : ""}`} data-lelu-preview-host data-avatar-spot style={{ left: lay.avatar.x, top: lay.avatar.y, width: lay.avatar.w, height: lay.avatar.h }} /> : null}
        <section className="ts-chat lq" data-thread-chat style={{ left: lay.chat.x, top: lay.chat.y, width: lay.chat.w, height: lay.chat.h }}>
          {transcript}
        </section>
        {lay.activity ? (
          <div style={{ position: "absolute", left: lay.activity.x, top: lay.activity.y, width: lay.activity.w, height: lay.activity.h }}>
            <LivePanel messages={messages} processing={processing} />
          </div>
        ) : null}
        {objects
          .filter((o) => lay.objects[o.id])
          .map((o) => (
            <LiquidShell key={o.id} o={o} rect={lay.objects[o.id]} variantId={variantId} compact={compact} shape={o.style.shape !== DEFAULT_STYLE.shape ? o.style.shape : spec.style.shape} hue={spec.style.hue} ribbon={spec.base === "ribbon"} focusPane={spec.base === "split"} />
          ))}
        {spec.base === "live" && !compact ? (
          <nav className="tx-dock lq" style={{ top: lay.height - 96 }} aria-label="Bring into the thread">
            {(["v1", "v2", "v3"] as const).map((a) => (
              <button key={a} type="button" data-dock={a} onClick={() => summon({ conversationId, kind: "neural-map", by: "user", title: a === "v1" ? "V1 · Knowledge" : a === "v2" ? "V2 · Cognitive architecture" : "V3 · Agent society", map: { aspect: a, view: a === "v2" ? "connectome-tractography" : "force-directed", dim: a === "v2" ? "3d" : "2d", highlight: [], selected: null } })}>
                <b>{a === "v1" ? "◉" : a === "v2" ? "✺" : "⟡"}</b>
                {a.toUpperCase()}
              </button>
            ))}
          </nav>
        ) : null}
        {tabs.length ? (
          <nav className="ts-tabs" style={{ left: lay.objects[Object.keys(lay.objects)[0]]?.x ?? 0, top: 52 }}>
            {tabs.map((o) => (
              <button key={o.id} type="button" onClick={() => setFocus(o.id)} data-tab-object={o.id}>
                {KIND_LABEL[o.kind]} · {o.title.slice(0, 24)}
              </button>
            ))}
          </nav>
        ) : null}
      </div>
      </FreeformMaps.Provider>
    </div>,
  );
}

