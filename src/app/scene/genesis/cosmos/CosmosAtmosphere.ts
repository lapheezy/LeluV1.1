/**
 * The Cosmos is one persistent universe. This model describes only the
 * atmosphere around it: lighting, color, signal, turbulence, and storm
 * intensity. Nothing here owns stars, galaxies, chunks, or camera state.
 */

export type CosmosAtmospherePhase =
  | "deep-black-space"
  | "core-colors"
  | "sunset"
  | "static"
  | "storm"
  | "hurricane"
  | "dissipation"
  | "rainbow";

export interface CosmosAtmosphereState {
  phase: CosmosAtmospherePhase;
  /** Progress through the named phase, from 0 to 1. */
  progress: number;
  /** 0..1 atmospheric presence above the baseline deep-space sky. */
  intensity: number;
  /** 0..1 cyan/blue/violet/pink core-inspired color influence. */
  coreColors: number;
  /** 0..1 warm sunset color influence. */
  sunset: number;
  /** 0..1 signal noise and scanline influence. */
  static: number;
  /** 0..1 storm cloud and turbulence influence. */
  storm: number;
  /** 0..1 rotating hurricane influence. */
  hurricane: number;
  /** 0..1 temporary lightning influence. */
  lightning: number;
  /** 0..1 sign-off test pattern (rainbow color bars) influence. */
  rainbow: number;
  /** Normalized hue offset for the existing atmospheric shader. */
  hueShift: number;
  /** Stable time value used by atmospheric shaders only. */
  time: number;
}

interface AtmosphereAnchor {
  intensity: number;
  coreColors: number;
  sunset: number;
  static: number;
  storm: number;
  hurricane: number;
  lightning: number;
  rainbow: number;
  hueShift: number;
}

interface AtmosphereSegment {
  phase: CosmosAtmospherePhase;
  duration: number;
  from: AtmosphereAnchor;
  to: AtmosphereAnchor;
}

const DEEP: AtmosphereAnchor = {
  intensity: 0.08,
  coreColors: 0,
  sunset: 0,
  static: 0,
  storm: 0,
  hurricane: 0,
  lightning: 0,
  rainbow: 0,
  hueShift: 0,
};

const CORE: AtmosphereAnchor = {
  intensity: 0.48,
  coreColors: 1,
  sunset: 0,
  static: 0,
  storm: 0,
  hurricane: 0,
  lightning: 0,
  rainbow: 0,
  hueShift: 0.08,
};

const SUNSET: AtmosphereAnchor = {
  intensity: 0.58,
  coreColors: 0.72,
  sunset: 1,
  static: 0,
  storm: 0,
  hurricane: 0,
  lightning: 0,
  rainbow: 0,
  hueShift: 0.16,
};

const SIGNAL: AtmosphereAnchor = {
  intensity: 0.48,
  coreColors: 0.6,
  sunset: 0.62,
  static: 1,
  storm: 0.08,
  hurricane: 0,
  lightning: 0,
  rainbow: 0,
  hueShift: 0.1,
};

const STORM: AtmosphereAnchor = {
  intensity: 0.62,
  coreColors: 0.42,
  sunset: 0.38,
  static: 0.42,
  storm: 1,
  hurricane: 0.2,
  lightning: 0.58,
  rainbow: 0,
  hueShift: -0.03,
};

const HURRICANE: AtmosphereAnchor = {
  intensity: 0.78,
  coreColors: 0.3,
  sunset: 0.22,
  static: 0.18,
  storm: 1,
  hurricane: 1,
  lightning: 1,
  rainbow: 0,
  hueShift: -0.08,
};

const DISSIPATION: AtmosphereAnchor = {
  intensity: 0.16,
  coreColors: 0.05,
  sunset: 0.03,
  static: 0,
  storm: 0.04,
  hurricane: 0,
  lightning: 0,
  rainbow: 0,
  hueShift: 0,
};

/**
 * The sign-off test pattern — the rainbow color bars a station put up
 * when it ended its broadcast. The bars reach full strength at the END
 * of the rainbow phase, then dissolve into deep space as the next
 * cycle's colors return (deep-black-space ramps from this anchor).
 */
const RAINBOW_OUT: AtmosphereAnchor = {
  intensity: 0.24,
  coreColors: 0.15,
  sunset: 0.05,
  static: 0.18,
  storm: 0,
  hurricane: 0,
  lightning: 0.15,
  rainbow: 1,
  hueShift: 0.4,
};

/* Durations are long enough to read as one evolving condition, not a scene
   carousel. Every segment chains into the next (each `to` is the following
   segment's `from`), so the cycle loops without any discontinuity. The
   rainbow test pattern is the final segment — it comes right before the
   atmosphere changes colors again. */
const SEGMENTS: AtmosphereSegment[] = [
  { phase: "deep-black-space", duration: 14, from: RAINBOW_OUT, to: CORE },
  { phase: "core-colors", duration: 12, from: CORE, to: SUNSET },
  { phase: "sunset", duration: 12, from: SUNSET, to: SIGNAL },
  { phase: "static", duration: 9, from: SIGNAL, to: STORM },
  { phase: "storm", duration: 12, from: STORM, to: HURRICANE },
  { phase: "hurricane", duration: 12, from: HURRICANE, to: DISSIPATION },
  { phase: "dissipation", duration: 8, from: DISSIPATION, to: DEEP },
  { phase: "rainbow", duration: 12, from: DEEP, to: RAINBOW_OUT },
];

export const COSMOS_ATMOSPHERE_CYCLE_SECONDS = SEGMENTS.reduce(
  (total, segment) => total + segment.duration,
  0,
);

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function interpolate(from: AtmosphereAnchor, to: AtmosphereAnchor, progress: number): AtmosphereAnchor {
  const t = smoothstep(progress);
  return {
    intensity: from.intensity + (to.intensity - from.intensity) * t,
    coreColors: from.coreColors + (to.coreColors - from.coreColors) * t,
    sunset: from.sunset + (to.sunset - from.sunset) * t,
    static: from.static + (to.static - from.static) * t,
    storm: from.storm + (to.storm - from.storm) * t,
    hurricane: from.hurricane + (to.hurricane - from.hurricane) * t,
    lightning: from.lightning + (to.lightning - from.lightning) * t,
    rainbow: from.rainbow + (to.rainbow - from.rainbow) * t,
    hueShift: from.hueShift + (to.hueShift - from.hueShift) * t,
  };
}

/** Sample the atmosphere without creating or changing any universe object. */
export function sampleCosmosAtmosphere(timeSeconds: number): CosmosAtmosphereState {
  const time = ((Number.isFinite(timeSeconds) ? timeSeconds : 0) % COSMOS_ATMOSPHERE_CYCLE_SECONDS + COSMOS_ATMOSPHERE_CYCLE_SECONDS) % COSMOS_ATMOSPHERE_CYCLE_SECONDS;
  let elapsed = 0;

  for (const segment of SEGMENTS) {
    const end = elapsed + segment.duration;
    if (time < end || segment === SEGMENTS[SEGMENTS.length - 1]) {
      const progress = Math.max(0, Math.min(1, (time - elapsed) / segment.duration));
      return {
        phase: segment.phase,
        progress,
        ...interpolate(segment.from, segment.to, progress),
        time: timeSeconds,
      };
    }
    elapsed = end;
  }

  return {
    phase: "deep-black-space",
    progress: 0,
    ...DEEP,
    time: timeSeconds,
  };
}
