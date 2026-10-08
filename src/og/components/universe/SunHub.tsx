import { useEffect, useRef, useState } from "react";
import { Link } from "@og/compat/router";
import { Sun, type SunState } from "./Sun";
import { MessageCircle, Sparkles, Orbit, FileText, LayoutDashboard } from "lucide-react";
import { cn } from "@og/lib/utils";

type Satellite = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
};

const SATELLITES: Satellite[] = [
  { label: "speak", icon: MessageCircle, to: "/" }, // handled by onTap below
  { label: "memory", icon: Sparkles, to: "/app/memories" },
  { label: "universes", icon: Orbit, to: "/app/universes" },
  { label: "files", icon: FileText, to: "/app/files" },
  { label: "inner sky", icon: LayoutDashboard, to: "/app" },
];

export function SunHub({
  onSpeak,
  state = "idle",
  size = 180,
}: {
  onSpeak: () => void;
  state?: SunState;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number | null>(null);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function handleTap() {
    if (open) { setOpen(false); return; }
    onSpeak();
  }

  function startPress() {
    pressTimer.current = window.setTimeout(() => setOpen(true), 380);
  }
  function cancelPress() {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  const radius = size * 0.95;

  return (
    <div
      ref={wrapRef}
      className="relative grid place-items-center"
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => { e.preventDefault(); setOpen((v) => !v); }}
    >
      <Sun onTap={handleTap} state={state} size={size} label={open ? "" : "tap to speak · hold for orbit"} />

      {/* Satellites */}
      <div
        className={cn(
          "absolute inset-0 grid place-items-center transition-opacity duration-300",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!open}
      >
        {SATELLITES.map((s, i) => {
          // distribute on the upper arc so satellites don't fall into the water
          const angle = Math.PI + (Math.PI * (i + 0.5)) / SATELLITES.length;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const Icon = s.icon;
          const isSpeak = i === 0;
          const inner = (
            <span className="grid h-12 w-12 place-items-center rounded-full border border-foreground/15 bg-background/60 text-foreground/80 shadow-lg backdrop-blur transition-all hover:scale-110 hover:text-foreground hover:border-foreground/40">
              <Icon className="h-5 w-5" />
              <span className="absolute top-full mt-1 text-[9px] uppercase tracking-[0.3em] text-foreground/60 whitespace-nowrap">
                {s.label}
              </span>
            </span>
          );
          return (
            <div
              key={s.label}
              className={cn(
                "absolute transition-transform duration-500",
                open ? "pointer-events-auto" : "pointer-events-none scale-50",
              )}
              style={{ transform: `translate(${open ? x : 0}px, ${open ? y : 0}px)` }}
            >
              {isSpeak ? (
                <button type="button" onClick={() => { setOpen(false); onSpeak(); }} aria-label="speak">
                  {inner}
                </button>
              ) : (
                <Link to={s.to} onClick={() => setOpen(false)} aria-label={s.label}>
                  {inner}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}