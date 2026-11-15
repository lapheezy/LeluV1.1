/**
 * LÉLU — the gallery stage: every image in the conversation, beside the chat.
 * Wide windows split gallery | thread; narrow ones stack them. Tapping an
 * image expands it with a shared-layout transition (Motion layoutId).
 */
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { StageConversation, StageMedia } from "./conversationModel";

export default function GalleryStage({ model, thread }: { model: StageConversation; thread: ReactNode }) {
  const [open, setOpen] = useState<StageMedia | null>(null);
  return (
    <div className="lst-gallery" data-lelu-stage-view="gallery">
      <div className="lst-gallery-grid" aria-label="Images in this conversation">
        {model.media.length === 0 ? <p className="lst-empty">No images in this conversation yet. Ask LÉLU for one, or attach a picture.</p> : null}
        {model.media.map((m, i) => (
          <motion.button
            key={m.id}
            type="button"
            layoutId={`lst-media-${m.id}`}
            className="lst-tile"
            onClick={() => setOpen(m)}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 28 }}
            whileHover={{ y: -4 }}
          >
            <img src={m.src} alt={m.alt} loading="lazy" decoding="async" />
            <span>{m.alt} · scene {m.turn + 1}</span>
          </motion.button>
        ))}
      </div>
      <div className="lst-gallery-thread">{thread}</div>
      <AnimatePresence>
        {open ? (
          <motion.div className="lst-lightbox" onClick={() => setOpen(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.figure layoutId={`lst-media-${open.id}`} className="lst-lightbox-fig" onClick={(e) => e.stopPropagation()}>
              <img src={open.src} alt={open.alt} />
              <figcaption>{open.alt}</figcaption>
            </motion.figure>
            <button type="button" className="lst-chip lst-lightbox-close" onClick={() => setOpen(null)} aria-label="Close image">✕</button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
