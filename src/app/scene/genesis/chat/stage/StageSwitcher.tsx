/**
 * LÉLU — how this conversation is staged. Every environment in the registry,
 * grouped by what it is for (talk · find · make · show); Motion carries the
 * active pill. Scrolls sideways on a phone, never wraps or clips.
 */
import { LayoutGroup, motion } from "framer-motion";
import type { StageMode } from "../../../../../core/interface/WorkspaceSteward";
import { ENVIRONMENTS } from "../../../../../core/interface/Environments";

const ORDER: StageMode[] = ["conversation", "research", "board", "document", "diagram", "data", "code", "gallery", "spatial", "film", "voice", "present", "cinematic", "studio"];

export default function StageSwitcher({ stage, onChange, counts }: { stage: StageMode; onChange: (s: StageMode) => void; counts: { media: number; sections: number; works?: number } }) {
  const envs = ORDER.map((id) => ENVIRONMENTS.find((e) => e.id === id)!).filter(Boolean);
  return (
    <LayoutGroup id="lst-switch">
      <div className="lst-switch" role="tablist" aria-label="Environment for this conversation">
        {envs.map((s, i) => (
          <span key={s.id} style={{ display: "contents" }}>
            {i > 0 && envs[i - 1].family !== s.family ? <span className="lst-switch-sep" aria-hidden /> : null}
            <button
              type="button"
              role="tab"
              aria-selected={stage === s.id}
              data-on={stage === s.id}
              data-lelu-stage={s.id}
              onClick={() => onChange(s.id)}
              title={s.id === "gallery" ? `${s.purpose} (${counts.media} image(s))` : s.purpose}
            >
              {stage === s.id ? <motion.span layoutId="lst-pill" className="lst-pill" transition={{ type: "spring", stiffness: 480, damping: 36 }} /> : null}
              <span aria-hidden>{s.glyph}</span>
              <span className="lst-switch-label">{s.label}</span>
            </button>
          </span>
        ))}
      </div>
    </LayoutGroup>
  );
}
