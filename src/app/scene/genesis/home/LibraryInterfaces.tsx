/**
 * ==========================================================
 * LÉLU — INFINITE LIBRARY: INTERFACES (Mission 17)
 *
 * The interface half of the Infinite Library. Every complete interface
 * LÉLU has, from the one catalog (InterfaceCatalog):
 *
 *   Cosmos        Cosmos · LÉLU's Room (Genesis V2)
 *   Legacy UIs    LÉLU System UI · Original LÉLU (Inner Sky, Core)
 *   Compositions  built-in and your own continuous interfaces
 *
 * Tapping an interface opens it ON ITS OWN (its standalone experience).
 * Ticking several and choosing “Compose” makes a new composition of
 * them and opens it as one continuous interface. Legacy means archived
 * and fully working — the real implementation launches, not a picture.
 * ==========================================================
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGenesis } from "../GenesisCore";
import { INTERFACE_CATEGORIES, INTERFACES, searchInterfaces, type InterfaceId } from "../../../../core/interface/InterfaceCatalog";
import InterfaceCompositionStore from "../../../../core/interface/InterfaceCompositionStore";
import { regionName } from "../../../../core/interface/interfaceComposition";
import { openComposition, openInterface } from "../interfaces/interfaceActions";
import { useInterfaceCompositions } from "../interfaces/useInterfaceCompositions";
import { HomeIcon } from "./HomeModules";

export default function LibraryInterfaces({ query, onClose }: { query: string; onClose: () => void }) {
  const genesis = useGenesis();
  const navigate = useNavigate();
  const state = useInterfaceCompositions();
  const [picked, setPicked] = useState<InterfaceId[]>([]);
  const q = query.trim().toLowerCase();
  const matches = new Set(searchInterfaces(q).map((entry) => entry.id));
  const compositions = InterfaceCompositionStore.list().filter((c) => !q || c.name.toLowerCase().includes(q) || c.regions.some((r) => regionName(r).toLowerCase().includes(q)));
  void state.revision; // re-render when compositions change

  const toggle = (id: InterfaceId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="lsh-interfaces" data-library-interfaces>
      {INTERFACE_CATEGORIES.map((category) => {
        const entries = INTERFACES.filter((entry) => entry.category === category && matches.has(entry.id));
        if (!entries.length) return null;
        return (
          <section key={category} className="lsh-section" data-library-category={category}>
            <h3>{category}</h3>
            <ul className="lsh-list">
              {entries.map((entry) => (
                <li key={entry.id} data-library-interface={entry.id}>
                  <button
                    type="button"
                    className="lsh-world"
                    onClick={() => {
                      onClose();
                      openInterface(genesis, entry.id, navigate);
                    }}
                  >
                    <span className="lsh-app-icon" style={{ background: `linear-gradient(140deg, ${entry.identity.accent}, ${entry.identity.background})` }}>
                      <HomeIcon name={entry.icon} size={20} />
                    </span>
                    <span className="lsh-list-name">
                      {entry.name}
                      <small className="lsh-sub">{entry.description}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="lsh-pick"
                    role="checkbox"
                    aria-checked={picked.includes(entry.id)}
                    aria-label={`Include ${entry.name} in a new composition`}
                    data-on={picked.includes(entry.id) ? "true" : "false"}
                    onClick={() => toggle(entry.id)}
                  >
                    {picked.includes(entry.id) ? <HomeIcon name="Check" size={16} /> : <HomeIcon name="Plus" size={16} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {picked.length ? (
        <div className="lsh-actions lsh-compose-bar">
          <button
            type="button"
            className="lsh-primary"
            data-compose-picked
            onClick={() => {
              const made = InterfaceCompositionStore.create(picked.map((id) => INTERFACES.find((e) => e.id === id)!.name).join(" + "), picked);
              setPicked([]);
              onClose();
              openComposition(genesis, made.id);
            }}
          >
            <HomeIcon name="Layers3" size={16} /> Compose {picked.length} interface{picked.length === 1 ? "" : "s"} into one
          </button>
        </div>
      ) : null}

      {compositions.length ? (
        <section className="lsh-section" data-library-category="Compositions">
          <h3>Compositions</h3>
          <ul className="lsh-list">
            {compositions.map((c) => (
              <li key={c.id} data-library-composition={c.id}>
                <button
                  type="button"
                  className="lsh-world"
                  onClick={() => {
                    onClose();
                    openComposition(genesis, c.id);
                  }}
                >
                  <span className="lsh-app-icon lsh-strip-icon">
                    {c.regions.slice(0, 5).map((r) => (
                      <i key={r.key} style={{ background: INTERFACES.find((e) => e.id === r.interfaceId)!.identity.accent }} />
                    ))}
                  </span>
                  <span className="lsh-list-name">
                    {c.name}
                    <small className="lsh-sub">
                      {c.regions.map(regionName).join(" → ")}
                      {c.builtIn ? " · built-in" : ""}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {state.trash.length ? (
        <section className="lsh-section" data-library-category="Trash">
          <h3>Recently removed</h3>
          <ul className="lsh-list">
            {state.trash.map((c) => (
              <li key={c.id}>
                <span className="lsh-list-name">{c.name}</span>
                <button type="button" className="lsh-pick" aria-label={`Restore ${c.name}`} onClick={() => InterfaceCompositionStore.restore(c.id)}>
                  <HomeIcon name="RotateCcw" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
