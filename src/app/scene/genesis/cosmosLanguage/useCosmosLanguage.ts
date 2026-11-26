/**
 * ==========================================================
 * LÉLU — THE ACTIVE COSMOS LANGUAGE
 *
 * One read of one authority: the ACTIVE Home presentation's layout
 * (HomeStore → layoutOf) names the language. Nothing here stores a
 * language of its own, so selection, persistence, presentations, undo
 * and restore all keep working exactly as they did — switching layout
 * is what switches the language, for every open window at once.
 * ==========================================================
 */

import { useSyncExternalStore } from "react";
import HomeStore from "../home/homeStore";
import { layoutOf } from "../home/homeComposition";
import { resolveRoles } from "../home/homeTerminal";
import {
  compositionFor,
  languageFor,
  languageOfLayout,
  type CompositionSpec,
  type CosmosLanguage,
  type CosmosLanguageId,
  type TerminalColours,
} from "../../../../core/interface/CosmosLanguages";

const subscribe = (cb: () => void) => HomeStore.subscribe(() => cb());

export function activeLanguageId(): CosmosLanguageId {
  try {
    return languageOfLayout(layoutOf(HomeStore.activePresentation()));
  } catch {
    return "cosmic";
  }
}

/** The colours of her terminal theme (the "terminal" language follows them). */
export function activeTerminalColours(): TerminalColours | null {
  try {
    return resolveRoles(HomeStore.terminalTheme()) as unknown as TerminalColours;
  } catch {
    return null;
  }
}

let terminalKey = "";
let terminalCache: TerminalColours | null = null;
function terminalSnapshot(): TerminalColours | null {
  const next = activeTerminalColours();
  const key = JSON.stringify(next);
  if (key !== terminalKey) {
    terminalKey = key;
    terminalCache = next;
  }
  return terminalCache;
}

export function useCosmosLanguageId(): CosmosLanguageId {
  // The app is client-rendered (no hydration), so the server snapshot reads
  // the same authority — which also lets a static render show the language.
  return useSyncExternalStore(subscribe, activeLanguageId, activeLanguageId);
}

export function useTerminalColours(): TerminalColours | null {
  return useSyncExternalStore(subscribe, terminalSnapshot, terminalSnapshot);
}

export interface ActiveCosmosLanguage {
  id: CosmosLanguageId;
  language: CosmosLanguage;
  composition: CompositionSpec;
}

export function useCosmosLanguage(): ActiveCosmosLanguage {
  const id = useCosmosLanguageId();
  return { id, language: languageFor(id), composition: compositionFor(id) };
}
