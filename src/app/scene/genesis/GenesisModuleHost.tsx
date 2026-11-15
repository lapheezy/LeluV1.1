/**
 * ==========================================================
 * LÉLU — UNIFIED MODULE HOST
 *
 * The presentation engine of the unified UI. Every environment
 * (Earth, Browser, Render, Self Development, …) is ONE module
 * instance held in GenesisCore.state.modules; this host decides
 * HOW it is presented:
 *
 *   inline    → floating window alongside the persistent Chat —
 *               draggable, resizable, stackable (move/resize/raise
 *               live in GenesisCore, shared by LÉLU's tool actions)
 *   expanded  → primary visual area (fullscreen backdrop, Chat
 *               stays mounted and reachable underneath)
 *   minimized → compact persistent chip strip — the module keeps
 *               running (its singleton runtime is untouched)
 * Changing presentation never creates a second module instance —
 * it only moves how the single instance is shown. Window geometry
 * (position/size/z-order) is persisted on the module state so a
 * module remembers where the user (or LÉLU) put it.
 * ==========================================================
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import WorkspaceStewardStore from "../../../core/interface/WorkspaceStewardStore";
import { isCompact, planWorkspace, type StewardWindow } from "../../../core/interface/WorkspaceSteward";
import WorkspaceBar from "./layout/WorkspaceBar";
import { useContentOverflowWatch, useStewardViewport } from "./layout/stewardHooks";
import { chatFillsScreen } from "./chat/chatLayout";
import { InModuleWindow } from "./moduleWindowContext";
import { APP_WINDOW_Z, CHAT_WINDOW_Z, conversationIdOf, floatsAboveChat, useGenesisActions, useGenesisState, type ModuleState } from "./GenesisCore";
import { MODULE_CATALOG } from "./GenesisDock";
import { useUniverseOpen } from "./chat/universe/universeOpen";
import ModuleLayoutStore from "./layout/ModuleLayoutStore";

/* The layout store's manual/pinned flags feed the plan. */
let layoutTick = 0;
const subscribeLayout = (cb: () => void) => ModuleLayoutStore.getInstance().subscribe(() => { layoutTick += 1; cb(); });
const layoutSnapshot = () => layoutTick;
import { genesisTheme } from "./GenesisTheme";
import { kindOf, type StewardPlacement } from "../../../core/interface/WorkspaceSteward";

const STATUS_DOT: Record<string, string> = {
  idle: "#64748b",
  active: "#34d399",
  loading: "#fbbf24",
  complete: "#38bdf8",
  attention: "#f59e0b",
  failed: "#f87171",
};

export type ModuleRenderer = (props: { onClose: () => void }) => ReactNode;

/**
 * Every environment's renderer, plus the chat windows: a `chat:<id>` module
 * is resolved by the same host (see GenesisInterface), so the Chat Universe
 * opens real module windows instead of a window system of its own.
 */
export type ModuleRenderers = Record<string, ModuleRenderer | undefined>;

const CHROME_HEIGHT = 40;
// Large enough for a finger: the resize grip must be reachable on iPhone.
const RESIZE_HANDLE = 28;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;

/**
 * How much of the top of the screen the Universe's own header owns.
 *
 * `.lcu` is `inset: 0` at z-index 480 and a phone conversation window is a
 * full-viewport sheet at `CHAT_WINDOW_Z` (520), so opening a conversation from
 * the Universe painted a sheet over the ENTIRE Universe — header, cards and
 * close control all disappeared behind the window, and the app looked as if
 * pressing a chat had closed the Universe.
 *
 * The sheet now starts below that header (`.lcu-main` 10px padding + the
 * `.lcu-head` 70px minimum, rounded up, plus the device's top safe area that
 * `.lcu` pads for) instead of over it, so the Universe stays on screen, keeps
 * its controls, and the conversation still owns the rest of the screen.
 */
const UNIVERSE_COMPACT_HEAD = 88;

interface FloatingWindowProps {
  id: string;
  mod: ModuleState;
  render: (props: { onClose: () => void }) => ReactNode;
  label: string;
  glyph: string;
  cascadeIndex: number;
  /** Where the Workspace Steward put this window (absent: legacy geometry). */
  placement?: StewardPlacement;
  /** Open and running, but folded into the workspace tabs. */
  folded?: boolean;
  /** Stacking base for this workspace (above the Universe while it is open). */
  zBase?: number;
  /** Replaces the title bar on a phone sheet: the workspace bar with every open window. */
  sheetBar?: ReactNode;
}

/**
 * ONE floating module window — the single implementation of the
 * inline/expanded presentations. It owns drag (title bar), resize
 * (bottom-right handle), and the window controls (minimize, expand
 * toggle, detach, close), all through the canonical module actions
 * in GenesisCore — the same actions LÉLU's structured tool calls use.
 */
function FloatingModuleWindow({ id, mod, render, label, glyph, cascadeIndex, placement, folded = false, zBase, sheetBar }: FloatingWindowProps) {
  const { moveModule, resizeModule, raiseModule, minimizeModule, expandModule, setModulePresentation, closeModule, openPanel } = useGenesisActions();
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.visualViewport?.width ?? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.visualViewport?.height ?? window.innerHeight : 800,
    // iOS scrolls the visual viewport when the keyboard opens: a fixed
    // full-screen sheet must follow it or its composer slides under the keys.
    offsetTop: typeof window !== "undefined" ? window.visualViewport?.offsetTop ?? 0 : 0,
  }));

  useEffect(() => {
    const updateViewport = () => {
      const visual = window.visualViewport;
      setViewport({
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
        offsetTop: visual?.offsetTop ?? 0,
      });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, []);

  const viewportWidth = viewport.width;
  const viewportHeight = viewport.height;

  /* Mobile module windows behave like the chat sheet so they never overlap
     the composer or sit off-screen: opened modules dock as a full-width
     bottom sheet above the safe-area + the mobile LÉLU pill, still freely
     draggable and resizable. Desktop keeps the cascade so two opened
     modules never stack exactly. */
  const isMobile = viewportWidth < 720;
  /** The phone rule chat and surfaces use (chat/chatLayout): narrow, or a phone on its side. */
  const compactScreen = chatFillsScreen({ width: viewportWidth, height: viewportHeight });
  const MOBILE_TOP_RESERVE = 16;
  const MOBILE_BOTTOM_RESERVE = 96; // composer + safe-area + the floating LÉLU menu
  const defaultPosition = isMobile
    ? {
        x: 8,
        y: Math.max(MOBILE_TOP_RESERVE, viewportHeight - MOBILE_BOTTOM_RESERVE - (Math.min(viewportHeight * 0.6, 520))),
      }
    : { x: 88 + (cascadeIndex % 6) * 34, y: 76 + (cascadeIndex % 5) * 34 };

  /* Default geometry cascades so two opened modules never stack exactly. */
  const mobileWidth = Math.max(1, viewportWidth - 16);
  const mobileHeight = Math.max(1, viewportHeight - MOBILE_TOP_RESERVE - MOBILE_BOTTOM_RESERVE);
  /*
   * A phone window is a SHEET, not a viewport-sized panel.
   *
   * It used to take `mobileHeight` — the entire usable height — which made its
   * vertical clamp `max(TOP, min(y, H - BOTTOM - height))` collapse to exactly
   * TOP: the window could not move at all, at any phone size (measured dx 0,
   * dy 0 at 360x640 with touch input arriving normally). A sheet that is a
   * little over half the usable height leaves three meaningful docks — top,
   * middle, bottom — while every control stays reachable above the safe area.
   */
  const mobileSheetHeight = Math.max(
    300,
    Math.min(Math.round(mobileHeight * 0.62), Math.round(viewportHeight * 0.66), 520),
  );
  const mobileMinWidth = Math.min(MIN_WIDTH, mobileWidth);
  const mobileMinHeight = Math.min(MIN_HEIGHT, mobileHeight);
  /**
   * The ONE layout store supplies fallback geometry.
   *
   * A rect the person placed (or auto-arrange computed) in an earlier session
   * is where the window opens; the module state stays the live value during a
   * drag. Before this, reopening a module always cascaded it back to a default
   * and a manual arrangement could not survive a reload.
   */
  /* Gesture state is declared here because the geometry below must read it. */
  const [interacting, setInteracting] = useState(false);
  const storedRect = ModuleLayoutStore.getInstance().rectFor(id);
  /*
   * A hand-placed rectangle is the committed geometry — position AND size.
   *
   * `mod.size` is in-session state that is rebuilt from the viewport whenever a
   * module is (re)opened, so it may describe a window nobody placed. Preferring
   * it for the height is what restored 273 px where 329 px had been committed
   * (and 379 where 436 had been): the reloaded window was re-derived from the
   * module instead of restored from the rectangle the person left behind.
   *
   * The viewport still has the final say through the clamps below — a stored
   * rect that no longer fits is reduced to the visible sheet, never silently
   * replaced by an unrelated default.
   */
  const committedRect = storedRect && ModuleLayoutStore.getInstance().isManual(id) ? storedRect : null;
  const size = isMobile
    ? {
        width: Math.max(mobileMinWidth, Math.min(committedRect?.width ?? mod.size?.width ?? mobileWidth, mobileWidth)),
        // The sheet's height is the DOCK height, not the whole viewport: that is
        // what gives placement a range. A resize on a phone is clamped into it.
        height: Math.max(
          mobileMinHeight,
          Math.min(committedRect?.height ?? mod.size?.height ?? mobileSheetHeight, Math.min(mobileSheetHeight, mobileHeight)),
        ),
      }
    : (() => {
        /*
         * A conversation on a wide screen is a document, not a stamp.
         *
         * The live module size was measured on whatever screen opened it: a
         * session started at phone width reopened on a desktop as a 407 px
         * column because `mod.size` outranked the room available. Unless the
         * person placed the window by hand, a chat fills a comfortable column
         * of the current screen — the same rule its sheet follows on a phone.
         */
        const isChat = id.startsWith("chat:");
        const comfortableWidth = isChat ? Math.min(960, viewportWidth - 48) : 620;
        const comfortableHeight = isChat
          ? Math.max(420, Math.min(viewportHeight - CHROME_HEIGHT - 32, 900))
          : 480;
        const base = id.startsWith("chat:") && !committedRect ? null : storedRect;
        return {
          width: Math.min(base?.width ?? mod.size?.width ?? comfortableWidth, viewportWidth - 24),
          height: Math.min(base?.height ?? mod.size?.height ?? comfortableHeight, viewportHeight - CHROME_HEIGHT - 24),
        };
      })();
  /*
   * A placement the person made (or auto-arrange computed) is authoritative:
   * it is where the window was actually left, and the layout store is the one
   * owner of that fact. The module's own live position is the in-session value,
   * so it wins only when it is what the store already agrees with; otherwise a
   * stale transcript of the module (a legacy size, a pre-reload restack) could
   * reopen the window a few pixels away from the rectangle that was saved.
   */
  /*
   * A live gesture must read the LIVE position.
   *
   * The store-first rule below is right at rest, but during a drag it made
   * every render snap the window back to the stored rectangle: moveModule()
   * updated the module, the store had not been written yet, and the drag
   * preview (and the rect the commit was derived from) stayed at the dock the
   * window started in — the measured "touch arrives, dx 0" failure.
   */
  const rawPosition =
    interacting && mod.position
      ? mod.position
      : storedRect
        ? { x: storedRect.x, y: storedRect.y }
        : mod.position ?? defaultPosition;
  /*
   * A desktop window is kept on screen too.
   *
   * A rectangle placed on a smaller screen (or left over from a phone-width
   * session) used to keep its pixel position after the screen grew: the
   * conversation reopened at y 408 with a 740 px height and its lower half —
   * the composer included — hung off the bottom of the display.
   */
  const position = {
    x: isMobile
      ? Math.max(0, Math.min(rawPosition.x, Math.max(0, viewportWidth - size.width)))
      : Math.max(8, Math.min(rawPosition.x, Math.max(8, viewportWidth - size.width - 8))),
    y: isMobile
      ? Math.max(MOBILE_TOP_RESERVE, Math.min(rawPosition.y, Math.max(MOBILE_TOP_RESERVE, viewportHeight - MOBILE_BOTTOM_RESERVE - size.height)))
      : Math.max(8, Math.min(rawPosition.y, Math.max(8, viewportHeight - size.height - 8))),
  };
  /*
   * The Workspace Steward owns geometry at rest. During a gesture the live
   * module geometry leads (it was seeded from the placement on pointerdown),
   * so a drag follows the finger 1:1 and lands as a manual placement the
   * steward keeps while it stays valid.
   */
  if (placement) {
    if (!interacting) {
      position.x = placement.rect.x;
      position.y = placement.rect.y;
      size.width = placement.rect.width;
      size.height = placement.rect.height;
    } else if (mod.size) {
      size.width = mod.size.width;
      size.height = mod.size.height;
    }
  }
  const stewardSheet = Boolean(placement?.sheet);
  const chatWindow = floatsAboveChat(id);
  /*
   * Pressing a chat opens the conversation OVER the Universe, which owns the
   * screen until it is closed. Reading its open state here is what lets the
   * sheet stop painting over the Universe's own header.
   */
  const universeOpen = useUniverseOpen();
  /**
   * On a phone a conversation (and what it produced: an artifact, a design)
   * IS the screen — the full visual viewport above the keyboard, not a
   * floating card beside a second composer. Desktop keeps free windows.
   */
  const phoneSheet = placement ? stewardSheet : compactScreen && chatWindow;
  /** Zero unless the sheet would otherwise bury the open Universe. */
  const universeHeadInset = phoneSheet && universeOpen ? UNIVERSE_COMPACT_HEAD : 0;
  // A chat window never sinks below the Universe overlay, not even when an
  // older session persisted a panel-level z-index for it.
  const zIndex = placement && zBase !== undefined
    ? zBase + placement.rank
    : chatWindow
      ? Math.max(CHAT_WINDOW_Z, mod.zIndex ?? CHAT_WINDOW_Z)
      : Math.max(APP_WINDOW_Z, mod.zIndex ?? APP_WINDOW_Z + cascadeIndex);

  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; baseW: number; baseH: number } | null>(null);
  /*
   * A gesture is committed to the layout store ONCE, not once per pointermove.
   *
   * Every `moveModule` used to reach ModuleLayoutStore.place through the sync
   * effect below, which serialized the whole layout into KvStore and notified
   * the spatial navigator — re-rendering the entire surface for each of the
   * pointer events a drag produces. On software rendering that stalled the main
   * thread for seconds at a time and the drag never landed as a manual
   * placement, so the layout counter stayed at `0 placed`. Geometry still
   * follows the pointer 1:1 (state is coalesced to one update per frame), and
   * the person's final rect is written when the gesture ends.
   */
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const gesturing = useRef(false);
  // While the user drags/resizes, geometry follows the pointer 1:1 — the
  // theme's motion transition applies only to orchestrated layout changes.

  /*
   * Geometry lives in the ONE layout store, not only in this component.
   *
   * - First appearance: the store gives the module its slot, and the modules
   *   without a manual placement are auto-arranged around it.
   * - A drag or resize the person performed arrives here as module state with
   *   a position and size; it is recorded as MANUAL, so auto-arrange never
   *   moves it again and a reload lands it back where they left it.
   */
  useEffect(() => {
    if (gesturing.current) return;
    const store = ModuleLayoutStore.getInstance();
    /*
     * A manual placement must survive the module re-rendering itself.
     *
     * Every open reconstructs `mod.position`/`mod.size` from the viewport, and
     * this effect used to mirror that reconstruction straight into the layout
     * store — overwriting the rectangle the person had committed (a viewport
     * default replacing a valid manual rectangle). The store is the owner of
     * hand-placed geometry; only geometry produced by a gesture, or by a module
     * with no placement yet, is written from here.
     */
    if (store.isManual(id)) return;
    if (!mod.position || !mod.size) {
      store.ensure(id);
      return;
    }
    const current = store.rectFor(id);
    if (
      current &&
      current.x === mod.position.x &&
      current.y === mod.position.y &&
      current.width === mod.size.width &&
      current.height === mod.size.height
    ) {
      return;
    }
    // Geometry the steward or a re-render produced is NOT a hand placement:
    // only endDrag (a real gesture) writes a manual rect. Seeding the store
    // keeps it aware of the module without claiming the person put it there.
    if (!placement) store.place(id, { x: mod.position.x, y: mod.position.y, width: mod.size.width, height: mod.size.height });
    else store.ensure(id);
  }, [id, mod.position?.x, mod.position?.y, mod.size?.width, mod.size?.height]);

  /*
   * Pin is a layout preference, so it lives in the ONE layout store — not in a
   * second persistence key and not in module state. Pinned means: the next
   * auto-arrange leaves this window where it is, and the dock lists it first.
   */
  const layoutStore = ModuleLayoutStore.getInstance();
  const [pinned, setPinned] = useState(
    () => layoutStore.getState().entries.find((entry) => entry.moduleId === id)?.pinned ?? false,
  );
  useEffect(
    () =>
      layoutStore.subscribe((layout) =>
        setPinned(layout.entries.find((entry) => entry.moduleId === id)?.pinned ?? false),
      ),
    [layoutStore, id],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType !== "touch") return;
      // The title bar is a drag handle, but its controls are real buttons.
      // preventDefault() on their pointerdown suppressed the click, so
      // minimize / expand / close / pin never fired.
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, a")) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      if (stewardSheet) return; // a phone sheet is the screen: nothing to drag
      dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: position.x, baseY: position.y };
      gesturing.current = true;
      if (placement) {
        moveModule(id, { x: position.x, y: position.y });
        resizeModule(id, { width: size.width, height: size.height });
      }
      setInteracting(true);
      raiseModule(id);
    },
    [id, position.x, position.y, size.width, size.height, raiseModule, moveModule, resizeModule, placement, stewardSheet],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const x = drag.baseX + (e.clientX - drag.startX);
      const y = drag.baseY + (e.clientY - drag.startY);
      // Keep the window's full chrome + resize handle within the visual
      // viewport — on mobile the window must never be clipped at an edge or
      // slide its composer out of reach.
      pendingMoveRef.current = {
        x: isMobile
          ? Math.max(0, Math.min(x, viewportWidth - Math.min(size.width, viewportWidth)))
          : Math.max(-size.width + 140, Math.min(x, viewportWidth - 96)),          y: isMobile
          ? Math.max(MOBILE_TOP_RESERVE, Math.min(y, viewportHeight - MOBILE_BOTTOM_RESERVE - size.height))
          : Math.max(0, Math.min(y, viewportHeight - CHROME_HEIGHT - 16)),

      };
      if (moveFrameRef.current === null) {
        moveFrameRef.current = requestAnimationFrame(() => {
          moveFrameRef.current = null;
          const next = pendingMoveRef.current;
          if (next) moveModule(id, next);
        });
      }
    },
    [id, moveModule, size.width, viewportWidth, viewportHeight, isMobile],
  );

  const handleResizeDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType !== "touch") return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      resizeRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseW: size.width, baseH: size.height };
      if (placement) {
        moveModule(id, { x: position.x, y: position.y });
        resizeModule(id, { width: size.width, height: size.height });
      }
      setInteracting(true);
      raiseModule(id);
    },
    [id, size.width, size.height, position.x, position.y, raiseModule, moveModule, resizeModule, placement],
  );

  const handleResizeMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      if (!resize || e.pointerId !== resize.pointerId) return;
      resizeModule(id, {
        width: Math.max(isMobile ? mobileMinWidth : MIN_WIDTH, Math.min(resize.baseW + (e.clientX - resize.startX), Math.max(isMobile ? mobileMinWidth : MIN_WIDTH, viewportWidth - position.x - 16))),
        height: Math.max(isMobile ? mobileMinHeight : MIN_HEIGHT, Math.min(resize.baseH + (e.clientY - resize.startY), Math.max(isMobile ? mobileMinHeight : MIN_HEIGHT, viewportHeight - position.y - CHROME_HEIGHT - (isMobile ? MOBILE_BOTTOM_RESERVE : 16)))),
      });
    },
    [id, resizeModule, position.x, position.y, viewportWidth, viewportHeight, isMobile, mobileMinWidth, mobileMinHeight],
  );

  const endDrag = useCallback(() => {
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    const finalRect = pendingMoveRef.current;
    const drag = dragRef.current;
    const resized = resizeRef.current !== null;
    pendingMoveRef.current = null;
    dragRef.current = null;
    resizeRef.current = null;
    if (finalRect) moveModule(id, finalRect);
    gesturing.current = false;
    /*
     * Record the gesture HERE, not only through the sync effect above.
     *
     * That effect keys on the module's position and size, so when the last
     * animation frame had already applied the final geometry its dependencies
     * do not change and it never runs again after `gesturing` clears. The
     * window moved but the layout store never learned it was placed by hand —
     * the counter stayed at `0 placed` and auto-arrange could still move it.
     * A press with no movement is a raise, not a placement.
     */
    const moved = Boolean(finalRect && drag && (finalRect.x !== drag.baseX || finalRect.y !== drag.baseY));
    if (moved || resized) {
      /*
       * On a phone the sheet DOCKS: the free drag lands on the nearest of the
       * three meaningful vertical stops (top / middle / bottom) inside the safe
       * band. Free-floating at a 12px offset would be a placement the person
       * cannot reproduce; a dock is one they can find again, and it is what gets
       * persisted. Horizontal position is fixed because the sheet is full width.
       */
      const dockTop = MOBILE_TOP_RESERVE;
      const dockBottom = Math.max(dockTop, viewportHeight - MOBILE_BOTTOM_RESERVE - size.height);
      const dockMiddle = Math.round((dockTop + dockBottom) / 2);
      const snappedY = isMobile
        ? [dockTop, dockMiddle, dockBottom].reduce(
            (best, stop) => (Math.abs(stop - (finalRect?.y ?? position.y)) < Math.abs(best - (finalRect?.y ?? position.y)) ? stop : best),
            dockTop,
          )
        : null;
      if (snappedY !== null && finalRect) {
        finalRect.y = snappedY;
        moveModule(id, { x: finalRect.x, y: snappedY });
      }
      ModuleLayoutStore.getInstance().place(id, {
        x: finalRect?.x ?? position.x,
        y: snappedY ?? finalRect?.y ?? position.y,
        width: size.width,
        height: size.height,
      });
    }
    setInteracting(false);
  }, [id, moveModule, mod.position?.x, mod.position?.y, mod.size?.width, mod.size?.height, position.x, position.y, size.width, size.height]);

  /*
   * Phones have exactly ONE window presentation: the sheet host below.
   *
   * The expanded presenter is a desktop modal (backdrop, 92vw, centred). On a
   * phone it was a second geometry path that also reopened differently after a
   * reload — the window came back through the inline host, so "restore" could
   * never be exact. `expandModule` still works on a phone: it means the sheet.
   */
  const isExpanded = mod.presentation === "expanded" && !isMobile && !placement && zBase === undefined;

  const controlButton: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 7,
    border: "1px solid rgba(148,163,184,0.2)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(203,213,225,0.85)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
    fontFamily: "inherit",
    flexShrink: 0,
  };

  /*
   * THE one window chrome. Every application in LÉLU is presented by this
   * host, so the title bar below is the only title bar a user ever sees:
   * identity (glyph + label), live status, and the window controls. Panels
   * render inside it through GenesisWindowFrame, which switches to a
   * body-only surface when it detects this context (moduleWindowContext).
   */
  const chrome = (
    <div
      data-lelu-module-chrome={id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        height: CHROME_HEIGHT,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 10px",
        // Interface themes restyle the chrome through these variables;
        // unset, each falls back to Session 1's genesisTheme value.
        borderBottom: `var(--lelu-border-soft, ${genesisTheme.glass.borderSoft})`,
        background: "var(--lelu-chrome-bg, rgba(8,16,38,0.82))",
        cursor: "grab",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        flexShrink: 0,
      }}
    >
      <span aria-hidden style={{ fontSize: 13, opacity: 0.9, color: "var(--lelu-color-accent, #67e8f9)" }}>{glyph}</span>
      <strong data-lelu-text="title" style={{ ...genesisTheme.text.label, fontSize: 11.5, letterSpacing: "0.1em", opacity: 1, color: "var(--lelu-color-text, #dbeafe)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </strong>
      <span
        title={`status: ${mod.status}`}
        style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_DOT[mod.status] ?? "#64748b", boxShadow: `0 0 6px ${STATUS_DOT[mod.status] ?? "#64748b"}` }}
      />
      {compactScreen ? (
        // On a phone a module is the whole screen; the chat waits underneath
        // and this brings it back in one tap. The module keeps running
        // (minimized) and the LÉLU menu reopens it.
        <button
          type="button"
          title="Back to the chat — this keeps running"
          aria-label="Back to chat"
          onClick={() => {
            minimizeModule(id);
            openPanel("chat");
          }}
          style={{ ...controlButton, width: "auto", padding: "0 10px", gap: 5, color: "#e9d5ff", borderColor: "rgba(216,180,254,0.45)" }}
        >
          <span aria-hidden>◎</span> Chat
        </button>
      ) : null}
      <button
        type="button"
        title={pinned ? "Unpin — auto-arrange may tile it again" : "Pin — keep this window where it is"}
        aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
        aria-pressed={pinned}
        data-lelu-module-pin={id}
        onClick={() => layoutStore.pin(id, !pinned)}
        style={{
          ...controlButton,
          color: pinned ? "#67e8f9" : controlButton.color,
          borderColor: pinned ? "rgba(103,232,249,0.55)" : controlButton.borderColor,
          background: pinned ? "rgba(34,211,238,0.16)" : controlButton.background,
        }}
      >
        {pinned ? "📌" : "📍"}
      </button>
      <button type="button" title="Minimize — keeps running" aria-label={`Minimize ${label}`} onClick={() => minimizeModule(id)} style={controlButton}>—</button>
      <button type="button" title={isExpanded ? "Restore window" : "Expand"} aria-label={isExpanded ? "Restore" : "Expand"} onClick={() => (isExpanded ? setModulePresentation(id, "inline") : expandModule(id))} style={controlButton}>{isExpanded ? "⊡" : "⤢"}</button>
      <button type="button" title="Close" aria-label={`Close ${label}`} onClick={() => closeModule(id)} style={controlButton}>✕</button>
    </div>
  );

  const header = stewardSheet && sheetBar ? sheetBar : chrome;

  if (isExpanded) {
    return (
      <div
        data-lelu-module-backdrop={id}
        style={{
          position: "fixed",
          inset: 0,
          zIndex,
          background: "rgba(2,6,23,0.55)",
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          data-lelu-module-window={id}
          data-lelu-module-host={id}
          data-lelu-module-presentation="expanded"
          data-presentation="expanded"
          data-lelu-surface="window"
          data-lelu-window={id}
          style={{
            pointerEvents: "auto",
            /*
             * On a phone the expanded presentation IS a sheet, driven by the
             * same contract as the inline host: store-owned position, the dock
             * height from 2.15.2, drag from the chrome, docking committed by
             * endDrag. Before this the phone window was a centred modal whose
             * geometry ignored `position`/`size`, so drags arrived and nothing
             * could move. Desktop keeps its centred modal untouched.
             */
            width: "min(92vw, 900px)",
            height: "min(84dvh, 640px)",
            display: "flex",
            flexDirection: "column",
            background: `var(--lelu-surface-bg, ${genesisTheme.glass.panel})`,
            backdropFilter: `var(--lelu-backdrop, ${genesisTheme.elevation.float.backdropFilter})`,
            WebkitBackdropFilter: `var(--lelu-backdrop, ${genesisTheme.elevation.float.backdropFilter})`,
            borderRadius: `var(--lelu-radius, ${genesisTheme.radius.md}px)`,
            border: `var(--lelu-border, ${genesisTheme.glass.borderAccent})`,
            boxShadow: `var(--lelu-shadow, ${genesisTheme.elevation.float.boxShadow})`,
            overflow: "hidden",
          }}
        >
          {chrome}
          <div data-lelu-module-content={id} style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", position: "relative" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", zoom: "var(--lelu-density, 1)" } as React.CSSProperties}>
              <InModuleWindow.Provider value={true}>
                {/* Modules are code-split (see GenesisInterface): a panel's own
                    chunk arrives on first open, so the window shows its empty
                    content area for a moment rather than the boot paying for
                    thirty panels nobody opened. */}
                <Suspense fallback={null}>{render({ onClose: () => closeModule(id) })}</Suspense>
              </InModuleWindow.Provider>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-lelu-module-window={id}
      data-lelu-module-host={id}
      data-lelu-module-presentation="inline"
      data-presentation="inline"
      data-lelu-surface="window"
      data-lelu-window={id}
      data-lelu-fullscreen={phoneSheet ? "" : undefined}
      data-lelu-steward={placement ? (stewardSheet ? "sheet" : "placed") : undefined}
      data-lelu-steward-rect={placement ? `${placement.rect.x},${placement.rect.y},${placement.rect.width},${placement.rect.height}` : undefined}
      data-lelu-folded={folded ? "" : undefined}
      aria-hidden={folded || undefined}
      data-lelu-interacting={interacting ? "" : undefined}
      style={{
        position: "fixed",
        left: isMobile
          ? Math.max(0, Math.min(position.x, viewportWidth - Math.min(size.width, viewportWidth)))
          : Math.max(0, Math.min(position.x, viewportWidth - 96)),
        top: isMobile
          ? Math.max(MOBILE_TOP_RESERVE, Math.min(position.y, viewportHeight - MOBILE_BOTTOM_RESERVE - size.height))
          : Math.max(0, Math.min(position.y, viewportHeight - CHROME_HEIGHT - 16)),
        width: Math.min(size.width, viewportWidth),
        height: size.height,
        ...(phoneSheet
          ? {
              left: 0,
              top: viewport.offsetTop,
              width: viewportWidth,
              height: viewportHeight,
              borderRadius: 0,
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
              boxSizing: "border-box" as const,
              /*
               * Clear the Universe's header (see UNIVERSE_COMPACT_HEAD). The
               * header sits below the device's top safe area (`.lcu` pads for
               * it), so the clearance is the header plus that inset: a bare 88
               * left a notched iPhone's header partly buried. With the
               * Universe closed this is empty and the sheet keeps the whole
               * visual viewport, so a conversation opened straight from Home
               * is unchanged.
               */
              ...(universeHeadInset
                ? {
                    top: `calc(${viewport.offsetTop}px + ${universeHeadInset}px + env(safe-area-inset-top, 0px))`,
                    height: `calc(${viewportHeight}px - ${universeHeadInset}px - env(safe-area-inset-top, 0px))`,
                    // The safe area is above the sheet now, not underneath it.
                    paddingTop: 0,
                  }
                : null),
            }
          : {}),
        ...(stewardSheet
          ? {
              left: 0,
              top: viewport.offsetTop,
              width: viewportWidth,
              height: viewportHeight,
              paddingTop: "env(safe-area-inset-top, 0px)",
              border: "none",
            }
          : {}),
        zIndex,
        pointerEvents: "auto",
        display: folded ? "none" : "flex",
        flexDirection: "column",
        background: `var(--lelu-surface-bg, ${genesisTheme.glass.panel})`,
        backdropFilter: `var(--lelu-backdrop, ${genesisTheme.elevation.float.backdropFilter})`,
        WebkitBackdropFilter: `var(--lelu-backdrop, ${genesisTheme.elevation.float.backdropFilter})`,
        borderRadius: stewardSheet ? 0 : `var(--lelu-window-radius, ${genesisTheme.radius.md}px)`,
        border: `var(--lelu-border, ${genesisTheme.glass.borderAccent})`,
        boxShadow: `var(--lelu-shadow, ${genesisTheme.elevation.float.boxShadow})`,
        overflow: "hidden",
        // Tilt is a separate CSS property from transform, so it composes
        // with the idle float animation instead of fighting it. Phones
        // never tilt: a rotated sheet would push controls off-screen.
        rotate: !isMobile && mod.rotation ? `${mod.rotation}deg` : undefined,
        transition: interacting || stewardSheet ? "none" : placement
          ? "left 420ms cubic-bezier(.22,1,.36,1), top 420ms cubic-bezier(.22,1,.36,1), width 420ms cubic-bezier(.22,1,.36,1), height 420ms cubic-bezier(.22,1,.36,1)"
          : "left var(--lelu-motion-duration, 0ms) var(--lelu-motion-easing, ease), top var(--lelu-motion-duration, 0ms) var(--lelu-motion-easing, ease), width var(--lelu-motion-duration, 0ms) var(--lelu-motion-easing, ease), height var(--lelu-motion-duration, 0ms) var(--lelu-motion-easing, ease), rotate var(--lelu-motion-duration, 0ms) ease",
      }}
    >
      {header}
      {/* position: relative contains panels' absolutely-positioned layers
          (e.g. the browser's overlays) inside the content area, so they can
          never paint over the title bar and steal its drag gesture. */}
      <div
        data-lelu-module-content={id}
        data-lelu-content-kind={kindOf(id)}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", position: "relative", containerType: "inline-size", zoom: "var(--lelu-density, 1)" } as React.CSSProperties}
      >
        <InModuleWindow.Provider value={true}>
          <Suspense fallback={null}>{render({ onClose: () => closeModule(id) })}</Suspense>
        </InModuleWindow.Provider>
      </div>
      {/* Resize handle — bottom-right corner (a phone sheet is the screen: none) */}
      {stewardSheet ? null : <div
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Resize"
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: RESIZE_HANDLE,
          height: RESIZE_HANDLE,
          cursor: "nwse-resize",
          touchAction: "none",
          background: "linear-gradient(135deg, transparent 50%, var(--lelu-color-accent, rgba(103,232,249,0.5)) 50%)",
          opacity: 0.8,
          borderBottomRightRadius: 14,
        }}
      />}
    </div>
  );
}

export default function GenesisModuleHost({
  renderers,
  resolve,
  labelFor,
}: {
  renderers: ModuleRenderers;
  /** Renderer for ids a static map cannot enumerate (`chat:<id>`). */
  resolve?: (id: string) => ModuleRenderer | undefined;
  /** Live label for a dynamic id (a conversation's own title). */
  labelFor?: (id: string) => string | undefined;
}) {
  const { state } = useGenesisState();
  const universeOpen = useUniverseOpen();
  const viewport = useStewardViewport();
  const steward = useSyncExternalStore(WorkspaceStewardStore.subscribe, WorkspaceStewardStore.get, WorkspaceStewardStore.get);
  const layoutVersion = useSyncExternalStore(subscribeLayout, layoutSnapshot, layoutSnapshot);
  const lastPlacements = useRef<Record<string, StewardPlacement>>({});

  const entries = Object.entries(state.modules) as Array<[string, ModuleState]>;
  // Legacy detached state is still restored as the same inline module window;
  // it never gets a tab or an independent application surface.
  const floating = entries.filter(([id, m]) =>
    (m.presentation === "inline" || m.presentation === "expanded") && Boolean(renderers[id] ?? resolve?.(id)),
  );
  const labelOf = (id: string) => labelFor?.(id) ?? MODULE_CATALOG.find((m) => m.id === id)?.label ?? id;
  const glyphOf = (id: string) => MODULE_CATALOG.find((m) => m.id === id)?.glyph ?? (conversationIdOf(id) ? "◍" : "◈");

  /*
   * ONE plan for the whole workspace (WorkspaceSteward). Recomputed on every
   * open/close/raise, viewport change, measured overflow or mode change —
   * locally, in microseconds, with no model involved.
   */
  const floatKey = floating.map(([id, m]) => `${id}:${m.presentation}:${m.zIndex ?? 0}:${m.updatedAt}`).join("|");
  const plan = useMemo(() => {
    const store = ModuleLayoutStore.getInstance();
    // The most recently raised maximised window, if any, owns the workspace.
    const expanded = floating
      .filter(([, m]) => m.presentation === "expanded")
      .sort((a, b) => (b[1].zIndex ?? 0) - (a[1].zIndex ?? 0) || b[1].updatedAt - a[1].updatedAt)[0]?.[0];
    const windows: StewardWindow[] = floating.map(([id, m]) => ({
      id,
      label: labelOf(id),
      order: (m.zIndex ?? 0) * 1e13 + m.updatedAt,
      presentation: m.presentation === "expanded" ? "expanded" : "inline",
      rect: store.isManual(id) ? store.rectFor(id) : lastPlacements.current[id]?.rect ?? null,
      manual: store.isManual(id),
      pinned: store.getState().entries.find((e) => e.moduleId === id)?.pinned ?? false,
      neededWidth: steward.needs[id],
    }));
    const universeDesktop = universeOpen && !isCompact(viewport);
    return planWorkspace({
      viewport,
      windows,
      mode: expanded ? "fullscreen" : steward.mode,
      focusId: expanded ?? (steward.focusId && windows.some((w) => w.id === steward.focusId) ? steward.focusId : null),
      focusIds: expanded ? [expanded] : steward.focusIds,
      insets: isCompact(viewport)
        ? { top: 0 }
        : universeDesktop
          ? { top: 84, left: 16, right: 16, bottom: 64 }
          // The home dock owns the bottom ~84px; the workspace bar sits above it.
          : { top: 64, left: 96, right: 16, bottom: 148 },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatKey, viewport.width, viewport.height, steward.mode, steward.focusId, steward.focusIds, steward.needs, universeOpen, layoutVersion]);
  lastPlacements.current = plan.placements;

  /* Record what the steward decided and why — visible proof, zero model calls. */
  const planSignature = `${plan.layout}|${Object.keys(plan.placements).join(",")}|${plan.tabs.join(",")}`;
  useEffect(() => {
    if (!floating.length) return;
    WorkspaceStewardStore.record({ by: "auto", what: `${plan.layout} · ${Object.keys(plan.placements).length} shown${plan.tabs.length ? ` · ${plan.tabs.length} tabbed` : ""}`, reasons: plan.reasons });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSignature]);

  /* Content wider than its window is measured, so the next plan gives it room. */
  useContentOverflowWatch(floatKey);

  if (state.minimized) return null;

  const zBase = universeOpen ? CHAT_WINDOW_Z : APP_WINDOW_Z;
  const tabbed = new Set(plan.tabs);
  const shownIds = Object.keys(plan.placements);
  const bar = (
    <WorkspaceBar
      compact={plan.compact}
      ids={floating.map(([id]) => id)}
      shown={shownIds}
      labelOf={labelOf}
      glyphOf={glyphOf}
      mode={steward.mode}
      layout={plan.layout}
      reasons={plan.reasons}
    />
  );

  return (
    <>
      {floating.map(([id, mod], index) => {
        const render = renderers[id] ?? resolve?.(id);
        if (!render) return null;
        return (
          <FloatingModuleWindow
            key={id}
            id={id}
            mod={mod}
            render={render}
            label={labelOf(id)}
            glyph={glyphOf(id)}
            cascadeIndex={index}
            placement={plan.placements[id]}
            folded={tabbed.has(id) || !plan.placements[id]}
            zBase={zBase}
            sheetBar={plan.compact ? bar : undefined}
          />
        );
      })}

      {/* Desktop: the workspace bar floats under the windows' work area. */}
      {!plan.compact && floating.length > 0 ? <div style={{ position: "fixed", zIndex: zBase + floating.length + 2, left: "50%", bottom: universeOpen ? "calc(12px + env(safe-area-inset-bottom, 0px))" : "calc(92px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)", pointerEvents: "auto", maxWidth: "calc(100vw - 24px)" }}>{bar}</div> : null}

      {/* Minimized windows are tabs in the workspace bar (still running). */}
    </>
  );
}
