/**
 * ==========================================================
 * LÉLU — SETTINGS NAVIGATION, PER COMPOSITION
 *
 * Settings is one long list of real controls. Under a design language it
 * gains the navigation that language would give it — the SAME sections
 * and the same controls, reached differently:
 *
 *   command      a shell menu: `settings> show 3 runtime`
 *   index        a numbered index column (01 … 08)
 *   contents     a table of contents with dotted leaders and folios
 *   tabs         heavy block tabs
 *   vertical     vertical tabs hanging on the right
 *   dial         a radial selector, sections around a ring
 *   switchboard  labelled hardware keys with lamps
 *   pebbles      a drift of soft pebbles
 * ==========================================================
 */

import "./settingsLanguage.css";

export const SETTINGS_SECTIONS = [
  { id: "overview", label: "Overview", short: "OVR" },
  { id: "identity", label: "Cloud identity", short: "ID" },
  { id: "destinations", label: "Destinations", short: "DST" },
  { id: "runtime", label: "Local runtime", short: "RUN" },
  { id: "proactive", label: "Proactive & voice", short: "PRO" },
  { id: "data", label: "Data", short: "DAT" },
  { id: "engine", label: "Model engine", short: "ENG" },
  { id: "foundation", label: "Foundation", short: "FND" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

interface Props {
  kind: string;
  sections: typeof SETTINGS_SECTIONS;
  current: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}

const two = (n: number) => String(n).padStart(2, "0");

export default function SettingsNav({ kind, sections, current, onSelect }: Props) {
  const button = (s: (typeof SETTINGS_SECTIONS)[number], _i: number, children: React.ReactNode, extra?: React.CSSProperties) => (
    <button
      key={s.id}
      type="button"
      role="tab"
      aria-selected={current === s.id}
      data-cl-keep
      data-settings-nav={s.id}
      data-on={current === s.id ? "true" : "false"}
      onClick={() => onSelect(s.id)}
      title={s.label}
      style={extra}
    >
      {children}
    </button>
  );

  if (kind === "dial") {
    const r = 82;
    const c = 104;
    const at = sections.findIndex((s) => s.id === current);
    return (
      <nav className="cls-nav" data-cl-nav="dial" role="tablist" aria-label="Settings sections">
        <div className="cls-dial" style={{ width: c * 2, height: c * 2 }}>
          <svg width={c * 2} height={c * 2} aria-hidden className="cls-dial-svg">
            <circle cx={c} cy={c} r={r} fill="none" />
            <circle cx={c} cy={c} r={r - 26} fill="none" className="cls-dial-inner" />
            {sections.map((_, i) => {
              const a = (i / sections.length) * Math.PI * 2 - Math.PI / 2;
              return <line key={i} x1={c + Math.cos(a) * (r - 8)} y1={c + Math.sin(a) * (r - 8)} x2={c + Math.cos(a) * (r + 6)} y2={c + Math.sin(a) * (r + 6)} />;
            })}
            <line className="cls-dial-needle" x1={c} y1={c} x2={c + Math.cos((at / sections.length) * Math.PI * 2 - Math.PI / 2) * (r - 30)} y2={c + Math.sin((at / sections.length) * Math.PI * 2 - Math.PI / 2) * (r - 30)} />
          </svg>
          {sections.map((s, i) => {
            const a = (i / sections.length) * Math.PI * 2 - Math.PI / 2;
            return button(s, i, s.short, { position: "absolute", left: c + Math.cos(a) * r - 21, top: c + Math.sin(a) * r - 13 });
          })}
          <span className="cls-dial-read">{sections[at]?.label ?? ""}</span>
        </div>
      </nav>
    );
  }

  return (
    <nav className="cls-nav" data-cl-nav={kind} role="tablist" aria-label="Settings sections">
      {kind === "command" ? <span className="cls-prompt">settings&gt; show</span> : null}
      {kind === "contents" ? <span className="cls-contents-title">Contents</span> : null}
      {sections.map((s, i) => {
        switch (kind) {
          case "command":
            return button(s, i, <>{i + 1} {s.label.toLowerCase().replace(/\s+&\s+/g, "+").replace(/\s+/g, "-")}</>);
          case "index":
            return button(s, i, <><b>{two(i + 1)}</b> {s.label}</>);
          case "contents":
            return button(s, i, <><span>{s.label}</span><i aria-hidden /><b>{i + 1}</b></>);
          case "switchboard":
            return button(s, i, <><span className="cls-lamp" aria-hidden />{s.short}</>);
          case "vertical":
            return button(s, i, <span className="cls-vtext">{s.label}</span>);
          default:
            return button(s, i, s.label);
        }
      })}
    </nav>
  );
}
