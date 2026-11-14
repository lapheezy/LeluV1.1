/** LÉLU — how this conversation is staged. Motion carries the active pill between stages. */
import { LayoutGroup, motion } from "framer-motion";
import type { StageMode } from "../../../../../core/interface/WorkspaceSteward";

const STAGES: Array<{ id: StageMode; label: string; glyph: string }> = [
  { id: "conversation", label: "Chat", glyph: "◍" },
  { id: "cinematic", label: "Cinematic", glyph: "✦" },
  { id: "board", label: "Board", glyph: "⌘" },
  { id: "gallery", label: "Gallery", glyph: "▣" },
  { id: "present", label: "Present", glyph: "▶" },
  { id: "spatial", label: "3D", glyph: "⬡" },
];

export default function StageSwitcher({ stage, onChange, counts }: { stage: StageMode; onChange: (s: StageMode) => void; counts: { media: number; sections: number } }) {
  return (
    <LayoutGroup id="lst-switch">
      <div className="lst-switch" role="tablist" aria-label="Stage this conversation">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={stage === s.id}
            data-on={stage === s.id}
            data-lelu-stage={s.id}
            onClick={() => onChange(s.id)}
            title={s.id === "gallery" ? `${counts.media} image(s)` : s.id === "board" ? `${counts.sections} section(s) as a research board` : s.label}
          >
            {stage === s.id ? <motion.span layoutId="lst-pill" className="lst-pill" transition={{ type: "spring", stiffness: 480, damping: 36 }} /> : null}
            <span aria-hidden>{s.glyph}</span>
            <span className="lst-switch-label">{s.label}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}
