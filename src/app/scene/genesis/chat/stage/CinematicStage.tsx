/**
 * LÉLU — the cinematic stage: the conversation as a film.
 * A full-bleed hero from its own first image, then each exchange as a scene:
 * the question as a title card, every section as a chapter with its media
 * breathing in as it scrolls into view (Motion whileInView).
 */
import { motion } from "framer-motion";
import ChatMarkdown from "../ChatMarkdown";
import { stripMarkdown, type StageConversation } from "./conversationModel";

const ART = `${import.meta.env?.BASE_URL ?? "/"}universe/galaxy.webp`.replace(/\/\/+/g, "/");

export default function CinematicStage({ model, processing }: { model: StageConversation; processing: boolean }) {
  const hero = model.media[0]?.src ?? ART;
  return (
    <div className="lst-cine" data-lelu-stage-view="cinematic">
      <section className="lst-cine-hero">
        <motion.div className="lst-cine-hero-img" style={{ backgroundImage: `url("${hero}")` }} initial={{ scale: 1.12 }} animate={{ scale: 1 }} transition={{ duration: 6, ease: "easeOut" }} />
        <div className="lst-cine-hero-shade" />
        <motion.div className="lst-cine-hero-text" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
          <span className="lst-eyebrow">A conversation with LÉLU</span>
          <h1>{model.title}</h1>
          <p>{model.turns.length} scene{model.turns.length === 1 ? "" : "s"} · {model.media.length} image{model.media.length === 1 ? "" : "s"} · {model.links.length} source{model.links.length === 1 ? "" : "s"}</p>
        </motion.div>
      </section>
      {model.turns.map((turn) => (
        <section key={turn.index} className="lst-cine-scene">
          {turn.question ? (
            <motion.h2 className="lst-cine-q" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.7 }}>
              <span>Scene {turn.index + 1}</span>
              {stripMarkdown(turn.question)}
            </motion.h2>
          ) : null}
          {turn.sections.map((s) => (
            <motion.article key={s.id} className="lst-cine-chapter" initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
              {s.heading ? <h3>{s.heading}</h3> : null}
              {s.text ? <div className="lst-cine-text"><ChatMarkdown text={s.text} /></div> : null}
              {s.media.map((m) => (
                <motion.figure key={m.id} className="lst-cine-media" initial={{ opacity: 0, scale: 0.94 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.9 }}>
                  <img src={m.src} alt={m.alt} loading="lazy" decoding="async" />
                  <figcaption>{m.alt}</figcaption>
                </motion.figure>
              ))}
            </motion.article>
          ))}
          {!turn.answerId && processing ? <p className="lst-cine-wait">LÉLU is writing this scene…</p> : null}
        </section>
      ))}
      {model.links.length ? (
        <section className="lst-cine-credits">
          <h4>Sources</h4>
          {model.links.map((l) => <a key={l.id} href={l.href} target="_blank" rel="noreferrer">{l.label}</a>)}
        </section>
      ) : null}
    </div>
  );
}
