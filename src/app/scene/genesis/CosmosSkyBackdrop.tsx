/**
 * ==========================================================
 * LÉLUVERSE — COSMOS SKY BACKDROP (DOM LAYER)
 *
 * The guaranteed-visible phase sky. Rendered as plain DOM CSS
 * BEHIND the transparent 3D canvas, driven every frame by the
 * SAME sampleCosmosAtmosphere() the 3D layers use, so the
 * atmosphere lifecycle (deep-black-space → core-colors →
 * sunset → static → storm → hurricane → dissipation → rainbow)
 * is ALWAYS visible — even if the WebGL scene fails to paint
 * for any reason. The 3D CosmicBackdrop sphere adds nebula
 * depth ON TOP of this layer through the transparent canvas.
 *
 * Two phases get dedicated surfaces here:
 * - static  → real TV static snow: random grayscale noise on a
 *             low-res canvas (classic off-air look), NOT flashes
 *             of light.
 * - rainbow → the sign-off test pattern a station showed when it
 *             ended its broadcast: hard-stop rainbow color bars.
 *             It is the final phase, right before the atmosphere
 *             changes colors again.
 *
 * No WebGL, no GLSL, no GPU — this layer cannot fail to render.
 * ==========================================================
 */

import { useEffect, useRef } from "react";

import { sampleCosmosAtmosphere } from "./cosmos/CosmosAtmosphere";

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)})`;
}

interface SkyState {
  top: string;
  mid: string;
  bottom: string;
  sunset: number;
  static: number;
  hurricane: number;
  lightning: number;
  rainbow: number;
}

/** Mix the current atmosphere phase into a bright, unmistakable sky. */
function buildSky(timeSeconds: number): SkyState {
  const atmosphere = sampleCosmosAtmosphere(timeSeconds);

  // Start from a visible deep-space blue — never pure black.
  let r = 8;
  let g = 10;
  let b = 32;

  // core-colors → electric blue
  r += 30 * atmosphere.coreColors;
  g += 110 * atmosphere.coreColors;
  b += 215 * atmosphere.coreColors;

  // sunset → warm orange/amber
  r += 255 * atmosphere.sunset;
  g += 115 * atmosphere.sunset;
  b += 30 * atmosphere.sunset;

  // static → keep the base dark so the TV-snow canvas pops on top.
  r += 12 * atmosphere.static;
  g += 14 * atmosphere.static;
  b += 24 * atmosphere.static;

  // storm → purple/indigo
  r += 150 * atmosphere.storm;
  g += 75 * atmosphere.storm;
  b += 235 * atmosphere.storm;

  // hurricane → cyan/blue spiral light
  r += 55 * atmosphere.hurricane;
  g += 180 * atmosphere.hurricane;
  b += 240 * atmosphere.hurricane;

  // rainbow → soft warm-gray under the test-pattern bars
  r += 40 * atmosphere.rainbow;
  g += 34 * atmosphere.rainbow;
  b += 46 * atmosphere.rainbow;

  // Lightning floods the sky white-blue in sharp pulses.
  const pulse = Math.pow(Math.max(0, Math.sin(timeSeconds * 13.0)), 8);
  const flash = atmosphere.lightning * (0.35 + 0.65 * pulse);

  return {
    top: rgb(r * 0.95 + 30 * flash, g * 0.95 + 40 * flash, b * 0.95 + 60 * flash),
    mid: rgb(r * 0.8, g * 0.8, b * 0.95),
    bottom: rgb(r * 0.5, g * 0.5, b * 0.65),
    sunset: atmosphere.sunset,
    static: atmosphere.static,
    hurricane: atmosphere.hurricane,
    lightning: flash,
    rainbow: atmosphere.rainbow,
  };
}

/** Sign-off test pattern: hard-stop rainbow color bars. */
const RAINBOW_BARS =
  "linear-gradient(to right, " +
  "#d42a2a 0%, #d42a2a 14.28%, " +
  "#e8751a 14.28%, #e8751a 28.57%, " +
  "#f2d21b 28.57%, #f2d21b 42.85%, " +
  "#3fae49 42.85%, #3fae49 57.14%, " +
  "#2b7fe0 57.14%, #2b7fe0 71.42%, " +
  "#7a3fd0 71.42%, #7a3fd0 85.71%, " +
  "#d9438f 85.71%, #d9438f 100%)";

export default function CosmosSkyBackdrop() {
  const skyRef = useRef<HTMLDivElement>(null);
  const sunsetRef = useRef<HTMLDivElement>(null);
  const staticWrapRef = useRef<HTMLDivElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const hurricaneRef = useRef<HTMLDivElement>(null);
  const lightningRef = useRef<HTMLDivElement>(null);
  const rainbowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;

    // TV static snow — low-res random noise scaled up (coarse snow, like a
    // real off-air signal). ImageData is created once and reused every frame.
    const canvas = staticCanvasRef.current;
    let ctx: CanvasRenderingContext2D | null = null;
    let image: ImageData | null = null;
    if (canvas) {
      canvas.width = 480;
      canvas.height = 270;
      ctx = canvas.getContext("2d");
      if (ctx) {
        image = ctx.createImageData(canvas.width, canvas.height);
      }
    }

    let frame = 0;
    const tick = () => {
      const sky = buildSky(performance.now() / 1000);
      frame += 1;

      if (skyRef.current) {
        skyRef.current.style.background =
          `radial-gradient(130% 100% at 50% 8%, ${sky.top} 0%, ${sky.mid} 55%, ${sky.bottom} 100%)`;
      }
      if (sunsetRef.current) {
        sunsetRef.current.style.opacity = String(sky.sunset);
      }

      // TV static snow — redraw at ~30fps (real snow is coarse and flickery).
      if (ctx && image && sky.static > 0.02 && frame % 2 === 0) {
        const data = image.data;
        for (let i = 0; i < data.length; i += 4) {
          // Bimodal speckle: dark dots + bright dots = authentic snow.
          const bright = Math.random() < 0.5;
          const v = bright ? 185 + Math.random() * 70 : 15 + Math.random() * 45;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = Math.min(255, v + 12); // slight blue cast
          data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      }
      if (staticWrapRef.current) {
        staticWrapRef.current.style.opacity = String(sky.static * 0.92);
      }

      if (hurricaneRef.current) {
        hurricaneRef.current.style.opacity = String(sky.hurricane * 0.75);
      }
      if (lightningRef.current) {
        lightningRef.current.style.opacity = String(Math.min(1, sky.lightning));
      }
      if (rainbowRef.current) {
        rainbowRef.current.style.opacity = String(sky.rainbow);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={skyRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        background: "#080a1e",
      }}
    >
      {/* Sunset — warm horizon band rising from below */}
      <div
        ref={sunsetRef}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "45%",
          opacity: 0,
          pointerEvents: "none",
          background:
            "linear-gradient(to top, rgba(255,120,35,0.9) 0%, rgba(255,95,55,0.5) 38%, rgba(205,70,120,0.22) 68%, transparent 100%)",
        }}
      />

      {/* Static — TV static snow (random noise) + faint CRT scanlines */}
      <div
        ref={staticWrapRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <canvas
          ref={staticCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            imageRendering: "pixelated",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.35,
            background:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.30) 0px, rgba(0,0,0,0.30) 1px, transparent 1px, transparent 3px)",
          }}
        />
      </div>

      {/* Hurricane — rotating spiral */}
      <div
        ref={hurricaneRef}
        style={{
          position: "absolute",
          inset: "-60%",
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "conic-gradient(from 0deg, rgba(45,195,250,0.34), rgba(95,125,255,0.14) 25%, rgba(45,195,250,0.30) 50%, rgba(35,85,205,0.12) 75%, rgba(45,195,250,0.34))",
            filter: "blur(26px)",
            animation: "cosmos-hurricane-spin 7s linear infinite",
          }}
        />
      </div>

      {/* Lightning — white-blue flood */}
      <div
        ref={lightningRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(95% 70% at 50% 18%, rgba(195,220,255,0.6) 0%, rgba(145,175,255,0.28) 45%, transparent 78%)",
          }}
        />
      </div>

      {/* Rainbow — sign-off test pattern color bars */}
      <div
        ref={rainbowRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: RAINBOW_BARS,
            animation: "cosmos-rainbow-shimmer 3.2s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1px, transparent 1px, transparent 3px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,10,0.55) 100%)",
          }}
        />
      </div>

      <style>{`
        @keyframes cosmos-hurricane-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes cosmos-rainbow-shimmer {
          0%, 100% { filter: brightness(0.92); }
          50% { filter: brightness(1.08); }
        }
      `}</style>
    </div>
  );
}
