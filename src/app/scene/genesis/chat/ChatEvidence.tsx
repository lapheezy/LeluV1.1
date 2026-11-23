/**
 * ==========================================================
 * LÉLU — EVIDENCE IN THE CONVERSATION (LÉLU 2.3, part 1)
 *
 * The mission's first rule is that the work is seen IN CHAT: actual renders,
 * before/after comparisons, technical overlays, measurements and the commit each
 * one belongs to — not a link to a dashboard, not a path to an artifact
 * directory.
 *
 * A message carries evidence as a fenced `evidence` block (see
 * `core/cognition/research/evidence.ts`); this component draws it:
 *
 *   image      the picture, its caption, its commit, its numbers; click to
 *              expand to a full-screen high-resolution view
 *   compare    two states of the SAME thing, each labelled, with the measured
 *              change between them
 *   group      several images as one sequence
 *   measure    a table with the change against the baseline
 *   commit     the development state the evidence belongs to
 *
 * It is responsive by construction: single column and full-width images on a
 * phone, two columns for a comparison on a desktop. Expanded images are a fixed
 * overlay with a close button, Escape and a tap-outside, so a phone can always
 * get back to the conversation.
 * ==========================================================
 */
import { memo, useCallback, useEffect, useState } from "react";
import { parseEvidence, type EvidenceBlock, type EvidenceImage, type Measurement } from "../../../../core/cognition/research/evidence";

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

function MeasurementChips({ rows }: { rows: Measurement[] }) {
  if (!rows.length) return null;
  return (
    <ul className="lelu-cc-evidence-measures" aria-label="Measurements">
      {rows.map((row) => (
        <li key={`${row.label}-${String(row.value)}`}>
          <span className="lelu-cc-evidence-measure-label">{row.label}</span>
          <span className="lelu-cc-evidence-measure-value">
            {row.value}
            {row.unit ? ` ${row.unit}` : ""}
          </span>
          {row.delta !== undefined ? <span className="lelu-cc-evidence-measure-delta">{String(row.delta)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function MeasurementTable({ rows }: { rows: Measurement[] }) {
  return (
    <div className="lelu-cc-table-scroll" tabIndex={0} role="region" aria-label="Measurements">
      <table>
        <thead>
          <tr>
            <th>measurement</th>
            <th>value</th>
            <th>vs baseline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.label}-${String(row.value)}`}>
              <td title={row.source}>{row.label}</td>
              <td>
                {row.value}
                {row.unit ? ` ${row.unit}` : ""}
              </td>
              <td>{row.delta === undefined ? "—" : String(row.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageCaption({ image }: { image: EvidenceImage }) {
  if (!image.caption && !image.commit) return null;
  return (
    <figcaption className="lelu-cc-evidence-caption">
      {image.caption ? <span>{image.caption}</span> : null}
      {image.commit ? <code title="commit this render was produced at">{shortSha(image.commit)}</code> : null}
    </figcaption>
  );
}

function EvidenceFigure({ image, onExpand, label }: { image: EvidenceImage; onExpand: (image: EvidenceImage) => void; label?: string }) {
  return (
    <figure className="lelu-cc-evidence-figure">
      <button type="button" className="lelu-cc-evidence-image-button" onClick={() => onExpand(image)} aria-label={`Expand ${image.alt}`}>
        {label ? <span className="lelu-cc-evidence-state">{label}</span> : null}
        <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
        <span className="lelu-cc-evidence-expand" aria-hidden>
          Expand
        </span>
      </button>
      <ImageCaption image={image} />
      {image.measurements?.length ? <MeasurementChips rows={image.measurements} /> : null}
    </figure>
  );
}

function Block({ block, onExpand }: { block: EvidenceBlock; onExpand: (image: EvidenceImage) => void }) {
  switch (block.kind) {
    case "image":
      return <EvidenceFigure image={block} onExpand={onExpand} />;
    case "compare":
      return (
        <section className="lelu-cc-evidence-compare" aria-label={block.title}>
          <h4 className="lelu-cc-evidence-title">{block.title}</h4>
          <div className="lelu-cc-evidence-compare-grid">
            <EvidenceFigure image={block.before} onExpand={onExpand} label="before" />
            <EvidenceFigure image={block.after} onExpand={onExpand} label="after" />
          </div>
          {block.measurements?.length ? <MeasurementTable rows={block.measurements} /> : null}
          {block.note ? <p className="lelu-cc-evidence-note">{block.note}</p> : null}
        </section>
      );
    case "group":
      return (
        <section className="lelu-cc-evidence-group" aria-label={block.title ?? "Images"}>
          {block.title ? <h4 className="lelu-cc-evidence-title">{block.title}</h4> : null}
          <div className="lelu-cc-evidence-group-grid">
            {block.items.map((image, index) => (
              <EvidenceFigure key={`${image.src}-${index}`} image={image} onExpand={onExpand} />
            ))}
          </div>
          {block.caption ? <p className="lelu-cc-evidence-note">{block.caption}</p> : null}
        </section>
      );
    case "measure":
      return (
        <section className="lelu-cc-evidence-measure" aria-label={block.title}>
          <h4 className="lelu-cc-evidence-title">{block.title}</h4>
          <MeasurementTable rows={block.rows} />
          {block.note ? <p className="lelu-cc-evidence-note">{block.note}</p> : null}
        </section>
      );
    case "commit":
      return (
        <p className="lelu-cc-evidence-commit">
          <code>{shortSha(block.sha)}</code>
          <span>{block.subject}</span>
          {block.url ? (
            <a href={block.url} target="_blank" rel="noopener noreferrer">
              view
            </a>
          ) : null}
        </p>
      );
  }
}

function Lightbox({ image, onClose }: { image: EvidenceImage; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lelu-cc-evidence-lightbox" role="dialog" aria-modal="true" aria-label={image.alt} onClick={onClose}>
      <div className="lelu-cc-evidence-lightbox-inner" onClick={(event) => event.stopPropagation()}>
        <img src={image.hiRes ?? image.src} alt={image.alt} decoding="async" />
        <div className="lelu-cc-evidence-lightbox-bar">
          <span>
            {image.alt}
            {image.commit ? ` · ${shortSha(image.commit)}` : ""}
          </span>
          <button type="button" onClick={onClose} aria-label="Close expanded image">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatEvidenceImpl({ source }: { source: string }) {
  const [expanded, setExpanded] = useState<EvidenceImage | null>(null);
  const onExpand = useCallback((image: EvidenceImage) => setExpanded(image), []);
  const onClose = useCallback(() => setExpanded(null), []);
  const blocks = parseEvidence(source);

  // A block that does not parse is shown as the text it was, never swallowed:
  // a malformed evidence fence must not make the message look like nothing
  // happened.
  if (!blocks.length) {
    return (
      <figure className="lelu-cc-visual" aria-label="Evidence">
        <figcaption className="lelu-cc-code-head">
          <span>evidence</span>
        </figcaption>
        <pre tabIndex={0} className="lelu-cc-visual-source">
          <code>{source}</code>
        </pre>
      </figure>
    );
  }

  return (
    <div className="lelu-cc-evidence">
      {blocks.map((block, index) => (
        <Block key={`${block.kind}-${index}`} block={block} onExpand={onExpand} />
      ))}
      {expanded ? <Lightbox image={expanded} onClose={onClose} /> : null}
    </div>
  );
}

const ChatEvidence = memo(ChatEvidenceImpl);
export default ChatEvidence;
