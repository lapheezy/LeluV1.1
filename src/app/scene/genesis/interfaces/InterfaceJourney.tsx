/**
 * ==========================================================
 * LÉLU — THE CONTINUOUS INTERFACE (Mission 17)
 *
 * An open composition: every interface it holds, one after another in
 * ONE scrollable space — scroll (or swipe, or use the jump bar) from the
 * original LÉLU into her Room, out into the Cosmos, into the System UI…
 * with no application boundary in between. Each region keeps its own
 * look; the seams blend one identity into the next.
 *
 * Performance policy (liveRegions, pure and tested):
 *   - only regions in view are mounted; the rest are light previews
 *     (unmounted, not hidden);
 *   - at most one WebGL region at a time;
 *   - the Cosmos region is a clear window onto the one Cosmos world the
 *     scene router draws, and the router draws it ONLY while that region
 *     is current (compositionCoversWorld).
 *
 * Everything shared stays shared: the chat button opens the same chat,
 * on the same conversation, above the composition.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useGenesis } from "../GenesisCore";
import InterfaceCompositionStore from "../../../../core/interface/InterfaceCompositionStore";
import { INTERFACES, interfaceById, type InterfaceId } from "../../../../core/interface/InterfaceCatalog";
import {
  liveRegions,
  regionName,
  VARIANT_STYLES,
  type CompositionEdit,
  type CompositionRegion,
  type InterfaceComposition,
} from "../../../../core/interface/interfaceComposition";
import { HomeIcon } from "../home/HomeModules";
import { useInterfaceCompositions } from "./useInterfaceCompositions";
import { closeComposition, openInterface } from "./interfaceActions";
import InterfaceRegion from "./InterfaceRegion";
import { NeuralView } from "../neural/neuralView";
import "./interfaceJourney.css";

function RegionPreview({ region }: { region: CompositionRegion }) {
  const entry = interfaceById(region.interfaceId)!;
  return (
    <div className="ij-preview" aria-hidden>
      <span className="ij-preview-icon">
        <HomeIcon name={entry.icon} size={36} />
      </span>
      <strong>{regionName(region)}</strong>
      <small>{entry.description}</small>
    </div>
  );
}

function Seam({ from, to, seam, onEnter }: { from: CompositionRegion; to: CompositionRegion; seam: InterfaceComposition["seam"]; onEnter: () => void }) {
  const a = interfaceById(from.interfaceId)!.identity;
  const b = interfaceById(to.interfaceId)!.identity;
  return (
    <div
      className="ij-seam"
      data-seam={seam}
      style={{ "--ij-from": a.background, "--ij-to": b.background, "--ij-from-accent": a.accent, "--ij-to-accent": b.accent } as CSSProperties}
    >
      {seam === "cut" ? null : (
        <button type="button" className="ij-seam-go" onClick={onEnter}>
          <HomeIcon name="ChevronDown" size={16} /> {regionName(to)}
        </button>
      )}
    </div>
  );
}

function EditDrawer({ composition, onClose, onEdit }: { composition: InterfaceComposition; onClose: () => void; onEdit: (edit: CompositionEdit) => void }) {
  const [adding, setAdding] = useState<InterfaceId>("cosmos");
  const all = InterfaceCompositionStore.list().filter((c) => c.id !== composition.id);
  const [mergeWith, setMergeWith] = useState(all[0]?.id ?? "");
  const S = InterfaceCompositionStore;
  return (
    <aside className="ij-drawer" aria-label="Edit this composition" data-ij-edit>
      <div className="ij-drawer-head">
        <strong>Edit composition</strong>
        <button type="button" aria-label="Close the editor" onClick={onClose}>
          <HomeIcon name="X" size={16} />
        </button>
      </div>
      {composition.builtIn ? <p className="ij-note">This is a built-in. Your first edit saves a copy of your own; the built-in stays as it is.</p> : null}
      <label className="ij-field">
        Name
        <input defaultValue={composition.name} key={composition.id} aria-label="Composition name" onBlur={(e) => e.target.value !== composition.name && onEdit({ op: "rename", name: e.target.value })} />
      </label>
      <div className="ij-row">
        <span>Flow</span>
        {(["vertical", "horizontal"] as const).map((flow) => (
          <button key={flow} type="button" data-on={composition.flow === flow ? "true" : "false"} onClick={() => onEdit({ op: "flow", flow })}>
            {flow === "vertical" ? "Scroll down" : "Scroll across"}
          </button>
        ))}
      </div>
      <div className="ij-row">
        <span>Seams</span>
        {(["blend", "portal", "cut"] as const).map((seam) => (
          <button key={seam} type="button" data-on={composition.seam === seam ? "true" : "false"} onClick={() => onEdit({ op: "seam", seam })}>
            {seam}
          </button>
        ))}
      </div>
      <ol className="ij-regions" aria-label="Interfaces in order">
        {composition.regions.map((r, i) => (
          <li key={r.key} data-ij-edit-region={r.interfaceId}>
            <span>{regionName(r)}</span>
            <span className="ij-region-actions">
              <button type="button" aria-label={`Move ${regionName(r)} earlier`} disabled={i === 0} onClick={() => onEdit({ op: "move", key: r.key, to: i - 1 })}>
                <HomeIcon name="ChevronUp" size={14} />
              </button>
              <button type="button" aria-label={`Move ${regionName(r)} later`} disabled={i === composition.regions.length - 1} onClick={() => onEdit({ op: "move", key: r.key, to: i + 1 })}>
                <HomeIcon name="ChevronDown" size={14} />
              </button>
              <button type="button" aria-label={`Remove ${regionName(r)}`} disabled={composition.regions.length <= 1} onClick={() => onEdit({ op: "remove", key: r.key })}>
                <HomeIcon name="X" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="ij-row">
        <select aria-label="Interface to add" value={adding} onChange={(e) => setAdding(e.target.value as InterfaceId)}>
          {INTERFACES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <button type="button" data-ij-add onClick={() => onEdit({ op: "add", interfaceId: adding })}>
          <HomeIcon name="Plus" size={14} /> Add
        </button>
      </div>
      <div className="ij-row">
        <button type="button" data-ij-undo disabled={!S.canUndo(composition.id)} onClick={() => S.undo(composition.id)}>
          <HomeIcon name="Undo2" size={14} /> Undo
        </button>
        <button type="button" data-ij-redo disabled={!S.canRedo(composition.id)} onClick={() => S.redo(composition.id)}>
          <HomeIcon name="Redo2" size={14} /> Redo
        </button>
        {composition.regions.length > 1 ? (
          <button
            type="button"
            data-ij-split
            onClick={() => {
              const parts = S.split(composition.id, Math.ceil(composition.regions.length / 2));
              if (parts) S.open(parts[0].id);
            }}
          >
            Split in two
          </button>
        ) : null}
      </div>
      {all.length ? (
        <div className="ij-row">
          <select aria-label="Composition to merge with" data-ij-merge-with value={mergeWith} onChange={(e) => setMergeWith(e.target.value)}>
            {all.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-ij-merge
            onClick={() => {
              const merged = S.merge(composition.id, mergeWith);
              if (merged) S.open(merged.id);
            }}
          >
            Merge
          </button>
        </div>
      ) : null}
      {!composition.builtIn ? (
        <button type="button" className="ij-danger" data-ij-trash onClick={() => S.remove(composition.id)}>
          Move to trash (restorable)
        </button>
      ) : null}
      {composition.lineage.length ? (
        <p className="ij-note">
          Made from: {composition.lineage.map((l) => `${l.name} (${l.how})`).join(" → ")}
        </p>
      ) : null}
    </aside>
  );
}

function VariantsPanel({ source, made, onClose }: { source: InterfaceComposition; made: InterfaceComposition[]; onClose: () => void }) {
  return (
    <aside className="ij-drawer ij-variants" aria-label="Alternative compositions" data-ij-variants>
      <div className="ij-drawer-head">
        <strong>{made.length} alternatives of “{source.name}”</strong>
        <button type="button" aria-label="Close alternatives" onClick={onClose}>
          <HomeIcon name="X" size={16} />
        </button>
      </div>
      <p className="ij-note">Same interfaces, different arrangements. Each is saved as its own composition; the source is unchanged.</p>
      <ul className="ij-variant-list">
        {made.map((v) => (
          <li key={v.id} data-ij-variant={v.id}>
            <strong>{v.name}</strong>
            <span className="ij-strip" data-flow={v.flow}>
              {v.regions.map((r) => (
                <i key={r.key} title={regionName(r)} style={{ background: interfaceById(r.interfaceId)!.identity.accent }} />
              ))}
            </span>
            <small>
              {v.regions.map(regionName).join(" → ")} · {v.flow} · {v.seam}
            </small>
            <button type="button" onClick={() => InterfaceCompositionStore.open(v.id)}>
              Open
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function InterfaceJourney() {
  const state = useInterfaceCompositions();
  const genesis = useGenesis();
  const navigate = useNavigate();
  const open = state.open;
  const composition = open ? InterfaceCompositionStore.get(open.compositionId) : undefined;
  const scroller = useRef<HTMLDivElement | null>(null);
  const [visibility, setVisibility] = useState<Record<string, number>>({});
  const [panel, setPanel] = useState<"edit" | "variants" | null>(null);
  const [variants, setVariants] = useState<InterfaceComposition[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [exploring, setExploring] = useState(false);
  const horizontal = composition?.flow === "horizontal";
  // A region is sized to the scroller it lives in, measured — not to a
  // guess at the browser chrome (iOS toolbars change it as you scroll).
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = () => setHeight(el.clientHeight);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open?.compositionId]);

  /* How much of the scroller each region occupies (pixels, not ratio: a
     small region fully in view must not outrank a screen-sized one). */
  const regionKeys = composition?.regions.map((r) => r.key).join("|") ?? "";
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const seen: Record<string, number> = {};
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.regionKey!;
          seen[key] = e.isIntersecting ? (horizontal ? e.intersectionRect.width : e.intersectionRect.height) : 0;
        }
        setVisibility({ ...seen });
      },
      { root, threshold: [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1] },
    );
    root.querySelectorAll<HTMLElement>("[data-region-key]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [regionKeys, horizontal]);

  const { current, live } = useMemo(() => (composition ? liveRegions(composition.regions, visibility) : { current: null, live: new Set<string>() }), [composition, visibility]);

  useEffect(() => {
    if (current) InterfaceCompositionStore.setCurrent(current);
  }, [current]);

  const scrollTo = useCallback(
    (key: string, smooth = true) => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-region-key="${key}"]`);
      if (!el || !scroller.current) return;
      scroller.current.scrollTo({ [horizontal ? "left" : "top"]: horizontal ? el.offsetLeft : el.offsetTop, behavior: smooth ? "smooth" : "auto" });
    },
    [horizontal],
  );

  // Arrive where the person left (or where they asked to go).
  const arrivedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!composition || !open) return;
    const tag = `${composition.id}:${composition.flow}`;
    if (arrivedFor.current === tag) return;
    arrivedFor.current = tag;
    const key = open.currentKey ?? composition.regions[0]?.key;
    if (key) requestAnimationFrame(() => scrollTo(key, false));
  }, [composition, open, scrollTo]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  if (!open || !composition) return null;

  const edit = (e: CompositionEdit) => {
    const result = InterfaceCompositionStore.edit(composition.id, e);
    if (result?.forked) setNotice(`Saved as “${InterfaceCompositionStore.get(result.id)?.name}”. “${composition.name}” is unchanged.`);
  };
  const go = (id: InterfaceId) => {
    const target = composition.regions.find((r) => r.interfaceId === id);
    if (target) scrollTo(target.key);
  };
  const bookmarked = new Set(composition.bookmarks.map((b) => b.regionKey));
  const conversation = genesis.state.conversations.find((c) => c.id === genesis.state.activeConversationId);

  return (
    <div className="ij" data-interface-journey={composition.id} data-flow={composition.flow} data-current={open.currentInterface ?? ""} data-exploring={exploring ? "true" : "false"} role="region" aria-label={composition.name} style={height ? ({ "--ij-h": `${height}px` } as CSSProperties) : undefined}>
      <header className="ij-bar">
        <button type="button" className="ij-icon" aria-label="Close and return to the Cosmos" title="Back to the Cosmos" onClick={() => closeComposition()}>
          <HomeIcon name="X" size={18} />
        </button>
        <div className="ij-title">
          <strong>{composition.name}</strong>
          <small>
            {composition.regions.length} interfaces · one LÉLU{conversation ? ` · chat: ${conversation.title}` : ""}
          </small>
        </div>
        <nav className="ij-jump" aria-label="Jump to an interface">
          {composition.regions.map((r) => (
            <button
              key={r.key}
              type="button"
              data-jump={r.interfaceId}
              data-on={r.key === current ? "true" : "false"}
              aria-current={r.key === current ? "true" : undefined}
              style={{ "--ij-accent": interfaceById(r.interfaceId)!.identity.accent } as CSSProperties}
              onClick={() => scrollTo(r.key)}
            >
              {bookmarked.has(r.key) ? "★ " : ""}
              {regionName(r)}
            </button>
          ))}
        </nav>
        <div className="ij-actions">
          <button type="button" aria-label="Talk to LÉLU (same chat)" title="Talk — the same conversation" onClick={() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))}>
            <HomeIcon name="MessageCircle" size={17} />
          </button>
          <button type="button" data-on={panel === "edit" ? "true" : "false"} aria-label="Edit this composition" title="Edit" onClick={() => setPanel(panel === "edit" ? null : "edit")}>
            <HomeIcon name="Pencil" size={17} />
          </button>
          <button
            type="button"
            aria-label="Make alternative compositions"
            title="Alternatives"
            data-on={panel === "variants" ? "true" : "false"}
            onClick={() => {
              setVariants(InterfaceCompositionStore.variants(composition.id, VARIANT_STYLES));
              setPanel("variants");
            }}
          >
            <HomeIcon name="Layers3" size={17} />
          </button>
          <button
            type="button"
            aria-label="Clone this composition"
            title="Clone"
            onClick={() => {
              const copy = InterfaceCompositionStore.clone(composition.id);
              if (copy) {
                InterfaceCompositionStore.open(copy.id, undefined);
                setNotice(`Cloned into “${copy.name}”. The original is unchanged.`);
              }
            }}
          >
            <HomeIcon name="Copy" size={17} />
          </button>
        </div>
      </header>

      <div className="ij-scroller" ref={scroller} data-ij-scroller>
        {composition.regions.map((r, i) => {
          const entry = interfaceById(r.interfaceId)!;
          const isLive = live.has(r.key);
          const isCosmos = r.interfaceId === "cosmos";
          return (
            <div key={r.key} className="ij-slot">
              <section
                className="ij-region"
                data-region-key={r.key}
                data-interface={r.interfaceId}
                data-live={isLive ? "true" : "false"}
                data-current={r.key === current ? "true" : "false"}
                data-size={r.size}
                style={{ "--ij-accent": entry.identity.accent, "--ij-bg": isCosmos ? "transparent" : entry.identity.background } as CSSProperties}
                aria-label={regionName(r)}
              >
                <div className="ij-region-bar">
                  <HomeIcon name={entry.icon} size={15} />
                  <strong>{regionName(r)}</strong>
                  <small>{entry.category}</small>
                  <span className="ij-region-tools">
                    {isCosmos ? (
                      <button type="button" data-ij-explore onClick={() => setExploring(!exploring)}>
                        {exploring ? "Back to scrolling" : "Explore the Cosmos"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={bookmarked.has(r.key) ? `Remove bookmark on ${regionName(r)}` : `Bookmark ${regionName(r)}`}
                      title="Bookmark"
                      onClick={() => edit(bookmarked.has(r.key) ? { op: "unbookmark", regionKey: r.key } : { op: "bookmark", regionKey: r.key, name: regionName(r) })}
                    >
                      <HomeIcon name="Pin" size={14} />
                    </button>
                    {r.interfaceId === "neural-map" ? null : (
                      <button type="button" data-neural-of={r.interfaceId} aria-label={`${regionName(r)} in the Neural Map`} title="In the Neural Map" onClick={() => NeuralView.inspect(`interface:${r.interfaceId}`)}>
                        <HomeIcon name="Workflow" size={14} />
                      </button>
                    )}
                    <button type="button" data-open-alone={r.interfaceId} aria-label={`Open ${regionName(r)} on its own`} title="Open on its own" onClick={() => openInterface(genesis, r.interfaceId, navigate)}>
                      <HomeIcon name="Maximize2" size={14} />
                    </button>
                  </span>
                </div>
                <div className="ij-region-body" data-contain>
                  {isLive ? <InterfaceRegion interfaceId={r.interfaceId} onLeave={() => closeComposition()} onGo={go} exploringCosmos={exploring} /> : <RegionPreview region={r} />}
                </div>
              </section>
              {i < composition.regions.length - 1 ? <Seam from={r} to={composition.regions[i + 1]} seam={composition.seam} onEnter={() => scrollTo(composition.regions[i + 1].key)} /> : null}
            </div>
          );
        })}
        <div className="ij-end">
          <p>End of “{composition.name}”.</p>
          <button type="button" onClick={() => setPanel("edit")}>
            <HomeIcon name="Plus" size={14} /> Add another interface
          </button>
          <button type="button" onClick={() => composition.regions[0] && scrollTo(composition.regions[0].key)}>
            Back to the start
          </button>
        </div>
      </div>

      {panel === "edit" ? <EditDrawer composition={composition} onClose={() => setPanel(null)} onEdit={edit} /> : null}
      {panel === "variants" ? <VariantsPanel source={composition} made={variants} onClose={() => setPanel(null)} /> : null}
      {notice ? (
        <div className="ij-notice" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
