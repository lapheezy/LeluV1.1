/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS NODE SPHERE
 *
 * The outer nodes of the workspace preview (Creation Studio,
 * Research Lab, Genesis Vault): a glowing wireframe energy
 * sphere with concentric orbit rings, a diamond marker above
 * and label block below — the reference's node language.
 *
 * These are real navigation surfaces: clicking a node routes
 * through the existing focusWorkspace / selectDestination /
 * openPanel machinery (see GenesisWorkspacePreview).
 * ==========================================================
 */

import type { CSSProperties } from "react";

export interface GenesisNodeSphereProps {
  /** Viewport-percentage anchor of the sphere center. */
  x: number;
  y: number;
  /** Primary luminous color. */
  color: string;
  /** Unique id prefix for SVG gradient ids (per node). */
  idPrefix: string;
  title: string;
  tagline: string;
  /** Module is online → renders the "Active" status. */
  active: boolean;
  /** Node is currently focused/selected → brighter treatment. */
  focused?: boolean;
  onClick: () => void;
  titleLabel?: string;
  /** Sphere diameter in px (responsive, computed from the viewport). */
  size?: number;
}

const nodeButtonBase: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  transform: "translate(-50%, -50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  border: "none",
  background: "transparent",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  pointerEvents: "auto",
};

export default function GenesisNodeSphere({
  x,
  y,
  color,
  idPrefix,
  title,
  tagline,
  active,
  focused = false,
  onClick,
  titleLabel,
  size: sizeProp,
}: GenesisNodeSphereProps) {
  const size = sizeProp ? `${sizeProp}px` : "clamp(76px, 9vw, 132px)";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={titleLabel ?? title}
      title={titleLabel ?? title}
      style={{
        ...nodeButtonBase,
        left: `${x}%`,
        top: `${y}%`,
        zIndex: 3,
      }}
    >
      {/* Diamond marker above the sphere */}
      <span
        aria-hidden
        className="genesis-marker-pulse"
        style={{
          width: 11,
          height: 11,
          transform: "rotate(45deg)",
          border: `1.5px solid ${color}`,
          background: `${color}22`,
          boxShadow: `0 0 12px ${color}, 0 0 26px ${color}66`,
          marginBottom: 4,
        }}
      />

      {/* Energy sphere */}
      <div style={{ position: "relative", width: size, height: size }}>
        {/* ambient glow */}
        <div
          aria-hidden
          className="genesis-node-breathe"
          style={{
            position: "absolute",
            inset: "-16%",
            borderRadius: 999,
            background: `radial-gradient(circle, ${color}${focused ? "59" : "3d"}, transparent 66%)`,
            filter: "blur(8px)",
            animation: "genesis-node-breathe 4.6s ease-in-out infinite",
          }}
        />
        {/* orbit rings */}
        <div
          aria-hidden
          className="genesis-ring-spin"
          style={{
            position: "absolute",
            inset: "-5%",
            borderRadius: 999,
            border: `1px solid ${color}${focused ? "99" : "66"}`,
            animation: "genesis-ring-spin 16s linear infinite",
            opacity: focused ? 0.95 : 0.7,
          }}
        />
        <div
          aria-hidden
          className="genesis-ring-spin-reverse"
          style={{
            position: "absolute",
            inset: "-13%",
            borderRadius: 999,
            border: `1px dashed ${color}55`,
            animation: "genesis-ring-spin-reverse 24s linear infinite",
            opacity: 0.65,
          }}
        />

        {/* wireframe sphere */}
        <svg
          viewBox="0 0 100 100"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          aria-hidden
        >
          <defs>
            <radialGradient id={`${idPrefix}-core`} cx="38%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="34%" stopColor={color} stopOpacity="0.85" />
              <stop offset="78%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.06" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="47" fill={`url(#${idPrefix}-core)`} stroke={color} strokeWidth="0.9" strokeOpacity="0.9" />
          {/* latitude / longitude wireframe */}
          <ellipse cx="50" cy="50" rx="47" ry="17" fill="none" stroke={color} strokeWidth="0.7" strokeOpacity="0.5" />
          <ellipse cx="50" cy="50" rx="47" ry="32" fill="none" stroke={color} strokeWidth="0.7" strokeOpacity="0.32" />
          <ellipse cx="50" cy="50" rx="17" ry="47" fill="none" stroke={color} strokeWidth="0.7" strokeOpacity="0.5" />
          <ellipse cx="50" cy="50" rx="32" ry="47" fill="none" stroke={color} strokeWidth="0.7" strokeOpacity="0.32" />
          {/* inner radial energy */}
          <circle cx="50" cy="50" r="20" fill="none" stroke="#ffffff" strokeWidth="0.6" strokeOpacity="0.4" />
        </svg>

        {/* bright inner core */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "26%",
            borderRadius: 999,
            background: `radial-gradient(circle at 38% 32%, #ffffff, ${color} 52%, ${color}11 100%)`,
            boxShadow: focused
              ? `0 0 26px ${color}, 0 0 60px ${color}77`
              : `0 0 18px ${color}, 0 0 40px ${color}55`,
            transition: "box-shadow 0.4s ease",
          }}
        />
      </div>

      {/* Labels */}
      <div style={{ textAlign: "center", marginTop: 6, userSelect: "none" }}>
        <div
          style={{
            fontSize: "clamp(11px, 1.05vw + 4px, 13.5px)",
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#ffffff",
            textShadow: `0 0 12px ${color}aa, 0 0 30px ${color}55`,
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: "clamp(9.5px, 0.8vw + 4px, 11.5px)",
            color: "rgba(203, 226, 244, 0.72)",
            marginTop: 3,
            letterSpacing: "0.05em",
            whiteSpace: "nowrap",
          }}
        >
          {tagline}
        </div>
        {active ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              marginTop: 5,
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color,
              textShadow: `0 0 10px ${color}`,
            }}
          >
            <span
              aria-hidden
              className="genesis-status-glow"
              style={{ width: 5, height: 5, borderRadius: 999, background: color, color }}
            />
            Active
          </div>
        ) : null}
      </div>
    </button>
  );
}
