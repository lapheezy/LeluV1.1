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

function Drop({ entry, place, slot, slots, compact, focused, onFocus }: { entry: FeedEntry; place: Place; slot: number; slots: number; compact: boolean; focused: boolean; onFocus: () => void }) {
  // A drop is first drawn above, then moved to its place, so arriving drops visibly fall.
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const where: Place = mounted ? place : "above";
  const col = slots === 1 ? 0.5 : slot / (slots - 1);
  const sag = slots === 3 && slot === 1 ? 1 : 0;
  return (
    <div
      className="rd-drop"
      data-drop={entry.id}
      data-place={where}
      data-kind={entry.kind}
      data-focused={focused ? "true" : "false"}
      style={{ ["--col" as string]: col, ["--sag" as string]: sag, ["--slots" as string]: slots }}
      onClick={onFocus}
    >
      <span className="rd-strand" aria-hidden />
      <div className="rd-shape">
        <small className="rd-label">{entry.label}</small>
        <div className="rd-body">{entry.body}</div>
      </div>
      {compact ? null : <span className="rd-shine" aria-hidden />}
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
            compact={compact}
            focused={focus === e.id}
            onFocus={() => setFocus(focus === e.id ? null : e.id)}
          />
        ))}
      </div>
      <div className="rd-puddle" aria-hidden>
        <span key={ripple} className="rd-ripple" />
        <span className="rd-ring r1" />
        <span className="rd-ring r2" />
        <span className="rd-ring r3" />
        <small className="rd-sunk">{start > 0 ? `${start} earlier in the puddle` : ""}</small>
      </div>
      <div className="rd-scroll" aria-label="Move through the thread">
        <span className="rd-scroll-cap">{n ? `${end}/${n}` : "0"}</span>
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
