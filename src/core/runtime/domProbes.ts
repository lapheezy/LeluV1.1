/**
 * ==========================================================
 * LÉLU — READINESS PROBES
 *
 * Confirms the two subsystems whose readiness is a LAYOUT
 * fact rather than a lifecycle event: the Cosmos is mounted,
 * and the composer exists and has size.
 *
 * Why observe instead of calling confirm() from inside the
 * components: the composer lives in a lazily loaded chat stack
 * and the world in a lazily loaded scene, and both already
 * announce themselves in the DOM (`[data-lelu-composer]`,
 * `data-workspace="genesis-v1"`). Reading that is one probe in
 * one place, it cannot be forgotten by a future component that
 * renders a second composer, and it measures the thing that
 * actually matters — an element with a non-zero box, not the
 * fact that a module was imported.
 *
 * "Has size" is the honest bar: a composer that exists but is
 * `display: none`, collapsed to 0 px, or behind a hidden sheet
 * is not usable, and would otherwise report READY.
 * ==========================================================
 */

import { readiness } from "./readiness";
import type { SubsystemId } from "./readiness";

/*
 * There are TWO real composers, and both mean "chat is usable": the one in
 * the Genesis chat window, and the Chat Universe's (the phone/dock composer
 * plus its per-conversation window composer). Measured in the browser: the
 * first selector alone left chat NOT_INITIALIZED while a laid-out Universe
 * composer was on screen — a false negative, and exactly the kind of
 * "readiness disagrees with reality" this layer exists to prevent.
 */
const COMPOSER = "[data-lelu-composer], .lcu-composer, .lcu-win-composer";
const WORLD = '[data-workspace="genesis-v1"]';

/** A composer that is disabled or read-only cannot accept input. */
function acceptsInput(el: Element | null): boolean {
  if (!el) return false;
  const input = el.matches("textarea, input")
    ? (el as HTMLTextAreaElement | HTMLInputElement)
    : (el.querySelector("textarea, input") as HTMLTextAreaElement | HTMLInputElement | null);
  if (!input) return true; // the container is the composer wrapper
  if (input.disabled || input.readOnly) return false;
  const box = input.getBoundingClientRect();
  return box.width >= 8 && box.height >= 8;
}

function visibleBox(el: Element | null): { w: number; h: number } | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return null;
  }
  return { w: Math.round(rect.width), h: Math.round(rect.height) };
}

/**
 * Watch for a selector and confirm `id` the first time it is present AND laid
 * out. Re-confirms on later appearances so a composer that unmounts and comes
 * back is reported as READY again rather than staying suspended.
 */
function watch(
  selector: string,
  id: SubsystemId,
  evidence: (box: { w: number; h: number }) => string,
): () => void {
  if (typeof document === "undefined") return () => {};

  let confirmedFor: Element | null = null;

  const check = () => {
    /*
     * FIRST USABLE match, not first match. `querySelector` returned a
     * zero-size composer inside a hidden sheet while a real one was on screen
     * — measured in the browser as chat stuck on NOT_INITIALIZED with a
     * laid-out composer in the DOM. Selecting among matches is the difference
     * between "a composer exists somewhere" and "you can type in one".
     */
    const el = [...document.querySelectorAll(selector)].find((candidate) => {
      if (!visibleBox(candidate)) return false;
      return id !== "chat" || acceptsInput(candidate);
    }) ?? null;
    const box = visibleBox(el);
    if (!box || (id === "chat" && !acceptsInput(el))) {
      // It went away (or cannot take input). Say so instead of leaving a
      // stale READY on screen.
      if (confirmedFor) {
        confirmedFor = null;
        readiness().suspend(id, "No longer on screen or cannot accept input.");
      }
      return;
    }
    if (confirmedFor === el) return;
    confirmedFor = el;
    readiness().confirm(id, evidence(box));
  };

  check();
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden"],
  });
  window.addEventListener("resize", check);
  window.addEventListener("orientationchange", check);

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", check);
    window.removeEventListener("orientationchange", check);
  };
}

/**
 * Start the probes. Returns a stop function. Idempotent: calling twice returns
 * the same stop, so a double mount cannot create a second observer (and a
 * second set of evidence strings) for the same element.
 */
let stopOnce: (() => void) | null = null;
export function startReadinessProbes(): () => void {
  if (stopOnce) return stopOnce;

  const stops = [
    watch(COMPOSER, "chat", (box) => `Composer laid out at ${box.w}×${box.h}px.`),
    watch(WORLD, "cosmos", (box) => `Genesis world mounted at ${box.w}×${box.h}px.`),
  ];

  stopOnce = () => {
    for (const stop of stops) stop();
    stopOnce = null;
  };
  return stopOnce;
}
