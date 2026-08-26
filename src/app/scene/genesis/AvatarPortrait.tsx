/**
 * ==========================================================
 * LÉLU — AVATAR PORTRAIT
 *
 * A stylized SVG portrait of Lélu that is visually DISTINCT
 * from the CoreGlyph / Earth Core. This is her visual identity:
 * refined features, dark expressive eyes, textured short hair,
 * gold jewelry, black lace aesthetic.
 *
 * The CoreGlyph remains the Earth Core (tap→Chat, hold→Voice).
 * This component is the AVATAR.
 * ==========================================================
 */

import { useMemo } from "react";

interface AvatarPortraitProps {
  /** Pixel size of the square portrait */
  size: number;
  /** Current runtime state ring color */
  ring: string;
  /** Whether the state ring should pulse */
  pulse: boolean;
  /** Canonical avatar image (data URL) from the AvatarStore. When
   *  provided, this replaces the default stylized SVG portrait so the
   *  user's saved avatar becomes the visual identity everywhere. */
  referenceImage?: string | null;
  /** Live presence animation (breathing float) — driven by the avatar
   *  runtime state, applied via real CSS animation. */
  animated?: boolean;
  /** Ambient simulation effects (aurora shimmer / particle drift). */
  simulated?: boolean;
}

/**
 * Stylized Lélu portrait — elegant, dark-skinned woman with
 * gold jewelry, textured short hair, and candlelit warmth.
 * Built with SVG primitives so it renders on any device
 * without requiring 3D/WebGL or external assets.
 */
export default function AvatarPortrait({ size, ring, pulse, referenceImage, animated = false, simulated = false }: AvatarPortraitProps) {
  // Scale factor to make the viewBox coordinate math simpler
  const s = size / 220;

  const glowFilter = useMemo(() => `avatar-glow-${Math.round(size)}`, [size]);

  /* When the user has saved a canonical avatar image, render it directly
   * with the state ring overlaid — same runtime identity, user's own visual.
   * Uses contain + natural aspect ratio — NEVER crops the image. */
  if (referenceImage) {
    return (
      <div
        aria-label="Lélu portrait"
        role="img"
        style={{
          position: "relative",
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: 16,
          overflow: "hidden",
          background: "#08040a",
          boxShadow: `0 0 ${Math.round(size / 3)}px ${ring}44`,
          // Live presence animation — the saved avatar breathes/glides
          // when the avatar runtime has animation enabled.
          animation: animated ? "avatar-live-breathe 5.5s ease-in-out infinite" : undefined,
        }}
      >
        <img
          src={referenceImage}
          alt="Lélu"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            objectPosition: "center center",
            display: "block",
          }}
        />
        {/* Simulation shimmer — ambient particle/aurora drift over the
            saved avatar when the avatar runtime has simulation enabled. */}
        {simulated ? (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(ellipse 60% 45% at 30% 20%, ${ring}33 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 75% 78%, rgba(212, 169, 78, 0.18) 0%, transparent 62%)`,
              mixBlendMode: "screen",
              animation: "avatar-sim-shimmer 4.2s ease-in-out infinite",
              pointerEvents: "none",
            }}
          />
        ) : null}
        {/* State ring overlay — always visible even with custom avatar */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `2.5px solid ${ring}`,
            opacity: pulse ? 0.7 : 0.35,
            boxShadow: pulse ? `inset 0 0 ${Math.round(size / 4)}px ${ring}33` : undefined,
            animation: pulse
              ? "avatar-state-pulse 1.8s ease-in-out infinite"
              : undefined,
            pointerEvents: "none",
          }}
        />
        <style>{`
          @keyframes avatar-state-pulse {
            0%, 100% { opacity: 0.35; }
            50% { opacity: 0.7; }
          }
          @keyframes avatar-live-breathe {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-3px) scale(1.008); }
          }
          @keyframes avatar-sim-shimmer {
            0%, 100% { opacity: 0.35; }
            50% { opacity: 0.75; }
          }
        `}</style>
      </div>
    );
  }

  /* Fallback: default stylized SVG portrait when no canonical image is saved. */
  return (
    <div
      aria-label="Lélu portrait"
      role="img"
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        overflow: "hidden",
        background:
          "radial-gradient(ellipse 50% 80% at 50% 55%, #2a1a0a 0%, #140a04 55%, #080406 100%)",
        boxShadow: `0 0 ${Math.round(size / 3)}px ${ring}44, inset 0 0 ${Math.round(size / 2)}px #0a0503`,
      }}
    >
      {/* Candlelight ambient glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 40% 30% at 50% 35%, rgba(255,198,88,0.18) 0%, transparent 70%)",
          pointerEvents: "none",
          animation: pulse
            ? "avatar-candle-flicker 3s ease-in-out infinite"
            : undefined,
        }}
      />

      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          animation: animated ? "avatar-live-breathe 5.5s ease-in-out infinite" : undefined,
        }}
      >
      <svg
        viewBox="0 0 220 220"
        width={size}
        height={size}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
        aria-hidden
      >
        <defs>
          <filter id={glowFilter}>
            <feGaussianBlur stdDeviation={0.8 * s} />
          </filter>
          <radialGradient id="skinGrad" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#6b3a2a" />
            <stop offset="45%" stopColor="#4a2218" />
            <stop offset="100%" stopColor="#2a1008" />
          </radialGradient>
          <radialGradient id="cheekWarmth" cx="35%" cy="58%" r="25%">
            <stop offset="0%" stopColor="rgba(180,90,50,0.4)" />
            <stop offset="100%" stopColor="rgba(180,90,50,0)" />
          </radialGradient>
          <radialGradient id="cheekWarmthR" cx="65%" cy="58%" r="25%">
            <stop offset="0%" stopColor="rgba(180,90,50,0.35)" />
            <stop offset="100%" stopColor="rgba(180,90,50,0)" />
          </radialGradient>
          <radialGradient id="lipsGrad" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#8b2a3a" />
            <stop offset="60%" stopColor="#5a1825" />
            <stop offset="100%" stopColor="#3a0e16" />
          </radialGradient>
          <linearGradient id="hairGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0a080e" />
            <stop offset="50%" stopColor="#1a1520" />
            <stop offset="100%" stopColor="#0c0a10" />
          </linearGradient>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e8c45a" />
            <stop offset="40%" stopColor="#c9a030" />
            <stop offset="70%" stopColor="#f0d878" />
            <stop offset="100%" stopColor="#a07820" />
          </linearGradient>
          <linearGradient id="goldDark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c9a030" />
            <stop offset="100%" stopColor="#785818" />
          </linearGradient>
          <linearGradient id="laceGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0a080e" />
            <stop offset="50%" stopColor="#15101a" />
            <stop offset="100%" stopColor="#08060c" />
          </linearGradient>
        </defs>

        {/* ============================================ */}
        {/* SHOULDERS / CLOTHING — black lace bodice     */}
        {/* ============================================ */}
        <path
          d="M55 190 Q55 165 78 155 L78 220 L55 220 Z"
          fill="url(#laceGrad)"
          opacity="0.85"
        />
        <path
          d="M165 190 Q165 165 142 155 L142 220 L165 220 Z"
          fill="url(#laceGrad)"
          opacity="0.85"
        />
        {/* Lace pattern dots */}
        {[0, 1, 2, 3].map((i) => (
          <g key={`lace-l-${i}`}>
            <circle cx={65 + i * 5} cy={172 + i * 10} r={0.8} fill="#3a3240" opacity="0.4" />
            <circle cx={68 + i * 4} cy={175 + i * 9} r={0.6} fill="#4a3a50" opacity="0.35" />
          </g>
        ))}
        {[0, 1, 2, 3].map((i) => (
          <g key={`lace-r-${i}`}>
            <circle cx={155 - i * 5} cy={172 + i * 10} r={0.8} fill="#3a3240" opacity="0.4" />
            <circle cx={152 - i * 4} cy={175 + i * 9} r={0.6} fill="#4a3a50" opacity="0.35" />
          </g>
        ))}

        {/* ============================================ */}
        {/* NECK */}
        {/* ============================================ */}
        <path
          d="M98 135 Q110 150 110 160 Q110 172 100 180 L120 180 Q120 165 120 150 Q120 135 110 130 Z"
          fill="url(#skinGrad)"
        />
        <path
          d="M122 135 Q110 150 110 160 Q110 172 120 180 L100 180 Q100 165 100 150 Q100 135 110 130 Z"
          fill="url(#skinGrad)"
        />
        {/* Neck merged into face shape below */}

        {/* ============================================ */}
        {/* FACE — refined oval, elegant bone structure  */}
        {/* ============================================ */}
        <ellipse
          cx="110"
          cy="118"
          rx="38"
          ry="48"
          fill="url(#skinGrad)"
        />
        {/* Cheekbone warmth */}
        <ellipse cx="92" cy="125" rx="16" ry="12" fill="url(#cheekWarmth)" />
        <ellipse cx="128" cy="125" rx="16" ry="12" fill="url(#cheekWarmthR)" />

        {/* Jawline definition */}
        <path
          d="M78 110 Q78 148 110 168 Q142 148 142 110"
          fill="none"
          stroke="rgba(30,8,4,0.25)"
          strokeWidth="1.5"
        />

        {/* ============================================ */}
        {/* EYEBROWS — strong, refined arch               */}
        {/* ============================================ */}
        <path
          d="M80 98 Q90 88 100 94"
          fill="none"
          stroke="#0a0608"
          strokeWidth="2.8"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M140 98 Q130 88 120 94"
          fill="none"
          stroke="#0a0608"
          strokeWidth="2.8"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* ============================================ */}
        {/* EYES — dark, expressive, dramatic liner       */}
        {/* ============================================ */}
        {/* Left eye */}
        <ellipse cx="93" cy="108" rx="12" ry="5.5" fill="#faf8f6" opacity="0.9" />
        <ellipse cx="93" cy="109" rx="6.5" ry="4.5" fill="#1a0a06" />
        <circle cx="94" cy="108" r="2.2" fill="#0a0402" />
        <circle cx="95.5" cy="106.5" r="0.8" fill="rgba(255,255,255,0.55)" />
        {/* Dramatic upper liner */}
        <path
          d="M79 105 Q86 101 93 103 Q100 101 107 105"
          fill="none"
          stroke="#0a0402"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        {/* Wing */}
        <path
          d="M79 105 Q75 103 74 100"
          fill="none"
          stroke="#0a0402"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        {/* Lower lash line */}
        <path
          d="M84 112 Q93 115 102 112"
          fill="none"
          stroke="rgba(10,4,2,0.35)"
          strokeWidth="0.8"
          strokeLinecap="round"
        />

        {/* Right eye */}
        <ellipse cx="127" cy="108" rx="12" ry="5.5" fill="#faf8f6" opacity="0.9" />
        <ellipse cx="127" cy="109" rx="6.5" ry="4.5" fill="#1a0a06" />
        <circle cx="128" cy="108" r="2.2" fill="#0a0402" />
        <circle cx="129.5" cy="106.5" r="0.8" fill="rgba(255,255,255,0.55)" />
        <path
          d="M113 105 Q120 101 127 103 Q134 101 141 105"
          fill="none"
          stroke="#0a0402"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M141 105 Q145 103 146 100"
          fill="none"
          stroke="#0a0402"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M118 112 Q127 115 136 112"
          fill="none"
          stroke="rgba(10,4,2,0.35)"
          strokeWidth="0.8"
          strokeLinecap="round"
        />

        {/* ============================================ */}
        {/* NOSE — refined bridge + tip                  */}
        {/* ============================================ */}
        <path
          d="M110 102 Q107 118 105 124 Q110 128 112 124"
          fill="none"
          stroke="rgba(30,10,6,0.3)"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
        {/* Nostril hints */}
        <ellipse cx="107" cy="126" rx="2.5" ry="1.2" fill="rgba(20,6,3,0.2)" />
        <ellipse cx="115" cy="126" rx="2.5" ry="1.2" fill="rgba(20,6,3,0.2)" />

        {/* ============================================ */}
        {/* LIPS — full, sculpted                        */}
        {/* ============================================ */}
        <path
          d="M97 137 Q103 134 110 135 Q117 134 123 137 Q118 142 110 143 Q102 142 97 137 Z"
          fill="url(#lipsGrad)"
        />
        {/* Lip highlight */}
        <path
          d="M104 136 Q110 134.5 116 136"
          fill="none"
          stroke="rgba(220,150,160,0.2)"
          strokeWidth="0.7"
          strokeLinecap="round"
        />

        {/* ============================================ */}
        {/* HAIR — short textured finger waves          */}
        {/* ============================================ */}
        {/* Main hair mass */}
        <path
          d="M60 82 Q58 130 70 148 Q75 155 85 152 Q78 140 74 120 Q72 100 76 80 Z"
          fill="url(#hairGrad)"
        />
        <path
          d="M160 82 Q162 130 150 148 Q145 155 135 152 Q142 140 146 120 Q148 100 144 80 Z"
          fill="url(#hairGrad)"
        />
        {/* Top volume */}
        <path
          d="M76 80 Q80 50 110 45 Q140 50 144 80 Q130 60 110 58 Q90 60 76 80 Z"
          fill="url(#hairGrad)"
        />
        {/* Finger wave texture lines */}
        {[0, 1, 2, 3].map((i) => (
          <path
            key={`wave-l-${i}`}
            d={`M${62 + i * 4} ${90 + i * 12} Q${68 + i * 3} ${88 + i * 12} ${72 + i * 4} ${92 + i * 11}`}
            fill="none"
            stroke="rgba(40,30,50,0.35)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <path
            key={`wave-r-${i}`}
            d={`M${158 - i * 4} ${90 + i * 12} Q${152 - i * 3} ${88 + i * 12} ${148 - i * 4} ${92 + i * 11}`}
            fill="none"
            stroke="rgba(40,30,50,0.35)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        ))}
        {/* Sculpted tendrils framing forehead */}
        <path
          d="M76 78 Q72 72 74 66 Q77 62 80 68 Q82 74 80 78"
          fill="url(#hairGrad)"
        />
        <path
          d="M144 78 Q148 72 146 66 Q143 62 140 68 Q138 74 140 78"
          fill="url(#hairGrad)"
        />

        {/* ============================================ */}
        {/* GOLD JEWELRY                                */}
        {/* ============================================ */}

        {/* Left ankh hoop earring */}
        <circle cx="72" cy="115" r="7" fill="none" stroke="url(#goldGrad)" strokeWidth="1.8" />
        {/* Ankh cross inside */}
        <path
          d="M72 109 L72 117 M68 111 L76 111 M70 115 L74 115"
          fill="none"
          stroke="url(#goldGrad)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle cx="72" cy="108.5" r="1.5" fill="url(#goldGrad)" />

        {/* Right ankh hoop earring */}
        <circle cx="148" cy="115" r="7" fill="none" stroke="url(#goldGrad)" strokeWidth="1.8" />
        <path
          d="M148 109 L148 117 M144 111 L152 111 M146 115 L150 115"
          fill="none"
          stroke="url(#goldGrad)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle cx="148" cy="108.5" r="1.5" fill="url(#goldGrad)" />

        {/* Multi-layer choker with dark gemstone drop */}
        <path
          d="M84 148 Q110 158 136 148"
          fill="none"
          stroke="url(#goldGrad)"
          strokeWidth="1.5"
        />
        <path
          d="M86 151 Q110 161 134 151"
          fill="none"
          stroke="url(#goldDark)"
          strokeWidth="1"
        />
        {/* Dark gemstone pendant */}
        <ellipse cx="110" cy="162" rx="4" ry="5.5" fill="#1a0a1e" />
        <ellipse cx="109" cy="161" rx="1.5" ry="2.5" fill="rgba(180,120,200,0.25)" />
        {/* Pendant setting */}
        <path
          d="M108 157 Q110 155 112 157"
          fill="none"
          stroke="url(#goldGrad)"
          strokeWidth="0.8"
        />

        {/* Small septum ring */}
        <circle cx="110" cy="130" r="2.5" fill="none" stroke="url(#goldGrad)" strokeWidth="0.8" />

        {/* ============================================ */}
        {/* CANDLELIGHT WARMTH OVERLAY                   */}
        {/* ============================================ */}
        <ellipse
          cx="110"
          cy="100"
          rx="70"
          ry="70"
          fill="rgba(255,180,60,0.04)"
          style={{
            animation: pulse
              ? "avatar-candle-flicker 2.5s ease-in-out infinite"
              : undefined,
          }}
        />

        {/* ============================================ */}
        {/* STATE RING — runtime status (listening/      */}
        {/* thinking/speaking/idle) around the portrait  */}
        {/* ============================================ */}
        <circle
          cx="110"
          cy="110"
          r="102"
          fill="none"
          stroke={ring}
          strokeWidth="2"
          opacity={pulse ? "0.7" : "0.35"}
          filter="url(#avatar-glow)"
          style={{
            animation: pulse
              ? "avatar-state-pulse 1.8s ease-in-out infinite"
              : undefined,
          }}
        />
      </svg>

      {/* Simulation shimmer overlay for the SVG embodiment */}
      {simulated ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: `radial-gradient(ellipse 55% 40% at 32% 22%, ${ring}2e 0%, transparent 58%), radial-gradient(ellipse 45% 38% at 72% 76%, rgba(212, 169, 78, 0.16) 0%, transparent 60%)`,
            mixBlendMode: "screen",
            animation: "avatar-sim-shimmer 4.2s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      ) : null}

      {/* CSS keyframes for the candle flicker, live presence, simulation & state pulse */}
      <style>{`
        @keyframes avatar-candle-flicker {
          0%, 100% { opacity: 0.55; }
          25% { opacity: 0.7; }
          50% { opacity: 0.45; }
          75% { opacity: 0.65; }
        }
        @keyframes avatar-live-breathe {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-3px) scale(1.008); }
        }
        @keyframes avatar-sim-shimmer {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.75; }
        }
        @keyframes avatar-state-pulse {
          0%, 100% { opacity: 0.35; stroke-width: 2; }
          50% { opacity: 0.7; stroke-width: 3; }
        }
      `}</style>
      </div>
    </div>
  );
}

/**
 * CoreGlyph — the Earth Core visual. This is Lélu's symbolic
 * interaction hub, NOT her avatar. It remains its own component
 * used in the Genesis dock, GenesisLab, and other locations.
 *
 * Tap → Chat, Hold → Voice.
 */
export function CoreGlyph({
  size,
  ring,
}: {
  size: number;
  ring: { color: string; pulse: boolean; label: string };
}) {
  const core = ring.color;

  const particles = [
    { angle: 0.4, r: 0.46, d: 0 },
    { angle: 1.9, r: 0.42, d: 0.9 },
    { angle: 3.4, r: 0.5, d: 1.6 },
    { angle: 4.9, r: 0.44, d: 2.3 },
    { angle: 2.8, r: 0.36, d: 3.1 },
  ];

  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Auroral halo */}
      <div
        style={{
          position: "absolute",
          inset: -Math.round(size * 0.14),
          borderRadius: 999,
          background: `radial-gradient(circle, ${core}44, ${core}1a 55%, transparent 74%)`,
          animation: "genesis-lab-aurora 9s ease-in-out infinite",
        }}
      />
      {/* Core body */}
      <div
        style={{
          position: "absolute",
          width: Math.round(size * 0.48),
          height: Math.round(size * 0.48),
          borderRadius: 999,
          background: `radial-gradient(circle at 50% 32%, #ffffff, ${core} 48%, ${core}33 82%, transparent 100%)`,
          boxShadow: `0 0 ${Math.round(size / 3)}px ${core}bb, inset 0 0 ${Math.round(size / 6)}px ${core}88, inset 0 0 2px rgba(255,255,255,0.85)`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: -10,
            borderRadius: 999,
            background: `conic-gradient(from 0deg, transparent 0deg, ${core}59 42deg, transparent 92deg, ${core}44 148deg, transparent 210deg, ${core}44 268deg, transparent 330deg)`,
            animation: "genesis-lab-surface-spin 6s linear infinite",
          }}
        />
      </div>
      {/* Nucleus */}
      <div
        style={{
          position: "absolute",
          width: Math.round(size * 0.13),
          height: Math.round(size * 0.13),
          borderRadius: 999,
          background:
            "radial-gradient(circle, #ffffff, rgba(255,255,255,0.5) 55%, transparent 78%)",
          boxShadow: `0 0 ${Math.round(size / 5)}px #ffffff, 0 0 ${Math.round(size / 9)}px ${core}`,
          filter: "blur(0.3px)",
        }}
      />
      {/* Wireframe shell */}
      <div
        style={{
          position: "absolute",
          width: Math.round(size * 0.62),
          height: Math.round(size * 0.62),
          borderRadius: 999,
          border: `1px dashed ${core}66`,
          animation: "genesis-lab-orbital-rev 14s linear infinite",
        }}
      />
      {/* Orbital rings */}
      <div
        style={{
          position: "absolute",
          width: Math.round(size * 0.88),
          height: Math.round(size * 0.88),
          borderRadius: 999,
          border: `1px solid ${core}55`,
          transform: "rotateX(70deg)",
          animation: "genesis-lab-orbital 8s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: Math.round(size * 0.66),
          height: Math.round(size * 0.66),
          borderRadius: 999,
          border: `1px solid ${core}40`,
          transform: "rotateX(70deg) rotateZ(42deg)",
          animation: "genesis-lab-orbital-rev 11s linear infinite",
        }}
      />
      {/* Energy motes */}
      {particles.map((p, i) => {
        const x = Math.round(size * 0.5 + Math.cos(p.angle) * size * p.r);
        const y = Math.round(
          size * 0.5 + Math.sin(p.angle) * size * p.r * 0.62,
        );
        return (
          <span
            key={i}
            aria-hidden
            style={{
              position: "absolute",
              left: x - 1.5,
              top: y - 1.5,
              width: 3,
              height: 3,
              borderRadius: 999,
              background: i % 2 === 0 ? "#ffffff" : core,
              boxShadow: `0 0 6px ${core}`,
              animation: `genesis-lab-twinkle ${2.2 + p.d}s ease-in-out ${p.d}s infinite`,
            }}
          />
        );
      })}
    </div>
  );
}