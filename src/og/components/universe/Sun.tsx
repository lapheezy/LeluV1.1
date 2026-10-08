import { cn } from "@og/lib/utils";

export type SunState = "idle" | "active" | "focus" | "calm";

const STATE_TINT: Record<SunState, string> = {
  // hue, chroma drive the orb gradient via custom property overrides
  idle:   "70",  // warm gold
  active: "55",  // glowing orange — in conversation
  focus:  "300", // violet — Lélu is thinking / processing
  calm:   "230", // cool blue — at rest / sleep
};

export function Sun({
  onTap,
  size = 180,
  label = "Begin",
  state = "idle",
}: {
  onTap?: () => void;
  size?: number;
  label?: string;
  state?: SunState;
}) {
  const hue = STATE_TINT[state];
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={label}
      className={cn(
        "group relative grid place-items-center rounded-full bg-transparent",
        "outline-none focus-visible:outline-none",
        "transition-transform duration-500 hover:scale-[1.04] active:scale-[0.98]",
      )}
      style={{ width: size, height: size, ["--sun-hue" as string]: hue }}
    >
      {/* Outer aura */}
      <span
        className="sun-aura pointer-events-none absolute rounded-full"
        style={{ width: size * 3, height: size * 3 }}
      />
      {/* The sun itself */}
      <span
        className="sun-orb relative rounded-full"
        style={{ width: size, height: size }}
      />
      {/* Tiny invitation text, only on idle */}
      <span
        className={cn(
          "absolute font-display text-xs tracking-[0.4em] uppercase text-foreground/60",
          "opacity-70 transition-opacity duration-700 group-hover:opacity-100 whitespace-nowrap",
        )}
        style={{ top: `calc(100% + 32px)` }}
      >
        {label}
      </span>
    </button>
  );
}