/**
 * ==========================================================
 * LÉLU
 * GENESIS AVATAR PANEL — LÉLU's visual embodiment
 *
 * The Avatar is NOT a separate AI — it is LÉLU's persistent
 * visual identity. Three sections:
 *   APPEARANCE — face, hair, skin, clothing, jewelry,
 *                accessories, environment, poses, expressions
 *   IDENTITY   — name, self-description, personality,
 *                biography, persistent identity, characteristics,
 *                preferences, system info (mirrors the memory
 *                seed, so avatar and cognition never drift)
 *   PRESENCE   — listening / thinking / speaking / idle states,
 *                expression + animation states, voice
 *
 * Everything persists locally (offline-first). The reference
 * image the user supplies is stored in the profile.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import AvatarStore, { type AvatarProfile } from "../../../core/avatar/AvatarProfile";
import { LELU_IDENTITY_STATEMENT } from "../../../brain/LeluIdentity";
import { useVoice } from "../../../core/voice/useVoice";
import LeluCharacterStore, { type LeluFormChoice, type LeluFramingChoice } from "../../../core/avatar/LeluCharacterStore";
import { useLeluCharacter } from "./avatar/useLeluCharacter";
import Avatar3DReconstructor, { type ReconstructionStatus } from "../../../core/avatar/Avatar3DReconstructor";

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  padding: "7px 9px",
  color: "white",
  fontSize: 12,
  outline: "none",
  fontFamily: "inherit",
};

const labelStyle: CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  opacity: 0.62,
  marginBottom: 4,
  display: "block",
};

const chipButton: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "7px 12px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
};

interface GenesisAvatarPanelProps {
  onClose: () => void;
}

type Section = "appearance" | "identity" | "presence";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "identity", label: "Identity" },
  { id: "presence", label: "Presence" },
];

type SaveStatus = "saved" | "unsaved" | "saving" | "failed";

export default function GenesisAvatarPanel({ onClose }: GenesisAvatarPanelProps) {
  const store = useMemo(() => AvatarStore.getInstance(), []);
  const voice = useVoice();
  const [profile, setProfile] = useState<AvatarProfile>(() => store.get());
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [previewTab, setPreviewTab] = useState<"avatar" | "3d">("avatar");
  // True-3D reconstruction of the saved reference (external pipeline).
  const reconstructor = useMemo(() => Avatar3DReconstructor.getInstance(), []);
  const [reconStatus, setReconStatus] = useState<ReconstructionStatus>(() => reconstructor.getStatus());
  const [reconStored, setReconStored] = useState(false);

  useEffect(() => {
    return reconstructor.subscribe((status, hasStored) => {
      setReconStatus(status);
      setReconStored(hasStored);
    });
  }, [reconstructor]);

  async function handleReconstruct() {
    if (!profile.referenceImage) return;
    try {
      await reconstructor.reconstruct(profile.referenceImage);
    } catch {
      // Status is already surfaced through the subscription + agent stream.
    }
  }
  // Working copy — diverges from persisted as the user edits.
  const [working, setWorking] = useState<AvatarProfile>(() => store.get());
  const [section, setSection] = useState<Section>("appearance");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return store.subscribe((next) => {
      setProfile(next);
      // IndexedDB hydration and external saves notify asynchronously. Keep
      // the working copy synchronized only when it still matches the last
      // persisted profile; never overwrite an edit in progress.
      setWorking((current) =>
        JSON.stringify(current) === JSON.stringify(profileRef.current) ? next : current,
      );
    });
  }, [store]);

  const isDirty = JSON.stringify(working) !== JSON.stringify(profile);


  function handleReference(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setWorking((prev) => ({ ...prev, referenceImage: String(reader.result) }));
      setSaveStatus("unsaved");
    };
    reader.readAsDataURL(file);
  }

  function fieldsFor(sectionId: Section): [string, string][] {
    const source = working[sectionId];
    return Object.entries(source) as [string, string][];
  }

  function updateField(sectionId: Section, key: string, value: string) {
    setWorking((prev) => ({
      ...prev,
      [sectionId]: { ...prev[sectionId], [key]: value },
    }));
    setSaveStatus("unsaved");
  }

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const updated = await store.update(working);
      setProfile(updated);
      setWorking(updated);
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("failed");
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [store, working]);

  function handleReset() {
    if (window.confirm("Reset the avatar profile to its default identity?")) {
      store.reset();
      const resetProfile = store.get();
      setWorking(resetProfile);
      setSaveStatus("saved");
    }
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Embodiment"
      title="Avatar · persistent identity"
      onClose={onClose}
      width="min(96vw, 980px)"
      maxHeight="min(92vh, 920px)"
      elevation="focus"
    >
      <div data-lelu-reflow="columns" style={{ display: "flex", gap: 14, minHeight: "min(70vh, 660px)" }}>
        {/* ---------------------------------------------- reference */}
        <div
          style={{
            width: 230,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            padding: 12,
            background: "rgba(255,255,255,0.03)",
            alignSelf: "flex-start",
          }}
        >
          <PresenceChoice />
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
            Visual reference
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(
              [
                ["avatar", working.referenceImage ? "Avatar" : "Default"],
                ["3d", "3D"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPreviewTab(id)}
                style={{
                  ...chipButton,
                  flex: 1,
                  background: previewTab === id ? "rgba(34, 211, 238, 0.16)" : "rgba(255,255,255,0.04)",
                  border: previewTab === id ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.1)",
                  padding: "6px 8px",
                  fontSize: 11,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {previewTab === "3d" ? (
            <>
              <LivePresencePreview />
              {/* ------------------ true 3D reconstruction ------------------ */}
              <div style={{ height: 1, background: "rgba(255,255,255,0.12)" }} />
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
                True 3D reconstruction
              </div>
              <div style={{ fontSize: 10.5, lineHeight: 1.5, opacity: 0.7 }}>
                Sends the SAVED reference to an external image-to-3D service and replaces the billboard
                with a real textured mesh in every live scene.
              </div>
              {reconStatus.state === "running" ? (
                <div>
                  <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${reconStatus.progress}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #22d3ee, #a78bfa)",
                        transition: "width 0.6s ease",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 4, fontSize: 10.5, opacity: 0.75 }}>{reconStatus.note}</div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleReconstruct()}
                  disabled={!profile.referenceImage}
                  style={{
                    ...chipButton,
                    background: "rgba(167, 139, 250, 0.16)",
                    border: "1px solid rgba(167, 139, 250, 0.45)",
                    opacity: profile.referenceImage ? 1 : 0.45,
                  }}
                >
                  {reconStored ? "Re-reconstruct true 3D model" : "Reconstruct true 3D model"}
                </button>
              )}
              {!profile.referenceImage ? (
                <div style={{ fontSize: 10.5, opacity: 0.6 }}>Save a reference image first.</div>
              ) : null}
              {reconStatus.state === "succeeded" && reconStored ? (
                <div style={{ fontSize: 10.5, color: "#4ade80" }}>● True-3D LÉLU is live in every scene</div>
              ) : null}
              {reconStatus.state === "failed" ? (
                <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "#fca5a5", wordBreak: "break-word" }}>
                  ✕ {reconStatus.error}
                </div>
              ) : null}
            </>
          ) : (
            <>
              {working.referenceImage ? (
                <img
                  src={working.referenceImage}
                  alt="LÉLU — saved avatar"
                  style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(212, 169, 78, 0.4)", boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "3 / 4",
                    borderRadius: 12,
                    border: "1px dashed rgba(255,255,255,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    opacity: 0.55,
                    textAlign: "center",
                    padding: 10,
                    boxSizing: "border-box",
                  }}
                >
                  Upload the reference portrait — LÉLU's appearance direction is stored with her profile.
                </div>
              )}
              <button type="button" onClick={() => fileRef.current?.click()} style={chipButton}>
                {working.referenceImage ? "Replace reference" : "Upload reference"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleReference(file);
                  }
                  event.target.value = "";
                }}
              />
              {working.referenceImage ? (
                <button type="button" onClick={() => { setWorking((prev) => ({ ...prev, referenceImage: null })); setSaveStatus("unsaved"); }} style={{ ...chipButton, color: "#fca5a5" }}>
                  Remove
                </button>
              ) : null}
            </>
          )}

          <div
            style={{
              fontSize: 11,
              lineHeight: 1.55,
              opacity: 0.75,
              border: "1px solid rgba(212, 169, 78, 0.25)",
              borderRadius: 10,
              padding: 10,
              background: "rgba(212, 169, 78, 0.06)",
            }}
          >
            <strong style={{ color: "#e7c883" }}>Direction</strong> — realistic, elegant, dark-skinned, natural textured
            hair, Egyptian/Nubian-inspired gold jewelry, black and antique-gold palette, candlelit cinematic atmosphere.
            Subtle futuristic AI elements; identity stays consistent across every session.
          </div>
          <button
            type="button"
            onClick={handleReset}
            style={{ ...chipButton, color: "#fca5a5", borderColor: "rgba(248,113,113,0.4)" }}
          >
            Reset profile
          </button>

          {/* System status — Avatar · Core · Renderer · Config */}
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginTop: 6 }}>
            System status
          </div>
          {[
            { label: "Avatar", status: working.referenceImage ? "● Saved Reference" : "● Default SVG", color: working.referenceImage ? "#4ade80" : "#fbbf24" },
            { label: "Core", status: "● READY", color: "#67e8f9" },
            { label: "Renderer", status: "● 3D + SVG", color: "#4ade80" },
            { label: "Voice", status: voice.state.active ? (voice.state.phase === "listening" ? "● Listening" : "● Active") : "● Idle", color: voice.state.active ? "#a78bfa" : "#4ade80" },
            { label: "Config", status: saveStatus === "saved" ? "● Saved" : saveStatus === "unsaved" ? "◌ Unsaved" : saveStatus === "saving" ? "● Saving…" : "● Failed", color: saveStatus === "saved" ? "#4ade80" : saveStatus === "unsaved" ? "#a78bfa" : saveStatus === "saving" ? "#fbbf24" : "#f87171" },
          ].map((row) => (
            <div
              key={row.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 10.5,
                padding: "3px 0",
              }}
            >
              <span style={{ opacity: 0.65 }}>{row.label}</span>
              <span style={{ color: row.color }}>{row.status}</span>
            </div>
          ))}
        </div>

        {/* ---------------------------------------------- config */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                style={{
                  ...chipButton,
                  background: section === item.id ? "rgba(212, 169, 78, 0.18)" : "rgba(255,255,255,0.04)",
                  border: section === item.id ? "1px solid rgba(212, 169, 78, 0.55)" : "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Save status bar — visible feedback for every operation */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.1)",
              background:
                saveStatus === "failed"
                  ? "rgba(248,113,113,0.12)"
                  : saveStatus === "saving"
                    ? "rgba(251,191,36,0.1)"
                    : saveStatus === "unsaved"
                      ? "rgba(167,139,250,0.1)"
                      : "rgba(74,222,128,0.06)",
              fontSize: 11.5,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background:
                  saveStatus === "failed"
                    ? "#f87171"
                    : saveStatus === "saving"
                      ? "#fbbf24"
                      : saveStatus === "unsaved"
                        ? "#a78bfa"
                        : "#4ade80",
                animation: saveStatus === "saving" ? "genesis-status-glow-pulse 1s ease-in-out infinite" : undefined,
              }}
            />
            <span style={{ color: "rgba(226,238,252,0.9)", flex: 1 }}>
              {saveStatus === "saved"
                ? `● Saved — ${new Date(profile.updatedAt).toLocaleTimeString()}`
                : saveStatus === "unsaved"
                  ? "◌ Unsaved changes"
                  : saveStatus === "saving"
                    ? "● Saving…"
                    : `● Save failed${saveError ? `: ${saveError}` : ""}`}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saveStatus === "saving"}
              style={{
                ...chipButton,
                background: isDirty ? "rgba(167,139,250,0.25)" : "rgba(255,255,255,0.04)",
                border: isDirty ? "1px solid rgba(167,139,250,0.5)" : "1px solid rgba(255,255,255,0.15)",
                color: isDirty ? "#c4b5fd" : "rgba(255,255,255,0.4)",
                cursor: isDirty && saveStatus !== "saving" ? "pointer" : "default",
                padding: "5px 16px",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              {saveStatus === "saving" ? "Saving…" : isDirty ? "Save" : "Saved"}
            </button>
            {saveStatus === "failed" ? (
              <button
                type="button"
                onClick={handleSave}
                style={{ ...chipButton, color: "#fca5a5", borderColor: "rgba(248,113,113,0.5)", fontSize: 11 }}
              >
                Retry
              </button>
            ) : null}
          </div>

          <div
            style={{
              flex: 1,
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: 14,
              background: "rgba(255,255,255,0.03)",
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              alignContent: "start",
            }}
          >
            {fieldsFor(section).map(([key, value]) => (
              <label key={key} style={{ display: "block" }}>
                <span style={labelStyle}>{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</span>
                <textarea
                  rows={2}
                  value={value}
                  onChange={(event) => updateField(section, key, event.target.value)}
                  style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.45 }}
                />
              </label>
            ))}
          </div>

          {section === "identity" ? (
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.55,
                opacity: 0.8,
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                padding: 10,
                background: "rgba(255,255,255,0.02)",
                maxHeight: 150,
                overflowY: "auto",
              }}
            >
              <strong style={{ color: "#9be8ff" }}>Connected to memory</strong> — this identity mirrors the persistent
              memory seed (lelu-identity-foundation). Both stay in sync automatically:
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 10.5, opacity: 0.85, margin: "6px 0 0", fontFamily: "inherit" }}>
                {LELU_IDENTITY_STATEMENT.slice(0, 420)}…
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </GenesisWindowFrame>
  );
}

/**
 * How she presents herself, everywhere: her form and framing. "Auto" lets
 * each interface choose (avatar/presentationProfile); a choice here wins.
 * No preview canvas of its own: her one presence on screen IS the preview
 * (a second canvas would be a second rendering of her).
 */
function PresenceChoice() {
  const character = useLeluCharacter();
  const store = LeluCharacterStore.getInstance();
  const row = <T extends string>(label: string, value: T, options: ReadonlyArray<readonly [T, string]>, set: (v: T) => void, testId: string) => (
    <div data-testid={testId} role="radiogroup" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, opacity: 0.65 }}>{label}</span>
      <div style={{ display: "flex", gap: 4 }}>
        {options.map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            data-choice={id}
            onClick={() => set(id)}
            style={{
              ...chipButton,
              flex: 1,
              padding: "5px 6px",
              fontSize: 10.5,
              background: value === id ? "rgba(34, 211, 238, 0.16)" : "rgba(255,255,255,0.04)",
              border: value === id ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div data-testid="lelu-presence-choice" style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>Presence</div>
      {row<LeluFormChoice>("Form", character.form, [["auto", "Auto"], ["embodied", "Embodied"], ["hologram", "Hologram"]] as const, (v) => store.setForm(v), "lelu-form-choice")}
      {row<LeluFramingChoice>("Framing", character.framing, [["auto", "Auto"], ["full", "Full body"], ["face", "Face"]] as const, (v) => store.setFraming(v), "lelu-framing-choice")}
      <span style={{ fontSize: 10, opacity: 0.55, lineHeight: 1.4 }}>Auto: each interface chooses. The same LÉLU in every form.</span>
    </div>
  );
}

/**
 * Her preview is HER: the Avatar panel reserves this spot and her one
 * presence (LeluCompanion) stands in it — the approved v005 model, live, in
 * the form and framing chosen above. No second canvas, model copy or
 * controller (the panel used to show a procedural figure, a saved photo as a
 * "billboard", and a procedural snapshot, none of which was her).
 */
function LivePresencePreview() {
  const character = useLeluCharacter();
  return (
    <>
      <div
        data-lelu-preview-host
        data-testid="lelu-avatar-preview"
        style={{
          position: "relative",
          width: "100%",
          height: 320,
          borderRadius: 12,
          border: "1px solid rgba(125, 211, 252, 0.28)",
          background: "radial-gradient(ellipse at 50% 85%, rgba(34,211,238,0.12), rgba(8,12,30,0.6) 70%)",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, padding: "5px 10px", borderRadius: 8, background: "rgba(4, 8, 24, 0.7)", fontSize: 10, color: "rgba(228, 244, 255, 0.9)", letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center" }}>
          LÉLU · live · form {character.form} · framing {character.framing}
        </div>
      </div>
      <div style={{ fontSize: 10.5, lineHeight: 1.5, opacity: 0.65 }}>
        This is LÉLU herself — her approved model, live, standing in the panel. Change her form and framing above.
      </div>
    </>
  );
}
