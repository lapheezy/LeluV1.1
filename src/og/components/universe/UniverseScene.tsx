import { useMemo } from "react";
import { Link } from "@og/compat/router";
import type { HorizonItem } from "@og/lib/horizons.functions";

type Star = {
  top: string;
  left: string;
  size: number;
  drift: number;
  twinkle: number;
  delay: number;
  opacity: number;
};

function makeStars(count: number, topMax: number): Star[] {
  return Array.from({ length: count }, (_, i) => {
    // deterministic-ish pseudo random for SSR stability
    const r = (n: number) => {
      const x = Math.sin((i + 1) * n) * 10000;
      return x - Math.floor(x);
    };
    const fx = (n: number) => Number(n.toFixed(3));
    return {
      top: `${fx(r(1.7) * topMax)}%`,
      left: `${fx(r(3.3) * 100)}%`,
      size: fx(1 + r(5.1) * 2),
      drift: fx(60 + r(7.2) * 80),
      twinkle: fx(3 + r(2.4) * 5),
      delay: fx(r(8.9) * -10),
      opacity: fx(0.3 + r(11.1) * 0.7),
    };
  });
}

export function UniverseScene({
  children,
  horizons,
}: {
  children?: React.ReactNode;
  horizons?: HorizonItem[];
}) {
  const stars = useMemo(() => makeStars(70, 65), []);
  const reflectedStars = useMemo(() => makeStars(20, 100), []);
  const lights = useMemo(() => placeHorizons(horizons ?? []), [horizons]);

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Sky: cosmos → sunset */}
      <div className="universe-sky absolute inset-x-0 top-0 h-[72%]" />

      {/* Stars in the sky */}
      <div className="absolute inset-x-0 top-0 h-[60%] pointer-events-none">
        {stars.map((s, i) => (
          <span
            key={i}
            className="star"
            style={{
              top: s.top,
              left: s.left,
              width: `${s.size}px`,
              height: `${s.size}px`,
              opacity: s.opacity,
              animationDuration: `${s.drift}s, ${s.twinkle}s`,
              animationDelay: `${s.delay}s, ${s.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Firmament — the luminous horizon line */}
      <div className="universe-firmament absolute inset-x-0 h-[3px] top-[72%]" />

      {/* Water below */}
      <div className="universe-water absolute inset-x-0 bottom-0 top-[72%] overflow-hidden">
        {/* Reflections of stars in the water */}
        {reflectedStars.map((s, i) => (
          <span
            key={i}
            className="star"
            style={{
              top: s.top,
              left: s.left,
              width: `${s.size}px`,
              height: `${s.size}px`,
              opacity: Number((s.opacity * 0.5).toFixed(3)),
              filter: "blur(0.4px)",
              animationDuration: `${Number((s.drift * 2).toFixed(3))}s, ${s.twinkle}s`,
              animationDelay: `${s.delay}s, ${s.delay}s`,
            }}
          />
        ))}
      </div>

      {/* User lights — conversations and saved items as living stars */}
      {lights.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[1]">
          {lights.map((l) => (
            <Link
              key={`${l.item.kind}-${l.item.id}`}
              to={l.item.kind === "conversation" ? "/chat/$threadId" : "/"}
              params={l.item.kind === "conversation" ? { threadId: l.item.id } : undefined}
              className="group pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${l.x}%`, top: `${l.y}%` }}
              aria-label={`${l.item.kind}: ${l.item.title}`}
            >
              <span
                className="block rounded-full bg-sun"
                style={{
                  width: l.size,
                  height: l.size,
                  opacity: l.brightness,
                  boxShadow: `0 0 ${l.size * 3}px oklch(0.95 0.16 75 / ${l.brightness})`,
                }}
              />
              <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-popover/80 px-2 py-1 text-[10px] uppercase tracking-widest text-foreground/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                {l.item.kind === "conversation" ? "" : `${l.item.kind} · `}
                {l.item.title}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Foreground content (sun, chat panel, etc.) */}
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}

/**
 * Lays out the user's lights as star clusters in the sky:
 * - Each kind has its own constellation region.
 * - Most recent within a kind is largest and brightest; older drift outward & dim.
 */
function placeHorizons(items: HorizonItem[]) {
  // Region per kind: center x/y (% of viewport) and radius (% units).
  const regions: Record<HorizonItem["kind"], { x: number; y: number; r: number }> = {
    conversation: { x: 50, y: 28, r: 22 }, // around the sun
    reminder:     { x: 18, y: 22, r: 12 },
    task:         { x: 82, y: 22, r: 12 },
    note:         { x: 28, y: 50, r: 10 },
    goal:         { x: 72, y: 50, r: 10 },
    event:        { x: 50, y: 12, r: 16 },
  };
  const byKind = new Map<HorizonItem["kind"], HorizonItem[]>();
  for (const it of items) {
    const arr = byKind.get(it.kind) ?? [];
    arr.push(it);
    byKind.set(it.kind, arr);
  }

  const out: Array<{
    item: HorizonItem;
    x: number;
    y: number;
    size: number;
    brightness: number;
  }> = [];

  for (const [kind, arr] of byKind) {
    const region = regions[kind];
    arr.forEach((item, idx) => {
      // Deterministic angle / distance from kind+id hash
      const seed = hash(`${kind}:${item.id}`);
      const angle = (seed % 360) * (Math.PI / 180);
      // newest items sit closer to region center; older drift outward
      const dist = Math.min(1, idx / 12) * region.r;
      const x = region.x + Math.cos(angle) * dist;
      const y = region.y + Math.sin(angle) * dist * 0.55; // squashed for sky perspective
      const brightness = Math.max(0.25, 1 - idx * 0.08);
      const size = Math.max(2, 6 - idx * 0.45);
      out.push({ item, x, y, size, brightness });
    });
  }
  return out;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}