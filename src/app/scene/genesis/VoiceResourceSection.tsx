/**
 * ==========================================================
 * LÉLU — VOICE RESOURCE SECTION (Settings)
 *
 * The visible half of the voice resource manager. It is mounted in
 * the existing Settings panel beside her voice picker, not in a
 * separate dashboard: the accounts that pay for her voice are part
 * of her settings, not a detached monitoring toy.
 *
 * What it shows, and where each number comes from:
 *   · engine health / TTS+STT availability — /api/voice/resources
 *   · active account (rotation)            — the server's last use
 *   · utilisation + remaining estimate     — internal accounting,
 *     reconciled against ElevenLabs' own counter when asked
 *   · recent failures and their reason     — recorded by the route
 *   · low-quota alerts                     — below 15% (or exhausted)
 *   · playback                             — the CLIENT's last real
 *     playback attempt (src/core/voice/elevenLabsTts), because only
 *     the page knows whether audio actually reached the speakers.
 *
 * Honesty rules held here:
 *   · nothing is shown until the server answers; a failed poll says
 *     so instead of showing zeros;
 *   · remaining allowance is labelled as an estimate, with reported
 *     characters shown separately;
 *   · playback is reported from a real synthesis attempt, and "not
 *     played this session" is a real answer, not a blank.
 * ==========================================================
 */
import { useCallback, useEffect, useState } from "react";
import type { VoiceResourceSnapshot } from "../../../core/voice/VoiceResourceManager";
import { getLastSynthesis } from "../../../core/voice/elevenLabsTts";

interface ResourcesResponse extends VoiceResourceSnapshot {
  ok: boolean;
  provider: string;
  identity: {
    name: string;
    voiceId: string;
    modelId: string;
    speakingStyle: { stability: number; similarityBoost: number; style: number; speakerBoost: boolean };
  };
}

const heading = {
  fontSize: 10.5,
  textTransform: "uppercase" as const,
  letterSpacing: "0.14em",
  opacity: 0.6,
  margin: "12px 0 8px",
};
const tile = {
  flex: "1 1 130px",
  minWidth: 0,
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
} as const;
const buttonStyle = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid rgba(125,211,252,0.4)",
  background: "rgba(125,211,252,0.12)",
  color: "inherit",
  cursor: "pointer",
  fontSize: 11.5,
  fontFamily: "inherit",
} as const;

const fmt = (n: number) => n.toLocaleString();

function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function healthColor(health: string): string {
  if (health === "ready") return "#86efac";
  if (health === "cooling") return "#fde047";
  return "#fca5a5";
}

export default function VoiceResourceSection() {
  const [data, setData] = useState<ResourcesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [playback, setPlayback] = useState(() => getLastSynthesis());
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/resources", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as ResourcesResponse;
      setData(body);
      setError(null);
    } catch (cause) {
      // A server that cannot answer is reported, never rendered as zeros.
      setError((cause as Error).message);
    }
    setPlayback(getLastSynthesis());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function post(action: "reconcile" | "replenish") {
    setBusy(action);
    try {
      const response = await fetch(`/api/voice/resources/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <div style={{ margin: "12px 0 4px", fontSize: 11.5, color: "#fca5a5" }}>
        Voice resources unavailable — {error}. Her voice settings are unchanged; this panel is the only thing missing.
      </div>
    );
  }

  if (!data) {
    return <div style={{ margin: "12px 0 4px", fontSize: 11.5, opacity: 0.55 }}>Reading voice resources…</div>;
  }

  const totals = data.totals;
  const availability = (ready: boolean) => (ready ? "#86efac" : "#fca5a5");

  return (
    <div style={{ margin: "12px 0 4px" }}>
      <div style={{ ...heading, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span>Voice resources · {data.credentials.length} account(s)</span>
        <span style={{ opacity: 1, letterSpacing: 0, textTransform: "none" }}>
          <span style={{ color: availability(data.availability.tts) }}>TTS {data.availability.tts ? "READY" : "BLOCKED"}</span>
          {" · "}
          <span style={{ color: availability(data.availability.stt) }}>STT {data.availability.stt ? "READY" : "BLOCKED"}</span>
        </span>
      </div>

      <div style={{ fontSize: 11, opacity: 0.62, marginBottom: 8, lineHeight: 1.5 }}>
        Her voice — <strong style={{ opacity: 0.9 }}>{data.identity.name}</strong> · {data.identity.modelId} · voice{" "}
        {data.identity.voiceId} <span style={{ opacity: 0.7 }}>(fixed: rotating an account changes who pays, never who speaks)</span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={tile}>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Remaining (estimate)</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {fmt(totals.remainingCharacters)}
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 2 }}>{fmt(totals.usedCharacters)} used · internal, reconciled on demand</div>
        </div>
        <div style={tile}>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Accounts</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {totals.ready} ready
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 2 }}>
            {totals.cooling} cooling · {totals.exhausted} exhausted
          </div>
        </div>
        <div style={tile}>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Calls</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {fmt(totals.ok)} ok
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 2 }}>{fmt(totals.failed)} failed</div>
        </div>
        <div style={tile}>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Accounting</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {fmt(totals.reportedCharacters)}
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 2 }}>
            reported chars · estimate drift {totals.estimateDriftCharacters >= 0 ? "+" : ""}
            {fmt(totals.estimateDriftCharacters)}
          </div>
        </div>
      </div>

      {data.lowQuota.length > 0 ? (
        <div
          style={{
            fontSize: 11.5,
            color: "#fde68a",
            background: "rgba(253, 224, 71, 0.08)",
            border: "1px solid rgba(253, 224, 71, 0.28)",
            borderRadius: 8,
            padding: "7px 10px",
            marginBottom: 8,
            lineHeight: 1.5,
          }}
        >
          <strong>Low allowance:</strong>{" "}
          {data.lowQuota
            .map((entry) => `${entry.label} — ${fmt(entry.remainingCharacters)} left (${Math.round(entry.utilization * 100)}% used)`)
            .join("; ")}
          . Top up the account, then press Replenished below.
        </div>
      ) : null}

      {data.credentials.length === 0 ? (
        <div style={{ fontSize: 11.5, opacity: 0.65 }}>No ElevenLabs account is configured, so she has no server voice.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.credentials.map((credential) => (
            <div
              key={credential.label}
              style={{
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 10,
                padding: "8px 10px",
                background: "rgba(0,0,0,0.16)",
                fontSize: 11.5,
                lineHeight: 1.55,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span>
                  <strong>{credential.label}</strong>
                  <span style={{ opacity: 0.55 }}> · {fmt(credential.usedCharacters)}/{fmt(credential.characterLimit)} chars</span>
                </span>
                <span style={{ color: healthColor(credential.health), fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {credential.health}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.1)", margin: "5px 0", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.max(2, Math.min(100, credential.utilization * 100))}%`,
                    height: "100%",
                    background: healthColor(credential.health),
                  }}
                />
              </div>
              <div style={{ opacity: 0.72 }}>
                {fmt(credential.remainingCharacters)} left (estimate)
                {credential.health === "cooling"
                  ? ` · cooling ${Math.ceil(Math.max(credential.tts.cooldownRemainingMs, credential.stt.cooldownRemainingMs) / 1000)}s`
                  : ""}
                {credential.exhausted ? ` · exhausted ${ago(credential.exhausted.since, now)}` : ""}
              </div>
              <div style={{ opacity: 0.72 }}>
                TTS {credential.tts.ok}/{credential.tts.calls} ok
                {credential.tts.lastFailure ? ` · last refusal ${credential.tts.lastFailure.status || "network"}` : ""}
                {" · "}STT {credential.stt.ok}/{credential.stt.calls} ok
                {credential.stt.lastFailure ? ` · last refusal ${credential.stt.lastFailure.status || "network"}` : ""}
              </div>
              {credential.upstream ? (
                <div style={{ opacity: 0.62 }}>
                  Provider says {fmt(credential.upstream.used)}/{fmt(credential.upstream.limit)} ({ago(credential.upstream.observedAt, now)})
                  {credential.upstream.lagging ? " · counter lagging behind local accounting" : ""}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div style={{ ...heading, marginBottom: 4 }}>Rotation & playback</div>
      <div style={{ fontSize: 11.5, lineHeight: 1.6, opacity: 0.82 }}>
        <div>
          Active account — TTS <strong>{data.activeCredential.tts ?? "none yet"}</strong> · STT{" "}
          <strong>{data.activeCredential.stt ?? "none yet"}</strong>
        </div>
        <div>
          Last success —{" "}
          {data.lastSuccess
            ? `${data.lastSuccess.kind.toUpperCase()} on ${data.lastSuccess.label}, ${ago(data.lastSuccess.at, now)}` +
              (data.lastSuccess.reportedCharacters !== null ? `, ${fmt(data.lastSuccess.reportedCharacters)} chars reported` : ", no report")
            : "none this server session"}
        </div>
        <div>
          Last failure —{" "}
          {data.lastFailure
            ? `${data.lastFailure.kind.toUpperCase()} on ${data.lastFailure.label}, ${ago(data.lastFailure.at, now)} — ${
                data.lastFailure.reason ?? `HTTP ${data.lastFailure.status}`
              }`
            : "none this server session"}
        </div>
        <div>
          Playback —{" "}
          {playback
            ? `${playback.characters !== null ? `${fmt(playback.characters)} chars` : "cost unreported"} · ${fmt(playback.ms)} ms · ${ago(playback.at, now)} (client, last synthesis attempt)`
            : "no synthesis attempted from this page yet"}
        </div>
      </div>

      {data.history.length > 0 ? (
        <>
          <div style={{ ...heading, marginBottom: 4 }}>Recent usage</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
            {data.history.slice(0, 6).map((entry) => (
              <div key={`${entry.at}-${entry.kind}-${entry.label}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, opacity: 0.8 }}>
                <span>
                  <span style={{ color: entry.ok ? "#86efac" : "#fca5a5" }}>{entry.ok ? "✓" : "✗"}</span> {entry.kind.toUpperCase()} ·{" "}
                  {entry.label}
                  {entry.reportedCharacters !== null ? ` · ${fmt(entry.reportedCharacters)} chars` : ""}
                  {entry.status ? ` · HTTP ${entry.status}` : ""}
                </span>
                <span style={{ opacity: 0.7 }}>{ago(entry.at, now)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        <button type="button" style={buttonStyle} onClick={() => void load()} disabled={busy !== null}>
          {busy === null ? "Refresh" : "Working…"}
        </button>
        <button type="button" style={buttonStyle} onClick={() => void post("reconcile")} disabled={busy !== null}>
          Check provider counters
        </button>
        <button type="button" style={buttonStyle} onClick={() => void post("replenish")} disabled={busy !== null}>
          Replenished
        </button>
        <span style={{ fontSize: 10.5, opacity: 0.5 }}>
          {error ? `Last action failed — ${error}` : "Replenished restarts the internal ledger after a top-up; history is kept."}
        </span>
      </div>
    </div>
  );
}
