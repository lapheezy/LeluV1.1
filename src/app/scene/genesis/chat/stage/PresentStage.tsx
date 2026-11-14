/**
 * LÉLU — the presentation stage: the conversation as full-screen slides.
 * Title, then one slide per question and per section. Arrow keys, swipe or
 * the controls; Motion slides direction-aware between them.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ChatMarkdown from "../ChatMarkdown";
import { slidesOf, type StageConversation } from "./conversationModel";

export default function PresentStage({ model, onExit }: { model: StageConversation; onExit: () => void }) {
  const slides = useMemo(() => slidesOf(model), [model]);
  const [[index, dir], setIndex] = useState<[number, number]>([0, 0]);
  const go = (delta: number) => setIndex(([i]) => [Math.max(0, Math.min(slides.length - 1, i + delta)), delta]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);
  const slide = slides[Math.min(index, slides.length - 1)];
  return (
    <div className="lst-present" data-lelu-stage-view="present">
      <AnimatePresence mode="popLayout" custom={dir} initial={false}>
        <motion.section
          key={slide.id}
          className="lst-slide"
          data-kind={slide.kind}
          custom={dir}
          initial={{ opacity: 0, x: dir >= 0 ? 80 : -80, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: dir >= 0 ? -80 : 80, scale: 0.98 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={(_, info) => (info.offset.x < -60 ? go(1) : info.offset.x > 60 ? go(-1) : undefined)}
        >
          {slide.media ? <div className="lst-slide-media" style={{ backgroundImage: `url("${slide.media.src}")` }} /> : null}
          <div className="lst-slide-copy">
            <span className="lst-eyebrow">{slide.kind === "title" ? "LÉLU presents" : slide.kind === "question" ? "The question" : `${index} / ${slides.length - 1}`}</span>
            <h1>{slide.heading}</h1>
            {slide.text ? <div className="lst-slide-text"><ChatMarkdown text={slide.text} /></div> : null}
          </div>
        </motion.section>
      </AnimatePresence>
      <nav className="lst-present-nav" aria-label="Slides">
        <button type="button" className="lst-chip" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous slide">‹</button>
        <div className="lst-dots">{slides.map((s, i) => <button key={s.id} type="button" data-on={i === index} aria-label={`Slide ${i + 1}`} onClick={() => setIndex([i, i > index ? 1 : -1])} />)}</div>
        <button type="button" className="lst-chip" onClick={() => go(1)} disabled={index >= slides.length - 1} aria-label="Next slide">›</button>
        <button type="button" className="lst-chip" onClick={onExit} aria-label="End presentation">End</button>
      </nav>
    </div>
  );
}
