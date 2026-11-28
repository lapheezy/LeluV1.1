/**
 * Her workspace, below the Cosmos (owner, 2026-11-28): recent updates, previous work, self development,
 * future work and tasks, arranged in a FORMAT. Nothing here is a fixed box or a locked menu: the formats are
 * the home layout kinds used as ways to arrange information; the owner (or LÉLU, workspace.format) picks
 * one; it is borderless, scrolls, and every item opens the real thing.
 *
 * Reached by scrolling / swiping down from the Cosmos landing, "Your workspace ↓", the dial, or her
 * ("arrange my workspace as a card table"). Scrolling up past the top (or ↑ Cosmos, or Escape) returns.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useGenesis, type GenesisPanel } from "../GenesisCore";
import { openChatWorkspace } from "./chatWorkspace";
import { FORMATS, SECTIONS, gatherBriefing, setWorkspaceFormat, subscribeWorkspaceFormat, workspaceFormat, type BriefItem, type SectionId } from "../../../../core/workspace/briefing";
import "./cosmosWorkspace.css";

export const WORKSPACE_OPEN_EVENT = "lelu-workspace-open";
const ABSOLUTE = new Set(["orbit", "radial", "constellation", "scatter", "freeform"]);
const FREE_KEY = "lelu.workspace.freeform.v1";

const ago = (t?: number) => {
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? "now" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};

function useBriefing(open: boolean): BriefItem[] | null {
  const [items, setItems] = useState<BriefItem[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const journal = await fetch("/api/self/journal", { signal: AbortSignal.timeout(5000) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { journal?: Array<{ file: string; date: string; title: string }> } | null) => j?.journal ?? [])
        .catch(() => []);
      const got = await gatherBriefing(journal);
      if (live) setItems(got);
    })();
    return () => {
      live = false;
    };
  }, [open]);
  return items;
}

/** Positions (0..1 of the canvas) for the absolute formats. */
function place(format: string, n: number, i: number, saved: Record<string, [number, number]>, id: string): { x: number; y: number; r: number } {
  if (format === "freeform" && saved[id]) return { x: saved[id][0], y: saved[id][1], r: 0 };
  if (format === "orbit" || format === "constellation") {
    const ring = i < 6 ? 0 : 1;
    const k = ring === 0 ? i : i - 6;
    const m = ring === 0 ? Math.min(6, n) : Math.max(1, n - 6);
    const a = (k / m) * Math.PI * 2 + (ring ? 0.4 : 0);
    const rad = ring === 0 ? 0.26 : 0.42;
    return { x: 0.5 + Math.cos(a) * rad, y: 0.5 + Math.sin(a) * rad * 0.9, r: 0 };
  }
  if (format === "radial") {
    const a = Math.PI * (1.05 + (0.9 * i) / Math.max(1, n - 1));
    const rad = 0.22 + (i % 2) * 0.17;
    return { x: 0.5 + Math.cos(a) * rad * 1.3, y: 0.92 + Math.sin(a) * rad * 1.9, r: 0 };
  }
  if (format === "scatter") {
    const cols = 4;
    const seed = (id.charCodeAt(2) || 7) + i * 13;
    return { x: 0.14 + (i % cols) * 0.24 + ((seed % 7) - 3) * 0.008, y: 0.12 + Math.floor(i / cols) * 0.2 + ((seed % 5) - 2) * 0.01, r: (seed % 17) - 8 };
  }
  // freeform with nothing saved yet: a loose grid to start from
  return { x: 0.14 + (i % 4) * 0.24, y: 0.12 + Math.floor(i / 4) * 0.2, r: 0 };
}

function Item({ it, onOpen }: { it: BriefItem; onOpen: (it: BriefItem) => void }) {
  return (
    <button type="button" className="cw-item" data-item={it.id} data-section={it.section} onClick={() => onOpen(it)}>
      <span className="cw-item-title">{it.title}</span>
      {it.detail ? <span className="cw-item-detail">{it.detail}</span> : null}
      <span className="cw-item-meta">
        {it.tag ? <em>{it.tag}</em> : null}
        {it.time ? <time>{ago(it.time)}</time> : null}
      </span>
    </button>
  );
}

export default function CosmosWorkspace() {
  const genesis = useGenesis();
  const [open, setOpen] = useState(false);
  const fmt = useSyncExternalStore(subscribeWorkspaceFormat, workspaceFormat, workspaceFormat);
  const items = useBriefing(open);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [free, setFree] = useState<Record<string, [number, number]>>(() => {
    try {
      return JSON.parse(localStorage.getItem(FREE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const drag = useRef<{ id: string; x: number; y: number; ox: number; oy: number } | null>(null);

  // Open: an event (her tool, the dial, the pill), a scroll down or swipe up on the landing.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(WORKSPACE_OPEN_EVENT, show);
    const onWheel = (e: WheelEvent) => {
      if (open || e.deltaY < 30) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-core-chat], .lelu-radial-items, .lsn, [data-lelu-module-window], .lcu, input, textarea, select")) return;
      if (!document.querySelector("[data-core-chat]")) return; // only from the Cosmos landing
      setOpen(true);
    };
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => (startY = e.touches[0]?.clientY ?? 0);
    const onTouchEnd = (e: TouchEvent) => {
      const dy = startY - (e.changedTouches[0]?.clientY ?? startY);
      const t = e.target as HTMLElement | null;
      if (!open && dy > 80 && document.querySelector("[data-core-chat]") && !t?.closest("[data-core-chat], .lsn, .lelu-radial-items")) setOpen(true);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener(WORKSPACE_OPEN_EVENT, show);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [open]);

  // Close: Escape, or scrolling up past the top.
  useEffect(() => {
    if (!open) return;
    const el = scroller.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    let pull = 0;
    const onWheel = (e: WheelEvent) => {
      if (!el) return;
      if (el.scrollTop <= 0 && e.deltaY < 0) {
        pull += -e.deltaY;
        if (pull > 160) setOpen(false);
      } else pull = 0;
    };
    window.addEventListener("keydown", onKey);
    el?.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      el?.removeEventListener("wheel", onWheel);
    };
  }, [open]);

  const bySection = useMemo(() => {
    const m = new Map<SectionId, BriefItem[]>(SECTIONS.map((s) => [s.id, []]));
    for (const it of items ?? []) m.get(it.section)!.push(it);
    return m;
  }, [items]);

  const onOpen = (it: BriefItem) => {
    if (drag.current?.id === it.id && (drag.current.x !== 0 || drag.current.y !== 0)) return;
    setOpen(false);
    if (it.open.kind === "conversation") {
      if (it.open.id !== genesis.state.activeConversationId) genesis.switchConversation(it.open.id);
      openChatWorkspace(genesis, "conversation");
    } else if (it.open.kind === "panel") genesis.openPanel(it.open.panel as GenesisPanel);
  };

  const counts = SECTIONS.map((s) => `${bySection.get(s.id)?.length ?? 0} ${s.title.toLowerCase()}`).join(" · ");
  const pill = !open ? (
    <button type="button" className="cw-pill" data-workspace-pill onClick={() => setOpen(true)}>
      Your workspace ↓
    </button>
  ) : null;
  if (!open) return document.querySelector("[data-core-chat]") ? createPortal(pill, document.body) : null;

  const absolute = ABSOLUTE.has(fmt.id);
  const flat = SECTIONS.flatMap((s) => bySection.get(s.id) ?? []);
  const sectionsView = SECTIONS.map((s) => (
    <section key={s.id} className="cw-section" data-section={s.id}>
      <h3>{s.title}</h3>
      <div className="cw-items">
        {(bySection.get(s.id) ?? []).map((it) => (
          <Item key={it.id} it={it} onOpen={onOpen} />
        ))}
        {(bySection.get(s.id) ?? []).length === 0 ? <p className="cw-empty">Nothing here yet.</p> : null}
      </div>
    </section>
  ));

  return createPortal(
    <div className="cw" data-cosmos-workspace data-format={fmt.id} ref={scroller}>
      <header className="cw-head">
        <button type="button" className="cw-up" onClick={() => setOpen(false)} aria-label="Back to the Cosmos">↑ Cosmos</button>
        <div className="cw-title">
          <strong>In your Cosmos</strong>
          <small>{items ? counts : "LÉLU is gathering it…"}</small>
        </div>
        <div className="cw-formats" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={f.id === fmt.id} data-format-pick={f.id} data-on={f.id === fmt.id ? "true" : "false"} title={f.blurb} onClick={() => setWorkspaceFormat(f.id, "owner")}>
              {f.name}
            </button>
          ))}
        </div>
        {fmt.by === "lelu" ? <p className="cw-why">LÉLU arranged it this way{fmt.reason ? `: ${fmt.reason}` : ""}.</p> : null}
      </header>
      {!items ? null : absolute ? (
        <div className="cw-canvas" data-canvas={fmt.id} style={{ height: Math.max(620, Math.ceil(flat.length / 4) * 190 + 140) }}>
          {fmt.id === "constellation" ? (
            <svg className="cw-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {flat.slice(1).map((it, i) => {
                const a = place(fmt.id, flat.length, i, free, flat[i].id), b = place(fmt.id, flat.length, i + 1, free, it.id);
                return <line key={it.id} x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100} />;
              })}
            </svg>
          ) : null}
          {flat.map((it, i) => {
            const p = place(fmt.id, flat.length, i, free, it.id);
            return (
              <div
                key={it.id}
                className="cw-abs"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: `translate(-50%, -50%) rotate(${p.r}deg)` }}
                onPointerDown={(e) => {
                  if (fmt.id !== "freeform") return;
                  drag.current = { id: it.id, x: 0, y: 0, ox: e.clientX, oy: e.clientY };
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || d.id !== it.id) return;
                  d.x = e.clientX - d.ox;
                  d.y = e.clientY - d.oy;
                  (e.currentTarget as HTMLElement).style.translate = `${d.x}px ${d.y}px`;
                }}
                onPointerUp={(e) => {
                  const d = drag.current;
                  if (!d || d.id !== it.id) return;
                  const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                  if (Math.hypot(d.x, d.y) > 4) {
                    const next = { ...free, [it.id]: [p.x + d.x / box.width, p.y + d.y / box.height] as [number, number] };
                    setFree(next);
                    localStorage.setItem(FREE_KEY, JSON.stringify(next));
                    (e.currentTarget as HTMLElement).style.translate = "";
                    setTimeout(() => (drag.current = null), 0);
                  } else {
                    // A tap, not a drag: pointer capture keeps the click from reaching the item, so open it here.
                    drag.current = null;
                    onOpen(it);
                  }
                }}
              >
                <Item it={it} onOpen={onOpen} />
              </div>
            );
          })}
        </div>
      ) : fmt.id === "terminal" ? (
        <pre className="cw-term" data-terminal>
          {SECTIONS.map((s) => (
            <span key={s.id}>
              {`\n$ ls ${s.id}/\n`}
              {(bySection.get(s.id) ?? []).map((it) => (
                <button key={it.id} type="button" className="cw-term-line" data-item={it.id} onClick={() => onOpen(it)}>
                  {`  ${(it.tag ?? "").padEnd(14).slice(0, 14)} ${ago(it.time).padStart(4)}  ${it.title}\n`}
                </button>
              ))}
              {(bySection.get(s.id) ?? []).length === 0 ? "  (empty)\n" : null}
            </span>
          ))}
          {"\n$ _"}
        </pre>
      ) : (
        <div className="cw-body">{sectionsView}</div>
      )}
    </div>,
    document.body,
  );
}
