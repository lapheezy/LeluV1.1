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

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import AvatarStore, { type AvatarProfile } from "../../../core/avatar/AvatarProfile";
import { LELU_IDENTITY_STATEMENT } from "../../../brain/LeluIdentity";

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

export default function GenesisAvatarPanel({ onClose }: GenesisAvatarPanelProps) {
  const store = useMemo(() => AvatarStore.getInstance(), []);
  const [profile, setProfile] = useState<AvatarProfile>(() => store.get());
  const [section, setSection] = useState<Section>("appearance");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return store.subscribe((next) => setProfile(next));
  }, [store]);

  function handleReference(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      store.setReferenceImage(String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  function fieldsFor(sectionId: Section): [string, string][] {
    const source = profile[sectionId];
    return Object.entries(source) as [string, string][];
  }

  function updateField(sectionId: Section, key: string, value: string) {
    if (sectionId === "appearance") {
      store.updateAppearance({ [key]: value });
    } else if (sectionId === "identity") {
      store.updateIdentity({ [key]: value });
    } else {
      store.updatePresence({ [key]: value });
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
      <div style={{ display: "flex", gap: 14, minHeight: "min(70vh, 660px)" }}>
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
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
            Visual reference
          </div>
          {profile.referenceImage ? (
            <img
              src={profile.referenceImage}
              alt="LÉLU reference"
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
            {profile.referenceImage ? "Replace reference" : "Upload reference"}
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
          {profile.referenceImage ? (
            <button type="button" onClick={() => store.setReferenceImage(null)} style={{ ...chipButton, color: "#fca5a5" }}>
              Remove
            </button>
          ) : null}

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
            onClick={() => {
              if (window.confirm("Reset the avatar profile to its default identity?")) {
                store.reset();
              }
            }}
            style={{ ...chipButton, color: "#fca5a5", borderColor: "rgba(248,113,113,0.4)" }}
          >
            Reset profile
          </button>
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
            <span style={{ fontSize: 10.5, opacity: 0.55, alignSelf: "center", marginLeft: "auto" }}>
              Saved locally · updated {new Date(profile.updatedAt).toLocaleTimeString()}
            </span>
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
