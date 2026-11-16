/**
 * LÉLU — planet texture worker.
 *
 * The procedural Earth, cloud and city-light textures are pure noise maths
 * (~550 ms for the three 1024² maps on a desktop, ~4x that on a phone).
 * Run here, the main thread — and so the first interaction — never waits
 * for them. The pixels come back as a transferred buffer (no copy).
 */
import { cityLightsPixels, cloudPixels, earthSurfacePixels } from "./PlanetTextures";

export type PlanetTextureKind = "earth" | "clouds" | "cityLights";

const GENERATORS: Record<PlanetTextureKind, (size: number) => Uint8ClampedArray> = {
  earth: earthSurfacePixels,
  clouds: cloudPixels,
  cityLights: cityLightsPixels,
};

self.onmessage = (event: MessageEvent<{ id: number; kind: PlanetTextureKind; size: number }>) => {
  const { id, kind, size } = event.data;
  try {
    const pixels = GENERATORS[kind](size);
    (self as unknown as Worker).postMessage({ id, ok: true, pixels }, [pixels.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(error) });
  }
};
