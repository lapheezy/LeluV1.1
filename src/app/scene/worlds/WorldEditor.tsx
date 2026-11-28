/**
 * ==========================================================
 * LÉLU — WORLD EDITOR (WP21 · WP05)
 *
 * Every control changes the rendered world immediately (it edits the saved
 * world through WorldStore; the stage re-renders from it). No decorative
 * controls: each one maps to a layer field, a world field, or a store
 * operation (save/duplicate/rename/reset/combine/export/import/delete).
 * ==========================================================
 */

import { useRef, useState, useSyncExternalStore } from "react";
import { allFamilies } from "../../../core/worlds/ThemeFamilies";
import { PLACES, placeWorld } from "../../../core/worlds/Places";
import { SLOTS, type LayerSlot, type Quality, type RenderMode, type WorldConfig, type WorldLayer } from "../../../core/worlds/WorldSchema";
import { activate, activeWorld, addWorld, applyEdit, combineInto, createWorld, deleteWorld, duplicateWorld, exportWorld, importWorld, renameWorld, resetWorld, savedWorlds, subscribeWorlds } from "../../../core/worlds/WorldStore";

const SLOT_LABEL: Record<LayerSlot, string> = { foundation: "Environment", atmosphere: "Atmosphere", objects3d: "3D objects", graphics2d: "2D graphics", spatialUI: "Panel frames", motion: "Motion" };

export function useActiveWorld(): WorldConfig | null {
  return useSyncExternalStore(subscribeWorlds, activeWorld, activeWorld);
}

export interface Compare {
  placeId: string;
  a: string;
  b: string;
  split: number;
}

function LayerRow({ world, l }: { world: WorldConfig; l: WorldLayer }) {
  const set = (changes: Parameters<typeof applyEdit>[1] extends infer E ? (E extends { op: "set"; changes: infer C } ? C : never) : never) => applyEdit(world.id, { op: "set", id: l.id, changes });
  const count = typeof l.params.count === "number" ? (l.params.count as number) : null;
  const color = typeof l.params.color === "string" && /^#[0-9a-f]{6}$/i.test(l.params.color as string) ? (l.params.color as string) : null;
  return (
    <div className="we-layer" data-enabled={l.enabled ? "true" : "false"} data-world-layer={l.id}>
      <input type="checkbox" checked={l.enabled} onChange={() => applyEdit(world.id, { op: "toggle", id: l.id })} aria-label={`Show ${l.label}`} data-layer-toggle={l.id} />
      <span>{l.label}</span>
      <button type="button" className="we-x" onClick={() => applyEdit(world.id, { op: "remove", id: l.id })} title="Remove layer" aria-label={`Remove ${l.label}`}>
        ✕
      </button>
      <small>
        {l.kind} · {l.family}
      </small>
      {l.slot !== "motion" && l.slot !== "spatialUI" ? <input type="range" min={0} max={1} step={0.05} value={l.opacity} onChange={(e) => set({ opacity: +e.target.value })} aria-label={`${l.label} opacity`} data-layer-opacity={l.id} /> : null}
      {count !== null ? <input type="range" min={0} max={Math.max(100, count * 2)} step={10} value={count} onChange={(e) => set({ params: { count: +e.target.value } })} aria-label={`${l.label} amount`} data-layer-count={l.id} /> : null}
      {color ? (
        <label>
          <small>colour</small>
          <input type="color" value={color} onChange={(e) => set({ params: { color: e.target.value } })} aria-label={`${l.label} colour`} data-layer-color={l.id} />
        </label>
      ) : null}
      {l.slot === "motion" ? (
        <>
          <input type="range" min={0} max={3} step={0.1} value={Number(l.params.wind ?? 0.5)} onChange={(e) => set({ params: { wind: +e.target.value } })} aria-label="Wind" />
          <input type="range" min={0} max={2} step={0.1} value={Number(l.params.parallax ?? 0.5)} onChange={(e) => set({ params: { parallax: +e.target.value } })} aria-label="Camera drift" />
        </>
      ) : null}
    </div>
  );
}

export default function WorldEditor({ onClose, compare, setCompare }: { onClose: () => void; compare: Compare | null; setCompare: (c: Compare | null) => void }) {
  const world = useActiveWorld();
  const saved = useSyncExternalStore(subscribeWorlds, savedWorlds, savedWorlds);
  const [placeId, setPlaceId] = useState("tampa");
  const [msg, setMsg] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const fams = allFamilies();
  const pl = PLACES.find((p) => p.id === placeId)!;

  const pickFamily = (id: string) => {
    if (!world) createWorld([id]);
    else if (world.families.includes(id)) setMsg(`${id} is already in this world`);
    else combineInto(world.id, id);
  };

  return (
    <aside className="we" data-world-editor aria-label="World editor">
      <h3>
        <span>World</span>
        <button type="button" onClick={onClose} aria-label="Close world editor">
          ✕
        </button>
      </h3>
      <div className="we-scroll">
        <section>
          <b>Saved worlds</b>
          <div className="we-tools">
            <select value={world?.id ?? ""} onChange={(e) => activate(e.target.value || null)} data-world-picker aria-label="Active world">
              <option value="">None (thread's own look)</option>
              {saved.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {world ? <input type="text" value={world.name} onChange={(e) => renameWorld(world.id, e.target.value)} aria-label="World name" data-world-name /> : null}
        </section>

        <section>
          <b>{world ? "Combine another family" : "Start from a family"}</b>
          <div className="we-fams">
            {fams.map((f) => (
              <button key={f.id} type="button" data-family={f.id} data-on={world?.families[0] === f.id ? "true" : "false"} data-in={world?.families.includes(f.id) ? "true" : "false"} title={`${f.description}${f.care ? `\n${f.care}` : ""}`} onClick={() => pickFamily(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {world ? (
            <div className="we-tools">
              <select value="" onChange={(e) => e.target.value && createWorld([e.target.value])} aria-label="New world from family" data-new-world>
                <option value="">New world from…</option>
                {fams.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </section>

        <section className="we-place">
          <b>Time &amp; Place</b>
          <div className="we-tools">
            <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} aria-label="Place" data-place-picker>
              {PLACES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="we-fams">
            {pl.eras.map((e) => (
              <button key={e.id} type="button" data-era={e.id} data-on={world?.id.startsWith(`place-${pl.id}-${e.id}`) ? "true" : "false"} onClick={() => addWorld(placeWorld(pl.id, e.id, Date.now())!)}>
                {e.label}
              </button>
            ))}
          </div>
          {pl.eras.length > 1 ? (
            <div className="we-tools">
              <button type="button" data-compare-toggle onClick={() => setCompare(compare ? null : { placeId: pl.id, a: pl.eras[0].id, b: pl.eras[pl.eras.length - 2]?.id ?? pl.eras[1].id, split: 0.5 })}>
                {compare ? "End comparison" : "Compare two eras"}
              </button>
              {compare ? (
                <>
                  <select value={compare.a} onChange={(e) => setCompare({ ...compare, a: e.target.value })} aria-label="Left era">
                    {pl.eras.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                  <select value={compare.b} onChange={(e) => setCompare({ ...compare, b: e.target.value })} aria-label="Right era">
                    {pl.eras.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
          ) : null}
          {world?.place ? (
            <ol data-place-sources>
              {world.place.sources.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
        </section>

        {world ? (
          <>
            <section>
              <b>Rendering</b>
              <div className="we-row">
                <span>Mode</span>
                <select value={world.mode} onChange={(e) => applyEdit(world.id, { op: "world", changes: { mode: e.target.value as RenderMode } })} data-world-mode-picker aria-label="Render mode">
                  <option value="combined">2D + 3D</option>
                  <option value="3d">3D only</option>
                  <option value="2d">2D only</option>
                </select>
                <span>Quality</span>
                <select value={world.quality} onChange={(e) => applyEdit(world.id, { op: "world", changes: { quality: e.target.value as Quality } })} data-world-quality-picker aria-label="Quality">
                  <option value="auto">Automatic</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <span>Motion</span>
                <input type="range" min={0} max={2} step={0.1} value={world.motion} onChange={(e) => applyEdit(world.id, { op: "world", changes: { motion: +e.target.value } })} aria-label="Motion" data-world-motion />
                <span>Density</span>
                <input type="range" min={0.1} max={2} step={0.1} value={world.density} onChange={(e) => applyEdit(world.id, { op: "world", changes: { density: +e.target.value } })} aria-label="Density" data-world-density />
                <span>Orbit</span>
                <input type="checkbox" checked={world.camera.auto} onChange={(e) => applyEdit(world.id, { op: "world", changes: { camera: { auto: e.target.checked } } })} aria-label="Camera drifts" />
                <span>Accent</span>
                <input type="color" value={world.palette.accent} onChange={(e) => applyEdit(world.id, { op: "world", changes: { palette: { accent: e.target.value } } })} aria-label="Accent colour" />
                <span>Glow</span>
                <input type="color" value={world.palette.glow} onChange={(e) => applyEdit(world.id, { op: "world", changes: { palette: { glow: e.target.value } } })} aria-label="Glow colour" />
              </div>
            </section>
            {SLOTS.map((slot) => {
              const ls = world.layers.filter((l) => l.slot === slot);
              return ls.length ? (
                <section key={slot} data-slot={slot}>
                  <b>{SLOT_LABEL[slot]}</b>
                  {ls.map((l) => (
                    <LayerRow key={l.id} world={world} l={l} />
                  ))}
                </section>
              ) : null;
            })}
            <section>
              <b>This world</b>
              <div className="we-tools">
                <button type="button" onClick={() => duplicateWorld(world.id)} data-world-duplicate>
                  Duplicate
                </button>
                <button type="button" onClick={() => resetWorld(world.id)} data-world-reset>
                  Reset layers
                </button>
                <button
                  type="button"
                  data-world-export
                  onClick={() => {
                    const json = exportWorld(world.id);
                    if (!json) return;
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
                    a.download = `${world.id}.lelu-world.json`;
                    a.click();
                    setMsg("Exported");
                  }}
                >
                  Export
                </button>
                <button type="button" onClick={() => file.current?.click()} data-world-import>
                  Import
                </button>
                <button type="button" onClick={() => deleteWorld(world.id)} data-world-delete>
                  Delete
                </button>
                <button type="button" onClick={() => activate(null)} data-world-off>
                  Turn off
                </button>
              </div>
            </section>
          </>
        ) : (
          <p className="we-hint">Pick a family to build a world behind this thread, or a place and an era. Everything you change is saved and comes back after a reload.</p>
        )}
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = importWorld(await f.text());
            setMsg(r.world ? `Imported ${r.world.name}${r.issues.length ? ` (${r.issues.length} fixed)` : ""}` : `Not imported: ${r.issues.join(", ")}`);
          }}
        />
        {msg ? <p className="we-hint" role="status">{msg}</p> : null}
      </div>
    </aside>
  );
}
