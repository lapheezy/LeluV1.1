/**
 * Opening an ORIGINAL screen (WP21.4 OG access), without changing the saved experience: routes and
 * standalone interfaces load as they always did; in-app originals are reached through the same stores.
 */
import type { useGenesis, GenesisPanel } from "../GenesisCore";
import type { OriginalScreen } from "../../../../core/experience/ExperienceMode";
import { setUniverseOpen, setUniverseOriginalBackdrop } from "../chat/universe/universeOpen";
import HomeStore from "./homeStore";
import { goHome } from "./homeActions";

type Genesis = ReturnType<typeof useGenesis>;

export function openOriginal(genesis: Genesis, screen: OriginalScreen): void {
  const o = screen.open;
  if (o.kind === "href") {
    window.location.assign(o.href);
    return;
  }
  if (o.action === "dashboard") {
    setUniverseOpen(false);
    goHome(genesis);
    HomeStore.setImmersive(false);
  } else if (o.action === "room") {
    genesis.openPanel("genesisv2" as GenesisPanel);
  } else if (o.action === "universe-original") {
    setUniverseOriginalBackdrop(true);
    setUniverseOpen(true);
  }
}
