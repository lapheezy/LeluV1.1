/**
 * ==========================================================
 * LÉLU HOME — ACTIONS AND THEIR TRANSITIONS
 *
 * Launching goes through GenesisCore.openPanel, like everywhere else.
 * What this adds is where it comes FROM: a glass surface grows out of
 * the element you tapped into the space the app will take, and fades as
 * the app itself appears — so Studio opens out of its Studio tile, not
 * out of nowhere. One element, transform + opacity only (GPU), cut short
 * if another launch starts, skipped under prefers-reduced-motion.
 *
 * Going home remembers the windows first (HomeStore); restoring puts the
 * whole layout back, geometry included.
 * ==========================================================
 */

import type { GenesisContextValue, GenesisPanel, ModulePresentation } from "../GenesisCore";
import HomeStore from "./homeStore";

type Genesis = Pick<GenesisContextValue, "state" | "openPanel" | "setModulePresentation" | "moveModule" | "resizeModule">;

let ghost: { el: HTMLElement; anim: Animation } | null = null;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Where an app of this kind lands: the chat's sheet on a phone, a centred window on a desktop. */
function landingRect(id: GenesisPanel): DOMRect {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 720) return new DOMRect(0, id === "chat" ? h * 0.18 : 0, w, id === "chat" ? h * 0.82 : h);
  const width = id === "chat" ? Math.min(620, w * 0.44) : Math.min(760, w * 0.52);
  const height = Math.min(h * 0.78, 720);
  return new DOMRect((w - width) / 2, (h - height) / 2, width, height);
}

/** Grow a glass surface from `from` to where the app will be. */
export function playLaunch(from: Element | null, id: GenesisPanel): void {
  if (typeof document === "undefined" || !from || reducedMotion()) return;
  ghost?.anim.cancel();
  ghost?.el.remove();
  const a = from.getBoundingClientRect();
  const b = landingRect(id);
  if (a.width <= 0 || a.height <= 0) return;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.dataset.leluLaunch = id;
  Object.assign(el.style, {
    position: "fixed",
    left: `${b.left}px`,
    top: `${b.top}px`,
    width: `${b.width}px`,
    height: `${b.height}px`,
    borderRadius: "22px",
    pointerEvents: "none",
    zIndex: "560",
    transformOrigin: "0 0",
    background: "linear-gradient(160deg, rgba(196,120,255,0.32), rgba(40,18,72,0.55))",
    border: "1px solid rgba(255,214,255,0.35)",
    boxShadow: "0 24px 60px rgba(20,0,40,0.45)",
    backdropFilter: "blur(14px)",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  const sx = a.width / b.width;
  const sy = a.height / b.height;
  const anim = el.animate(
    [
      { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${sx}, ${sy})`, opacity: 0.9 },
      { transform: "translate(0, 0) scale(1, 1)", opacity: 0.75, offset: 0.72 },
      { transform: "translate(0, 0) scale(1, 1)", opacity: 0 },
    ],
    { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  ghost = { el, anim };
  const done = () => {
    el.remove();
    if (ghost?.el === el) ghost = null;
  };
  anim.onfinish = done;
  anim.oncancel = done;
}

export function launch(genesis: Genesis, id: GenesisPanel, from: Element | null): void {
  playLaunch(from, id);
  // Chat opens the Multi-Chat Universe; the single chat stays reachable
  // from inside it (attach / voice) and from the library.
  if (id === "chat") {
    window.dispatchEvent(new CustomEvent("lelu-open-universe"));
    return;
  }
  genesis.openPanel(id);
}

/** Home: remember the windows, then clear the workspace (GenesisCore.openPanel("none")). */
export function goHome(genesis: Genesis): void {
  HomeStore.rememberLayout(genesis.state.activePanel, genesis.state.modules);
  HomeStore.setImmersive(false);
  genesis.openPanel("none");
}

/** Put the remembered windows back where they were, then focus the panel that had it. */
export function restoreLayout(genesis: Genesis): void {
  const layout = HomeStore.get().layout;
  if (!layout) return;
  for (const [id, mod] of Object.entries(layout.modules)) {
    genesis.openPanel(id as GenesisPanel);
    if (mod.position) genesis.moveModule(id, mod.position);
    if (mod.size) genesis.resizeModule(id, mod.size);
    genesis.setModulePresentation(id, mod.presentation as ModulePresentation);
  }
  if (layout.activePanel && layout.activePanel !== "none") genesis.openPanel(layout.activePanel);
  HomeStore.clearLayout();
}
