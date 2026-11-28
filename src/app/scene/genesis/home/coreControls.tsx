/**
 * Sections other features add to the core chat box's "+" Controls tab. Registered once, at import.
 */
import { useSyncExternalStore } from "react";
import { registerControlsSection } from "./CoreChat";
import { currentTheme, setTheme, themes } from "../../../../core/worlds/cosmosTheme";
import { subscribeWorlds, activeWorld } from "../../../../core/worlds/WorldStore";
import { ORIGINAL_SCREENS, setExperience } from "../../../../core/experience/ExperienceMode";
import { useGenesis } from "../GenesisCore";
import { openOriginal } from "./originals";
import { describePerformance, getPerformance, setPerformanceMode, subscribePerformance, type PerformanceModeId } from "../../../../core/performance/PerformanceMode";

function PerformanceSection() {
  const perf = useSyncExternalStore(subscribePerformance, getPerformance, getPerformance);
  const pick = (mode: PerformanceModeId) => setPerformanceMode(mode, "owner", mode === "auto" ? "LÉLU adjusts to this device" : "chosen in the controls");
  return (
    <>
      <div className="ccx-grid" role="radiogroup" aria-label="Weight">
        {(["auto", "light", "full"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={perf.mode === m} data-weight={m} data-on={perf.mode === m ? "true" : "false"} onClick={() => pick(m)}>
            {m === "auto" ? "Auto (LÉLU decides)" : m === "light" ? "Lightweight" : "Full weight"}
          </button>
        ))}
      </div>
      <p className="ccx-hint" data-performance-state>{describePerformance(perf)}</p>
    </>
  );
}

registerControlsSection({ id: "performance", title: "Weight", render: () => <PerformanceSection /> });

function ThemeSection() {
  useSyncExternalStore(subscribeWorlds, activeWorld, activeWorld);
  const now = currentTheme();
  return (
    <>
      <div className="ccx-grid" role="radiogroup" aria-label="Theme">
        {themes().map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={now === t.id} data-theme={t.id} data-on={now === t.id ? "true" : "false"} onClick={() => setTheme(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="ccx-hint">The Cosmos and every chat variant take the theme. Primary Cosmos is always one tap away.</p>
    </>
  );
}

registerControlsSection({ id: "theme", title: "Theme", render: () => <ThemeSection /> });

function ExperienceSection() {
  const genesis = useGenesis();
  return (
    <>
      <div className="ccx-grid">
        <button type="button" data-og-switch onClick={() => setExperience("og")}>Switch to the OG experience</button>
      </div>
      <div className="ccx-grid" style={{ marginTop: 6 }}>
        {ORIGINAL_SCREENS.map((o) => (
          <button key={o.id} type="button" data-original={o.id} title={o.description} onClick={() => openOriginal(genesis, o)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="ccx-hint">Opening one original does not change your default. The same conversations, workspaces and themes are in both.</p>
    </>
  );
}

registerControlsSection({ id: "experience", title: "Original experiences (OG)", render: () => <ExperienceSection /> });
