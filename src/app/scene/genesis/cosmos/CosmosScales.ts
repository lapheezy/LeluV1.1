/**
 * ==========================================================
 * LÉLUVERSE — COSMOS SPATIAL SCALES
 *
 * The physical navigation hierarchy of the v1 cosmos camera:
 *
 *   PLANET   → the LÉLU planet / Earth Core (camera near origin)
 *   SOLAR    → the visible solar system (Sun + 8 planets)
 *   STELLAR  → nearby stellar space, looking back at the system
 *   GALACTIC → the deep field / galactic vantage
 *
 * This is the scale-aware navigation layer that lets the camera
 * move THROUGH the cosmos instead of stopping at the planet:
 * presets define real fly destinations, `scaleFromDistance`
 * derives the current scale from the actual camera, and
 * `flyCosmosScale` dispatches through the SAME `planet-navigate`
 * event the planet HUD already uses — so chat, voice and the
 * HUD all drive the one real camera, never a mocked state.
 *
 * The store mirrors `planetNavStore` (render/PlanetExplorer):
 * a module-level singleton the 3D probe updates and the DOM HUD
 * subscribes to. There is exactly one authoritative scale.
 * ==========================================================
 */

export type SpatialScale = "planet" | "solar" | "stellar" | "galactic";

export const SCALE_ORDER: SpatialScale[] = ["planet", "solar", "stellar", "galactic"];

export interface CosmosScalePreset {
  scale: SpatialScale;
  label: string;
  description: string;
  /** Camera destination in world units (v1 cosmos space). */
  position: [number, number, number];
  /** Point the camera looks at. */
  lookAt: [number, number, number];
  /** Camera-distance-from-origin range this scale corresponds to. */
  distanceRange: [number, number];
  /** Fly duration in seconds (longer for bigger jumps). */
  duration: number;
}

export const SCALE_PRESETS: Record<SpatialScale, CosmosScalePreset> = {
  planet: {
    scale: "planet",
    label: "PLANET",
    description: "LÉLU · Earth Core",
    position: [0, 0, 6.8],
    lookAt: [0, 1.15, 0],
    distanceRange: [0, 30],
    duration: 1.6,
  },
  solar: {
    scale: "solar",
    label: "SOLAR SYSTEM",
    description: "The Sun and its planets",
    // The SolarSystem group sits at [60,-5,-50]; the Sun is its
    // origin, Neptune orbits at radius 38 — park ~80 units out
    // so the whole system is framed.
    position: [60, 18, -128],
    lookAt: [60, -5, -50],
    distanceRange: [30, 160],
    duration: 2.6,
  },
  stellar: {
    scale: "stellar",
    label: "STELLAR SPACE",
    description: "Nearby stars, looking back at the system",
    position: [30, 100, 280],
    lookAt: [60, -5, -50],
    distanceRange: [160, 700],
    duration: 3.2,
  },
  galactic: {
    scale: "galactic",
    label: "GALAXY",
    description: "The Milky Way from beyond",
    position: [0, 460, 1040],
    lookAt: [0, 0, 0],
    distanceRange: [700, Infinity],
    duration: 4,
  },
};

/** Derive the current spatial scale from camera distance to the origin. */
export function scaleFromDistance(distance: number): SpatialScale {
  let scale: SpatialScale = "planet";
  for (const candidate of SCALE_ORDER) {
    if (distance >= SCALE_PRESETS[candidate].distanceRange[0]) {
      scale = candidate;
    }
  }
  return scale;
}

/** Map a spoken/phrase word to a scale (null when unrecognized). */
export function scaleFromPhrase(word: string): SpatialScale | null {
  const w = word.toLowerCase().replace(/\s+/g, " ").trim();
  if (
    w === "solar system" || w === "the solar system" ||
    w === "sun" || w === "the sun" || w === "our solar system"
  ) {
    return "solar";
  }
  if (
    w === "stars" || w === "the stars" || w === "stellar space" ||
    w === "deep space" || w === "nebula" || w === "the nebula"
  ) {
    return "stellar";
  }
  if (
    w === "galaxy" || w === "the galaxy" || w === "milky way" ||
    w === "the milky way" || w === "intergalactic space" ||
    w === "universe" || w === "the universe" || w === "cosmos" ||
    w === "the cosmos" || w === "outer space" || w === "space"
  ) {
    return "galactic";
  }
  if (w === "earth" || w === "the earth" || w === "planet" || w === "the planet") {
    return "planet";
  }
  return null;
}

/* ------------------------------------------------------------------
 * SCALE STORE — module-level, updated by the 3D probe, read by HUD
 * ------------------------------------------------------------------ */

type ScaleListener = (scale: SpatialScale) => void;

export const cosmosScaleStore = {
  scale: "planet" as SpatialScale,
  _listeners: new Set<ScaleListener>(),
  get(): SpatialScale {
    return this.scale;
  },
  set(next: SpatialScale): void {
    if (next !== this.scale) {
      this.scale = next;
      for (const fn of this._listeners) {
        try {
          fn(next);
        } catch {
          /* a listener must never break scale tracking */
        }
      }
    }
  },
  subscribe(fn: ScaleListener): () => void {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  },
};

/* ------------------------------------------------------------------
 * FLY — one shared dispatcher for the v1 camera
 * ------------------------------------------------------------------ */

/**
 * Fly the v1 cosmos camera to a scale preset through the existing
 * `planet-navigate` event the camera controller subscribes to.
 * Safe to call from chat/voice (ExplorationController) and the HUD.
 */
export function flyCosmosScale(scale: SpatialScale): void {
  if (typeof window === "undefined") return;
  const preset = SCALE_PRESETS[scale];
  window.dispatchEvent(
    new CustomEvent("planet-navigate", {
      detail: {
        pos: { x: preset.position[0], y: preset.position[1], z: preset.position[2] },
        lookAt: { x: preset.lookAt[0], y: preset.lookAt[1], z: preset.lookAt[2] },
        duration: preset.duration,
      },
    }),
  );
}
