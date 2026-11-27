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

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  adopt,
  DEFAULT_STYLE,

  remove,
  resetLayout,
  setThreadConversationResolver,
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
import ThreadMap from "./ThreadMap";
import YouTubeObject from "./YouTubeObject";
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

export function ObjectBody({ o, compact }: { o: ThreadObject; compact: boolean }): ReactNode {
  switch (o.kind) {
    case "neural-map":
      return <ThreadMap object={o} compact={compact} />;
    case "youtube":
      return <YouTubeObject object={o} />;
    case "image":
      return <img className="to-img" src={o.ref?.src} alt={o.title} />;
    case "model3d":
      return o.ref?.src ? (
        <Suspense fallback={<p className="tm-hint">Loading model…</p>}>
          <Model3DView model={{ name: o.ref.name ?? o.title, format: (o.ref.format ?? "glb") as "glb", src: o.ref.src, size: 0 }} />
        </Suspense>
      ) : null;
    case "web":
      return (
        <div className="to-web">
          <b>{o.web?.title}</b>
          <a href={o.web?.url} target="_blank" rel="noreferrer">
            {o.web?.url}
          </a>
          {o.web?.snippet ? <p>{o.web.snippet}</p> : null}
          <button type="button" onClick={() => openInBrowser(o.web!.url)}>
            Open in her browser
          </button>
        </div>
      );
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

const KIND_LABEL: Record<ThreadObject["kind"], string> = { "neural-map": "Neural Map", youtube: "Video", web: "Web", research: "Research", image: "Image", model3d: "3D model", spatial: "Spatial" };

/* ---------------------------------------------------------- one liquid object */

function LiquidShell({ o, rect, variantId, compact, shape, hue }: { o: ThreadObject; rect: Rect; variantId: string; compact: boolean; shape: LiquidStyle["shape"]; hue: number }) {
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
      className="to"
      data-thread-object={o.id}
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
        zIndex: 2 + (t?.z ?? 0) + (live ? 50 : 0),
        ["--hue" as string]: style.hue ?? hue,
        ["--alpha" as string]: 1 - style.transparency,
        ["--grad" as string]: style.gradient,
      }}
      onPointerMove={moveG}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <header className="to-head">
        <span className="to-grip" onPointerDown={begin("move")} title="Drag to move" aria-label="Move">
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
    <div className="to-panel" data-shape-panel onPointerDown={(e) => e.stopPropagation()}>
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
    <aside className="tl" data-live-panel>
      <header>
        <b>LÉLU Live</b> <span className={processing ? "tl-on" : "tl-off"}>{processing ? "● Running" : "○ Idle"}</span>
      </header>
      {steps.length === 0 ? <p className="tm-hint">No steps recorded for her last reply.</p> : null}
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
  const chatH = compact ? Math.min(300, size.h * 0.42) : 260;
  const lay = useMemo(() => layoutThread(spec.base, size.w, size.h, objects.map((o) => o.id), focus, chatH), [spec.base, size.w, size.h, objects.map((o) => o.id).join(","), focus, chatH]); // eslint-disable-line react-hooks/exhaustive-deps

  const picker = (
    <div className="ts-bar">
      <select value={variantId} onChange={(e) => setVariant(conversationId, e.target.value)} aria-label="Thread variant" data-variant-picker>
        {variants().map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
            {v.origin.by === "lelu" ? " · by LÉLU" : ""}
          </option>
        ))}
      </select>
      <span className="ts-count">{objects.length} objects</span>
      <button type="button" onClick={() => resetLayout(conversationId, variantId)} title="Return every object to its automatic place">
        Reset layout
      </button>
    </div>
  );

  if (spec.base === "raindrop") {
    const entries: FeedEntry[] = [
      ...messages.map<FeedEntry>((m) => ({ id: m.id, at: m.timestamp, kind: "message", label: m.role === "user" ? "You" : "LÉLU", body: <p className="rd-text">{m.text}</p> })),
      ...objects.map<FeedEntry>((o) => ({ id: o.id, at: o.createdAt || messages.find((m) => o.ref?.messageId === m.id)?.timestamp || 0, kind: "object", label: `${KIND_LABEL[o.kind]} · ${o.title}`, body: ObjectBody({ o, compact: true }) })),
    ].sort((a, b) => a.at - b.at);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastLelu = [...messages].reverse().find((m) => m.role === "assistant");
    return (
      <div ref={ref} className="ts" data-thread-stage={conversationId} data-variant={variantId} data-base="raindrop" data-compact={compact ? "true" : "false"} style={{ ["--hue" as string]: spec.style.hue, ["--accent" as string]: spec.style.accent }}>
        {picker}
        <div className="ts-avatar ts-avatar-orb" data-lelu-preview-host data-avatar-spot style={{ left: lay.avatar!.x, top: lay.avatar!.y + 40, width: lay.avatar!.w, height: lay.avatar!.h }} />
        <div className="ts-head">
          {lastUser ? <p className="ts-you">{lastUser.text}</p> : null}
          {lastLelu ? (
            <p className="ts-lelu">
              <b>✦ LÉLU</b> {processing ? <span className="tl-on">● working</span> : null} {lastLelu.text.slice(0, 280)}
            </p>
          ) : null}
        </div>
        <RaindropFeed conversationId={conversationId} entries={entries} compact={compact} />
      </div>
    );
  }

  const tabs = lay.tabs.map((id) => objects.find((o) => o.id === id)!).filter(Boolean);
  return (
    <div
      ref={ref}
      className="ts"
      data-thread-stage={conversationId}
      data-variant={variantId}
      data-base={spec.base}
      data-backdrop={spec.style.backdrop}
      data-compact={compact ? "true" : "false"}
      style={{ ["--hue" as string]: spec.style.hue, ["--accent" as string]: spec.style.accent, ["--glow" as string]: spec.style.glow }}
    >
      {picker}
      <div className="ts-canvas" style={{ height: lay.height }}>
        {lay.avatar ? <div className={`ts-avatar${lay.avatar.w < 100 ? " ts-avatar-orb" : ""}`} data-lelu-preview-host data-avatar-spot style={{ left: lay.avatar.x, top: lay.avatar.y, width: lay.avatar.w, height: lay.avatar.h }} /> : null}
        <section className="ts-chat" data-thread-chat style={{ left: lay.chat.x, top: lay.chat.y, width: lay.chat.w, height: lay.chat.h }}>
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
            <LiquidShell key={o.id} o={o} rect={lay.objects[o.id]} variantId={variantId} compact={compact} shape={o.style.shape !== DEFAULT_STYLE.shape ? o.style.shape : spec.style.shape} hue={spec.style.hue} />
          ))}
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
    </div>
  );
}

