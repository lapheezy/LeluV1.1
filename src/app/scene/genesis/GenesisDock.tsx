/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS DOCK
 *
 * The single navigation surface for the AI OS — the same list
 * backs the visible dock and the command palette, so the two
 * can never drift apart.
 *
 * Three layouts, one source of truth (DOCK_ITEMS):
 *   Desktop (≥1024px) — the reference's full-height left rail
 *     (~80px, dark translucent glass, thin luminous line icons,
 *     active state with cyan glow + left indicator bar).
 *   Tablet (720–1024px) — compact floating icon rail.
 *   Narrow (<720px) — horizontal bar pinned to the bottom,
 *     scrollable, so nothing clips on mobile.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GenesisPanel } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import GenesisNavIcon, { type GenesisNavIconName } from "./GenesisNavIcons";
import GenesisTabEditor from "./GenesisTabEditor";
import KvStore from "../../../core/storage/KvStore";

export interface DockItem {
  id: GenesisPanel;
  label: string;
  glyph: string;
  icon: GenesisNavIconName;
  group: "core" | "intelligence" | "system";
}

export const DOCK_ITEMS: DockItem[] = [
  { id: "chat", label: "Chat", glyph: "◎", icon: "orbit", group: "core" },
  { id: "cosmos", label: "Cosmos", glyph: "✦", icon: "spark", group: "core" },
  { id: "history", label: "History", glyph: "≡", icon: "arrows", group: "core" },
  { id: "workspaces", label: "Projects", glyph: "▦", icon: "folder", group: "core" },
  // GENESIS v2 — the Core Transformation Lab. A first-class workspace
  // destination, not a modal: it opens as a panel like every other dock
  // item and controls/observes the SAME ONE Genesis Core.
  { id: "genesisv2", label: "Genesis v2", glyph: "⬡", icon: "lab", group: "core" },
  // LÉLU V1 creative expansion — dedicated workspaces.
  { id: "sketch", label: "Sketch", glyph: "✎", icon: "pencil", group: "core" },
  { id: "render", label: "Render", glyph: "◍", icon: "aperture", group: "core" },
  { id: "video", label: "Video", glyph: "▶", icon: "film", group: "core" },
  { id: "avatar", label: "Avatar", glyph: "◉", icon: "mask", group: "core" },
  { id: "reasoning", label: "Reasoning", glyph: "✦", icon: "spark", group: "intelligence" },
  { id: "cognition", label: "Cognition", glyph: "◬", icon: "brain", group: "intelligence" },
  { id: "engineering", label: "Engineering", glyph: "⌘", icon: "code", group: "intelligence" },
  { id: "evolution", label: "Evolution", glyph: "⬖", icon: "evolve", group: "intelligence" },
  { id: "agents", label: "Agents", glyph: "◈", icon: "user", group: "intelligence" },
  { id: "memory", label: "Memory", glyph: "◐", icon: "crescent", group: "intelligence" },
  { id: "providers", label: "API Status", glyph: "⌁", icon: "gear", group: "system" },
  { id: "settings", label: "Settings", glyph: "⚙", icon: "sliders", group: "system" },
  { id: "device", label: "Device", glyph: "◮", icon: "phone", group: "system" },
  { id: "diagnostics", label: "Engines", glyph: "●", icon: "wave", group: "system" },
  { id: "logs", label: "Logs", glyph: "▤", icon: "file", group: "system" },
  { id: "browser", label: "Browser", glyph: "◫", icon: "globe", group: "system" },
  { id: "workspace", label: "Workspace", glyph: "◱", icon: "layers", group: "system" },
  // The SYSTEM tab is the LÉLU UI ↔ SYSTEM UI environment switch. Its id
  // stays "visual" (VisualEngine.interfaceFocus drives it), but it reads
  // as the second operating environment, not a panel.
  { id: "visual", label: "System", glyph: "◉", icon: "system", group: "system" },
];

/**
 * The reference rail presents the primary destinations first, in the
 * reference's icon order (orbit, spark, grid, wave, crescent, arrows,
 * gear, user). The remaining system items follow below a divider —
 * every destination stays reachable from the rail.
 */
/* ----------------------------------------------------------
 * ADJUSTABLE TABS — persisted dock customization.
 *
 * The user can reorder, hide/show, and resize every tab across
 * all three dock layouts (mobile bar / tablet rail / desktop
 * rail). Settings persist through the shared KvStore, so the
 * layout survives reloads and is the same on every breakpoint.
 * ---------------------------------------------------------- */

export type DockSize = "compact" | "standard" | "large";

export interface DockSettings {
  order: string[];
  hidden: string[];
  size: DockSize;
}

const DOCK_CONFIG_KEY = "lelu.dock.v1";
const DEFAULT_DOCK_SETTINGS: DockSettings = { order: [], hidden: [], size: "standard" };

function readDockSettings(): DockSettings {
  try {
    const stored = KvStore.getInstance().get<Partial<DockSettings>>(DOCK_CONFIG_KEY);
    return { ...DEFAULT_DOCK_SETTINGS, ...(stored ?? {}) };
  } catch {
    return { ...DEFAULT_DOCK_SETTINGS };
  }
}

function sizeTokens(size: DockSize): { padding: string; fontSize: number; iconSize: number; gap: number } {
  if (size === "compact") {
    return { padding: "5px 10px", fontSize: 11, iconSize: 15, gap: 5 };
  }
  if (size === "large") {
    return { padding: "8px 16px", fontSize: 13.5, iconSize: 21, gap: 8 };
  }
  return { padding: "6px 12px", fontSize: 12, iconSize: 18, gap: 6 };
}

function useDockSettings() {
  const [settings, setSettings] = useState<DockSettings>(() => readDockSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const persist = useCallback((next: DockSettings) => {
    setSettings(next);
    try {
      KvStore.getInstance().set(DOCK_CONFIG_KEY, next);
    } catch {
      // persistence must never break the dock
    }
  }, []);

  /** Visible tabs in the user's chosen order (custom order first, then the rest). */
  const visibleItems = useMemo<DockItem[]>(() => {
    const byId = new Map<string, DockItem>(DOCK_ITEMS.map((item) => [item.id, item]));
    const hidden = new Set(settings.hidden);
    const ordered: DockItem[] = settings.order
      .map((id) => byId.get(id))
      .filter((item): item is DockItem => item !== undefined && !hidden.has(item.id));
    const rest = DOCK_ITEMS.filter((item) => !hidden.has(item.id) && !ordered.includes(item));
    return [...ordered, ...rest];
  }, [settings.order, settings.hidden]);

  const toggleHidden = (id: GenesisPanel) => {
    const hidden = settings.hidden.includes(id)
      ? settings.hidden.filter((item) => item !== id)
      : [...settings.hidden, id];
    persist({ ...settings, hidden });
  };

  const move = (id: GenesisPanel, direction: -1 | 1) => {
    const ids = visibleItems.map((item) => item.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) {
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist({ ...settings, order: next });
  };

  /** Drag-to-reorder: move `id` to the slot currently occupied by `overId`. */
  const moveTo = useCallback(
    (id: GenesisPanel, overId: GenesisPanel) => {
      const current = settingsRef.current;
      const hidden = new Set(current.hidden);
      const byId = new Map<string, DockItem>(DOCK_ITEMS.map((item) => [item.id, item]));
      const ordered = current.order
        .map((oid) => byId.get(oid))
        .filter((item): item is DockItem => item !== undefined && !hidden.has(item.id));
      const rest = DOCK_ITEMS.filter((item) => !hidden.has(item.id) && !ordered.includes(item));
      const ids = [...ordered, ...rest].map((item) => item.id);
      const from = ids.indexOf(id);
      const targetIndex = ids.indexOf(overId);
      if (from < 0 || targetIndex < 0 || from === targetIndex) {
        return;
      }
      const next = [...ids];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);
      persist({ ...current, order: next });
    },
    [persist],
  );

  const setSize = (size: DockSize) => persist({ ...settings, size });

  const reset = () => persist({ ...DEFAULT_DOCK_SETTINGS });

  return { settings, visibleItems, toggleHidden, move, moveTo, setSize, reset };
}

/** Shared "customize tabs" trigger button. */
function TabEditButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Customize tabs — reorder, hide, resize"
      aria-label="Customize tabs"
      className="lelu-tab-cloud"
      style={{
        flexShrink: 0,
        borderRadius: 999,
        padding: compact ? "6px 9px" : "6px 12px",
        fontSize: compact ? 11 : 11.5,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <span aria-hidden>⚙</span>
      {compact ? null : "Tabs"}
    </button>
  );
}

/* ------------------------------------------------------------------
 * DOCK TAB — the draggable tab button.
 *
 * Grab-and-drag reorder works on every layout and pointer type:
 *   mouse  — press + drag more than 6px starts the drag;
 *   touch  — long-press (~320ms) lifts the tab, then drag;
 * the tab under the pointer swaps into its slot and the new order is
 * persisted through the shared dock settings (same KvStore as the ⚙
 * editor), so the layout survives reloads on every breakpoint.
 * A tap that never became a drag still selects the tab as before.
 * ------------------------------------------------------------------ */
interface DockTabProps {
  item: DockItem;
  active: boolean;
  glowBorder?: string;
  glowClass?: string;
  onSelect: () => void;
  onReorder: (dragId: string, overId: string) => void;
  children: ReactNode;
  title?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}

function DockTab({
  item,
  active,
  glowBorder,
  glowClass,
  onSelect,
  onReorder,
  children,
  title,
  ariaLabel,
  style,
}: DockTabProps) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    longPress: number | null;
    started: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lifted, setLifted] = useState(false);
  const suppressClickRef = useRef(false);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.longPress !== null && drag?.longPress !== undefined) {
      window.clearTimeout(drag.longPress);
    }
    if (drag?.started) {
      suppressClickRef.current = true;
    }
    dragRef.current = null;
    setDragging(false);
    setLifted(false);
  }, []);

  /* While dragging, the whole window tracks the pointer: the tab under
     the cursor swaps into its slot (dragId moves to overId's index). */
  useEffect(() => {
    if (!dragging) {
      return;
    }
    function onMove(event: PointerEvent) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const target = element?.closest?.("[data-lelu-tab]");
      const overId = target?.getAttribute("data-lelu-tab");
      if (overId && overId !== item.id) {
        onReorder(item.id, overId);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [dragging, endDrag, item.id, onReorder]);

  return (
    <button
      type="button"
      data-lelu-tab={item.id}
      title={title ?? item.label}
      aria-label={ariaLabel ?? item.label}
      onClick={() => {
        // A drag that just ended also fires a click — swallow it so the
        // tab only toggles when the user actually tapped it.
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onSelect();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.pointerType !== "touch") {
          return;
        }
        const point = {
          startX: event.clientX,
          startY: event.clientY,
          longPress: null as number | null,
          started: false,
        };
        dragRef.current = point;
        if (event.pointerType === "touch") {
          point.longPress = window.setTimeout(() => {
            if (dragRef.current === point) {
              point.started = true;
              setDragging(true);
              setLifted(true);
            }
          }, 320);
        }
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.started) {
          return;
        }
        if (event.pointerType === "mouse") {
          const dx = Math.abs(event.clientX - drag.startX);
          const dy = Math.abs(event.clientY - drag.startY);
          if (dx + dy > 6) {
            drag.started = true;
            setDragging(true);
            setLifted(true);
          }
        }
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`lelu-tab-cloud${active ? " lelu-tab-cloud-active" : ""}${glowClass ? ` ${glowClass}` : ""}`}
      style={{
        ...style,
        border: active ? undefined : glowBorder ?? undefined,
        cursor: "pointer",
        fontFamily: "inherit",
        touchAction: dragging ? "none" : undefined,
        userSelect: dragging ? "none" : undefined,
        WebkitUserSelect: dragging ? "none" : undefined,
        transform: lifted ? "scale(1.08)" : undefined,
        opacity: lifted ? 0.92 : undefined,
        zIndex: lifted ? 30 : undefined,
        boxShadow: lifted ? "0 12px 32px rgba(2, 6, 23, 0.65), 0 0 26px rgba(255, 158, 203, 0.4)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

type Breakpoint = "mobile" | "tablet" | "desktop";

function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => {
    if (typeof window === "undefined") {
      return "desktop";
    }
    const width = window.innerWidth;
    return width < 720 ? "mobile" : width < 1024 ? "tablet" : "desktop";
  });

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      setBreakpoint(width < 720 ? "mobile" : width < 1024 ? "tablet" : "desktop");
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return breakpoint;
}

interface GenesisDockProps {
  activePanel: GenesisPanel;
  onSelect: (panel: GenesisPanel) => void;
  online: boolean;
  /**
   * Phase 11 — optional live signals (same source Phase 10 wired into
   * the 3D core: GenesisUIState). All optional and default to inert
   * so existing callers that don't pass them render exactly as before.
   */
  thinking?: boolean;
  speaking?: boolean;
  reasoningActive?: boolean;
  engineErrorCount?: number;
  /**
   * Whether the Visual interface layer is currently focused — makes the
   * Visual dock tab reflect the live VisualEngine state.
   */
  visualActive?: boolean;
}

export default function GenesisDock({
  activePanel,
  onSelect,
  online,
  thinking = false,
  speaking = false,
  reasoningActive = false,
  engineErrorCount = 0,
  visualActive = false,
}: GenesisDockProps) {
  const breakpoint = useBreakpoint();
  const dockSettings = useDockSettings();
  const [tabEditorOpen, setTabEditorOpen] = useState(false);
  const tokens = sizeTokens(dockSettings.settings.size);
  const hasErrors = engineErrorCount > 0;
  const isLive = thinking || speaking;

  /* Drag-to-reorder handler shared by every layout — move the dragged
     tab into the slot of the tab currently under the pointer. */
  const handleReorder = useCallback(
    (dragId: string, overId: string) => {
      dockSettings.moveTo(dragId as GenesisPanel, overId as GenesisPanel);
    },
    [dockSettings.moveTo],
  );

  const tabEditor = tabEditorOpen ? (
    <GenesisTabEditor
      visible={dockSettings.visibleItems}
      allItems={DOCK_ITEMS}
      settings={dockSettings.settings}
      onToggleHidden={dockSettings.toggleHidden}
      onMove={dockSettings.move}
      onSetSize={dockSettings.setSize}
      onReset={dockSettings.reset}
      onClose={() => setTabEditorOpen(false)}
      mobile={breakpoint === "mobile"}
    />
  ) : null;

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadDone, setDownloadDone] = useState(false);

  const base = typeof import.meta.env.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
  const zipHref = `${base}lelu-project.zip`;

  const statusColor = hasErrors
    ? genesisTheme.status.error
    : isLive
      ? genesisTheme.status.accent
      : online
        ? genesisTheme.status.ok
        : genesisTheme.status.idle;

  const statusPulsing = !hasErrors && isLive;
  const statusTitle = hasErrors
    ? `${engineErrorCount} engine${engineErrorCount === 1 ? "" : "s"} reporting errors`
    : isLive
      ? speaking
        ? "Speaking"
        : "Thinking"
      : online
        ? "Live"
        : "Booting";

  function toggle(id: GenesisPanel) {
    onSelect(activePanel === id ? "none" : id);
  }

  function isItemActive(id: GenesisPanel): boolean {
    if (id === "visual") {
      return visualActive;
    }
    return activePanel === id;
  }

  function itemGlow(id: GenesisPanel): { border?: string; className?: string } {
    if (id === "reasoning" && reasoningActive) {
      return {
        border: genesisTheme.glass.borderAccent,
        className: "genesis-signal-active",
      };
    }
    if (id === "diagnostics" && hasErrors) {
      return {
        border: `1px solid ${genesisTheme.status.error}`,
      };
    }
    return {};
  }

  async function handleZipDownload(event: { preventDefault(): void }) {
    const savePicker = (
      window as unknown as {
        showSaveFilePicker?: (opts?: unknown) => Promise<unknown>;
      }
    ).showSaveFilePicker;

    // Browsers without the File System Access API get the plain native
    // download of the linked file (anchor `download` attribute).
    if (typeof savePicker !== "function") return;

    event.preventDefault();
    setDownloading(true);
    setDownloadError(null);
    setDownloadDone(false);
    try {
      const response = await fetch(zipHref, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${zipHref}`);
      const blob = await response.blob();
      if (blob.size < 1000) throw new Error("Downloaded file looks empty");
      try {
        const handle = (await savePicker({
          suggestedName: "lelu-project.zip",
          types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
        })) as {
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        };
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setDownloadDone(true);
      } catch (pickerError) {
        if ((pickerError as Error)?.name === "AbortError") return; // user cancelled
        throw pickerError;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDownloadError(message);
      console.error("[GenesisDock] Project ZIP download failed:", error);
      // Last resort: open the served file in a new tab so the browser
      // handles it natively. Right-click → "Save link as…" always works.
      window.open(zipHref, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  }

  /* ----------------------------------------------------------
   * PINCH-TO-ZOOM on dock: two-finger pinch on the dock bar
   * cycles through compact → standard → large.
   * ---------------------------------------------------------- */
  const pinchRef = useRef<{ dist: number; size: DockSize } | null>(null);

  function handleDockTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), size: dockSettings.settings.size };
    }
  }

  function handleDockTouchMove(e: React.TouchEvent) {
    const pinch = pinchRef.current;
    if (!pinch || e.touches.length !== 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const newDist = Math.hypot(dx, dy);
    const ratio = newDist / pinch.dist;
    if (ratio > 1.4 && pinch.size === "compact") {
      dockSettings.setSize("standard");
      pinchRef.current = { dist: newDist, size: "standard" };
    } else if (ratio > 1.4 && pinch.size === "standard") {
      dockSettings.setSize("large");
      pinchRef.current = { dist: newDist, size: "large" };
    } else if (ratio < 0.6 && pinch.size === "large") {
      dockSettings.setSize("standard");
      pinchRef.current = { dist: newDist, size: "standard" };
    } else if (ratio < 0.6 && pinch.size === "standard") {
      dockSettings.setSize("compact");
      pinchRef.current = { dist: newDist, size: "compact" };
    }
  }

  function handleDockTouchEnd() {
    pinchRef.current = null;
  }

  /* ----------------------------------------------------------
   * MOBILE (<720px): horizontal bottom bar — the compact
   * navigation for phones. Every destination stays reachable.
   * ---------------------------------------------------------- */
  if (breakpoint === "mobile") {
    return (
      <>
        <div
          className="lelu-tab-bar"
          onTouchStart={handleDockTouchStart}
          onTouchMove={handleDockTouchMove}
          onTouchEnd={handleDockTouchEnd}
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 25,
            pointerEvents: "auto",
            display: "flex",
            gap: 7,
            overflowX: "auto",
            overflowY: "hidden",
            alignItems: "center",
            padding: "9px 10px",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 9px)",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {dockSettings.visibleItems.map((item) => {
            const active = isItemActive(item.id);
            const glow = itemGlow(item.id);
            return (
              <DockTab
                key={item.id}
                item={item}
                active={active}
                glowBorder={glow.border}
                glowClass={glow.className}
                onSelect={() => toggle(item.id)}
                onReorder={handleReorder}
                style={{
                  flexShrink: 0,
                  borderRadius: 999,
                  padding: tokens.padding,
                  fontSize: tokens.fontSize,
                  display: "flex",
                  alignItems: "center",
                  gap: tokens.gap,
                }}
              >
                <span aria-hidden>{item.glyph}</span>
                {item.label}
              </DockTab>
            );
          })}
          <TabEditButton onClick={() => setTabEditorOpen(true)} compact />
          <a
            href={zipHref}
            download="lelu-project.zip"
            onClick={handleZipDownload}
            title={
              downloadError
                ? `Download blocked: ${downloadError} — right-click → "Save link as…"`
                : "Download project ZIP (right-click → “Save link as…” if no download starts)"
            }
            className="lelu-tab-cloud"
            style={{
              flexShrink: 0,
              borderRadius: 999,
              padding: tokens.padding,
              fontSize: tokens.fontSize,
              display: "flex",
              alignItems: "center",
              gap: tokens.gap,
              cursor: "pointer",
              textDecoration: "none",
              fontFamily: "inherit",
            }}
          >
            <span aria-hidden>{downloading ? "◌" : downloadDone ? "✓" : "⬇"}</span>
            {downloading ? "Preparing…" : downloadDone ? "Saved" : "ZIP"}
          </a>
        </div>
        {tabEditor}
      </>
    );
  }

  /* ----------------------------------------------------------
   * TABLET (720–1024px): compact floating icon rail.
   * ---------------------------------------------------------- */
  if (breakpoint === "tablet") {
    const railSize = dockSettings.settings.size === "large" ? 46 : dockSettings.settings.size === "compact" ? 34 : 40;
    return (
      <>
        <div
          className="lelu-tab-bar"
          style={{
            position: "fixed",
            top: "50%",
            left: 12,
            transform: "translateY(-50%)",
            zIndex: 25,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "10px 7px",
            borderRadius: 18,
            maxHeight: "calc(100dvh - 28px)",
            overflowY: "auto",
            scrollbarWidth: "none",
          }}
        >
          <div
            title={statusTitle}
            className={statusPulsing ? "genesis-signal-active" : undefined}
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              alignSelf: "center",
              color: statusColor,
              background: statusColor,
              boxShadow: online || isLive ? `0 0 8px ${statusColor}` : "none",
              flexShrink: 0,
            }}
          />

          {dockSettings.visibleItems.map((item) => {
            const active = isItemActive(item.id);
            const glow = itemGlow(item.id);
            return (
              <DockTab
                key={item.id}
                item={item}
                active={active}
                glowBorder={glow.border}
                glowClass={glow.className}
                onSelect={() => toggle(item.id)}
                onReorder={handleReorder}
                title={item.label}
                style={{
                  width: railSize,
                  height: railSize,
                  flexShrink: 0,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <GenesisNavIcon name={item.icon} size={tokens.iconSize} />
              </DockTab>
            );
          })}

          <TabEditButton onClick={() => setTabEditorOpen(true)} compact />
          <a
            href={zipHref}
            download="lelu-project.zip"
            onClick={handleZipDownload}
            title={
              downloadError
                ? `Download blocked: ${downloadError} — right-click → "Save link as…"`
                : "Download project ZIP (right-click → “Save link as…” if no download starts)"
            }
            className="lelu-tab-cloud"
            style={{
              width: railSize,
              height: railSize,
              flexShrink: 0,
              borderRadius: 14,
              fontSize: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
              fontFamily: "inherit",
            }}
          >
            <span aria-hidden>{downloading ? "◌" : downloadDone ? "✓" : "⬇"}</span>
          </a>
          {downloadError ? (
            <div
              style={{
                width: 128,
                fontSize: 10,
                lineHeight: 1.35,
                textAlign: "center",
                color: genesisTheme.status.error,
              }}
            >
              {downloadError}
            </div>
          ) : null}
        </div>
        {tabEditor}
      </>
    );
  }

  /* ----------------------------------------------------------
   * DESKTOP (≥1024px): the reference's full-height left rail.
   * ~80px wide, dark translucent glass, thin luminous line
   * icons, active state glowing with a left indicator bar.
   * ---------------------------------------------------------- */
  const primaryIds = new Set<GenesisPanel>(["chat", "genesisv2", "reasoning", "cognition", "engineering", "evolution", "workspaces", "sketch", "render", "video", "avatar", "diagnostics", "memory", "history", "providers", "agents"]);
  const railSize = dockSettings.settings.size === "large" ? 48 : dockSettings.settings.size === "compact" ? 38 : 44;

  return (
    <>
      <div
        className="lelu-tab-bar"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: 80,
          zIndex: 25,
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: "16px 0 12px",
          boxSizing: "border-box",
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(214, 178, 255, 0.3) transparent",
        }}
      >
        {/* system status */}
        <div
          title={statusTitle}
          className={statusPulsing ? "genesis-signal-active" : undefined}
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            marginBottom: 10,
            color: statusColor,
            background: statusColor,
            boxShadow: online || isLive ? `0 0 10px ${statusColor}` : "none",
            flexShrink: 0,
          }}
        />

        {dockSettings.visibleItems.map((item) => {
          const active = isItemActive(item.id);
          const primary = primaryIds.has(item.id);
          const dividerBefore = item.id === "device" || item.id === "visual";
          const glow = itemGlow(item.id);
          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
                flexShrink: 0,
              }}
            >
              {dividerBefore ? (
                <div style={{ width: 36, height: 1, background: "rgba(255,255,255,0.1)", margin: "8px 0 10px" }} />
              ) : null}
              <DockTab
                item={item}
                active={active}
                glowBorder={glow.border}
                glowClass={glow.className}
                onSelect={() => toggle(item.id)}
                onReorder={handleReorder}
                title={item.label}
                ariaLabel={item.label}
                style={{
                  position: "relative",
                  width: railSize,
                  height: railSize,
                  borderRadius: 13,
                  color: active ? "#fff6fb" : primary ? "rgba(238, 226, 255, 0.85)" : "rgba(190, 175, 215, 0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* active indicator bar at the rail edge */}
                {active ? (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: -20,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 2,
                      height: 20,
                      borderRadius: 2,
                      background: "#ffb3d9",
                      boxShadow: "0 0 8px #ff9ecb",
                    }}
                  />
                ) : null}
                <GenesisNavIcon name={item.icon} size={primary ? tokens.iconSize : tokens.iconSize - 2} />
              </DockTab>
            </div>
          );
        })}

        {/* customize tabs + download archive pinned to the bottom */}
        <div style={{ flex: 1 }} />
        <TabEditButton onClick={() => setTabEditorOpen(true)} compact />
        <a
          href={zipHref}
          download="lelu-project.zip"
          onClick={handleZipDownload}
          title={
            downloadError
              ? `Download blocked: ${downloadError} — right-click → "Save link as…"`
              : "Download project ZIP (right-click → “Save link as…” if no download starts)"
          }
          className="lelu-tab-cloud"
          style={{
            width: railSize,
            height: railSize,
            borderRadius: 13,
            fontSize: 16,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
            fontFamily: "inherit",
          }}
        >
          <span aria-hidden>{downloading ? "◌" : downloadDone ? "✓" : "⬇"}</span>
        </a>
        {downloadError ? (
          <div
            style={{
              position: "absolute",
              left: 84,
              top: "50%",
              transform: "translateY(-50%)",
              width: 180,
              fontSize: 10,
              lineHeight: 1.4,
              textAlign: "left",
              color: genesisTheme.status.error,
              pointerEvents: "none",
            }}
          >
            {downloadError}
          </div>
        ) : null}
      </div>
      {tabEditor}
    </>
  );
}
