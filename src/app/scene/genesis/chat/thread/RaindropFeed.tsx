/**
 * The Raindrop feed (Mission 44.9, owner's request).
 *
 * Every message and every thread object is a drop, in the order it came.
 * Only the newest few hang above the puddle. When something new arrives
 * while the person is at the latest, it forms above, falls into place, and
 * the oldest hanging drop sinks into the puddle with a ripple.
 *
 * The scrollbar on the side moves through the whole feed: back in time lifts
 * sunk drops out of the puddle in order (the newer ones rise back up out of
 * view), forward lets them fall and sink again. Wheel and touch move it too.
 * The position is kept with the thread (feedPosition), so a reload comes back
 * to the same place; "follow" means "always at the latest".
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { feedPosition, setFeedPosition } from "../../../../../core/thread/ThreadObjects";

export interface FeedEntry {
  id: string;
  at: number;
  /** "you" / "LÉLU" for messages, the object kind for objects. */
  label: string;
  /** What the drop holds. */
  body: ReactNode;
  kind: "message" | "object";
}

type Place = "above" | "hanging" | "sunk";

const TEAR = "M50 0C50 0 44 18 26 40C12 57 4 68 4 80A46 40 0 0 0 96 80C96 68 88 57 74 40C56 18 50 0 50 0Z";

function Drop({ entry, place, slot, slots, focused, fresh, onFocus }: { entry: FeedEntry; place: Place; slot: number; slots: number; focused: boolean; fresh: boolean; onFocus: () => void }) {
  // A drop is first drawn above, then moved to its place, so arriving drops visibly fall.
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const where: Place = mounted ? place : "above";
  // How it reached its current place: fell from above, or rose back out of the puddle.
  const prev = useRef<Place>("above");
  const [arrival, setArrival] = useState<"fell" | "rose" | "">("");
  useEffect(() => {
    if (where === "hanging" && prev.current !== "hanging") setArrival(prev.current === "sunk" ? "rose" : "fell");
    prev.current = where;
  }, [where]);
  const col = slots === 1 ? 0.5 : slot / (slots - 1);
  const sag = slots === 3 && slot === 1 ? 1 : 0;
  const gid = `rdg-${entry.id.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div
      className="rd-drop"
      data-drop={entry.id}
      data-place={where}
      data-kind={entry.kind}
      data-arrival={arrival}
      data-new={fresh ? "true" : "false"}
      data-focused={focused ? "true" : "false"}
      style={{ ["--col" as string]: col, ["--sag" as string]: sag, ["--slots" as string]: slots }}
      onClick={onFocus}
    >
      <span className="rd-strand" aria-hidden />
      <div className="rd-shape">
        <div className="rd-liquid" />
        <svg className="rd-edge" viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="hsl(274 95% 76%)" />
              <stop offset=".45" stopColor="hsl(300 95% 72%)" />
              <stop offset=".75" stopColor="hsl(38 98% 64%)" />
              <stop offset="1" stopColor="hsl(212 95% 68%)" />
            </linearGradient>
          </defs>
          <path d={TEAR} stroke={`url(#${gid})`} />
        </svg>
        <small className="rd-label">{entry.label}</small>
        <div className="rd-body">{entry.body}</div>
      </div>
    </div>
  );
}

export default function RaindropFeed({ conversationId, entries, compact }: { conversationId: string; entries: FeedEntry[]; compact: boolean }) {
  const slots = compact ? 2 : 3;
  const n = entries.length;
  const [pos, setPos] = useState<number | null>(() => feedPosition(conversationId));
  // The window's end: the newest hanging drop + 1. Following = always the latest.
  const end = pos === null ? n : Math.min(n, Math.max(Math.min(slots, n), pos));
  const start = Math.max(0, end - slots);
  const [ripple, setRipple] = useState(0);
  const prevStart = useRef(start);
  useEffect(() => {
    if (start !== prevStart.current) setRipple((r) => r + 1);
    prevStart.current = start;
  }, [start]);
  const [focus, setFocus] = useState<string | null>(null);
  // Drops that arrived while this view was open glow gold for a few seconds.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(entries.map((e) => e.id));
      return;
    }
    const added = entries.filter((e) => !seen.current!.has(e.id)).map((e) => e.id);
    if (!added.length) return;
    for (const id of added) seen.current.add(id);
    setFresh((f) => new Set([...f, ...added]));
    const t = setTimeout(() => setFresh((f) => new Set([...f].filter((x) => !added.includes(x)))), 4000);
    return () => clearTimeout(t);
  }, [entries]);
  const rail = useRef<HTMLDivElement | null>(null);
  const railTo = (clientY: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r || n <= slots) return;
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    move(Math.min(slots, n) + f * (n - Math.min(slots, n)));
  };
  const move = (to: number) => {
    const clamped = Math.min(n, Math.max(Math.min(slots, n), Math.round(to)));
    const follow = clamped >= n;
    setPos(follow ? null : clamped);
    setFeedPosition(conversationId, follow ? null : clamped);
  };
  const touch = useRef<number | null>(null);
  const shown = useMemo(() => entries.map((e, i) => ({ e, i })).filter(({ i }) => i >= start - 3 && i < end + 2), [entries, start, end]);

  return (
    <div
      className="rd"
      data-raindrop-feed={conversationId}
      data-feed-total={n}
      data-feed-start={start}
      data-feed-end={end}
      data-following={pos === null ? "true" : "false"}
      onWheel={(e) => {
        if ((e.target as Element).closest("iframe, canvas, .tm-svg")) return;
        move(end + (e.deltaY > 0 ? 1 : -1));
      }}
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientY ?? null)}
      onTouchMove={(e) => {
        const y = e.touches[0]?.clientY;
        if (touch.current === null || y === undefined || Math.abs(y - touch.current) < 40) return;
        move(end + (y < touch.current ? 1 : -1));
        touch.current = y;
      }}
    >
      <div className="rd-sky" aria-hidden>
        {Array.from({ length: compact ? 8 : 16 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 61) % 100}%`, animationDelay: `${(i * 0.37) % 3}s`, animationDuration: `${2.2 + ((i * 13) % 10) / 6}s` }} />
        ))}
      </div>
      <div className="rd-stage">
        {shown.map(({ e, i }) => (
          <Drop
            key={e.id}
            entry={e}
            place={i < start ? "sunk" : i >= end ? "above" : "hanging"}
            slot={Math.max(0, Math.min(slots - 1, i - start))}
            slots={Math.min(slots, Math.max(1, end - start))}
            focused={focus === e.id}
            fresh={fresh.has(e.id)}
            onFocus={() => setFocus(focus === e.id ? null : e.id)}
          />
        ))}
      </div>
      <div className="rd-puddle" aria-hidden>
        <svg className="rd-pool" viewBox="0 0 1000 200" preserveAspectRatio="none">
          <defs>
            <radialGradient id="rd-pool-glow" cx="50%" cy="62%" r="55%">
              <stop offset="0" stopColor="hsl(274 95% 60% / .45)" />
              <stop offset=".6" stopColor="hsl(38 98% 55% / .12)" />
              <stop offset="1" stopColor="transparent" />
            </radialGradient>
          </defs>
          <ellipse cx="500" cy="130" rx="480" ry="62" fill="url(#rd-pool-glow)" />
          <ellipse cx="500" cy="130" rx="460" ry="56" stroke="hsl(212 95% 66% / .55)" strokeWidth="2" />
          <ellipse cx="500" cy="128" rx="350" ry="42" stroke="hsl(38 98% 62% / .7)" strokeWidth="2.5" />
          <ellipse cx="500" cy="126" rx="240" ry="29" stroke="hsl(300 95% 70% / .7)" strokeWidth="2" />
          <ellipse cx="500" cy="124" rx="130" ry="15" stroke="hsl(274 95% 78% / .9)" strokeWidth="2" />
        </svg>
        {ripple ? (
          <>
            <span key={`a${ripple}`} className="rd-ripple" />
            <span key={`b${ripple}`} className="rd-ripple r2" />
          </>
        ) : null}
        <small className="rd-sunk">{start > 0 ? `${start} earlier beneath the surface` : ""}</small>
      </div>
      <div className="rd-scroll" aria-label="Move through the thread">
        <span className="rd-scroll-cap">{n ? `${end}/${n}` : "0"}</span>
        <div
          ref={rail}
          className="rd-rail"
          data-feed-rail
          onPointerDown={(e) => {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            railTo(e.clientY);
          }}
          onPointerMove={(e) => {
            if (e.buttons) railTo(e.clientY);
          }}
        >
          {entries.map((e, i) => (
            <i key={e.id} data-in={i >= start && i < end ? "true" : "false"} style={{ top: `${n <= 1 ? 50 : (i / (n - 1)) * 100}%` }} />
          ))}
          <span className="rd-thumb" style={{ top: `${n ? (start / n) * 100 : 0}%`, height: `${n ? Math.max(8, ((end - start) / n) * 100) : 100}%` }} />
        </div>
        <input
          type="range"
          min={Math.min(slots, n)}
          max={Math.max(n, 1)}
          step={1}
          value={end}
          disabled={n <= slots}
          onChange={(ev) => move(Number(ev.target.value))}
          aria-label="Thread position: up lifts earlier drops out of the puddle"
          data-feed-scroll
        />
        <button type="button" data-feed-follow disabled={pos === null} onClick={() => move(n)} title="Back to the latest">
          ↓
        </button>
      </div>
    </div>
  );
}
