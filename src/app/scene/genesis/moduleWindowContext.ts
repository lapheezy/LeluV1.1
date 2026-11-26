/**
 * Is this panel already inside a module window (GenesisModuleHost)?
 *
 * A panel draws its own GenesisWindowFrame. On a phone that frame makes
 * itself a fixed, 587px bottom sheet — and inside a 560px module window
 * (whose backdrop-filter makes it the frame's containing block) it rose
 * over the window's title bar. Measured: elementsFromPoint at the
 * "◎ Chat" / — / ✕ controls returned the inner frame, so on a phone a
 * module window could not be minimized, closed or left by touch.
 * Inside a module window the frame fills the window's body instead.
 */
import { createContext } from "react";

export const InModuleWindow = createContext(false);

/**
 * Which window a panel is in, for the active design language: its folio
 * number among the open windows, its role and its label (an editorial
 * heading prints "No. 03", a grid heading the index number).
 */
export interface ModuleWindowMetaValue {
  id: string;
  index: number;
  role: string;
  label: string;
}
export const ModuleWindowMeta = createContext<ModuleWindowMetaValue | null>(null);
