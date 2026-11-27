/**
 * ==========================================================
 * LÉLU — COSMOS LANGUAGE RUNTIME
 *
 * Mounted once. When the active layout's language changes it:
 *
 *   1. marks <html> with data-cosmos-language / -composition / -tone,
 *      which the composition stylesheet (cosmosLanguage.css) keys on;
 *   2. writes the language's variables into ONE <style> element, scoped
 *      to the surfaces the language owns: every module window, the
 *      Neural Map and any element marked data-cosmos-surface.
 *
 * The variables are scoped on purpose: an approved interface theme
 * (InterfaceRuntime) still owns <html>, and surfaces the language does
 * not draw keep that theme. With the default language nothing is
 * written and every attribute is removed — the original Cosmos.
 * ==========================================================
 */

import { useEffect } from "react";
import { languageFor, languageVariables, type TerminalColours } from "../../../../core/interface/CosmosLanguages";
import { useCosmosLanguageId, useTerminalColours } from "./useCosmosLanguage";
import "./cosmosLanguage.css";
import "./surfacesLanguage.css";

export const LANGUAGE_SURFACES = "[data-lelu-module-window], [data-neural-map-view], [data-cosmos-surface], .hc, .lsn, .lws";
const STYLE_ID = "lelu-cosmos-language";

function block(selector: string, vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

/** The stylesheet text for a language (pure; exported for tests). */
export function languageStylesheet(id: string, terminal: TerminalColours | null = null, reducedMotion = false): string {
  const desktop = languageVariables(id, { terminal, reducedMotion });
  if (Object.keys(desktop).length === 0) return "";
  const mobile = languageVariables(id, { terminal, reducedMotion, mobile: true });
  const scope = `:root[data-cosmos-language="${id}"] :is(${LANGUAGE_SURFACES})`;
  const mobileOnly = Object.fromEntries(Object.entries(mobile).filter(([k, v]) => desktop[k] !== v));
  return `${block(scope, desktop)}\n@media (max-width: 719px) {\n${block(scope, mobileOnly)}\n}`;
}

export default function CosmosLanguageRuntime() {
  const id = useCosmosLanguageId();
  const terminal = useTerminalColours();

  useEffect(() => {
    const root = document.documentElement;
    const lang = languageFor(id);
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    // Read-only diagnostic, same convention as __leluSpatialProbe.
    (window as unknown as { __leluCosmosLanguage?: unknown }).__leluCosmosLanguage = { id: lang.id, composition: lang.composition, tone: lang.tone };
    if (lang.id === "cosmic") {
      root.removeAttribute("data-cosmos-language");
      root.removeAttribute("data-cosmos-composition");
      root.removeAttribute("data-cosmos-tone");
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = languageStylesheet(lang.id, lang.id === "terminal" ? terminal : null, reduced);
    root.setAttribute("data-cosmos-language", lang.id);
    root.setAttribute("data-cosmos-composition", lang.composition);
    root.setAttribute("data-cosmos-tone", lang.tone);
  }, [id, terminal]);

  return null;
}
