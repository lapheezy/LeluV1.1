/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS NAV ICONS
 *
 * The reference navigation rail uses thin, elegant, luminous
 * line icons — not emoji glyphs and not filled glyphs. This is
 * that icon set: one shared 24×24 stroke language (1.5px,
 * round caps) drawn from `currentColor` so the dock can tint
 * the active icon cyan and keep the rest monochrome.
 *
 * Each icon maps to an existing dock destination; the mapping
 * lives in GenesisDock.tsx so the two can never drift.
 * ==========================================================
 */

export type GenesisNavIconName =
  | "orbit" // Genesis / cosmic orbit → Chat
  | "spark" // Spark / intelligence → Reasoning
  | "grid" // 4-square workspace → Workspaces
  | "wave" // Pulse / cognition waveform → Engines
  | "crescent" // Crescent / consciousness → Memory
  | "arrows" // Connection / exchange arrows → History
  | "gear" // Settings → API status
  | "user" // Profile → Knowledge & agents
  | "phone" // Device
  | "file" // Logs
  | "globe" // Browser
  | "layers" // Workspace layer
  | "system" // SYSTEM environment switch
  | "bubble" // Chat bubble (bottom nav)
  | "list" // History lines (bottom nav)
  | "lab" // Genesis v2 transformation lab
  | "pencil" // Sketch workspace
  | "aperture" // Render workspace
  | "film" // Video workspace
  | "mask" // Avatar workspace
  | "folder" // Projects / Workspace
  | "sliders" // Settings hub
  | "brain" // Cognition — persistent mind
  | "code" // Engineering — sandbox
  | "evolve"; // Evolution — self-development engine

interface GenesisNavIconProps {
  name: GenesisNavIconName;
  size?: number;
  strokeWidth?: number;
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconPath({ name }: { name: GenesisNavIconName }) {
  switch (name) {
    case "orbit":
      return (
        <>
          <circle cx="12" cy="12" r="4.2" {...STROKE} />
          <ellipse cx="12" cy="12" rx="10" ry="4.6" transform="rotate(-24 12 12)" {...STROKE} />
        </>
      );
    case "spark":
      return <path d="M12 2.8 14 10 21.2 12 14 14 12 21.2 10 14 2.8 12 10 10Z" {...STROKE} strokeWidth={1.35} />;
    case "grid":
      return (
        <>
          <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2" {...STROKE} />
          <rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2" {...STROKE} />
          <rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2" {...STROKE} />
          <rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2" {...STROKE} />
        </>
      );
    case "wave":
      return <path d="M3 12h3.2l2.3-5.4 3 10.8 2.4-8.1 2.2 4.6 2.2-1.9H21" {...STROKE} strokeWidth={1.4} />;
    case "crescent":
      return <path d="M14.4 2.8a9.2 9.2 0 1 0 6.8 15.2A7.2 7.2 0 0 1 14.4 2.8Z" {...STROKE} />;
    case "arrows":
      return (
        <>
          <path d="M3.5 8h13.2M13.4 4.6l3.3 3.4-3.3 3.4" {...STROKE} />
          <path d="M20.5 16H7.3M10.6 12.6l-3.3 3.4 3.3 3.4" {...STROKE} />
        </>
      );
    case "gear":
      return (
        <>
          <circle cx="12" cy="12" r="3.1" {...STROKE} />
          <path
            d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"
            {...STROKE}
            strokeWidth={1.4}
          />
        </>
      );
    case "user":
      return (
        <>
          <circle cx="12" cy="8" r="3.6" {...STROKE} />
          <path d="M4.4 20.2a7.6 7.6 0 0 1 15.2 0" {...STROKE} />
        </>
      );
    case "phone":
      return (
        <>
          <rect x="7" y="2.8" width="10" height="18.4" rx="2.6" {...STROKE} />
          <path d="M10.6 18.6h2.8" {...STROKE} />
        </>
      );
    case "file":
      return (
        <>
          <path d="M6 2.8h8.4L19 7.4v13.8H6Z" {...STROKE} />
          <path d="M14.4 2.8V7.4H19" {...STROKE} />
          <path d="M9 12.4h6M9 16h6" {...STROKE} />
        </>
      );
    case "globe":
      return (
        <>
          <circle cx="12" cy="12" r="8.4" {...STROKE} />
          <path d="M3.6 12h16.8" {...STROKE} />
          <path d="M12 3.6c2.7 2.4 4 5.3 4 8.4s-1.3 6-4 8.4c-2.7-2.4-4-5.3-4-8.4s1.3-6 4-8.4Z" {...STROKE} />
        </>
      );
    case "layers":
      return (
        <>
          <path d="M12 3.2 20.6 8 12 12.8 3.4 8Z" {...STROKE} />
          <path d="M3.4 12.4 12 17.2l8.6-4.8" {...STROKE} />
          <path d="M3.4 16.6 12 21.4l8.6-4.8" {...STROKE} />
        </>
      );
    case "system":
      return (
        <>
          <path d="M12 2.8 20.6 12 12 21.2 3.4 12Z" {...STROKE} />
          <circle cx="12" cy="12" r="2.2" {...STROKE} />
        </>
      );
    case "bubble":
      return (
        <>
          <path d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4v-4.6A1.5 1.5 0 0 1 4 4.5Z" {...STROKE} />
          <path d="M8 9.2h8M8 12.4h5" {...STROKE} strokeWidth={1.4} />
        </>
      );
    case "list":
      return (
        <>
          <path d="M4 6.5h16M4 12h16M4 17.5h10" {...STROKE} />
          <circle cx="19.5" cy="17.5" r="1" {...STROKE} />
        </>
      );
    case "lab":
      return (
        <>
          {/* transformation flask: core nucleus + radiating morph arcs */}
          <path d="M9.2 3h5.6M10.4 3v5.2L5.4 16.4a2.8 2.8 0 0 0 2.4 4.3h8.4a2.8 2.8 0 0 0 2.4-4.3L13.6 8.2V3" {...STROKE} />
          <circle cx="12" cy="14.2" r="2.4" {...STROKE} />
          <path d="M7.6 11.4c2.9-.6 5.9-.6 8.8 0M7.2 17.4c1.5-.8 3.1-1.2 4.8-1.2s3.3.4 4.8 1.2" {...STROKE} strokeWidth={1.3} />
        </>
      );
    case "pencil":
      return (
        <>
          <path d="M4 20l1.2-4.4L15.6 5.2a1.7 1.7 0 0 1 2.4 0l.8.8a1.7 1.7 0 0 1 0 2.4L8.4 18.8 4 20Z" {...STROKE} />
          <path d="M13.8 6.9l3.3 3.3" {...STROKE} strokeWidth={1.3} />
        </>
      );
    case "aperture":
      return (
        <>
          <circle cx="12" cy="12" r="8.4" {...STROKE} />
          <path d="M12 3.6l4.2 7.3H7.8Z" {...STROKE} />
          <path d="M9.6 8.5h8.6M7.8 10.9l2.2 8.2M16.2 10.9l-2.2 8.2" {...STROKE} strokeWidth={1.3} />
        </>
      );
    case "film":
      return (
        <>
          <rect x="3" y="4.5" width="18" height="15" rx="2" {...STROKE} />
          <path d="M7.5 4.5v15M16.5 4.5v15M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21" {...STROKE} strokeWidth={1.3} />
        </>
      );
    case "mask":
      return (
        <>
          <path d="M12 3.2c4.8 0 8.2 2.3 8.2 5.6 0 2-1.2 3.8-3.2 5.1-.6 3.5-2.4 6.1-5 6.1s-4.4-2.6-5-6.1c-2-1.3-3.2-3.1-3.2-5.1 0-3.3 3.4-5.6 8.2-5.6Z" {...STROKE} />
          <path d="M9 11.5c.9-.8 1.9-1.2 3-1.2s2.1.4 3 1.2" {...STROKE} strokeWidth={1.3} />
          <circle cx="9.6" cy="8.8" r="0.6" {...STROKE} />
          <circle cx="14.4" cy="8.8" r="0.6" {...STROKE} />
        </>
      );
    case "folder":
      return (
        <>
          <path d="M3.4 6.4a1.6 1.6 0 0 1 1.6-1.6h4.2l2 2.2h7.8a1.6 1.6 0 0 1 1.6 1.6v9a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6Z" {...STROKE} />
          <path d="M3.4 9.4h17.2" {...STROKE} />
        </>
      );
    case "sliders":
      return (
        <>
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" {...STROKE} />
          <circle cx="16" cy="7" r="2" {...STROKE} />
          <circle cx="8" cy="17" r="2" {...STROKE} />
        </>
      );
    case "brain":
      return (
        <>
          <path d="M9.5 2.8a3.9 3.9 0 0 0-3.8 3.9v.7a4.5 4.5 0 0 0-2.3 4.1c0 2 1.3 3.7 3.1 4.4V17a3.3 3.3 0 0 0 3.3 3.3h.8V3.6c-.4-.3-.7-.6-1.1-.8Z" {...STROKE} />
          <path d="M14.5 2.8a3.9 3.9 0 0 1 3.8 3.9v.7a4.5 4.5 0 0 1 2.3 4.1c0 2-1.3 3.7-3.1 4.4V17a3.3 3.3 0 0 1-3.3 3.3h-.8V3.6c.4-.3.7-.6 1.1-.8Z" {...STROKE} />
          <path d="M8.4 9.6c.8-1 1.7-1.5 2.6-1.7M8.4 14.4c.8 1 1.7 1.5 2.6 1.7M15.6 9.6c-.8-1-1.7-1.5-2.6-1.7M15.6 14.4c-.8 1-1.7 1.5-2.6 1.7" {...STROKE} strokeWidth={1.2} />
        </>
      );
    case "code":
      return (
        <>
          <path d="m8 6-6 6 6 6M16 6l6 6-6 6" {...STROKE} />
        </>
      );
    case "evolve":
      // DNA double-helix — LÉLU inspecting and evolving her own software.
      return (
        <>
          <path d="M8.4 3.2c-2 2.6-2 15 0 17.6M15.6 3.2c2 2.6 2 15 0 17.6" {...STROKE} strokeWidth={1.35} />
          <path d="M8.4 3.2c3.6-1 6.2 2 7.2 0M15.6 3.2c-3.6-1-6.2 2-7.2 0M8.4 6.9c3.6-1 6.2 2 7.2 0M8.4 10.6c3.6-1 6.2 2 7.2 0M8.4 14.3c3.6-1 6.2 2 7.2 0M8.4 18c3.6-1 6.2 2 7.2 0M15.6 6.9c-3.6-1-6.2 2-7.2 0M15.6 10.6c-3.6-1-6.2 2-7.2 0M15.6 14.3c-3.6-1-6.2 2-7.2 0M15.6 18c-3.6-1-6.2 2-7.2 0" {...STROKE} strokeWidth={1.15} />
        </>
      );
  }
}

export default function GenesisNavIcon({ name, size = 20, strokeWidth = 1.5 }: GenesisNavIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0, display: "block" }}
    >
      <IconPath name={name} />
    </svg>
  );
}
