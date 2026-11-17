/**
 * LÉLU — Spatial Studio · Creation workspace.
 *
 * A persistent character (server: plugins/asreCharacters.ts). Controls build
 * a patch; "Preview impact" asks the server which components the patch would
 * rebuild, recolour or keep — and why — before anything is built; "Apply"
 * makes a new immutable version. History supports undo, redo, checkout
 * (branch), full or partial restore, comparison and Forge export.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import AsreClient, { type CharacterHistory } from "../../../../core/asre/AsreClient";
import type { CharacterVersion, ComponentImpact, RestorableGroup, SpecPatch } from "../../../../core/asre/character/identity";
import { HAIR_STYLES, type CharacterSpec } from "../../../../core/asre/character/CharacterSpec";
import LeluCharacterStore from "../../../../core/avatar/LeluCharacterStore";
import { Btn, ErrorLine, Field, Section, input, ms, text, type RenderTarget } from "./spatialUi";
import SpatialViewer from "./SpatialViewer";

const TOPS = ["none", "tank", "tshirt", "longsleeve", "jacket"];
const BOTTOMS = ["none", "shorts", "pants", "skirt"];
const POSES = ["relaxed", "a-pose", "t-pose", "wave", "stride"];
const HEAD_ACC = ["glasses", "hat", "earrings"] as const;
const BODY_ACC = ["necklace", "backpack"] as const;
const SLIDERS: Array<[keyof CharacterSpec["body"], number, number, number]> = [["height", 1.4, 2.0, 0.01], ["shoulderWidth", 0.32, 0.52, 0.005], ["hipWidth", 0.28, 0.44, 0.005], ["build", 0.8, 1.3, 0.01], ["legRatio", 0.44, 0.52, 0.002]];
const MATERIALS = ["skin", "hair", "top", "bottom", "shoes", "accessory", "eyes"] as const;
const GROUPS: RestorableGroup[] = ["hair", "clothing", "body", "face", "accessories", "materials", "pose"];

const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => +(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)) as [number, number, number];

/** The patch that turns `a` into `b` (only the groups that differ). */
function patchBetween(a: CharacterSpec, b: CharacterSpec): SpecPatch {
  const p: SpecPatch = {};
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(a.body, b.body)) p.body = b.body;
  if (!same(a.face, b.face)) p.face = b.face;
  if (!same(a.hair, b.hair)) p.hair = b.hair;
  if (!same(a.clothing, b.clothing)) p.clothing = b.clothing;
  if (!same(a.accessories, b.accessories)) p.accessories = b.accessories;
  const m = Object.fromEntries(MATERIALS.filter((k) => !same(a.materials[k], b.materials[k])).map((k) => [k, b.materials[k]]));
  if (Object.keys(m).length) p.materials = m as SpecPatch["materials"];
  if (a.pose !== b.pose) p.pose = b.pose;
  return p;
}

export default function CreationWorkspace({ onRender }: { onRender: (t: RenderTarget) => void }) {
  const [list, setList] = useState<string[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [hist, setHist] = useState<CharacterHistory | null>(null);
  const [head, setHead] = useState<CharacterVersion | null>(null);
  const [draft, setDraft] = useState<CharacterSpec | null>(null);
  const [impact, setImpact] = useState<ComponentImpact[] | null>(null);
  const [newId, setNewId] = useState("lelu");
  const [compareWith, setCompareWith] = useState<string>("");
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof AsreClient.compare>>["comparison"] | null>(null);
  const [restoreGroup, setRestoreGroup] = useState<RestorableGroup | "all">("hair");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(() => LeluCharacterStore.getInstance().get().asre);

  const load = useCallback(async (cid: string) => {
    const h = await AsreClient.history(cid);
    setHist(h);
    const v = (await AsreClient.version(cid, h.character.head)).version;
    setHead(v);
    setDraft(structuredClone(v.spec));
    setImpact(null);
  }, []);
  useEffect(() => {
    AsreClient.characters()
      .then((r) => {
        setList(r.characters.map((c) => c.id));
        if (r.characters[0]) {
          setId(r.characters[0].id);
          void load(r.characters[0].id);
        }
      })
      .catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => LeluCharacterStore.getInstance().subscribe((s) => setLinked(s.asre)), []);

  /** Run an action, then reload `reload` (explicit, so a stale closure can never skip it). */
  const act = async (label: string, fn: () => Promise<unknown>, reload: string | null = id) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      if (reload) await load(reload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const patch = useMemo(() => (head && draft ? patchBetween(head.spec, draft) : {}), [head, draft]);
  const dirty = Object.keys(patch).length > 0;
  const set = (fn: (d: CharacterSpec) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const n = structuredClone(d);
      fn(n);
      return n;
    });
    setImpact(null);
  };

  if (!id || !hist || !head || !draft) {
    return (
      <Section title="Characters" id="characters">
        <p style={{ margin: 0, fontSize: 12, color: text.dim }}>{list.length ? "Loading…" : "No persistent character yet. Create one: its identity stays fixed while its components change."}</p>
        <div style={{ display: "flex", gap: 6 }}>
          <input data-spatial-new-character style={input} value={newId} onChange={(e) => setNewId(e.target.value.toLowerCase())} />
          <Btn kind="primary" data="create-character" disabled={!!busy} onClick={() => act("create", async () => { await AsreClient.createCharacter(newId, newId === "lelu" ? "LÉLU" : newId, "gothic"); setList((l) => [...l, newId]); setId(newId); }, newId)}>
            Create character
          </Btn>
        </div>
        <ErrorLine error={error} />
      </Section>
    );
  }

  const isLinked = linked?.characterId === id && linked.version === head.id;
  return (
    <div data-spatial-workspace="creation" style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <Section title="Character" aside={`${hist.character.name} · head ${head.id}`} id="character">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select style={input} value={id} onChange={(e) => { setId(e.target.value); void load(e.target.value); }}>
              {list.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <Btn data="link-lelu" kind={isLinked ? "primary" : "normal"} onClick={() => LeluCharacterStore.getInstance().setAsreCharacter({ characterId: id, version: head.id })}>
              {isLinked ? "LÉLU's character ✓" : "Use as LÉLU's character"}
            </Btn>
          </div>
          <Field label="hairstyle">
            <select data-spatial-hair style={input} value={draft.hair.style} onChange={(e) => set((d) => void (d.hair.style = e.target.value as never))}>
              {[...HAIR_STYLES, "none"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Field label={`hair length ${draft.hair.length.toFixed(2)}`}>
              <input type="range" min={0.5} max={1.5} step={0.05} value={draft.hair.length} onChange={(e) => set((d) => void (d.hair.length = Number(e.target.value)))} />
            </Field>
            <Field label={`hair volume ${draft.hair.volume.toFixed(2)}`}>
              <input type="range" min={0.7} max={1.4} step={0.05} value={draft.hair.volume} onChange={(e) => set((d) => void (d.hair.volume = Number(e.target.value)))} />
            </Field>
            <Field label="top">
              <select data-spatial-top style={input} value={draft.clothing.top} onChange={(e) => set((d) => void (d.clothing.top = e.target.value as never))}>
                {TOPS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="bottom">
              <select data-spatial-bottom style={input} value={draft.clothing.bottom} onChange={(e) => set((d) => void (d.clothing.bottom = e.target.value as never))}>
                {BOTTOMS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="pose">
              <select data-spatial-pose style={input} value={draft.pose} onChange={(e) => set((d) => void (d.pose = e.target.value as never))}>
                {POSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="shoes">
              <select style={input} value={draft.clothing.shoes ? "yes" : "no"} onChange={(e) => set((d) => void (d.clothing.shoes = e.target.value === "yes"))}>
                <option>yes</option>
                <option>no</option>
              </select>
            </Field>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 12, color: text.body }}>
            {HEAD_ACC.map((a) => (
              <label key={a}>
                <input type="checkbox" checked={draft.accessories.head.includes(a)} onChange={(e) => set((d) => void (d.accessories.head = e.target.checked ? [...d.accessories.head, a] : d.accessories.head.filter((x) => x !== a)))} /> {a}
              </label>
            ))}
            {BODY_ACC.map((a) => (
              <label key={a}>
                <input type="checkbox" checked={draft.accessories.body.includes(a)} onChange={(e) => set((d) => void (d.accessories.body = e.target.checked ? [...d.accessories.body, a] : d.accessories.body.filter((x) => x !== a)))} /> {a}
              </label>
            ))}
          </div>
          {SLIDERS.map(([k, lo, hi, step]) => (
            <Field key={k} label={`${k} ${draft.body[k].toFixed(3)}`}>
              <input data-spatial-body={k} type="range" min={lo} max={hi} step={step} value={draft.body[k]} onChange={(e) => set((d) => void (d.body[k] = Number(e.target.value)))} />
            </Field>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MATERIALS.map((k) => (
              <label key={k} style={{ fontSize: 11, color: text.dim, display: "flex", alignItems: "center", gap: 3 }}>
                <input data-spatial-material={k} type="color" value={hex(draft.materials[k])} onChange={(e) => set((d) => void (d.materials[k] = rgb(e.target.value)))} /> {k}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn data="impact" disabled={!dirty || !!busy} onClick={() => act("impact", async () => setImpact((await AsreClient.impact(id, patch)).impact), null)}>
              Preview impact
            </Btn>
            <Btn kind="primary" data="apply" disabled={!dirty || !!busy} onClick={() => act("apply", () => AsreClient.edit(id, patch))}>
              {busy === "apply" ? "Building…" : "Apply → new version"}
            </Btn>
            <Btn data="discard" disabled={!dirty} onClick={() => { setDraft(structuredClone(head.spec)); setImpact(null); }}>
              Discard
            </Btn>
          </div>
          {impact ? (
            <ul data-spatial-impact style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: text.body }}>
              {impact.filter((c) => c.action !== "keep").map((c) => (
                <li key={c.id}>
                  <b style={{ color: c.action === "rebuild" ? text.warn : text.good }}>{c.action}</b> {c.id} — {c.reason}
                </li>
              ))}
              <li style={{ color: text.dim }}>keep {impact.filter((c) => c.action === "keep").length} components unchanged</li>
            </ul>
          ) : null}
          <ErrorLine error={error} />
        </Section>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <Section title={`Version ${head.id}`} aside={`${head.label} · built in ${ms(head.build.ms)} · rebuilt ${head.build.regenerated.length}, recoloured ${head.build.recolored.length}, reused ${head.build.reused.length}`} id="head">
          <SpatialViewer url={AsreClient.characterGlbUrl(id, head.id)} height={320} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn data="undo" disabled={!head.parentId || !!busy} onClick={() => act("undo", () => AsreClient.undo(id))}>Undo</Btn>
            <Btn data="redo" disabled={!hist.character.redo.length || !!busy} onClick={() => act("redo", () => AsreClient.redo(id))}>Redo</Btn>
            <Btn data="render-head" onClick={() => onRender({ url: AsreClient.characterGlbUrl(id, head.id), label: `${id} ${head.id}`, forgeJobId: hist.character.exports[head.id] ?? null })}>Open in Render</Btn>
            <Btn kind="primary" data="export-head" disabled={!!busy} onClick={() => act("export", () => AsreClient.exportCharacter(id, head.id))}>
              {hist.character.exports[head.id] ? `In the Forge (${hist.character.exports[head.id]})` : "Export to the Forge"}
            </Btn>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: text.dim }}>Every cell of a procedural character is GENERATED: nothing about it was observed.</p>
        </Section>
        <Section title="History" aside={`${hist.versions.length} versions`} id="history">
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            <table style={{ fontSize: 12, color: text.body, width: "100%" }}>
              <tbody>
                {[...hist.versions].reverse().map((v) => (
                  <tr key={v.id} data-spatial-version={v.id} data-head={v.isHead ? "true" : "false"} style={{ background: v.isHead ? "rgba(167,139,250,0.12)" : undefined }}>
                    <td>{v.isHead ? "▶ " : ""}{v.id}</td>
                    <td style={{ color: text.dim }}>{v.parentId ?? "—"}</td>
                    <td>{v.label}</td>
                    <td style={{ color: text.dim }}>{v.regenerated.length ? `rebuilt ${v.regenerated.join(", ")}` : `rebuilt nothing`} · {ms(v.buildMs)}</td>
                    <td>{!v.isHead ? <Btn data={`checkout-${v.id}`} onClick={() => act("checkout", () => AsreClient.checkout(id, v.id))}>checkout</Btn> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap" }}>
            <Field label="other version">
              <select data-spatial-other style={input} value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
                <option value="">—</option>
                {hist.versions.filter((v) => v.id !== head.id).map((v) => (
                  <option key={v.id} value={v.id}>{v.id} {v.label}</option>
                ))}
              </select>
            </Field>
            <Field label="restore">
              <select style={input} value={restoreGroup} onChange={(e) => setRestoreGroup(e.target.value as never)}>
                <option value="all">everything</option>
                {GROUPS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
            <Btn data="restore" disabled={!compareWith || !!busy} onClick={() => act("restore", () => AsreClient.restore(id, compareWith, restoreGroup === "all" ? undefined : [restoreGroup]))}>Restore onto head</Btn>
            <Btn data="compare" disabled={!compareWith || !!busy} onClick={() => act("compare", async () => setComparison((await AsreClient.compare(id, compareWith, head.id)).comparison), null)}>Compare with head</Btn>
          </div>
          {comparison ? (
            <div data-spatial-comparison style={{ fontSize: 12, color: text.body }}>
              <p style={{ margin: "4px 0" }}>
                Voxel IoU {comparison.geometry.iou.toFixed(3)} ({comparison.geometry.change}): +{comparison.geometry.added.toLocaleString()} / −{comparison.geometry.removed.toLocaleString()} cells · triangles {comparison.triangles.a.toLocaleString()} → {comparison.triangles.b.toLocaleString()}. Spec changes: {comparison.specChanges.join(", ") || "none"}.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {comparison.components.map((c) => (
                  <span key={c.id} data-component-change={c.change} style={{ padding: "2px 6px", borderRadius: 6, fontSize: 11, background: c.change === "same" ? "rgba(74,222,128,0.12)" : c.change === "moved" || c.change === "material-only" ? "rgba(96,165,250,0.15)" : "rgba(245,158,11,0.18)" }}>
                    {c.id}: {c.change}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
