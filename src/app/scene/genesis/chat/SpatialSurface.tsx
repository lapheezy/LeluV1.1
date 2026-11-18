/**
 * ==========================================================
 * LÉLU — A SPATIAL SURFACE IN THE CONVERSATION (Mission 5.7)
 *
 * This is where spatial work happens now. It sits in the thread, under the
 * reply it belongs to, and shows the SAME workspaces the standalone studio
 * shows — imported, not copied:
 *
 *   model       the GLB three.js opened (SpatialViewer)
 *   numerical   voxel planes, evidence, confidence (NumericalWorkspace)
 *   create      the persistent character and its versions (CreationWorkspace)
 *   render      Forge edit / export / placement (RenderWorkspace)
 *
 * Nothing here invents state: the job, the evidence counts and the character
 * come from /api/asre exactly as they do for the studio, and a surface only
 * appears because a tool or a control summoned it.
 * ==========================================================
 */
import { lazy, Suspense, useEffect, useSyncExternalStore, useState } from "react";
import { Box, ChevronDown, History, Loader2, Scan, SlidersHorizontal, X } from "lucide-react";
import AsreClient from "../../../../core/asre/AsreClient";
import type { AsreJobView } from "../../../../core/asre/contracts";
import {
  describeSummon,
  dismissSpatial,
  summonsFor,
  subscribeSpatial,
  summonTab,
  type SpatialSummon,
  type SpatialTab,
} from "../../../../core/asre/SpatialSummon";
import { EvidenceBar, text } from "../spatial/spatialUi";

const SpatialViewer = lazy(() => import("../spatial/SpatialViewer"));
const NumericalWorkspace = lazy(() => import("../spatial/NumericalWorkspace"));
const CreationWorkspace = lazy(() => import("../spatial/CreationWorkspace"));
const RenderWorkspace = lazy(() => import("../spatial/RenderWorkspace"));

const TABS: Array<{ key: SpatialTab; label: string; icon: typeof Box }> = [
  { key: "model", label: "3D", icon: Box },
  { key: "numerical", label: "Numerical", icon: Scan },
  { key: "create", label: "Create", icon: SlidersHorizontal },
  { key: "render", label: "Render / export", icon: History },
];

function Wait({ label }: { label: string }) {
  return (
    <p style={{ margin: 0, display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: text.dim }} role="status">
      <Loader2 size={13} className="lelu-spin" aria-hidden /> {label}
    </p>
  );
}

/** A reconstruction's own numbers, read from the job — never re-derived here. */
function useJob(jobId: string | undefined) {
  const [job, setJob] = useState<AsreJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { job: next } = await AsreClient.job(jobId);
        if (!alive) return;
        setJob(next);
        if (next.state === "queued" || next.state === "running") timer = setTimeout(tick, 600);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);
  return { job, error };
}

function Surface({ summon }: { summon: SpatialSummon }) {
  const { job } = useJob(summon.jobId);
  const glbUrl = summon.glbUrl ?? (job?.result?.files.glb ? AsreClient.assetUrl(job.result.files.glb) : undefined);
  const result = job?.state === "succeeded" ? job.result ?? null : null;
  const [target, setTarget] = useState<{ url: string; label: string; forgeJobId?: string | null } | null>(null);

  return (
    <section
      data-spatial-surface={summon.tab}
      data-spatial-surface-id={summon.id}
      data-spatial-source={summon.source}
      aria-label={`Spatial — ${summon.title}`}
      style={{
        border: "1px solid rgba(167,139,250,0.28)",
        borderRadius: 14,
        background: "linear-gradient(180deg, rgba(38,26,74,0.55), rgba(14,10,28,0.62))",
        padding: 12,
        margin: "10px 0 0",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        textAlign: "left",
        maxWidth: 760,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#d4c8ff" }}>
          <Box size={14} aria-hidden /> {summon.title}
        </span>
        <span style={{ fontSize: 11, color: text.dim }}>{describeSummon(summon)}{summon.note ? ` · ${summon.note}` : ""}</span>
        <button
          type="button"
          data-spatial-dismiss
          onClick={() => dismissSpatial(summon.id)}
          aria-label="Close this spatial surface"
          style={{ marginLeft: "auto", background: "transparent", border: 0, color: text.dim, cursor: "pointer", display: "inline-flex" }}
        >
          <X size={14} />
        </button>
      </header>

      <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="Spatial capabilities">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            data-spatial-surface-tab={t.key}
            aria-pressed={summon.tab === t.key}
            onClick={() => summonTab(summon.id, t.key)}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontFamily: "inherit",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              border: summon.tab === t.key ? "1px solid rgba(34,211,238,0.5)" : "1px solid rgba(255,255,255,0.08)",
              background: summon.tab === t.key ? "rgba(34,211,238,0.12)" : "transparent",
              color: summon.tab === t.key ? "#a5f3fc" : "rgba(203,228,255,0.6)",
            }}
          >
            <t.icon size={12} aria-hidden /> {t.label}
          </button>
        ))}
      </nav>

      {job && job.state !== "succeeded" ? (
        <p style={{ margin: 0, fontSize: 12, color: job.state === "failed" ? text.bad : text.dim }} data-spatial-job-state={job.state}>
          {job.state === "failed" ? `The reconstruction failed: ${job.error ?? "no reason recorded"}` : `Reconstruction ${job.state} — ${job.steps.filter((s) => s.state === "done").length}/${job.steps.length} steps done.`}
        </p>
      ) : null}

      {result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <EvidenceBar evidence={result.evidence} caption={`${result.mesh.triangles.toLocaleString()} triangles · ${result.grid.cells.toLocaleString()} cells`} />
        </div>
      ) : null}

      <Suspense fallback={<Wait label="Opening the spatial workspace…" />}>
        {summon.tab === "model" ? (
          glbUrl ? (
            <SpatialViewer url={glbUrl} height={320} />
          ) : (
            <Wait label={job ? "The geometry is not ready yet." : "Reading the reconstruction…"} />
          )
        ) : null}
        {summon.tab === "numerical" ? (
          summon.jobId ? <NumericalWorkspace selectedJob={summon.jobId} /> : <p style={{ margin: 0, fontSize: 12, color: text.dim }}>Numerical inspection is for a reconstruction: ask LÉLU to reconstruct an image first.</p>
        ) : null}
        {summon.tab === "create" ? (
          <CreationWorkspace onRender={(t: { url: string; label: string; forgeJobId?: string | null }) => { setTarget(t); summonTab(summon.id, "render"); }} />
        ) : null}
        {summon.tab === "render" ? (
          <RenderWorkspace target={target ?? (glbUrl ? { url: glbUrl, label: summon.title } : null)} onTarget={setTarget} />
        ) : null}
      </Suspense>
    </section>
  );
}

/**
 * Every spatial surface this conversation has been given, in the order it
 * happened. Rendered under the reply; survives reopening the chat.
 */
export default function SpatialSurfaces({ conversationId }: { conversationId: string | null }) {
  const list = useSyncExternalStore(
    subscribeSpatial,
    () => summonsFor(conversationId),
    () => summonsFor(conversationId),
  );
  const [open, setOpen] = useState(true);
  if (list.length === 0) return null;
  return (
    <div data-spatial-surfaces={list.length} aria-label="Spatial work in this conversation" style={{ marginTop: 8 }}>
      <button
        type="button"
        data-spatial-collapse
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, background: "transparent", border: 0, color: "rgba(203,228,255,0.6)", cursor: "pointer", fontFamily: "inherit" }}
      >
        <ChevronDown size={12} style={{ transform: open ? "none" : "rotate(-90deg)" }} aria-hidden />
        {list.length} spatial {list.length === 1 ? "surface" : "surfaces"} in this conversation
      </button>
      {open ? list.map((summon) => <Surface key={summon.id} summon={summon} />) : null}
    </div>
  );
}
