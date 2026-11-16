/**
 * One entity of the Neural Map: identity, state, place, typed
 * relationships (grouped, collapsible — never a wall of lines), history,
 * and the real operations that can act on it. Shared by the embedded
 * inspector and the standalone map, so both show the same thing.
 */

import { useState } from "react";
import { RELATION_WORDS, type NeuralEntity, type NeuralRelationType } from "../../../../core/neural/NeuralMapTypes";
import { neuralMap } from "../../../../core/neural/NeuralMap";
import { useNeuralEntity, useNeuralRelations, runNeuralOperation } from "./useNeural";

/** Object operations a person can press. The ids are the existing tools. */
const BUTTONS: Array<{ tool: string; label: string; args: (e: NeuralEntity) => Record<string, unknown>; when?: (e: NeuralEntity) => boolean }> = [
  { tool: "cosmos.object.select", label: "Show in Cosmos", args: (e) => ({ object: e.sourceId }) },
  { tool: "cosmos.object.duplicate", label: "Duplicate", args: (e) => ({ object: e.sourceId }) },
  { tool: "cosmos.object.extract", label: "Take out", args: (e) => ({ object: e.sourceId }), when: (e) => neuralMap().relations(e.id, { direction: "out", types: ["attached-to"] }).length > 0 },
  { tool: "cosmos.object.remove", label: "Remove", args: (e) => ({ object: e.sourceId }) },
  { tool: "cosmos.object.restore", label: "Restore", args: (e) => ({ object: e.sourceId }) },
];

const ORDER: NeuralRelationType[] = ["attached-to", "contains", "part-of", "located-in", "member-of", "derived-from", "extracted-from", "created-from", "references", "presents", "orbits", "connected-to", "aligned-with", "operated-by"];

export default function EntityPanel({ id, onFollow, compact = false }: { id: string; onFollow: (id: string) => void; compact?: boolean }) {
  const entity = useNeuralEntity(id);
  const relations = useNeuralRelations(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  if (!entity) {
    return (
      <div className="nm-panel" data-neural-entity={id} data-missing="true">
        <p className="nm-muted">Nothing in the Neural Map has the id {id}.</p>
      </div>
    );
  }

  const groups = new Map<string, typeof relations>();
  for (const n of relations) {
    const key = `${n.relation.type}:${n.direction}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const keys = [...groups.keys()].sort((a, b) => ORDER.indexOf(a.split(":")[0] as NeuralRelationType) - ORDER.indexOf(b.split(":")[0] as NeuralRelationType));
  const ops = BUTTONS.filter((b) => entity.operations.includes(b.tool) && (!b.when || b.when(entity)));

  return (
    <div className="nm-panel" data-neural-entity={entity.id} data-state={entity.state} data-type={entity.type}>
      <div className="nm-head">
        <span className="nm-type" data-type={entity.type}>{entity.type}</span>
        <strong className="nm-label">{entity.label}</strong>
        <span className="nm-state" data-state={entity.state}>{entity.state}</span>
      </div>
      <dl className="nm-facts">
        <dt>Identity</dt>
        <dd>
          <code data-neural-id>{entity.id}</code>
        </dd>
        <dt>Owned by</dt>
        <dd>
          {entity.authority} · <code>{entity.sourceId}</code>
        </dd>
        {entity.spatial ? (
          <>
            <dt>Where</dt>
            <dd data-neural-position={entity.spatial.position.join(",")}>
              {entity.spatial.position.map((n) => Number(n.toFixed(2))).join(", ")}
              {entity.spatial.space ? (
                <>
                  {" "}in{" "}
                  <button type="button" className="nm-link" onClick={() => onFollow(entity.spatial!.space!)}>
                    {neuralMap().get(entity.spatial.space)?.label ?? entity.spatial.space}
                  </button>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        {compact
          ? null
          : Object.entries(entity.facts).map(([k, v]) => (
              <span key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </span>
            ))}
      </dl>

      <div className="nm-relations" aria-label="Relationships">
        {keys.length === 0 ? <p className="nm-muted">No relationships.</p> : null}
        {keys.map((key) => {
          const [type, dir] = key.split(":") as [NeuralRelationType, "out" | "in"];
          const items = groups.get(key)!;
          return (
            <div key={key} className="nm-rel-group" data-relation={type} data-direction={dir}>
              <span className="nm-rel-word">{RELATION_WORDS[type][dir]}</span>
              <span className="nm-rel-items">
                {items.slice(0, compact ? 6 : 40).map((n) => {
                  const otherId = dir === "out" ? n.relation.to : n.relation.from;
                  return (
                    <button key={n.relation.id} type="button" className="nm-chip" data-to={otherId} data-entity-type={n.entity?.type} onClick={() => onFollow(otherId)} title={otherId}>
                      {n.entity?.label ?? otherId}
                    </button>
                  );
                })}
                {items.length > (compact ? 6 : 40) ? <span className="nm-muted">+{items.length - (compact ? 6 : 40)} more</span> : null}
              </span>
            </div>
          );
        })}
      </div>

      {entity.provenance.length ? (
        <div className="nm-history">
          <button type="button" className="nm-link" onClick={() => setShowHistory(!showHistory)}>
            History ({entity.provenance.length}) {showHistory ? "▴" : "▾"}
          </button>
          {showHistory ? (
            <ol>
              {entity.provenance.slice(-12).map((p, i) => (
                <li key={i}>
                  <b>{p.action}</b> {p.detail}
                  {p.ref ? (
                    <>
                      {" "}
                      <button type="button" className="nm-link" onClick={() => onFollow(p.ref!)}>
                        →
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {ops.length ? (
        <div className="nm-ops" aria-label="Operations">
          {ops.map((b) => (
            <button
              key={b.tool}
              type="button"
              data-op={b.tool}
              disabled={busy !== null}
              title={`Runs ${b.tool} through LÉLU's tool dispatcher`}
              onClick={async () => {
                setBusy(b.tool);
                setResult(null);
                const r = await runNeuralOperation(b.tool, b.args(entity));
                setBusy(null);
                setResult({ ok: r.ok, text: r.content });
                // A duplicate is a new entity: go to it, so its lineage is what you see.
                const newId = (r.data as { objectId?: string } | undefined)?.objectId;
                if (r.ok && b.tool === "cosmos.object.duplicate" && newId) onFollow(`cosmos.object:${newId}`);
              }}
            >
              {busy === b.tool ? "…" : b.label}
            </button>
          ))}
        </div>
      ) : null}
      {result ? (
        <p className="nm-result" data-ok={result.ok ? "true" : "false"} role="status">
          {result.ok ? "✓" : "✗"} {result.text}
        </p>
      ) : null}
    </div>
  );
}
