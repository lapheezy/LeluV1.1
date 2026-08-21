/**
 * ==========================================================
 * LÉLUVERSE — WORLD MORPH
 *
 * Visually transforms the LÉLU Core through lifecycle phases.
 * Sits in GenesisRenderer, modulates the Core mesh properties
 * based on WorldLifecycle state.
 * ==========================================================
 */

import { useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Color, Mesh } from "three";
import WorldLifecycle, { type WorldCycleState } from "../engines/WorldLifecycle";
import { WorldPhase, type WorldPhaseType } from "../engines/EngineDomains";

// Phase ordering
const PHASE_ORDER: WorldPhaseType[] = [
  WorldPhase.CORE_SEED,
  WorldPhase.FORMATION,
  WorldPhase.EXPANSION,
  WorldPhase.PLANET,
  WorldPhase.LIFE,
  WorldPhase.MIND,
  WorldPhase.FULL_WORLD,
  WorldPhase.SUNSET,
  WorldPhase.COLLAPSE,
  WorldPhase.REBIRTH,
];

interface PhaseVisual {
  scale: number;
  emissiveIntensity: number;
  hue: number;
  saturation: number;
  brightness: number;
  ringOpacity: number;
  atmosphereRadius: number;
  atmosphereOpacity: number;
  particleDensity: number;
  rotationSpeed: number;
  oceanCoverage: number;
  cloudCoverage: number;
  showContinents: boolean;
  showCityLights: boolean;
}

const PHASE_VISUALS: Record<string, PhaseVisual> = {
  [WorldPhase.CORE_SEED]: {
    scale: 1.0, emissiveIntensity: 0.6, hue: 0.52, saturation: 0.8, brightness: 0.6,
    ringOpacity: 0.4, atmosphereRadius: 1.3, atmosphereOpacity: 0.12,
    particleDensity: 0.1, rotationSpeed: 0.05, oceanCoverage: 0, cloudCoverage: 0,
    showContinents: false, showCityLights: false,
  },
  [WorldPhase.FORMATION]: {
    scale: 1.15, emissiveIntensity: 0.7, hue: 0.55, saturation: 0.85, brightness: 0.65,
    ringOpacity: 0.5, atmosphereRadius: 1.4, atmosphereOpacity: 0.15,
    particleDensity: 0.3, rotationSpeed: 0.04, oceanCoverage: 0, cloudCoverage: 0,
    showContinents: false, showCityLights: false,
  },
  [WorldPhase.EXPANSION]: {
    scale: 1.3, emissiveIntensity: 0.5, hue: 0.5, saturation: 0.7, brightness: 0.55,
    ringOpacity: 0.35, atmosphereRadius: 1.5, atmosphereOpacity: 0.18,
    particleDensity: 0.5, rotationSpeed: 0.03, oceanCoverage: 0.1, cloudCoverage: 0,
    showContinents: false, showCityLights: false,
  },
  [WorldPhase.PLANET]: {
    scale: 1.4, emissiveIntensity: 0.3, hue: 0.55, saturation: 0.6, brightness: 0.5,
    ringOpacity: 0.2, atmosphereRadius: 1.6, atmosphereOpacity: 0.22,
    particleDensity: 0.3, rotationSpeed: 0.02, oceanCoverage: 0.5, cloudCoverage: 0.1,
    showContinents: true, showCityLights: false,
  },
  [WorldPhase.LIFE]: {
    scale: 1.45, emissiveIntensity: 0.25, hue: 0.35, saturation: 0.55, brightness: 0.5,
    ringOpacity: 0.15, atmosphereRadius: 1.65, atmosphereOpacity: 0.25,
    particleDensity: 0.2, rotationSpeed: 0.018, oceanCoverage: 0.6, cloudCoverage: 0.2,
    showContinents: true, showCityLights: false,
  },
  [WorldPhase.MIND]: {
    scale: 1.5, emissiveIntensity: 0.2, hue: 0.4, saturation: 0.5, brightness: 0.5,
    ringOpacity: 0.12, atmosphereRadius: 1.7, atmosphereOpacity: 0.28,
    particleDensity: 0.15, rotationSpeed: 0.015, oceanCoverage: 0.6, cloudCoverage: 0.35,
    showContinents: true, showCityLights: false,
  },
  [WorldPhase.FULL_WORLD]: {
    scale: 1.5, emissiveIntensity: 0.15, hue: 0.45, saturation: 0.45, brightness: 0.5,
    ringOpacity: 0.1, atmosphereRadius: 1.75, atmosphereOpacity: 0.3,
    particleDensity: 0.1, rotationSpeed: 0.012, oceanCoverage: 0.6, cloudCoverage: 0.4,
    showContinents: true, showCityLights: true,
  },
  [WorldPhase.SUNSET]: {
    scale: 1.5, emissiveIntensity: 0.25, hue: 0.08, saturation: 0.7, brightness: 0.55,
    ringOpacity: 0.15, atmosphereRadius: 1.8, atmosphereOpacity: 0.35,
    particleDensity: 0.1, rotationSpeed: 0.01, oceanCoverage: 0.6, cloudCoverage: 0.5,
    showContinents: true, showCityLights: true,
  },
  [WorldPhase.COLLAPSE]: {
    scale: 0.8, emissiveIntensity: 0.8, hue: 0.0, saturation: 0.9, brightness: 0.6,
    ringOpacity: 0.6, atmosphereRadius: 1.2, atmosphereOpacity: 0.4,
    particleDensity: 0.8, rotationSpeed: 0.08, oceanCoverage: 0.3, cloudCoverage: 0.6,
    showContinents: false, showCityLights: false,
  },
  [WorldPhase.REBIRTH]: {
    scale: 1.2, emissiveIntensity: 1.0, hue: 0.52, saturation: 1.0, brightness: 0.8,
    ringOpacity: 0.8, atmosphereRadius: 2.0, atmosphereOpacity: 0.5,
    particleDensity: 1.0, rotationSpeed: 0.15, oceanCoverage: 0, cloudCoverage: 0,
    showContinents: false, showCityLights: false,
  },
};

// ── WORLD MORPH ──

interface WorldMorphProps {
  coreRef: React.RefObject<Group | null>;
}

export default function WorldMorph({ coreRef }: WorldMorphProps) {
  const [lifecycleState, setLifecycleState] = useState<WorldCycleState>(() =>
    WorldLifecycle.getInstance().getState()
  );

  useEffect(() => {
    return WorldLifecycle.getInstance().subscribe(setLifecycleState);
  }, []);

  const currentVisualConfig = useMemo(() => {
    return PHASE_VISUALS[lifecycleState.phase] ?? PHASE_VISUALS[WorldPhase.CORE_SEED];
  }, [lifecycleState.phase]);

  useFrame((_, delta) => {
    if (!coreRef.current) return;

    const target = currentVisualConfig;
    const lerp = Math.min(1, delta * 3);

    // Scale
    const currentScale = coreRef.current.scale.x;
    const newScale = currentScale + (target.scale - currentScale) * lerp;
    coreRef.current.scale.setScalar(newScale);

    // Rotation
    coreRef.current.rotation.y += target.rotationSpeed * delta * 60;

    // Color/emissive on child meshes
    coreRef.current.traverse((child) => {
      if (child instanceof Mesh && child.material) {
        const mat = child.material as any;
        if (mat.emissive) {
          const targetColor = new Color().setHSL(target.hue, target.saturation, target.brightness);
          mat.emissive.lerp(targetColor, lerp);
          if (mat.emissiveIntensity !== undefined) {
            mat.emissiveIntensity += (target.emissiveIntensity - mat.emissiveIntensity) * lerp;
          }
        }
        // Collapse: shrink opacity
        if (lifecycleState.phase === WorldPhase.COLLAPSE && mat.opacity !== undefined) {
          mat.opacity = Math.max(0.3, mat.opacity - delta * 0.3);
        }
        // Rebirth: flash bright
        if (lifecycleState.phase === WorldPhase.REBIRTH && mat.emissiveIntensity !== undefined) {
          const flash = 0.8 + Math.sin(lifecycleState.phaseProgress * Math.PI * 4) * 0.2;
          mat.emissiveIntensity = flash;
        }
      }
    });
  });

  return null;
}

// ── CYCLE INDICATOR (HUD) ──

export function CycleIndicator() {
  const [state, setState] = useState<WorldCycleState>(() =>
    WorldLifecycle.getInstance().getState()
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const lifecycle = WorldLifecycle.getInstance();
    try { lifecycle.start(); } catch { /* already started */ }
    return lifecycle.subscribe(setState);
  }, []);

  const lifecycle = WorldLifecycle.getInstance();
  const devAge = state.developmental ?? {
    complexity: 0, completedCycles: 0, meaningfulMemoryCount: 0,
    reflectionCount: 0, discoveryCount: 0, artifactCount: 0,
    projectCount: 0, worldComplexity: 0, engineComplexity: 0,
    currentCycleDuration: 70,
  };
  const phase = state.phase;
  const progress = state.phaseProgress;
  const speed = lifecycle.getSpeed();
  const paused = lifecycle.isPaused();

  const phaseLabels: Record<string, string> = {
    [WorldPhase.CORE_SEED]: "CORE",
    [WorldPhase.FORMATION]: "FORMATION",
    [WorldPhase.EXPANSION]: "EXPANSION",
    [WorldPhase.PLANET]: "PLANET",
    [WorldPhase.LIFE]: "LIFE",
    [WorldPhase.MIND]: "MIND",
    [WorldPhase.FULL_WORLD]: "FULL WORLD",
    [WorldPhase.SUNSET]: "SUNSET",
    [WorldPhase.COLLAPSE]: "COLLAPSE",
    [WorldPhase.REBIRTH]: "REBIRTH",
  };

  const phaseIcons: Record<string, string> = {
    [WorldPhase.CORE_SEED]: "◉",
    [WorldPhase.FORMATION]: "✦",
    [WorldPhase.EXPANSION]: "✧",
    [WorldPhase.PLANET]: "🌍",
    [WorldPhase.LIFE]: "🌿",
    [WorldPhase.MIND]: "🧠",
    [WorldPhase.FULL_WORLD]: "🌐",
    [WorldPhase.SUNSET]: "🌅",
    [WorldPhase.COLLAPSE]: "⊗",
    [WorldPhase.REBIRTH]: "💥",
  };

  const handleSpeed = (s: number | "pause") => {
    if (s === "pause") {
      if (paused) lifecycle.resume();
      else lifecycle.pause();
    } else {
      lifecycle.setSpeed(s);
    }
  };

  const handleForcePhase = (p: string) => {
    try {
      lifecycle.advanceToPhase(p as WorldPhaseType);
    } catch (err) {
      console.error("[CycleIndicator] Failed to advance phase:", err);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 90,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 20,
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 14px",
          background: "rgba(8, 16, 38, 0.75)",
          border: "1px solid rgba(148, 163, 184, 0.2)",
          borderRadius: 20,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: "rgba(200, 220, 240, 0.85)",
          fontSize: 10,
          fontFamily: "system-ui, sans-serif",
          letterSpacing: "0.08em",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontSize: 12 }}>{phaseIcons[phase] ?? "◉"}</span>
        <span>{phaseLabels[phase] ?? phase}</span>
        <div
          style={{
            width: 40,
            height: 3,
            background: "rgba(148, 163, 184, 0.2)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              background: paused ? "rgba(251, 191, 36, 0.6)" : "rgba(103, 232, 249, 0.6)",
              borderRadius: 2,
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <span style={{ opacity: 0.6 }}>{paused ? "⏸" : `${speed}×`}</span>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 6,
            padding: "10px 16px",
            background: "rgba(8, 16, 38, 0.85)",
            border: "1px solid rgba(148, 163, 184, 0.15)",
            borderRadius: 12,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minWidth: 280,
          }}
        >
          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
            {[
              { label: "⏸", value: "pause" as const },
              { label: "1×", value: 1 },
              { label: "2×", value: 2 },
              { label: "5×", value: 5 },
              { label: "10×", value: 10 },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => handleSpeed(opt.value)}
                style={{
                  padding: "3px 10px",
                  background:
                    (opt.value === "pause" && paused) ||
                    (opt.value !== "pause" && speed === opt.value)
                      ? "rgba(103, 232, 249, 0.2)"
                      : "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(148, 163, 184, 0.15)",
                  borderRadius: 6,
                  color: "rgba(200, 220, 240, 0.8)",
                  fontSize: 10,
                  fontFamily: "system-ui, sans-serif",
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "3px 12px",
              fontSize: 9,
              fontFamily: "monospace",
              color: "rgba(148, 163, 184, 0.7)",
            }}
          >
            <span>Cycle:</span>
            <span style={{ color: "rgba(200, 220, 240, 0.8)" }}>#{state.completedCycles + 1}</span>
            <span>Complexity:</span>
            <span style={{ color: "rgba(200, 220, 240, 0.8)" }}>{(devAge.complexity * 100).toFixed(0)}%</span>
            <span>Day length:</span>
            <span style={{ color: "rgba(200, 220, 220, 0.8)" }}>{devAge.currentCycleDuration.toFixed(0)}s</span>
            <span>Memories:</span>
            <span style={{ color: "rgba(200, 220, 240, 0.8)" }}>{devAge.meaningfulMemoryCount}</span>
            <span>Reflections:</span>
            <span style={{ color: "rgba(200, 220, 240, 0.8)" }}>{devAge.reflectionCount}</span>
            <span>Discoveries:</span>
            <span style={{ color: "rgba(200, 220, 240, 0.8)" }}>{devAge.discoveryCount}</span>
          </div>

          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>
            {PHASE_ORDER.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleForcePhase(p)}
                style={{
                  padding: "2px 6px",
                  background: phase === p ? "rgba(103, 232, 249, 0.2)" : "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(148, 163, 184, 0.1)",
                  borderRadius: 4,
                  color: "rgba(200, 220, 240, 0.6)",
                  fontSize: 8,
                  fontFamily: "system-ui, sans-serif",
                  cursor: "pointer",
                }}
              >
                {phaseLabels[p]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
