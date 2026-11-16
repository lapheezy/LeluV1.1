/**
 * ==========================================================
 * LÉLU — THE NEURAL MAP, INSIDE ANY INTERFACE (M17.2-WP02)
 *
 * The embedded contract (useNeural.ts) as one card an interface places
 * in its OWN layout — not an overlay, not a link out. It reads the same
 * shared index as the standalone map and the Cosmos inspector:
 *
 *   focus     the interface's current entity, by canonical id
 *   context   the interface's own entities to switch between (this
 *             chat, its project, the artifact it made…)
 *   follow    relationships are followed inside the card (← walks back)
 *   act       the entity's operations run the existing tools; a host may
 *             add its own interface actions (open this chat…)
 *   open map  the SAME entity in the standalone Neural Map, opened over
 *             this interface; Return lands back here
 *
 * `unindexed` says plainly what this interface shows that no authority
 * exposes to the map, instead of drawing it as if it were there.
 * ==========================================================
 */

import { useEffect, useState, type CSSProperties } from "react";
import { NeuralView } from "./neuralView";
import EntityPanel, { type HostAction } from "./EntityPanel";
import { ensureNeuralMap, useNeuralEntity } from "./useNeural";
import "./neural.css";

export interface NeuralEmbedProps {
  /** The host interface's id (home, chat-universe, creation, projects, engineering, system). */
  host: string;
  hostLabel: string;
  /** The entity the interface is on now (canonical id), or null. */
  focus: string | null;
  context?: Array<{ id: string; label: string }>;
  hostActions?: HostAction[];
  unindexed?: string;
  onClose: () => void;
  style?: CSSProperties;
}

function ContextChip({ id, label, on, pick }: { id: string; label: string; on: boolean; pick: (id: string) => void }) {
  const entity = useNeuralEntity(id);
  return (
    <button type="button" className="nm-chip" data-context={id} data-on={on ? "true" : "false"} data-indexed={entity ? "true" : "false"} onClick={() => pick(id)} title={id}>
      {label}
    </button>
  );
}

// Idempotent; normally Bootstrap already connected the map.
ensureNeuralMap();

export default function NeuralEmbed({ host, hostLabel, focus, context = [], hostActions, unindexed, onClose, style }: NeuralEmbedProps) {
  // The trail is this card's own presentation state: it starts at the
  // interface's focus and is reset whenever the interface moves on.
  const [trail, setTrail] = useState<string[]>(focus ? [focus] : []);
  useEffect(() => {
    setTrail(focus ? [focus] : []);
  }, [focus]);
  const current = trail.at(-1) ?? null;
  const follow = (id: string) => setTrail((t) => (t.at(-1) === id ? t : [...t, id].slice(-30)));
  const pick = (id: string) => setTrail([id]);

  return (
    <section className="nm-embed" data-neural-embed={host} data-current={current ?? ""} aria-label={`Neural Map in ${hostLabel}`} style={style}>
      <div className="nm-inspector-bar">
        <span className="nm-title">Neural Map · {hostLabel}</span>
        <button type="button" data-embed-back disabled={trail.length < 2} onClick={() => setTrail((t) => t.slice(0, -1))} aria-label="Back to the previous entity">
          ←
        </button>
        <button type="button" data-open-standalone disabled={!current} onClick={() => current && NeuralView.openStandalone(current, { over: true, from: host })} title="Open this in the Neural Map">
          Open map
        </button>
        <button type="button" data-close-embed aria-label="Close the Neural Map card" onClick={onClose}>
          ✕
        </button>
      </div>
      {context.length ? (
        <div className="nm-context" aria-label={`In ${hostLabel}`}>
          {context.map((c) => (
            <ContextChip key={c.id} id={c.id} label={c.label} on={c.id === current} pick={pick} />
          ))}
        </div>
      ) : null}
      {current ? (
        <EntityPanel id={current} compact onFollow={follow} hostActions={hostActions} />
      ) : (
        <p className="nm-muted nm-embed-empty">Pick something in {hostLabel} to see its place in the Neural Map.</p>
      )}
      {unindexed ? (
        <p className="nm-muted nm-unindexed" data-unindexed>
          Not in the map: {unindexed}
        </p>
      ) : null}
    </section>
  );
}
