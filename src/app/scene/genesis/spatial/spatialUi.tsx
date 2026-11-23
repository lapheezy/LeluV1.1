/**
 * LÉLU — Spatial Studio: shared primitives (styles in the Genesis Studio
 * idiom: dark glass, violet/cyan accents) and the evidence colours every
 * workspace uses, so OBSERVED/INFERRED/GENERATED look the same everywhere.
 */
import type { CSSProperties, ReactNode } from "react";
import type { EvidenceBreakdown } from "../../../../core/asre/contracts";

export const EVIDENCE_COLOURS: Record<keyof EvidenceBreakdown, string> = {
  OBSERVED: "#4ade80",
  INFERRED: "#60a5fa",
  GENERATED: "#f59e0b",
  INTERPOLATED: "#c084fc",
  UNKNOWN: "#64748b",
};

export const EVIDENCE_HELP: Record<keyof EvidenceBreakdown, string> = {
  OBSERVED: "directly supported by an input view",
  INFERRED: "derived from the views by a measurement model",
  GENERATED: "made by a model or shape prior — nothing observed it",
  INTERPOLATED: "produced between two snapshots",
  UNKNOWN: "no evidence either way",
};

export const text = { dim: "rgba(203,228,255,0.55)", body: "rgba(226,236,255,0.9)", warn: "#fbbf24", bad: "#f87171", good: "#4ade80" };

export const card: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  background: "rgba(255,255,255,0.03)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
};

export function Section({ title, children, aside, id }: { title: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section style={{ ...card, textAlign: "left" }} data-spatial-section={id ?? title}>
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: "rgba(212,200,255,0.85)" }}>{title}</h3>
        <span style={{ marginLeft: "auto", fontSize: 11, color: text.dim }}>{aside}</span>
      </header>
      {children}
    </section>
  );
}

export function Btn({ children, onClick, disabled, kind = "normal", title, data }: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: "normal" | "primary" | "danger"; title?: string; data?: string }) {
  const colours = kind === "primary" ? ["rgba(167,139,250,0.22)", "rgba(167,139,250,0.55)", "#e9e2ff"] : kind === "danger" ? ["rgba(248,113,113,0.12)", "rgba(248,113,113,0.45)", "#fecaca"] : ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.12)", "rgba(226,236,255,0.9)"];
  return (
    <button
      type="button"
      title={title}
      data-spatial-action={data}
      disabled={disabled}
      onClick={onClick}
      style={{ padding: "5px 11px", borderRadius: 8, border: `1px solid ${colours[1]}`, background: colours[0], color: colours[2], fontSize: 12, fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }}
    >
      {children}
    </button>
  );
}

export const input: CSSProperties = { background: "rgba(0,0,0,0.3)", color: "rgba(226,236,255,0.95)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, padding: "4px 7px", fontSize: 12, fontFamily: "inherit" };

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: text.dim, minWidth: 0 }}>
      {label}
      {children}
    </label>
  );
}

/** Stacked bar of the five evidence classes, with counts and fractions. */
export function EvidenceBar({ evidence, caption }: { evidence: EvidenceBreakdown; caption?: string }) {
  const total = Object.values(evidence).reduce((a, b) => a + b, 0) || 1;
  const keys = (Object.keys(EVIDENCE_COLOURS) as Array<keyof EvidenceBreakdown>).filter((k) => evidence[k] > 0);
  return (
    <div data-spatial-evidence>
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
        {keys.map((k) => (
          <div key={k} title={`${k}: ${evidence[k]} cells — ${EVIDENCE_HELP[k]}`} style={{ width: `${(100 * evidence[k]) / total}%`, background: EVIDENCE_COLOURS[k] }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 5, fontSize: 11, color: text.dim }}>
        {keys.map((k) => (
          <span key={k} data-evidence-class={k}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: EVIDENCE_COLOURS[k], marginRight: 4 }} />
            {k} {((100 * evidence[k]) / total).toFixed(0)}% ({evidence[k].toLocaleString()})
          </span>
        ))}
        {caption ? <span>{caption}</span> : null}
      </div>
    </div>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" data-spatial-error style={{ margin: 0, color: text.bad, fontSize: 12 }}>
      {error}
    </p>
  ) : null;
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export const ms = (n: number | undefined) => (n === undefined ? "" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

/** What the Render workspace shows. */
export interface RenderTarget {
  url: string;
  label: string;
  /** A Forge job that holds exactly this file (enables Forge edit/export/place). */
  forgeJobId?: string | null;
  evidence?: EvidenceBreakdown | null;
}
