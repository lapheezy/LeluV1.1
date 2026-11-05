/**
 * True for everything rendered inside a GenesisModuleHost window. A panel's
 * own GenesisWindowFrame then renders embedded — filling the window body —
 * instead of floating a second window (a fixed bottom sheet on phones) that
 * would escape the host window and cover its title bar and controls.
 */
import { createContext } from "react";

export const ModuleWindowContext = createContext(false);
