/**
 * LÉLU — Spatial Studio · Rendering workspace.
 *
 * Shows any ASRE GLB — a reconstruction, a hypothesis, a character version
 * or a Forge asset — in the interactive viewer, and drives the EXISTING
 * Forge for it: geometric edits (new version), Cosmos placement and the
 * Forge's own Blender export gate. Exported files are linked from the
 * Forge's asset route.
 */
import { useCallback, useEffect, useState } from "react";
import AsreClient, { type ForgeAsset } from "../../../../core/asre/AsreClient";
import { Btn, ErrorLine, EvidenceBar, Field, Section, input, text, type RenderTarget } from "./spatialUi";
import SpatialViewer from "./SpatialViewer";

const FORMATS = ["glb", "obj", "stl", "fbx", "blend"] as const;

export default function RenderWorkspace({ target, onTarget }: { target: RenderTarget | null; onTarget: (t: RenderTarget) => void }) {
  const [assets, setAssets] = useState<ForgeAsset[]>([]);
  const [history, setHistory] = useState<ForgeAsset[]>([]);
  const [formats, setFormats] = useState<string[]>(["glb", "obj", "stl"]);
  const [edit, setEdit] = useState({ scale: 1, rotateDeg: 0, ground: true, center: true, tint: "#ffffff" });
  const [exported, setExported] = useState<ForgeAsset | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => AsreClient.forgeAssets().then((r) => setAssets(r.assets)).catch((e) => setError(e.message)), []);
  useEffect(() => void refresh(), [refresh]);
  const forgeId = target?.forgeJobId ?? null;
  useEffect(() => {
    setExported(null);
    if (forgeId) AsreClient.forgeHistory(forgeId).then((r) => setHistory(r.history)).catch(() => setHistory([]));
    else setHistory([]);
  }, [forgeId]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (a: ForgeAsset) => {
    const model = a.output?.files.find((f) => f.role === "model");
    if (model) onTarget({ url: AsreClient.forgeAssetUrl(model.file), label: a.purpose, forgeJobId: a.id, evidence: ((a.request.provenance as { evidence?: unknown } | undefined)?.evidence as RenderTarget["evidence"]) ?? null });
  };
  const evidence = target?.evidence && typeof target.evidence === "object" ? target.evidence : null;

  return (
    <div data-spatial-workspace="render" style={{ display: "grid", gridTemplateColumns: "1fr minmax(260px, 330px)", gap: 10 }}>
      <Section title={target ? target.label : "Preview"} aside={forgeId ? `Forge job ${forgeId}` : target ? "not yet in the Forge" : ""} id="viewer">
        {target ? <SpatialViewer url={target.url} height={440} /> : <p style={{ margin: 0, color: text.dim, fontSize: 12 }}>Open a reconstruction, a hypothesis, a character version or a Forge asset.</p>}
        {evidence ? <EvidenceBar evidence={evidence} /> : null}
        {target ? (
          <a href={target.url} download style={{ fontSize: 12, color: "#c4b5fd" }} data-spatial-download>
            Download this GLB
          </a>
        ) : null}
      </Section>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <Section title="Forge" aside={`${assets.length} ASRE assets`} id="forge">
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 170, overflow: "auto" }}>
            {assets.map((a) => (
              <button key={a.id} type="button" data-spatial-forge-asset={a.id} onClick={() => open(a)} style={{ textAlign: "left", fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.07)", background: a.id === forgeId ? "rgba(167,139,250,0.15)" : "transparent", color: a.status === "SUCCEEDED" ? text.body : text.bad, fontFamily: "inherit", cursor: "pointer" }}>
                {a.id} · {a.purpose.slice(0, 70)} {a.status !== "SUCCEEDED" ? `(${a.status})` : ""}
              </button>
            ))}
          </div>
          <Field label="import a GLB into the Forge (inspected first)">
            <input
              data-spatial-import
              type="file"
              accept=".glb,model/gltf-binary"
              style={input}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void act(async () => {
                    const buf = new Uint8Array(await f.arrayBuffer());
                    let s = "";
                    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                    const { job } = await AsreClient.forgeImport(f.name, btoa(s));
                    open(job);
                  });
              }}
            />
          </Field>
        </Section>
        {forgeId ? (
          <>
            <Section title="Edit → new version" id="edit">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <Field label="scale">
                  <input style={input} type="number" step={0.1} min={0.01} value={edit.scale} onChange={(e) => setEdit({ ...edit, scale: Number(e.target.value) })} />
                </Field>
                <Field label="rotate Y°">
                  <input style={input} type="number" step={15} value={edit.rotateDeg} onChange={(e) => setEdit({ ...edit, rotateDeg: Number(e.target.value) })} />
                </Field>
                <Field label="tint">
                  <input type="color" value={edit.tint} onChange={(e) => setEdit({ ...edit, tint: e.target.value })} />
                </Field>
                <div style={{ fontSize: 12, color: text.body, display: "flex", flexDirection: "column" }}>
                  <label><input type="checkbox" checked={edit.ground} onChange={(e) => setEdit({ ...edit, ground: e.target.checked })} /> stand on floor</label>
                  <label><input type="checkbox" checked={edit.center} onChange={(e) => setEdit({ ...edit, center: e.target.checked })} /> centre</label>
                </div>
              </div>
              <Btn
                kind="primary"
                data="forge-edit"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const t = [1, 3, 5].map((i) => parseInt(edit.tint.slice(i, i + 2), 16) / 255);
                    const { job } = await AsreClient.forgeEdit(forgeId, { scale: edit.scale, rotateY: (edit.rotateDeg * Math.PI) / 180, ground: edit.ground, center: edit.center, ...(edit.tint !== "#ffffff" ? { tint: t } : {}) });
                    open(job);
                    setNote(`New version ${job.id}; the previous one is unchanged.`);
                  })
                }
              >
                Apply edit
              </Btn>
              {history.length > 1 ? <p style={{ margin: 0, fontSize: 11, color: text.dim }}>versions: {history.map((h) => h.id).join(" → ")}</p> : null}
            </Section>
            <Section title="Export & place" id="export">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 12, color: text.body }}>
                {FORMATS.map((f) => (
                  <label key={f}>
                    <input type="checkbox" checked={formats.includes(f)} onChange={(e) => setFormats((x) => (e.target.checked ? [...x, f] : x.filter((y) => y !== f)))} /> {f}
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Btn kind="primary" data="forge-export" disabled={busy || !formats.length} onClick={() => act(async () => setExported((await AsreClient.forgeExport(forgeId, formats)).job))}>
                  {busy ? "Working…" : "Export with Blender"}
                </Btn>
                <Btn data="forge-place" disabled={busy} onClick={() => act(async () => setNote(`Placed in the Cosmos as ${(await AsreClient.forgePlace(forgeId, target?.label ?? "ASRE asset")).placement.id}.`))}>
                  Place in the Cosmos
                </Btn>
              </div>
              {exported ? (
                <ul data-spatial-exported style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                  {exported.output?.files.map((f) => (
                    <li key={f.file}>
                      <a href={AsreClient.forgeAssetUrl(f.file)} download style={{ color: "#c4b5fd" }}>{f.file.split("/").pop()}</a> <span style={{ color: text.dim }}>({f.role}, {(f.bytes / 1024).toFixed(0)} KB)</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {note ? <p style={{ margin: 0, fontSize: 12, color: text.good }}>{note}</p> : null}
            </Section>
          </>
        ) : null}
        <ErrorLine error={error} />
      </div>
    </div>
  );
}
