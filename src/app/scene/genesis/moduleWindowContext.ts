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
