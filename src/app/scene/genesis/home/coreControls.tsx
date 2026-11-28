/**
 * Sections other features add to the core chat box's "+" Controls tab. Registered once, at import.
 */
import { useSyncExternalStore } from "react";
import { registerControlsSection } from "./CoreChat";
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
