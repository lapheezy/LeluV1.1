/**
 * ==========================================================
 * LÉLU HOME — TERMINAL APPEARANCE STUDIO
 *
 * Everything the Retro Terminal looks like, without code:
 *
 *   Themes       the built-in presets and her saved themes — select,
 *                save, save as, rename, duplicate, delete, import, export
 *   Palette      2–8 swatches; every role pointing at a swatch follows it
 *   Colours      each of the 31 interface roles (8 surfaces, 11 kinds of
 *                text, 12 accents): swatch, picker, HEX, RGB, HSL, reset;
 *                gradients on the large surfaces
 *   Effects      fonts, size, weight, borders, opacity, glow, scanlines,
 *                grid, animation, radius, density; "reduce effects"
 *   Readability  contrast of every pair the terminal draws, with warnings
 *                — she decides; nothing is changed for her
 *
 * The preview is the real terminal behind the studio: every edit is a
 * DRAFT in HomeStore that the terminal paints immediately, and the saved
 * theme is untouched until she saves. Undo, redo and revert are there.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import HomeStore from "./homeStore";
import { useHomeStore } from "./useHomeLive";
import { HomeIcon } from "./HomeModules";
import type { DeviceClass } from "./homeComposition";
import {
  GRADIENT_ROLES,
  MAX_SWATCHES,
  MIN_SWATCHES,
  MONO_FONTS,
  REDUCED_EFFECTS,
  TERMINAL_BODY_FONTS,
  TERMINAL_PRESETS,
  TERMINAL_ROLES,
  addSwatch,
  contrastReport,
  hexToHsl,
  hexToRgb,
  hslToHex,
  isPresetThemeId,
  isSwatchRef,
  monochromeContrast,
  normalizeHex,
  presetTheme,
  presetThemeId,
  removeSwatch,
  resetRole,
  resetTheme,
  resolveValue,
  rgbToHex,
  roleColor,
  setEffects,
  setGradient,
  setRole,
  setSwatch,
  type ContrastCheck,
  type GradientRole,
  type RoleGroup,
  type TerminalEffects,
  type TerminalRole,
  type TerminalTheme,
} from "./homeTerminal";

type Tab = "themes" | "palette" | "colors" | "effects" | "check";

const GROUP_LABEL: Record<RoleGroup, string> = { background: "Backgrounds", text: "Typography", accent: "Accents" };

/** The confirm dialog the studio uses for anything that throws work away. */
interface Confirm {
  text: string;
  yes: string;
  run: () => void;
}

export default function TerminalAppearanceStudio({ device, vars, onClose }: { device: DeviceClass; vars: Record<string, string>; onClose: () => void }) {
  const home = useHomeStore();
  const { themes, activeId, draft, canUndo, canRedo } = home.terminal;
  const theme = HomeStore.terminalTheme();
  const [tab, setTab] = useState<Tab>("colors");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [peek, setPeek] = useState(false);
  const [message, setMessage] = useState("");
  const report = useMemo(() => contrastReport(theme), [theme]);
  const fails = report.filter((c) => c.level === "fail").length;
  const lows = report.filter((c) => c.level === "large").length;
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Focus starts inside the studio — once, on opening (not on every edit, which
  // would pull focus out of the field she is typing in).
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-studio-first]")?.focus();
  }, []);
  // Escape closes (unless a confirmation is open, which Escape cancels).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirm) setConfirm(null);
      else closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(t);
  }, [message]);

  const edit = (fn: (t: TerminalTheme) => TerminalTheme, coalesce?: string) => HomeStore.editTerminal(fn, coalesce);

  /** Switching themes drops unsaved edits — ask first. */
  const guard = (text: string, run: () => void) => {
    if (draft) setConfirm({ text: `${text} Your unsaved changes to "${theme.name}" will be lost.`, yes: "Discard and continue", run });
    else run();
  };

  const tabs: Array<{ id: Tab; label: string; badge?: string }> = [
    { id: "themes", label: "Themes" },
    { id: "palette", label: "Palette" },
    { id: "colors", label: "Colours" },
    { id: "effects", label: "Effects" },
    { id: "check", label: "Readability", badge: fails ? String(fails) : lows ? "!" : undefined },
  ];

  return (
    <div className="rts" ref={rootRef} style={vars} data-device={device} data-peek={peek ? "true" : "false"} role="dialog" aria-modal="false" aria-labelledby="rts-title" data-terminal-studio>
      <header className="rts-head">
        <div className="rts-title-row">
          <h2 id="rts-title">TERMINAL APPEARANCE STUDIO</h2>
          <button type="button" className="rt-icon" onClick={onClose} aria-label="Close the appearance studio" data-studio-first>
            <HomeIcon name="X" size={18} />
          </button>
        </div>
        <div className="rts-status">
          <span className="rts-theme-name">{theme.name}</span>
          {draft ? <span className="rts-unsaved">UNSAVED</span> : <span className="rt-dim">saved</span>}
          {fails ? (
            <button type="button" className="rts-warnchip" onClick={() => setTab("check")}>
              {fails} contrast {fails === 1 ? "problem" : "problems"}
            </button>
          ) : null}
        </div>
        <div className="rts-actions" role="toolbar" aria-label="Appearance actions">
          <button type="button" className="rt-btn" onClick={() => HomeStore.undoTerminal()} disabled={!canUndo} aria-label="Undo appearance change">
            <HomeIcon name="Undo2" size={15} />
          </button>
          <button type="button" className="rt-btn" onClick={() => HomeStore.redoTerminal()} disabled={!canRedo} aria-label="Redo appearance change">
            <HomeIcon name="Redo2" size={15} />
          </button>
          <button type="button" className="rt-btn" onClick={() => HomeStore.revertTerminal()} disabled={!draft} aria-label="Revert all unsaved changes">
            Revert
          </button>
          <button
            type="button"
            className="rt-btn rt-btn-primary"
            onClick={() => {
              const saved = HomeStore.saveTerminalTheme();
              setMessage(isPresetThemeId(activeId) ? `Saved as "${saved.name}" — the preset is unchanged.` : `Saved "${saved.name}".`);
            }}
            disabled={!draft}
            data-terminal-save
          >
            <HomeIcon name="Save" size={15} /> Save
          </button>
          <button type="button" className="rt-btn rts-peek" aria-pressed={peek} onClick={() => setPeek(!peek)} aria-label={peek ? "Show the studio" : "Peek at the terminal"}>
            <HomeIcon name={peek ? "ChevronUp" : "Eye"} size={15} />
          </button>
        </div>
        <div className="rts-tabs" role="tablist" aria-label="Studio sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`rts-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="rts-panel" className="rt-tab" onClick={() => setTab(t.id)}>
              {t.label}
              {t.badge ? <span className="rts-tabbadge">{t.badge}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <div className="rts-body" id="rts-panel" role="tabpanel" aria-labelledby={`rts-tab-${tab}`}>
        {tab === "themes" ? <ThemesTab theme={theme} themes={themes} activeId={activeId} guard={guard} setConfirm={setConfirm} setMessage={setMessage} edit={edit} /> : null}
        {tab === "palette" ? <PaletteTab theme={theme} edit={edit} /> : null}
        {tab === "colors" ? <ColorsTab theme={theme} edit={edit} report={report} /> : null}
        {tab === "effects" ? <EffectsTab theme={theme} edit={edit} /> : null}
        {tab === "check" ? <CheckTab theme={theme} report={report} edit={edit} setConfirm={setConfirm} /> : null}
      </div>

      {message ? (
        <p className="rts-message" role="status">
          {message}
        </p>
      ) : null}

      {confirm ? (
        <div className="rts-confirm" role="alertdialog" aria-modal="true" aria-labelledby="rts-confirm-text">
          <p id="rts-confirm-text">{confirm.text}</p>
          <div>
            <button type="button" className="rt-btn" onClick={() => setConfirm(null)} autoFocus>
              Cancel
            </button>
            <button
              type="button"
              className="rt-btn rt-btn-primary"
              onClick={() => {
                confirm.run();
                setConfirm(null);
              }}
            >
              {confirm.yes}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------
 * Themes
 * ------------------------------------------------------------- */

function Swatches({ theme, n = 5 }: { theme: TerminalTheme; n?: number }) {
  const roles: TerminalRole[] = ["bg", "panel", "text", "accent2", "accent3", "highlight", "error"];
  return (
    <span className="rts-mini" aria-hidden>
      {roles.slice(0, n).map((r) => (
        <i key={r} style={{ background: roleColor(theme, r) }} />
      ))}
    </span>
  );
}

function ThemesTab({
  theme,
  themes,
  activeId,
  guard,
  setConfirm,
  setMessage,
  edit,
}: {
  theme: TerminalTheme;
  themes: TerminalTheme[];
  activeId: string;
  guard: (text: string, run: () => void) => void;
  setConfirm: (c: Confirm | null) => void;
  setMessage: (m: string) => void;
  edit: (fn: (t: TerminalTheme) => TerminalTheme, coalesce?: string) => boolean;
}) {
  const [saveName, setSaveName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [mono, setMono] = useState(0.5);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const download = (id: string, name: string) => {
    const text = HomeStore.exportTerminalTheme(id);
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^\w-]+/g, "-").toLowerCase() || "terminal-theme"}.lelu-theme.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage(`Exported "${name}".`);
    } catch {
      setMessage("Export failed on this device; use Copy instead.");
    }
  };
  const copy = async (id: string, name: string) => {
    try {
      await navigator.clipboard.writeText(HomeStore.exportTerminalTheme(id));
      setMessage(`"${name}" copied as JSON.`);
    } catch {
      setImportText(HomeStore.exportTerminalTheme(id));
      setMessage("Clipboard unavailable — the JSON is in the import box below to copy by hand.");
    }
  };
  const doImport = (text: string) => {
    const r = HomeStore.importTerminalTheme(text);
    if (r.ok) {
      setImportText("");
      setImportError("");
      setMessage(`Imported "${r.theme.name}".`);
    } else setImportError(r.reason);
  };

  return (
    <div className="rts-section">
      <h3 className="rts-h">Presets</h3>
      <p className="rt-dim">Selecting a preset never locks it: edit any colour afterwards. Saving an edited preset makes a theme of your own.</p>
      <div className="rts-presets">
        {TERMINAL_PRESETS.map((p) => {
          const id = presetThemeId(p.id);
          const t = presetTheme(p.id);
          return (
            <button key={p.id} type="button" className="rts-preset" aria-pressed={activeId === id} onClick={() => guard(`Switch to ${p.name}?`, () => HomeStore.selectTerminalTheme(id))} data-preset={p.id} style={{ background: t.palette[0], color: roleColor(t, "text"), borderColor: roleColor(t, "border") }}>
              <Swatches theme={t} />
              <strong style={{ color: roleColor(t, "heading") }}>{p.name}</strong>
              <small style={{ color: roleColor(t, "text2") }}>{p.blurb}</small>
            </button>
          );
        })}
      </div>

      {theme.base === "monochrome" ? (
        <label className="rts-field">
          <span>Monochrome contrast</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={mono}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMono(v);
              edit((t) => monochromeContrast(t, v), "mono-contrast");
            }}
            aria-label="Monochrome contrast, soft to high"
          />
        </label>
      ) : null}

      <h3 className="rts-h">Save</h3>
      <div className="rts-inline">
        <input className="rts-input" value={saveName} maxLength={60} placeholder={`${theme.name} (custom)`} onChange={(e) => setSaveName(e.target.value)} aria-label="Name for the new theme" />
        <button
          type="button"
          className="rt-btn"
          onClick={() => {
            const t = HomeStore.saveTerminalThemeAs(saveName.trim() || `${theme.name} (custom)`);
            setSaveName("");
            setMessage(`Saved as "${t.name}".`);
          }}
        >
          Save as new
        </button>
        <button type="button" className="rt-btn" onClick={() => setConfirm({ text: `Reset "${theme.name}" to the ${presetTheme(theme.base).name} preset? You can undo this.`, yes: "Reset theme", run: () => edit((t) => resetTheme(t)) })}>
          <HomeIcon name="RotateCcw" size={14} /> Reset to preset
        </button>
      </div>

      <h3 className="rts-h">My themes</h3>
      {themes.length ? (
        <ul className="rts-list">
          {themes.map((t) => (
            <li key={t.id} data-active={activeId === t.id ? "true" : undefined}>
              {renaming === t.id ? (
                <input
                  className="rts-input"
                  value={renameText}
                  maxLength={60}
                  autoFocus
                  aria-label={`Rename ${t.name}`}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => {
                    HomeStore.renameTerminalTheme(t.id, renameText);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button type="button" className="rts-theme-pick" aria-pressed={activeId === t.id} onClick={() => guard(`Switch to ${t.name}?`, () => HomeStore.selectTerminalTheme(t.id))}>
                  <Swatches theme={t} />
                  <span>{t.name}</span>
                </button>
              )}
              <span className="rts-row-actions">
                <button type="button" className="rt-btn" aria-label={`Rename ${t.name}`} onClick={() => (setRenaming(t.id), setRenameText(t.name))}>
                  <HomeIcon name="PenLine" size={14} />
                </button>
                <button type="button" className="rt-btn" aria-label={`Duplicate ${t.name}`} onClick={() => guard(`Duplicate ${t.name}?`, () => HomeStore.duplicateTerminalTheme(t.id))}>
                  <HomeIcon name="Copy" size={14} />
                </button>
                <button type="button" className="rt-btn" aria-label={`Export ${t.name}`} onClick={() => download(t.id, t.name)}>
                  <HomeIcon name="FileText" size={14} />
                </button>
                <button type="button" className="rt-btn" aria-label={`Delete ${t.name}`} onClick={() => setConfirm({ text: `Delete "${t.name}"? This cannot be undone (export it first to keep a copy).`, yes: "Delete", run: () => HomeStore.deleteTerminalTheme(t.id) })}>
                  <HomeIcon name="Trash2" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rt-dim">None yet. Edit a preset and press Save, or use “Save as new”.</p>
      )}
      <div className="rts-inline">
        <button type="button" className="rt-btn" onClick={() => guard("Duplicate the current theme?", () => HomeStore.duplicateTerminalTheme(activeId))}>
          <HomeIcon name="Copy" size={14} /> Duplicate current
        </button>
        <button type="button" className="rt-btn" onClick={() => download(activeId, theme.name)}>
          Export current
        </button>
        <button type="button" className="rt-btn" onClick={() => void copy(activeId, theme.name)}>
          Copy JSON
        </button>
      </div>

      <h3 className="rts-h">Import</h3>
      <div className="rts-inline">
        <button type="button" className="rt-btn" onClick={() => fileRef.current?.click()}>
          Import file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) doImport(await file.text());
          }}
        />
      </div>
      <textarea className="rts-input rts-textarea" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="…or paste an exported theme's JSON here" aria-label="Theme JSON to import" rows={4} />
      <div className="rts-inline">
        <button type="button" className="rt-btn" disabled={!importText.trim()} onClick={() => doImport(importText)}>
          Import pasted
        </button>
        {importError ? (
          <span className="rt-err" role="alert">
            {importError}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
 * Colour input — picker · HEX · RGB · HSL
 * ------------------------------------------------------------- */

function ColorInput({ value, onChange, label, coalesceKey }: { value: string; onChange: (hex: string, coalesce?: string) => void; label: string; coalesceKey: string }) {
  const [hex, setHex] = useState(value);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"rgb" | "hsl">("hsl");
  useEffect(() => {
    setHex(value);
    setError(false);
  }, [value]);
  const rgb = hexToRgb(value);
  const hsl = hexToHsl(value);
  const commitHex = () => {
    const n = normalizeHex(hex);
    if (n) {
      setError(false);
      onChange(n);
    } else setError(true);
  };
  return (
    <div className="rts-color">
      <div className="rts-inline">
        <input type="color" className="rts-picker" value={value} onChange={(e) => onChange(e.target.value, `${coalesceKey}:picker`)} aria-label={`${label} colour picker`} />
        <input
          className="rts-input rts-hex"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => e.key === "Enter" && commitHex()}
          aria-label={`${label} HEX value`}
          aria-invalid={error}
          spellCheck={false}
          autoCapitalize="off"
          maxLength={32}
        />
        <button type="button" className="rt-btn" aria-pressed={mode === "hsl"} onClick={() => setMode(mode === "hsl" ? "rgb" : "hsl")} aria-label={`Switch to ${mode === "hsl" ? "RGB" : "HSL"} controls`}>
          {mode === "hsl" ? "HSL" : "RGB"}
        </button>
      </div>
      {error ? (
        <p className="rt-err" role="alert">
          Not a colour. Use #rgb, #rrggbb, rgb(…) or hsl(…).
        </p>
      ) : null}
      {mode === "rgb" ? (
        <div className="rts-sliders">
          {(["R", "G", "B"] as const).map((c, i) => (
            <label key={c}>
              <span>{c}</span>
              <input
                type="range"
                min={0}
                max={255}
                value={rgb[i]}
                onChange={(e) => {
                  const next = [...rgb] as [number, number, number];
                  next[i] = Number(e.target.value);
                  onChange(rgbToHex(...next), `${coalesceKey}:rgb${i}`);
                }}
                aria-label={`${label} ${c}`}
              />
              <input
                type="number"
                className="rts-num"
                min={0}
                max={255}
                value={rgb[i]}
                onChange={(e) => {
                  const next = [...rgb] as [number, number, number];
                  next[i] = Math.max(0, Math.min(255, Number(e.target.value) || 0));
                  onChange(rgbToHex(...next), `${coalesceKey}:rgbn${i}`);
                }}
                aria-label={`${label} ${c} value`}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="rts-sliders">
          {(["H", "S", "L"] as const).map((c, i) => (
            <label key={c}>
              <span>{c}</span>
              <input
                type="range"
                min={0}
                max={i === 0 ? 359 : 100}
                value={hsl[i]}
                onChange={(e) => {
                  const next = [...hsl] as [number, number, number];
                  next[i] = Number(e.target.value);
                  onChange(hslToHex(...next), `${coalesceKey}:hsl${i}`);
                }}
                aria-label={`${label} ${c === "H" ? "hue" : c === "S" ? "saturation" : "lightness"}`}
              />
              <span className="rts-num">{hsl[i]}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
 * Palette
 * ------------------------------------------------------------- */

function PaletteTab({ theme, edit }: { theme: TerminalTheme; edit: (fn: (t: TerminalTheme) => TerminalTheme, coalesce?: string) => boolean }) {
  const usage = (i: number) => TERMINAL_ROLES.filter((r) => theme.roles[r.id] === `@${i}`).length + Object.values(theme.gradients).filter((g) => g?.to === `@${i}`).length;
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="rts-section">
      <p className="rt-dim">Your palette: up to {MAX_SWATCHES} colours. Roles that use a swatch follow it when you change it — one edit can recolour the whole terminal. Assign swatches to roles in Colours.</p>
      <ul className="rts-swatches">
        {theme.palette.map((c, i) => (
          <li key={i}>
            <button type="button" className="rts-swatch-btn" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} aria-label={`Swatch ${i + 1}, ${c}, used by ${usage(i)} roles. Edit.`}>
              <i style={{ background: c }} />
              <span className="rt-num">{c.toUpperCase()}</span>
              <span className="rt-dim">
                #{i + 1} · {usage(i)} roles
              </span>
            </button>
            {open === i ? (
              <div className="rts-editor">
                <ColorInput value={c} label={`Swatch ${i + 1}`} coalesceKey={`swatch${i}`} onChange={(hex, k) => edit((t) => setSwatch(t, i, hex), k)} />
                <button type="button" className="rt-btn" disabled={theme.palette.length <= MIN_SWATCHES} onClick={() => (edit((t) => removeSwatch(t, i)), setOpen(null))}>
                  <HomeIcon name="Trash2" size={14} /> Remove swatch (its roles keep the colour)
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <button type="button" className="rt-btn" disabled={theme.palette.length >= MAX_SWATCHES} onClick={() => edit((t) => addSwatch(t, "#7f7f7f"))}>
        <HomeIcon name="Plus" size={14} /> Add swatch
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------
 * Colours — every role
 * ------------------------------------------------------------- */

function LevelBadge({ check }: { check?: ContrastCheck | null }) {
  if (!check) return null;
  const text = check.level === "pass" ? "OK" : check.level === "large" ? "LOW" : "FAIL";
  return (
    <span className="rts-level" data-level={check.level} title={`${check.label}: ${check.ratio}:1`}>
      {check.ratio.toFixed(1)} {text}
    </span>
  );
}

function ColorsTab({ theme, edit, report }: { theme: TerminalTheme; edit: (fn: (t: TerminalTheme) => TerminalTheme, coalesce?: string) => boolean; report: ContrastCheck[] }) {
  const [open, setOpen] = useState<TerminalRole | null>(null);
  const groups: RoleGroup[] = ["background", "text", "accent"];
  const firstCheck = (role: TerminalRole) => report.find((c) => c.fg === role) ?? null;
  const worstOnSurface = (role: TerminalRole) => report.filter((c) => c.bg === role).sort((a, b) => a.ratio - b.ratio)[0] ?? null;
  return (
    <div className="rts-section">
      {groups.map((g) => (
        <section key={g} aria-label={GROUP_LABEL[g]}>
          <h3 className="rts-h">{GROUP_LABEL[g]}</h3>
          <ul className="rts-roles">
            {TERMINAL_ROLES.filter((r) => r.group === g).map((r) => {
              const value = theme.roles[r.id];
              const hex = roleColor(theme, r.id);
              const check = g === "background" ? worstOnSurface(r.id) : firstCheck(r.id);
              return (
                <li key={r.id} data-role={r.id}>
                  <button type="button" className="rts-role" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} aria-label={`${r.label}: ${hex}${isSwatchRef(value) ? `, swatch ${Number(value.slice(1)) + 1}` : ""}. Edit.`}>
                    <i style={{ background: hex }} />
                    <span className="rts-role-label">{r.label}</span>
                    <span className="rt-num rt-dim">{isSwatchRef(value) ? `#${Number(value.slice(1)) + 1}` : hex.toUpperCase()}</span>
                    <LevelBadge check={check} />
                  </button>
                  {open === r.id ? (
                    <div className="rts-editor">
                      <div className="rts-chips" role="group" aria-label={`Use a palette swatch for ${r.label}`}>
                        {theme.palette.map((c, i) => (
                          <button key={i} type="button" className="rts-chip" aria-pressed={value === `@${i}`} style={{ background: c }} onClick={() => edit((t) => setRole(t, r.id, `@${i}`))} aria-label={`Swatch ${i + 1} ${c}`} />
                        ))}
                      </div>
                      <ColorInput value={hex} label={r.label} coalesceKey={`role:${r.id}`} onChange={(next, k) => edit((t) => setRole(t, r.id, next), k)} />
                      {(GRADIENT_ROLES as readonly string[]).includes(r.id) ? <GradientEditor theme={theme} role={r.id as GradientRole} edit={edit} /> : null}
                      <button type="button" className="rt-btn" onClick={() => edit((t) => resetRole(t, r.id))}>
                        <HomeIcon name="RotateCcw" size={14} /> Reset this colour
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GradientEditor({ theme, role, edit }: { theme: TerminalTheme; role: GradientRole; edit: (fn: (t: TerminalTheme) => TerminalTheme, coalesce?: string) => boolean }) {
  const g = theme.gradients[role];
  return (
    <div className="rts-gradient">
      <label className="rts-check">
        <input type="checkbox" checked={Boolean(g)} onChange={(e) => edit((t) => setGradient(t, role, e.target.checked ? { to: theme.palette[Math.min(2, theme.palette.length - 1)], angle: 180 } : null))} />
        <span>Gradient</span>
      </label>
      {g ? (
        <>
          <div className="rts-chips" role="group" aria-label="Gradient end colour from the palette">
            {theme.palette.map((c, i) => (
              <button key={i} type="button" className="rts-chip" aria-pressed={g.to === `@${i}`} style={{ background: c }} onClick={() => edit((t) => setGradient(t, role, { ...g, to: `@${i}` }))} aria-label={`Gradient to swatch ${i + 1}`} />
            ))}
          </div>
          <ColorInput value={resolveValue(theme, g.to)} label="Gradient end" coalesceKey={`grad:${role}`} onChange={(hex, k) => edit((t) => setGradient(t, role, { ...g, to: hex }), k)} />
          <label className="rts-field">
            <span>Angle {g.angle}°</span>
            <input type="range" min={0} max={359} value={g.angle} onChange={(e) => edit((t) => setGradient(t, role, { ...g, angle: Number(e.target.value) }), `grad-angle:${role}`)} aria-label="Gradient angle" />
          </label>
        </>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------
 * Effects
 * ------------------------------------------------------------- */

function EffectsTab({ theme, edit }: { theme: TerminalTheme; edit: (fn: (t: TerminalTheme) => TerminalTheme, coalesce?: string) => boolean }) {
  const e = theme.effects;
  const set = (patch: Partial<TerminalEffects>, k?: string) => edit((t) => setEffects(t, patch), k);
  const slider = (key: keyof TerminalEffects, label: string, min: number, max: number, step: number, show: (v: number) => string, note?: ReactNode) => (
    <label className="rts-field" key={key}>
      <span>
        {label} <b className="rt-num">{show(e[key] as number)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={e[key] as number} onChange={(ev) => set({ [key]: Number(ev.target.value) } as Partial<TerminalEffects>, `fx:${key}`)} aria-label={label} />
      {note}
    </label>
  );
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="rts-section">
      <div className="rts-inline">
        <button type="button" className="rt-btn" onClick={() => set(REDUCED_EFFECTS)}>
          Reduce effects
        </button>
        <button type="button" className="rt-btn" onClick={() => set({ ...presetTheme(theme.base).effects })}>
          <HomeIcon name="RotateCcw" size={14} /> Effects from preset
        </button>
      </div>
      <p className="rt-dim">Glow, scanlines, the grid and animation are drawn once over the terminal (no per-frame work). Reduced-motion devices always get animation off.</p>
      <h3 className="rts-h">Type</h3>
      <label className="rts-field">
        <span>Font family</span>
        <select className="rts-input" value={e.font} onChange={(ev) => set({ font: ev.target.value })} aria-label="Font family">
          {TERMINAL_BODY_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="rts-field">
        <span>Monospace font</span>
        <select className="rts-input" value={e.monoFont} onChange={(ev) => set({ monoFont: ev.target.value })} aria-label="Monospace font">
          {MONO_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {slider("fontSize", "Font size", 12, 20, 1, (v) => `${v}px`)}
      {slider("weight", "Weight", 300, 700, 100, (v) => String(v))}
      <h3 className="rts-h">Surfaces</h3>
      {slider("borderIntensity", "Border intensity", 0, 1, 0.05, pct)}
      {slider("panelOpacity", "Panel opacity", 0, 1, 0.05, pct, e.panelOpacity < 0.5 ? <small className="rt-warn">Low opacity lets the Cosmos through: real contrast depends on what is behind the panel.</small> : null)}
      {slider("radius", "Corner radius", 0, 16, 1, (v) => `${v}px`)}
      {slider("density", "Density / spacing", 0, 1, 0.05, (v) => (v < 0.34 ? "compact" : v < 0.67 ? "regular" : "airy"))}
      <h3 className="rts-h">Effects</h3>
      {slider("glow", "Glow", 0, 1, 0.05, pct)}
      {slider("scanlines", "Scanlines", 0, 1, 0.05, (v) => (v === 0 ? "off" : pct(v)))}
      <label className="rts-check">
        <input type="checkbox" checked={e.grid} onChange={(ev) => set({ grid: ev.target.checked })} />
        <span>Background grid</span>
      </label>
      {slider("animation", "Animation", 0, 1, 0.05, (v) => (v === 0 ? "off" : pct(v)))}
    </div>
  );
}

/* ---------------------------------------------------------------
 * Readability
 * ------------------------------------------------------------- */

function CheckTab({ theme, report, edit, setConfirm }: { theme: TerminalTheme; report: ContrastCheck[]; edit: (fn: (t: TerminalTheme) => TerminalTheme, coalesce?: string) => boolean; setConfirm: (c: Confirm | null) => void }) {
  const fails = report.filter((c) => c.level === "fail");
  const lows = report.filter((c) => c.level === "large");
  return (
    <div className="rts-section">
      <p className={fails.length ? "rt-err" : lows.length ? "rt-warn" : "rt-ok"} role="status">
        {fails.length ? `${fails.length} pair${fails.length === 1 ? "" : "s"} below the minimum — text may be hard or impossible to read.` : lows.length ? `${lows.length} pair${lows.length === 1 ? "" : "s"} only readable at large sizes.` : "Every pair meets WCAG AA."}
      </p>
      <p className="rt-dim">Text needs 4.5:1 (3:1 counts only for large text); borders, controls and indicators need 3:1. Your colours are never changed for you.</p>
      <table className="rts-table">
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col">Sample</th>
            <th scope="col">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {[...report].sort((a, b) => a.ratio - b.ratio).map((c) => (
            <tr key={c.id} data-level={c.level}>
              <td>{c.label}</td>
              <td>
                <span className="rts-sample" style={{ background: roleColor(theme, c.bg), color: roleColor(theme, c.fg) }}>
                  Aa 42
                </span>
              </td>
              <td>
                <LevelBadge check={c} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="rt-btn rt-btn-primary"
        onClick={() =>
          setConfirm({
            text: `Restore a readable palette? This replaces every colour with the ${presetTheme(theme.base).name} preset's (effects and name are kept). Undo is available.`,
            yes: "Restore readable colours",
            run: () =>
              edit((t) => {
                const base = presetTheme(t.base);
                return { ...t, palette: base.palette, roles: base.roles, gradients: base.gradients, updatedAt: Date.now() };
              }),
          })
        }
      >
        Restore readable palette
      </button>
    </div>
  );
}
