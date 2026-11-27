/**
 * ==========================================================
 * LÉLU — LANGUAGE WINDOW CHROME
 *
 * The title bar of a module window in every composition other than the
 * original glass (which GenesisModuleHost still draws itself, untouched).
 * Each composition is a different arrangement, not a recolour:
 *
 *   console    a box-drawn prompt line, function-key controls
 *   grid       an index number, flush-left grotesk title, word controls
 *   editorial  a centred nameplate between rules, folio and dateline
 *   slab       a title block with heavy outlines, square block controls
 *   scroll     a quiet bar with ink dots; the title hangs vertically
 *   hud        bracketed designation, system readout, key controls
 *   bezel      an engraved plate between screws, status lamps, toggles
 *   organic    a pebble title and soft seed controls
 *
 * Behaviour is shared and unchanged: the bar is the drag handle (the
 * host's pointer handlers), the glyph is the radial "window actions"
 * handle, and pin / minimise / expand / close are the same actions with
 * the same accessible names and data hooks the host's glass bar uses.
 * ==========================================================
 */

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { CompositionSpec, WindowRole } from "../../../../core/interface/CosmosLanguages";

export interface LanguageChromeProps {
  id: string;
  label: string;
  composition: CompositionSpec;
  role: WindowRole;
  /** 1-based position among open windows (folio, index number). */
  index: number;
  status: string;
  pinned: boolean;
  isExpanded: boolean;
  compactScreen: boolean;
  /** The radial window-actions handle (already wired by the host). */
  actionsHandle: ReactNode;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPin: () => void;
  onMinimize: () => void;
  onToggleExpand: () => void;
  onClose: () => void;
  onBackToChat: () => void;
}

const two = (n: number) => String(n).padStart(2, "0");
const ROLE_WORD: Record<WindowRole, string> = {
  browser: "navigation",
  map: "cartography",
  settings: "configuration",
  conversation: "dialogue",
  document: "text",
  files: "archive",
  studio: "studio",
  canvas: "image",
  board: "board",
  list: "register",
  dashboard: "instruments",
  tools: "tools",
};

interface ControlSet {
  pin: ReactNode;
  min: ReactNode;
  max: ReactNode;
  close: ReactNode;
}

function controlFaces(kind: CompositionSpec["chrome"]["controls"], pinned: boolean, expanded: boolean): ControlSet {
  switch (kind) {
    case "keys":
      return { pin: pinned ? "[P*]" : "[P]", min: "[_]", max: expanded ? "[▫]" : "[□]", close: "[×]" };
    case "text":
      return { pin: pinned ? "Pinned" : "Pin", min: "Min", max: expanded ? "Restore" : "Full", close: "Close" };
    case "blocks":
      return { pin: pinned ? "■" : "□", min: "▁", max: expanded ? "▣" : "▢", close: "✕" };
    case "lamps":
      return { pin: "PIN", min: "STBY", max: expanded ? "NORM" : "FULL", close: "STOP" };
    case "dots":
      return { pin: "", min: "", max: "", close: "" };
    default:
      return { pin: pinned ? "📌" : "📍", min: "—", max: expanded ? "⊡" : "⤢", close: "✕" };
  }
}

export default function LanguageWindowChrome(props: LanguageChromeProps) {
  const { id, label, composition, role, index, status, pinned, isExpanded, compactScreen, actionsHandle } = props;
  const faces = controlFaces(composition.chrome.controls, pinned, isExpanded);
  const kind = composition.id;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "window";

  const title = (() => {
    switch (kind) {
      case "console":
        return (
          <span className="clc-title" data-cl-title>
            <span aria-hidden className="clc-box">┤</span> lelu@cosmos:~/{slug}$ <b>{label.toUpperCase()}</b> <span aria-hidden className="clc-box">├</span>
          </span>
        );
      case "grid":
        return (
          <span className="clc-title" data-cl-title>
            <span className="clc-index">{two(index)}</span>
            <b>{label}</b>
            <span className="clc-kicker">{ROLE_WORD[role]}</span>
          </span>
        );
      case "editorial":
        return (
          <span className="clc-title" data-cl-title>
            <span className="clc-folio">No. {two(index)}</span>
            <b>{label}</b>
            <span className="clc-folio">{ROLE_WORD[role]}</span>
          </span>
        );
      case "slab":
        return (
          <span className="clc-title" data-cl-title>
            <b>{label}</b>
            <span className="clc-tag">#{two(index)}</span>
          </span>
        );
      case "scroll":
        return (
          <span className="clc-title" data-cl-title>
            <span className="clc-seal" aria-hidden>{label.slice(0, 1)}</span>
            <span className="clc-kicker">{label}</span>
          </span>
        );
      case "hud":
        return (
          <span className="clc-title" data-cl-title>
            <span aria-hidden>⟦</span>
            <b>{label.toUpperCase()}</b>
            <span aria-hidden>⟧</span>
            <span className="clc-readout">SYS.{two(index)} · {status.toUpperCase()}</span>
          </span>
        );
      case "bezel":
        return (
          <span className="clc-title" data-cl-title>
            <span className="clc-screw" aria-hidden />
            <b>{label.toUpperCase()}</b>
            <span className="clc-readout">UNIT {two(index)}</span>
            <span className="clc-screw" aria-hidden />
          </span>
        );
      default:
        return (
          <span className="clc-title" data-cl-title>
            <b>{label}</b>
          </span>
        );
    }
  })();

  return (
    <div
      data-lelu-module-chrome={id}
      data-cl-chrome={kind}
      data-status={status}
      className="cl-chrome"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerUp}
      style={{ height: 40, flexShrink: 0, touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: "grab" }}
    >
      <span className="cl-actions-handle">{actionsHandle}</span>
      <strong data-lelu-text="title" className="clc-label">
        {title}
      </strong>
      <span className="clc-lamp" data-status={status} title={`status: ${status}`} aria-hidden />
      <span className="clc-controls">
        {compactScreen ? (
          <button type="button" className="clc-btn clc-chat" title="Back to the chat — this keeps running" aria-label="Back to chat" onClick={props.onBackToChat}>
            ◎ Chat
          </button>
        ) : null}
        <button
          type="button"
          className="clc-btn"
          data-cl-control="pin"
          title={pinned ? "Unpin — auto-arrange may tile it again" : "Pin — keep this window where it is"}
          aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
          aria-pressed={pinned}
          data-lelu-module-pin={id}
          data-on={pinned ? "true" : "false"}
          onClick={props.onPin}
        >
          {faces.pin}
        </button>
        <button type="button" className="clc-btn" data-cl-control="min" title="Minimize — keeps running" aria-label={`Minimize ${label}`} onClick={props.onMinimize}>
          {faces.min}
        </button>
        <button type="button" className="clc-btn" data-cl-control="max" title={isExpanded ? "Restore window" : "Expand"} aria-label={isExpanded ? "Restore" : "Expand"} onClick={props.onToggleExpand}>
          {faces.max}
        </button>
        <button type="button" className="clc-btn" data-cl-control="close" title="Close" aria-label={`Close ${label}`} onClick={props.onClose}>
          {faces.close}
        </button>
      </span>
    </div>
  );
}
