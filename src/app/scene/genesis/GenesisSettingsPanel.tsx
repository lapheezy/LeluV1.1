/**
 * ==========================================================
 * LÉLU
 * GENESIS SETTINGS PANEL — the Settings hub
 *
 * Aggregates the system destinations (API Status, Device,
 * Engines, Logs, Browser, Knowledge, Cognition workspaces)
 * and exposes honest local data controls: memory count,
 * clearing the conversation, exporting all creative data as
 * JSON, and resetting the creative stores. Offline-first.
 * ==========================================================
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import { useGenesis, type GenesisPanel } from "./GenesisCore";
import AIService from "../../../core/AIService";
import AvatarStore from "../../../core/avatar/AvatarProfile";
import AgentStore from "../../../core/agents/AgentStore";
import ProjectStore from "../../../core/projects/ProjectStore";
import SketchStore from "../../../core/creative/SketchDocument";
import RenderStore from "../../../core/creative/RenderStore";
import VideoStore from "../../../core/creative/VideoProject";
import ProactiveCore, {
  PROACTIVE_CATEGORIES,
  type NotificationLevel,
  type ProactiveSettings,
} from "../../../core/proactive/ProactiveCore";
import type { LocalRuntimeStatus } from "../../../core/runtime/local/LocalRuntimeTypes";
import SupabasePersistence, { type SupabaseAuthState } from "../../../core/persistence/SupabasePersistence";
import { getEnvironment } from "../../../core/Environment";
import VoiceEngine from "../../../core/voice/VoiceEngine";

const LEVELS: { value: NotificationLevel; label: string }[] = [
  { value: "quiet", label: "Quiet" },
  { value: "normal", label: "Normal" },
  { value: "proactive", label: "Proactive" },
  { value: "highly-proactive", label: "Highly proactive" },
];

/* ==========================================================
 * VOICE SECTION — real voice registry from the runtime.
 *
 * Lists the voices the browser/device ACTUALLY exposes, marks
 * which are genuinely offline-capable (localService), lets the
 * user pick (persisted by VoiceEngine) and preview. No fake
 * voices, no silent external services.
 * ========================================================== */

function VoiceSection() {
  const engine = useMemo(() => VoiceEngine.getInstance(), []);
  const [voices, setVoices] = useState(engine.listVoices());
  const [offline, setOffline] = useState(engine.offlineVoiceAvailability());

  useEffect(() => {
    // Voices load asynchronously in most browsers — refresh on change.
    const refresh = () => {
      setVoices(engine.listVoices());
      setOffline(engine.offlineVoiceAvailability());
    };
    refresh();
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.addEventListener?.("voiceschanged", refresh);
      return () => speechSynthesis.removeEventListener?.("voiceschanged", refresh);
    }
  }, [engine]);

  const selectAndPreview = (uri: string) => {
    engine.setPreferredVoice(uri);
    setVoices(engine.listVoices());
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(
        "Hi — I'm Lélu. This is how I sound now.",
      );
      const match = speechSynthesis.getVoices().find((v) => v.voiceURI === uri);
      if (match) utterance.voice = match;
      speechSynthesis.speak(utterance);
    } catch {
      /* preview is best-effort */
    }
  };

  const offlineLabel =
    offline === "available"
      ? "OFFLINE VOICE — AVAILABLE"
      : offline === "not-available"
        ? "OFFLINE VOICE — NOT AVAILABLE"
        : "OFFLINE VOICE — UNSUPPORTED IN THIS BROWSER";

  return (
    <div style={{ margin: "12px 0 4px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          opacity: 0.6,
          margin: "12px 0 8px",
        }}
      >
        <span>Lélu's voice</span>
        <span style={{ color: offline === "available" ? "#34d399" : "rgba(248,113,113,0.85)", opacity: 1 }}>
          {offlineLabel}
        </span>
      </div>
      {voices.length === 0 ? (
        <div style={{ fontSize: 11.5, opacity: 0.6 }}>
          No system voices exposed yet — they appear once the browser loads them.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
          {voices.map((voice) => (
            <button
              key={voice.uri}
              type="button"
              onClick={() => selectAndPreview(voice.uri)}
              title={`Language ${voice.lang} · ${voice.localService ? "installed on device (works offline)" : "network/cloud voice"}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                border: voice.selected
                  ? "1px solid rgba(167, 139, 250, 0.55)"
                  : "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 8,
                padding: "6px 10px",
                background: voice.selected ? "rgba(167, 139, 250, 0.14)" : "rgba(255,255,255,0.03)",
                color: "white",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                fontSize: 11.5,
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {voice.name}
                <span style={{ opacity: 0.55 }}> · {voice.lang}</span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.75 }}>
                {voice.selected ? "✓ selected" : voice.localService ? "offline ✓" : "online"}
              </span>
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 6 }}>
        Click a voice to select and preview it. Selection persists across restarts. Lélu speaks through the same chat runtime — no separate voice system.
      </div>
    </div>
  );
}

interface ProactiveToggleProps {
  label: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

function ProactiveToggle({ label, description, value, disabled, onChange }: ProactiveToggleProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        width: "100%",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10,
        padding: "9px 12px",
        background: value ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.03)",
        color: "white",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, display: "block", color: value ? "#9be8ff" : "inherit" }}>
          {label}
        </span>
        <span style={{ fontSize: 11, opacity: 0.62, display: "block", marginTop: 2 }}>{description}</span>
      </span>
      <span
        aria-hidden
        style={{
          width: 34,
          height: 20,
          borderRadius: 999,
          flexShrink: 0,
          background: value ? "rgba(34, 211, 238, 0.7)" : "rgba(148, 163, 184, 0.3)",
          position: "relative",
          transition: "background 0.2s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: value ? 16 : 2,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: "white",
            transition: "left 0.2s",
          }}
        />
      </span>
    </button>
  );
}

interface GenesisSettingsPanelProps {
  onClose: () => void;
}

const LINKS: { id: GenesisPanel; label: string; description: string }[] = [
  { id: "providers", label: "API Status", description: "Provider health, active provider, fallback state" },
  { id: "device", label: "Device", description: "Microphone, camera, clipboard, share, storage…" },
  { id: "diagnostics", label: "Engines", description: "Genesis engine status and errors" },
  { id: "logs", label: "Logs", description: "Execution trace of the request pipeline" },
  { id: "browser", label: "Browser", description: "Live browser surface" },
  { id: "knowledge", label: "Knowledge", description: "Research / knowledge providers" },
  { id: "workspaces", label: "Projects", description: "The workspace / project system" },
];

export default function GenesisSettingsPanel({ onClose }: GenesisSettingsPanelProps) {
  const { openPanel, clearConversation, state } = useGenesis();
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [avatarName, setAvatarName] = useState<string>("Lélu");
  const [exported, setExported] = useState(false);
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveSettings>(() =>
    ProactiveCore.getInstance().getSettings(),
  );
  const [offlineMode, setOfflineMode] = useState<boolean>(() => AIService.getInstance().isOfflineMode());
  const [modelStatus, setModelStatus] = useState(() => AIService.getInstance().modelSystemStatus());
  const [localStatus, setLocalStatus] = useState<LocalRuntimeStatus | null>(null);
  const [authState, setAuthState] = useState<SupabaseAuthState>(() =>
    SupabasePersistence.getInstance().getAuthState(),
  );
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  function updateProactive(patch: Partial<ProactiveSettings>) {
    setProactiveSettings(ProactiveCore.getInstance().updateSettings(patch));
  }

  function toggleOfflineMode(value: boolean) {
    AIService.getInstance().setOfflineMode(value);
    setOfflineMode(value);
    setModelStatus(AIService.getInstance().modelSystemStatus());
    void AIService.getInstance().localRuntimeStatus().then(setLocalStatus).catch(() => {});
  }

  useEffect(() => {
    void AIService.getInstance().localRuntimeStatus().then(setLocalStatus).catch(() => {});
    return SupabasePersistence.getInstance().subscribeAuth(setAuthState);
  }, []);

  async function authenticateWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    const persistence = SupabasePersistence.getInstance();
    if (authMode === "sign-in") {
      const result = await persistence.signInWithEmail(authEmail, authPassword);
      if (result.error) setAuthError(result.error);
    } else {
      const result = await persistence.signUpWithEmail(authEmail, authPassword);
      if (result.error) setAuthError(result.error);
      else if (result.requiresConfirmation) setAuthNotice("Account created. Check your email to confirm it, then sign in.");
      else setAuthNotice("Account created and signed in.");
    }
    setAuthBusy(false);
  }

  async function signOut() {
    setAuthBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    const result = await SupabasePersistence.getInstance().signOut();
    if (result.error) setAuthError(result.error);
    setAuthBusy(false);
  }

  const stores = useMemo(
    () => ({
      agents: AgentStore.getInstance().list().length,
      projects: ProjectStore.getInstance().list().length,
      sketches: SketchStore.getInstance().list().length,
      renders: RenderStore.getInstance().list().length,
      videos: VideoStore.getInstance().list().length,
    }),
    [],
  );

  useEffect(() => {
    void AIService.getInstance()
      .getMemories(1000)
      .then((memories) => setMemoryCount(memories.length))
      .catch(() => setMemoryCount(null));
    setAvatarName(AvatarStore.getInstance().get().identity.name);
  }, []);

  function exportAll() {
    const payload = {
      exportedAt: new Date().toISOString(),
      conversations: state.messages,
      memories: memoryCount,
      agents: AgentStore.getInstance().list(),
      projects: ProjectStore.getInstance().list(),
      sketches: SketchStore.getInstance().list(),
      renders: RenderStore.getInstance().list(),
      videos: VideoStore.getInstance().list(),
      avatar: AvatarStore.getInstance().get(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lelu-export.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  function clearCreativeData() {
    if (!window.confirm("Delete ALL locally stored creative data (agents, projects, sketches, renders, videos)? This cannot be undone.")) {
      return;
    }
    const kv = localStorage;
    for (const key of ["lelu.agents.v1", "lelu.projects.v1", "lelu.sketches.v1", "lelu.renders.v1", "lelu.videos.v1", "lelu.avatar.v1"]) {
      try {
        kv.removeItem(key);
      } catch {
        // backend blocked
      }
    }
    window.location.reload();
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · System"
      title="Settings · local-first operating environment"
      onClose={onClose}
      width="min(94vw, 820px)"
      maxHeight="min(90vh, 860px)"
      elevation="focus"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            <strong style={{ color: "#e7c883" }}>{avatarName}</strong> · {memoryCount ?? "…"} local memories ·{" "}
            {stores.agents} agents · {stores.projects} projects · {stores.sketches} sketches · {stores.renders} renders ·{" "}
            {stores.videos} video projects
          </div>
        </div>

        <div style={{ border: "1px solid rgba(125, 211, 252, 0.25)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
            Cloud identity · Supabase
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.78, marginBottom: 10 }}>
            {authState.session
              ? `Signed in${authState.displayName ? ` as ${authState.displayName}` : authState.email ? ` as ${authState.email}` : ""}. Cloud memory and runtime state follow this account.`
              : authState.status === "disabled"
                ? "Cloud identity is not configured. Local cognition remains available."
                : "Use your email to persist LÉLU's memory, projects, questions, and runtime state across devices."}
          </div>
          {authState.session ? (
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={authBusy}
              style={{
                border: "1px solid rgba(125, 211, 252, 0.42)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                color: "white",
                padding: "8px 12px",
                fontSize: 12,
                cursor: authBusy ? "default" : "pointer",
                opacity: authBusy ? 0.55 : 1,
                fontFamily: "inherit",
              }}
            >
              {authBusy ? "Signing out…" : "Sign out"}
            </button>
          ) : (
            <form onSubmit={(event) => void authenticateWithEmail(event)} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
              <input
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="Email address"
                autoComplete="email"
                required
                disabled={authBusy || authState.status === "disabled"}
                style={{ border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, background: "rgba(0,0,0,0.22)", color: "white", padding: "9px 10px", fontSize: 12, fontFamily: "inherit" }}
              />
              <input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="Password"
                autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
                minLength={6}
                required
                disabled={authBusy || authState.status === "disabled"}
                style={{ border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, background: "rgba(0,0,0,0.22)", color: "white", padding: "9px 10px", fontSize: 12, fontFamily: "inherit" }}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="submit"
                  disabled={authBusy || authState.status === "disabled"}
                  style={{ border: "1px solid rgba(125, 211, 252, 0.42)", borderRadius: 8, background: "rgba(34, 211, 238, 0.14)", color: "white", padding: "8px 12px", fontSize: 12, cursor: authBusy || authState.status === "disabled" ? "default" : "pointer", opacity: authBusy || authState.status === "disabled" ? 0.55 : 1, fontFamily: "inherit" }}
                >
                  {authBusy ? "Checking…" : authMode === "sign-in" ? "Sign in" : "Create account"}
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in"); setAuthError(null); setAuthNotice(null); }}
                  disabled={authBusy || authState.status === "disabled"}
                  style={{ border: 0, background: "transparent", color: "#9be8ff", padding: "6px 0", fontSize: 11.5, cursor: authBusy || authState.status === "disabled" ? "default" : "pointer", fontFamily: "inherit" }}
                >
                  {authMode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
                </button>
              </div>
            </form>
          )}
          {authNotice ? <div style={{ color: "#86efac", fontSize: 11, marginTop: 8 }}>{authNotice}</div> : null}
          {authError ? <div style={{ color: "#fca5a5", fontSize: 11, marginTop: 8 }}>{authError}</div> : null}
          {authState.status === "degraded" ? <div style={{ color: "#fde68a", fontSize: 11, marginTop: 8 }}>Cloud sync is degraded; local state is still active.</div> : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {LINKS.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => openPanel(link.id)}
              style={{
                textAlign: "left",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding: "11px 13px",
                background: "rgba(255,255,255,0.03)",
                color: "white",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "#9be8ff" }}>{link.label}</div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{link.description}</div>
            </button>
          ))}
        </div>

        {/* Live local runtime status — honest probed state of every companion backend */}
        <div style={{ border: "1px solid rgba(34, 211, 238, 0.25)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 10 }}>
            Local runtime · live
          </div>
          {localStatus ? (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(0,0,0,0.22)",
                fontSize: 11.5,
                lineHeight: 1.65,
                opacity: 0.9,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                {localStatus.backends.length > 0 ? (
                  localStatus.backends.map((b) => (
                    <div key={b.name} style={{ marginBottom: 2 }}>
                      {b.name} · {b.baseUrl} ·{" "}
                      <strong style={{ color: b.reachable ? "#86efac" : "#fca5a5" }}>
                        {b.reachable ? `✓ reachable (${b.models.length} models)` : b.error ?? "✗ unreachable"}
                      </strong>
                    </div>
                  ))
                ) : (
                  <div style={{ opacity: 0.7 }}>No local backends detected — probing Ollama, llama.cpp, LM Studio, vLLM…</div>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                {Object.entries(localStatus.capabilities).map(([key, cap]) => {
                  const color =
                    cap.state === "available" ? "#86efac" :
                    cap.state === "partial" ? "#fde047" :
                    cap.state === "error" ? "#fca5a5" : "rgba(255,255,255,0.4)";
                  return (
                    <span
                      key={key}
                      title={cap.description}
                      style={{
                        fontSize: 10,
                        padding: "3px 7px",
                        borderRadius: 6,
                        background: "rgba(255,255,255,0.06)",
                        color,
                        border: `1px solid ${color}33`,
                      }}
                    >
                      {cap.label.split(" ")[0]}: {cap.state}
                    </span>
                  );
                })}
              </div>
              <div style={{ marginTop: 6, opacity: 0.6, fontSize: 10.5 }}>
                {localStatus.activeJobCount} active jobs · {localStatus.totalJobsRun} total run
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, opacity: 0.5, padding: "6px 12px" }}>Probing local backends…</div>
          )}
        </div>

        <div style={{ border: "1px solid rgba(125, 211, 252, 0.25)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 10 }}>
            Proactive intelligence
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ProactiveToggle
              label="Proactive mode"
              description="Let Lélu prepare context, routines and suggestions instead of only waiting."
              value={proactiveSettings.enabled}
              onChange={(value) => updateProactive({ enabled: value })}
            />
            <ProactiveToggle
              label="Session briefing"
              description="On open, present the most relevant updates without being asked."
              value={proactiveSettings.sessionBriefing}
              disabled={!proactiveSettings.enabled}
              onChange={(value) => updateProactive({ sessionBriefing: value })}
            />
            <ProactiveToggle
              label="Routine learning"
              description="Recognize repeated topics and times — never treated as permanent fact."
              value={proactiveSettings.routineLearning}
              disabled={!proactiveSettings.enabled}
              onChange={(value) => updateProactive({ routineLearning: value })}
            />
            <ProactiveToggle
              label="Suggestions"
              description="Suggest useful next steps for active projects."
              value={proactiveSettings.suggestions}
              disabled={!proactiveSettings.enabled}
              onChange={(value) => updateProactive({ suggestions: value })}
            />
            <ProactiveToggle
              label="Project updates"
              description="Surface your active projects when you return."
              value={proactiveSettings.projectUpdates}
              disabled={!proactiveSettings.enabled}
              onChange={(value) => updateProactive({ projectUpdates: value })}
            />
            <ProactiveToggle
              label="Location context"
              description="Use your last known location when relevant (permission-controlled)."
              value={proactiveSettings.locationContext}
              disabled={!proactiveSettings.enabled}
              onChange={(value) => updateProactive({ locationContext: value })}
            />
            <ProactiveToggle
              label="Media discovery"
              description={
                getEnvironment().youtube.hasKey
                  ? "CONNECTED — YouTube source active (VITE_YOUTUBE_API_KEY)."
                  : "NOT CONFIGURED — add VITE_YOUTUBE_API_KEY in Settings → Environment to enable video discovery. Everything else stays online."
              }
              value={proactiveSettings.mediaDiscovery}
              disabled={!proactiveSettings.enabled}
              onChange={(value) => updateProactive({ mediaDiscovery: value })}
            />
            <ProactiveToggle
              label="Video autoplay"
              description="Applies only when a video plays inside chat or Workspace. Never autoplays by default."
              value={proactiveSettings.videoAutoplay}
              disabled={!proactiveSettings.enabled || !proactiveSettings.mediaDiscovery}
              onChange={(value) => updateProactive({ videoAutoplay: value })}
            />
          </div>

          <VoiceSection />

          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, margin: "12px 0 8px" }}>
            Initiation level
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {LEVELS.map((level) => {
              const active = proactiveSettings.notificationLevel === level.value;
              return (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => updateProactive({ notificationLevel: level.value })}
                  style={{
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11.5,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: active ? "#062033" : "white",
                    background: active ? "#7dd3fc" : "rgba(255,255,255,0.04)",
                  }}
                >
                  {level.label}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, margin: "12px 0 8px" }}>
            Allowed topics
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PROACTIVE_CATEGORIES.map((category) => {
              const active = proactiveSettings.categories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setProactiveSettings(ProactiveCore.getInstance().toggleCategory(category))}
                  style={{
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11.5,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: active ? "#062033" : "white",
                    background: active ? "#7dd3fc" : "rgba(255,255,255,0.04)",
                  }}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
            Data
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                clearConversation();
                openPanel("none");
              }}
              style={{
                border: "1px solid rgba(255,255,255,0.16)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                color: "white",
                padding: "7px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear conversation
            </button>
            <button
              type="button"
              onClick={exportAll}
              style={{
                border: "1px solid rgba(125, 211, 252, 0.4)",
                borderRadius: 8,
                background: "rgba(34, 211, 238, 0.12)",
                color: "white",
                padding: "7px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {exported ? "✓ Exported" : "⬇ Export all local data (JSON)"}
            </button>
            <button
              type="button"
              onClick={clearCreativeData}
              style={{
                border: "1px solid rgba(248, 113, 113, 0.4)",
                borderRadius: 8,
                background: "rgba(248, 113, 113, 0.08)",
                color: "#fca5a5",
                padding: "7px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Reset creative data
            </button>
          </div>
        </div>

        <div style={{ border: "1px solid rgba(34, 211, 238, 0.25)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 10 }}>
            Local-first model engine
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ProactiveToggle
              label="Local / Offline mode"
              description="Skip every remote AI provider and run on local capabilities only."
              value={offlineMode}
              onChange={toggleOfflineMode}
            />
          </div>
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.22)",
              fontSize: 11.5,
              lineHeight: 1.7,
              opacity: 0.9,
            }}
          >
            <div>
              Hardware tier: <strong style={{ color: "#9be8ff" }}>{modelStatus.hardware.tier.toUpperCase()}</strong>{" "}
              · acceleration: {modelStatus.hardware.acceleration.toUpperCase()}
            </div>
            <div>
              {modelStatus.hardware.cpuCores ?? "?"} cores ·{" "}
              {modelStatus.hardware.memoryGB != null ? `${modelStatus.hardware.memoryGB} GB RAM` : "RAM unknown"} ·{" "}
              {modelStatus.hardware.vramGB != null ? `~${modelStatus.hardware.vramGB} GB VRAM` : "VRAM unknown"}
            </div>
            <div style={{ opacity: 0.75 }}>{modelStatus.hardware.recommendation}</div>
            <div style={{ marginTop: 6 }}>
              Models: <strong>{modelStatus.remoteModelCount}</strong> remote ·{" "}
              <strong>{modelStatus.localModelCount}</strong> local slots ·{" "}
              local runtime:{" "}
              <strong style={{ color: modelStatus.localInstalled ? "#86efac" : "#fca5a5" }}>
                {modelStatus.localInstalled ? "INSTALLED" : "NOT INSTALLED"}
              </strong>
            </div>
            <div style={{ opacity: 0.72 }}>
              {offlineMode
                ? modelStatus.localInstalled
                  ? "Offline mode is on — routing to local models."
                  : "Offline mode is on, but no local runtime is installed yet — generation degrades to local memory/identity only."
                : "External providers are optional fallbacks. If every one fails, LÉLU keeps working locally."}
            </div>
          </div>
        </div>

        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12, fontSize: 12, lineHeight: 1.6, opacity: 0.85 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
            Offline-first foundation
          </div>
          LÉLU launches, opens projects, sketches, saves sketches, manages agents, manages projects, configures the
          avatar, views previous work and accesses local memory with zero network. Cloud AI enhances LÉLU — it never
          determines whether the application is usable. Provider-dependent capabilities (cloud image/video generation)
          are clearly marked in their workspaces and require API keys.
        </div>
      </div>
    </GenesisWindowFrame>
  );
}