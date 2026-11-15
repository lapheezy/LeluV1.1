/**
 * ==========================================================
 * LÉLU HOME — DESIGN STUDIO (Mission 15)
 *
 * The twelve compositions as WORKING prototypes: each frame is
 * the real HomeComposition with the eight live modules, at the
 * real width of an iPhone (390), a tablet (834) or a desktop
 * (1280), scaled to fit. "Try it" makes the frame editable
 * (drag, resize, float, dock, group — the same ops as the Home)
 * on a scratch copy; "Use this" saves it as a NEW presentation,
 * so trying a composition never overwrites an arrangement.
 *
 * Loaded lazily from the Home's edit bar or `?homeStudio`.
 * ==========================================================
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import HomeComposition from "./HomeComposition";
import HomeStore from "./homeStore";
import { HomeIcon, useHomeSignals } from "./HomeModules";
import { useHomeStore } from "./useHomeLive";
import { TEMPLATES, applyHomeOp, presentationFromTemplate, templateFor, type DeviceClass, type HomeOp, type HomePresentation, type TemplateId } from "./homeComposition";
import "./homeStudio.css";

const FRAME: Record<DeviceClass, { width: number; height: number; label: string; icon: string }> = {
  phone: { width: 390, height: 844, label: "iPhone", icon: "Smartphone" },
  tablet: { width: 834, height: 1194, label: "Tablet", icon: "Tablet" },
  desktop: { width: 1280, height: 860, label: "Desktop", icon: "Monitor" },
};

type View = DeviceClass | "all";
const YOURS = "__yours__";

export default function HomeDesignStudio({ onClose }: { onClose: () => void }) {
  const home = useHomeStore();
  const signals = useHomeSignals();
  const [selected, setSelected] = useState<string>(() => new URLSearchParams(location.search).get("homeStudio") || "bento-universe");
  const [view, setView] = useState<View>(() => (window.innerWidth < 700 ? "phone" : "all"));
  const [trying, setTrying] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, HomePresentation>>({});
  const [note, setNote] = useState("");

  const yours = home.presentations.list.find((p) => p.id === home.presentations.activeId) ?? home.presentations.list[0];
  const base = useMemo(() => (selected === YOURS ? yours : presentationFromTemplate((templateFor(selected).id as TemplateId) ?? "bento-universe", undefined, 0)), [selected, yours]);
  const presentation = drafts[selected] ?? base;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const edit = (device: DeviceClass, op: HomeOp) => setDrafts((d) => ({ ...d, [selected]: applyHomeOp(d[selected] ?? base, device, op) }));

  const use = () => {
    if (selected === YOURS) {
      setNote("This is already your Home.");
      return;
    }
    const created = HomeStore.adoptPresentation(presentation, templateFor(presentation.template).name);
    setNote(`Saved as a new presentation, “${created.name}”. Your previous one is kept — switch back from the edit bar.`);
  };

  const devices: DeviceClass[] = view === "all" ? ["phone", "tablet", "desktop"] : [view];

  // A modal on the app's modal layer: portalled to <body> so no ancestor's
  // stacking context (the Home sits under the scene canvas's) can bury it.
  return createPortal(
    <div className="hs" role="dialog" aria-modal="true" aria-label="Home Design Studio" data-home-studio>
      <header className="hs-head">
        <div className="hs-title">
          <strong>Home Design Studio</strong>
          <small>12 compositions · real modules · iPhone, tablet and desktop</small>
        </div>
        <div className="hs-seg" role="radiogroup" aria-label="Device">
          {(["phone", "tablet", "desktop", "all"] as View[]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
              {v === "all" ? "All three" : FRAME[v].label}
            </button>
          ))}
        </div>
        <button type="button" className="hs-close" onClick={onClose} aria-label="Close the studio">
          <HomeIcon name="X" size={18} />
        </button>
      </header>

      <nav className="hs-list" aria-label="Compositions">
        <button type="button" data-on={selected === YOURS} onClick={() => setSelected(YOURS)}>
          <strong>Your Home</strong>
          <small>{yours.name}</small>
        </button>
        {TEMPLATES.map((t, i) => (
          <button key={t.id} type="button" data-on={selected === t.id} onClick={() => setSelected(t.id)} data-template={t.id}>
            <strong>
              {i + 1}. {t.name}
            </strong>
            <small>{t.blurb}</small>
          </button>
        ))}
      </nav>

      <section className="hs-main">
        <div className="hs-bar">
          <span className="hs-kinds">
            {(["phone", "tablet", "desktop"] as DeviceClass[]).map((d) => (
              <span key={d}>
                {FRAME[d].label}: <b>{templateFor(presentation.template).kind[d]}</b>
              </span>
            ))}
          </span>
          <label className="hs-try">
            <input type="checkbox" checked={trying} onChange={(e) => setTrying(e.target.checked)} /> Try it (drag, resize, float, dock)
          </label>
          {drafts[selected] ? (
            <button type="button" onClick={() => setDrafts(({ [selected]: _gone, ...rest }) => rest)}>
              <HomeIcon name="RotateCcw" size={14} /> Reset frames
            </button>
          ) : null}
          <button type="button" className="hs-use" onClick={use} disabled={selected === YOURS} data-home-studio-use>
            <HomeIcon name="Check" size={14} /> Use as a new presentation
          </button>
        </div>
        {note ? (
          <p className="hs-note" role="status">
            {note}
          </p>
        ) : null}
        <div className="hs-frames" data-view={view}>
          {devices.map((device) => (
            <Frame key={device} device={device} share={devices.length}>
              <HomeComposition presentation={presentation} device={device} preview editing={trying} signals={signals} onOp={(op) => edit(device, op)} label={`${presentation.name} on ${FRAME[device].label}`} />
            </Frame>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** A device-sized frame scaled to the space it has (no re-layout: real widths). */
function Frame({ device, share, children }: { device: DeviceClass; share: number; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.4);
  const f = FRAME[device];
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = Math.max(320, window.innerHeight - 190);
      setScale(Math.min(1, w / f.width, share === 1 ? h / f.height : 10));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [f.width, f.height, share]);
  return (
    <figure className="hs-frame" data-device={device} ref={outer}>
      <figcaption>
        <HomeIcon name={f.icon} size={14} /> {f.label} · {f.width}px
      </figcaption>
      <div className="hs-viewport-box" style={{ height: f.height * scale }}>
        <div className="hs-viewport" style={{ width: f.width, height: f.height, transform: `scale(${scale})` }}>
          <div className="hs-cosmos" aria-hidden />
          <div className="hs-home lch lch-m15" data-device={device} style={{ ["--canvas-h" as string]: `${f.height - 150}px`, ["--deck-h" as string]: `${Math.round(f.height * 0.42)}px` }}>
            <header className="lch-header">
              <span className="lch-round">
                <HomeIcon name="Menu" />
              </span>
              <div className="lch-brand">
                <span className="lch-brand-name">
                  LÉLU<sup>+</sup>
                </span>
                <span className="lch-brand-sub">Workspace</span>
              </div>
              <div className="lch-header-right">
                <span className="lch-round lch-cosmos">
                  <span className="lch-cosmos-core" />
                </span>
              </div>
            </header>
            {children}
          </div>
        </div>
      </div>
    </figure>
  );
}
